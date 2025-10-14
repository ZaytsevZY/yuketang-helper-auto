// src/state/actions.js
import { PROBLEM_TYPE_MAP } from '../core/types.js';
import { storage } from '../core/storage.js';
import { randInt, gm } from '../core/env.js'
import { repo } from './repo.js';
import { ui } from '../ui/ui-api.js';
import { submitAnswer, retryAnswer } from '../tsm/answer.js';
import { queryKimi, queryKimiVision } from '../ai/kimi.js';
import { showAutoAnswerPopup } from '../ui/panels/auto-answer-popup.js';
import { formatProblemForAI, formatProblemForDisplay, formatProblemForVision, parseAIAnswer } from '../tsm/ai-format.js';
import { captureSlideImage, captureProblemForVision } from '../capture/screenshoot.js';  // ✅ 添加 captureSlideImage
import { getOnLesson, checkinClass } from '../net/xhr-interceptor.js';
import { connectOrAttachLessonWS } from '../net/ws-interceptor.js';

let _autoLoopStarted = false;
let _autoJoinStarted = false;
let _autoOnLessonClickStarted = false;
let _autoOnLessonClickInProgress = false;

// 1.18.5: 本地默认答案生成（无 API Key 时使用，保持 AutoAnswer 流程通畅）
function makeDefaultAnswer(problem) {
  switch (problem.problemType) {
    case 1: // 单选
    case 2: // 多选
    case 3: // 投票
      return ['A'];
    case 4: // 填空
      // 按需求示例返回 [" 1"]（保留前导空格）
      return [' 1'];
    case 5: // 主观/问答
      return { content: '略', pics: [] };
    default:
      // 兜底：按单选处理
      return ['A'];
  }
}

