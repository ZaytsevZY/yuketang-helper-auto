// src/state/actions.js
import { PROBLEM_TYPE_MAP } from '../core/types.js';
import { storage } from '../core/storage.js';
import { randInt } from '../core/env.js';
import { repo } from './repo.js';
import { ui } from '../ui/ui-api.js';
import { submitAnswer, retryAnswer } from '../tsm/answer.js';
import { queryKimi, queryKimiVision } from '../ai/kimi.js';
import { showAutoAnswerPopup } from '../ui/panels/auto-answer-popup.js';
import { captureProblemForVision } from '../capture/screenshoot.js';
import { formatProblemForAI, formatProblemForDisplay, formatProblemForVision, parseAIAnswer } from '../tsm/ai-format.js';

let _autoLoopStarted = false;

// 内部自动答题处理函数 - 融合模式（文本+图像）
async function handleAutoAnswerInternal(problem) {
  const status = repo.problemStatus.get(problem.problemId);
  if (!status || status.answering || problem.result) return;
  if (Date.now() >= status.endTime) return;

  try {
    console.log('[AutoAnswer] 使用融合模式分析（文本+图像）...');
    
    // 截图
    const imageBase64 = await captureProblemForVision();
    if (!imageBase64) {
      return ui.toast('无法截取页面图像，跳过自动作答', 3000);
    }
    
    // 使用新的 formatProblemForVision 函数构建提示
    const hasTextInfo = problem.body && problem.body.trim();
    const textPrompt = formatProblemForVision(problem, PROBLEM_TYPE_MAP, hasTextInfo);
    
    console.log('[AutoAnswer] 使用的提示:', textPrompt);
    
    const aiAnswer = await queryKimiVision(imageBase64, textPrompt, ui.config.ai);
    console.log('[AutoAnswer] AI回答:', aiAnswer);
    
    const parsed = parseAIAnswer(problem, aiAnswer);
    console.log('[AutoAnswer] 解析结果:', parsed);
    
    if (!parsed) {
      return ui.toast('融合模式无法解析答案，跳过自动作答', 3000);
    }

    await submitAnswer(problem, parsed);
    actions.onAnswerProblem(problem.problemId, parsed);
    ui.toast(`融合模式自动作答完成: ${String(problem.body || '').slice(0, 30)}...`, 3000);
    showAutoAnswerPopup(problem, aiAnswer);
    
  } catch (e) {
    console.error('[AutoAnswer] 融合模式失败', e);
    ui.toast(`融合模式自动作答失败: ${e.message}`, 3000);
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
    if (!problem || !slide) return;

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

    if (Date.now() > status.endTime || problem.result) return;

    if (ui.config.notifyProblems) ui.notifyProblem(problem, slide);

    if (ui.config.autoAnswer) {
      const delay = ui.config.autoAnswerDelay + randInt(0, ui.config.autoAnswerRandomDelay);
      status.autoAnswerTime = Date.now() + delay;
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
    await submitAnswer(problem, result);
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
  },
};