// 内部自动答题处理函数 - 融合模式（文本+图像）
async function handleAutoAnswerInternal(problem) {
  const status = repo.problemStatus.get(problem.problemId);
  if (!status || status.answering || problem.result) {
    console.log('[AutoAnswer] 跳过：', {
      hasStatus: !!status,
      answering: status?.answering,
      hasResult: !!problem.result
    });
    return;
  }
  
  if (Date.now() >= status.endTime) {
    console.log('[AutoAnswer] 跳过：已超时');
    return;
  }

  status.answering = true;

  try {
    console.log('[AutoAnswer] =================================');
    console.log('[AutoAnswer] 开始自动答题');
    console.log('[AutoAnswer] 题目ID:', problem.problemId);
    console.log('[AutoAnswer] 题目类型:', PROBLEM_TYPE_MAP[problem.problemType]);
    console.log('[AutoAnswer] 题目内容:', problem.body?.slice(0, 50) + '...');
    
    if (!ui.config.ai.kimiApiKey) {
    // ✅ 无 API Key：使用本地默认答案直接提交，确保流程不中断
    // 
      const parsed = makeDefaultAnswer(problem);
      console.log('[AutoAnswer] 无 API Key，使用本地默认答案:', JSON.stringify(parsed));

      // 提交答案（根据时限自动选择 answer/retry 逻辑）
      await submitAnswer(problem, parsed, {
        startTime: status.startTime,
        endTime: status.endTime,
        forceRetry: false,
        lessonId: repo.currentLessonId,
      });

      // 更新状态与UI
      actions.onAnswerProblem(problem.problemId, parsed);
      status.done = true;
      status.answering = false;

      ui.toast('✅ 使用默认答案完成作答（未配置 API Key）', 3000);
      showAutoAnswerPopup(problem, '（本地默认答案：无 API Key）');

      console.log('[AutoAnswer] ✅ 默认答案提交流程结束');
      return; // 提前返回，避免继续走图像+AI流程
    }

    const slideId = status.slideId;
    console.log('[AutoAnswer] 题目所在幻灯片:', slideId);
    console.log('[AutoAnswer] =================================');
    
    // ✅ 关键修复：直接使用幻灯片的cover图片，而不是截图DOM
    console.log('[AutoAnswer] 使用融合模式分析（文本+幻灯片图片）...');
    
    let imageBase64 = await captureSlideImage(slideId);
    
    // ✅ 如果获取幻灯片图片失败，回退到DOM截图
    if (!imageBase64) {
      console.log('[AutoAnswer] 无法获取幻灯片图片，尝试使用DOM截图...');
      const fallbackImage = await captureProblemForVision();
      
      if (!fallbackImage) {
        status.answering = false;
        console.error('[AutoAnswer] 所有截图方法都失败');
        return ui.toast('无法获取题目图像，跳过自动作答', 3000);
      }
      
      imageBase64 = fallbackImage;
      console.log('[AutoAnswer] ✅ DOM截图成功');
    } else {
      console.log('[AutoAnswer] ✅ 幻灯片图片获取成功');
    }
    
    console.log('[AutoAnswer] 图片大小:', Math.round(imageBase64.length / 1024), 'KB');
    
    // 构建提示
    const hasTextInfo = problem.body && problem.body.trim();
    const textPrompt = formatProblemForVision(problem, PROBLEM_TYPE_MAP, hasTextInfo);
    
    console.log('[AutoAnswer] 文本信息:', hasTextInfo ? '有' : '无');
    console.log('[AutoAnswer] 提示长度:', textPrompt.length);
    
    // 调用 AI
    ui.toast('AI 正在分析题目...', 2000);
    const aiAnswer = await queryKimiVision(imageBase64, textPrompt, ui.config.ai);
    console.log('[AutoAnswer] ✅ AI回答:', aiAnswer);
    
    // 解析答案
    const parsed = parseAIAnswer(problem, aiAnswer);
    console.log('[AutoAnswer] 解析结果:', parsed);
    
    if (!parsed) {
      status.answering = false;
      console.error('[AutoAnswer] 解析失败，AI回答格式不正确');
      return ui.toast('无法解析AI答案，请检查格式', 3000);
    }

    console.log('[AutoAnswer] ✅ 准备提交答案:', JSON.stringify(parsed));
    
    // 提交答案
    await submitAnswer(problem, parsed, {
      startTime: status.startTime,
      endTime: status.endTime,
      forceRetry: false,
      lessonId: repo.currentLessonId
    });
    
    console.log('[AutoAnswer] ✅ 提交成功');
    
    // 更新状态
    actions.onAnswerProblem(problem.problemId, parsed);
    status.done = true;
    status.answering = false;
    
    ui.toast(`✅ 自动作答完成`, 3000);
    showAutoAnswerPopup(problem, aiAnswer);
    
  } catch (e) {
    console.error('[AutoAnswer] ❌ 失败:', e);
    console.error('[AutoAnswer] 错误堆栈:', e.stack);
    status.answering = false;
    ui.toast(`自动作答失败: ${e.message}`, 4000);
  }
}

export function startAutoAnswerLoop() {
  if (_autoLoopStarted) return;
  _autoLoopStarted = true;

  setInterval(() => {
    const now = Date.now();
    repo.problemStatus.forEach((status, pid) => {
      if (status.autoAnswerTime !== null && now >= status.autoAnswerTime) {
        const problem = repo.problems.get(pid);
        if (problem && !problem.result) {
          status.autoAnswerTime = null;
          handleAutoAnswerInternal(problem);
        }
      }
    });
  }, 500);
}

export const actions = {
  onFetchTimeline(timeline) {
    for (const piece of timeline) if (piece.type === 'problem') this.onUnlockProblem(piece);
  },

  onPresentationLoaded(id, data) {
    repo.setPresentation(id, data);
    const pres = repo.presentations.get(id);
    for (const slide of pres.slides) {
      repo.upsertSlide(slide);
      if (slide.problem) {
        repo.upsertProblem(slide.problem);
        repo.pushEncounteredProblem(slide.problem, slide, id);
      }
    }
    ui.updatePresentationList();
  },

  onUnlockProblem(data) {
    const problem = repo.problems.get(data.prob);
    const slide = repo.slides.get(data.sid);
    if (!problem || !slide) {
      console.log('[onUnlockProblem] 题目或幻灯片不存在');
      return;
    }

    console.log('[onUnlockProblem] 题目解锁');
    console.log('[onUnlockProblem] 题目ID:', data.prob);
    console.log('[onUnlockProblem] 幻灯片ID:', data.sid);
    console.log('[onUnlockProblem] 课件ID:', data.pres);

    const status = {
      presentationId: data.pres,
      slideId: data.sid,
      startTime: data.dt,
      endTime: data.dt + 1000 * data.limit,
      done: !!problem.result,
      autoAnswerTime: null,
      answering: false,
    };
    repo.problemStatus.set(data.prob, status);

    if (Date.now() > status.endTime || problem.result) {
      console.log('[onUnlockProblem] 题目已过期或已作答，跳过');
      return;
    }

    if (ui.config.notifyProblems) {
      ui.notifyProblem(problem, slide);
    }

    if (ui.config.autoAnswer) {
      const delay = ui.config.autoAnswerDelay + randInt(0, ui.config.autoAnswerRandomDelay);
      status.autoAnswerTime = Date.now() + delay;
      
      console.log(`[onUnlockProblem] 将在 ${Math.floor(delay / 1000)} 秒后自动作答`);
      ui.toast(`将在 ${Math.floor(delay / 1000)} 秒后使用融合模式自动作答`, 3000);
    }
    
    ui.updateActiveProblems();
  },

  onLessonFinished() {
    ui.nativeNotify({ title: '下课提示', text: '当前课程已结束', timeout: 5000 });
  },

  onAnswerProblem(problemId, result) {
    const p = repo.problems.get(problemId);
    if (p) {
      p.result = result;
      const i = repo.encounteredProblems.findIndex(e => e.problemId === problemId);
      if (i !== -1) repo.encounteredProblems[i].result = result;
      ui.updateProblemList();
    }
  },

  async handleAutoAnswer(problem) {
    return handleAutoAnswerInternal(problem);
  },

  tickAutoAnswer() {
    const now = Date.now();
    for (const [pid, status] of repo.problemStatus) {
      if (status.autoAnswerTime !== null && now >= status.autoAnswerTime) {
        const p = repo.problems.get(pid);
        if (p) {
          status.autoAnswerTime = null;
          this.handleAutoAnswer(p);
        }
      }
    }
  },

  async submit(problem, content) {
    const result = this.parseManual(problem.problemType, content);
    await submitAnswer(problem, result,{
      lessonId: repo.currentLessonId,
      autoGate: false  // 手动提交：保持旧行为，不触发自动等待/判定
    });
    this.onAnswerProblem(problem.problemId, result);
  },

  parseManual(problemType, content) {
    switch (problemType) {
      case 1: case 2: case 3: return content.split('').sort();
      case 4: return content.split('\n').filter(Boolean);
      case 5: return { content, pics: [] };
      default: return null;
    }
  },

  navigateTo(presId, slideId) {
    repo.currentPresentationId = presId;
    repo.currentSlideId = slideId;
    ui.updateSlideView();
    ui.showPresentationPanel(true);
  },

  launchLessonHelper() {
    const path = window.location.pathname;
    const m = path.match(/\/lesson\/fullscreen\/v3\/([^/]+)/);
    repo.currentLessonId = m ? m[1] : null;
    if (repo.currentLessonId) {
      console.log(`[雨课堂助手] 检测到课堂页面 lessonId: ${repo.currentLessonId}`);
    }

    if (typeof window.GM_getTab === 'function' && typeof window.GM_saveTab === 'function' && repo.currentLessonId) {
      window.GM_getTab((tab) => {
        tab.type = 'lesson';
        tab.lessonId = repo.currentLessonId;
        window.GM_saveTab(tab);
      });
    }
    repo.loadStoredPresentations();
     if (ui.config.autoJoinEnabled) {
      this.startAutoJoinLoop();
      // 仅在非课堂页尝试：自动模拟点击“正在上课”条，触发官方路由跳转
      this.startAutoClickOnOnLessonBar();
    }
  },
  
    startAutoAnswerLoop() {
    if (_autoLoopStarted) return;
    _autoLoopStarted = true;

    setInterval(() => {
      const now = Date.now();
      repo.problemStatus.forEach((status, pid) => {
        if (status.autoAnswerTime !== null && now >= status.autoAnswerTime) {
          const problem = repo.problems.get(pid);
          if (problem && !problem.result) {
            status.autoAnswerTime = null;
            handleAutoAnswerInternal(problem);
          }
        }
      });
    }, 500);
  },

  // ===== 自动进入课堂：轮询“正在上课”并为每个课堂独立建链 =====
  startAutoJoinLoop() {
    if (_autoJoinStarted) return;
    _autoJoinStarted = true;
    repo.autoJoinRunning = true;

    const loop = async () => {
      if (!repo.autoJoinRunning) return;
      try {
        const list = await getOnLesson();
        // 期望结构：每项至少含 { lessonId, status }，其中 status==1 表示正在上课
        for (const it of list) {
          const lessonId = it.lessonId || it.lesson_id || it.id;
          const status = it.status;
          if (!lessonId || status !== 1) continue;
          if (repo.isLessonConnected(lessonId)) continue; // 已有连接

          console.log('[AutoJoin] 检测到正在上课的课堂，准备进入:', lessonId);
          try {
            const { token, setAuth } = await checkinClass(lessonId);
            if (!token) {
              console.warn('[AutoJoin] 未获取到 lessonToken，跳过:', lessonId);
              continue;
            }
            // 建立 WS 并发送 hello（消息会走 ws-interceptor 统一分发）
            connectOrAttachLessonWS({ lessonId, auth: token });
            // 标记该课堂为“自动进入”
            repo.markLessonAutoJoined(lessonId, true);
            // 若设置为“自动进入课堂默认自动答题”，为该课放开自动答题判定
            if (ui.config.autoAnswerOnAutoJoin) {
              repo.forceAutoAnswerLessons.add(lessonId);
              // 说明：该标记只作为“shouldAutoAnswer”判定的一个加项，不直接改全局 autoAnswer
            }
          } catch (e) {
            console.error('[AutoJoin] 进入课堂失败:', lessonId, e);
          }
        }
      } catch (e) {
          console.error('[AutoJoin] 拉取正在上课失败:', e);
      } finally {
        // 5 秒一轮，保证多课堂时彼此独立、互不阻塞
        setTimeout(loop, 5000);
      }
    };
    loop();
  },

  stopAutoJoinLoop() {
    repo.autoJoinRunning = false;
  },

  // ===== 自动点击“正在上课”条：无需预先拿 lesson_id，复用官方路由逻辑 =====
  startAutoClickOnOnLessonBar() {
    if (_autoOnLessonClickStarted) return;
    _autoOnLessonClickStarted = true;

    // 仅在非课堂页（首页/课表页等）生效
    if (/\/lesson\//.test(location.pathname)) return;

    const uw = (gm && gm.uw) ? gm.uw : (window.unsafeWindow || window);

    async function tryApiJumpFirst() {
      if (_autoOnLessonClickInProgress) return false;
      _autoOnLessonClickInProgress = true;
      try {
        const list = await getOnLesson();              // ← 强化后的版本
        const arr = Array.isArray(list) ? list : [];
        // A) 严格：status===1
        let on = arr.find(x => (x?.status === 1) && (x.lessonId || x.lesson_id || x.id));
        // B) 回退：没有严格匹配，但有 lessonId 就用第一条
        if (!on) {
          const withId = arr.find(x => (x && (x.lessonId || x.lesson_id || x.id)));
          if (withId) {
            console.warn('[AutoJoin][API] 没有 status===1，但存在 lessonId，使用回退项：', {
              status: withId.status,
              keys: Object.keys(withId || {}),
              sample: withId
            });
            on = withId;
          }
        }
        if (!on) {
          // 详细日志：环境、主机、列表长度与前 3 项
          try {
            console.warn('[AutoJoin][API] EMPTY on-lesson list', {
              host: location.hostname,
              path: location.pathname,
              length: Array.isArray(list) ? list.length : -1,
              sample: Array.isArray(list) ? list.slice(0, 3) : list
            });
          } catch {}
          _autoOnLessonClickInProgress = false; 
          return false;
        }
        const lessonId = on.lessonId || on.lesson_id || on.id;
        const classroomId = on.classroomId || on.classroom_id;
        // 优先尝试 checkin（带 classroomId 提高成功率）
        try {
          await checkinClass(lessonId, { classroomId });
        } catch (e) {
          // 如果 checkin 400，兜底直接跳 lesson 页面，让站内自己完成后续
          console.warn('[AutoJoin][API] checkin 失败，兜底直跳 lesson 页：', e);
        }

        // 已在 /index 的“重复导航”告警：如果目标与当前一致就不跳
        const target = `/v2/web/lesson/${lessonId}`;
        if (location.pathname === target) { _autoOnLessonClickInProgress = false; return true; }

        // 为了少日志，先 replace 再 assign（站内有时也会 push /index）
        history.replaceState(null, '', location.href);
        location.assign(target);
        return true;
      } catch (e) {
        console.warn('[AutoJoin][API] 跳转失败：', e, {
          host: location.hostname,
          path: location.pathname
        });
        _autoOnLessonClickInProgress = false;
        return false;
      }
    }

    function attachGuardAndTrigger(root = uw.document) {
      const bar = root.querySelector('.onlesson .jump_lesson__bar');
      if (!bar || bar.__ykt_guard_bound__) return false;
      if (_autoOnLessonClickInProgress) return false;

      bar.__ykt_guard_bound__ = true;
      console.log('[AutoJoin][DOM] 发现 onlesson 条，接管点击（捕获阶段）');

      const handler = async (ev) => {
        ev.preventDefault();
        ev.stopImmediatePropagation?.();
        ev.stopPropagation();
        if (_autoOnLessonClickInProgress) return;

        // 延时阶梯：考虑 WS 刚推完 banner 但接口还没更新
        const delays = [0, 250, 600, 1200, 2000, 3000];
        for (const d of delays) {
          if (d) await new Promise(r => setTimeout(r, d));
          if (await tryApiJumpFirst()) return;
        }
        console.warn('[AutoJoin][DOM] on-lesson 接口仍为空，放弃本次点击');
        try {
          console.group('%c[AutoJoin][DOM] on-lesson 仍为空，放弃本次点击', 'color:#f60');
          console.log('env:', { host: location.hostname, path: location.pathname, href: location.href });
          console.log('retryDelays(ms):', delays);
          console.log('hint:', '可能是域/路径不匹配、会话未带上、或 WS/接口不同步导致。请展开上方 [getOnLesson] 折叠日志查看每个候选 URL 的状态与响应片段。');
          console.groupEnd();
        } catch {}
      };

      bar.addEventListener('click', handler, { capture: true });
      // 触发一次我们自己的 click（优先进入捕获处理器）
      try {
        const W = bar.ownerDocument?.defaultView || uw;
        const ClickEvt = W.MouseEvent || uw.MouseEvent;
        bar.dispatchEvent(new ClickEvt('click', { bubbles: true, cancelable: true, view: W }));
      } catch (e) {
        // 兜底：部分环境对 MouseEvent 构造器有限制
        try { bar.click(); } catch (_) {}
      }
      return true;
    }

    // A) 首选：直接 API 跳转（若此时就能拿到 on-lesson，就不必等 DOM）
    tryApiJumpFirst().then((ok) => {
      if (ok) return;
      // B) DOM 渲染后接管点击
      if (attachGuardAndTrigger()) return;
      const mo = new uw.MutationObserver(() => {
        if (attachGuardAndTrigger()) { mo.disconnect(); return; }
      });
      mo.observe(uw.document.documentElement, { childList: true, subtree: true });
      setTimeout(() => mo.disconnect(), 10000);
    });
  },
};