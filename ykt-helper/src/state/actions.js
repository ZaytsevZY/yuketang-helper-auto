// src/state/actions.js
import { PROBLEM_TYPE_MAP } from '../core/types.js';
import { storage } from '../core/storage.js';
import { randInt } from '../core/env.js';
import { repo } from './repo.js';
import { ui } from '../ui/ui-api.js';
import { submitAnswer, retryAnswer } from '../tsm/answer.js';
import { formatProblemForAI, formatProblemForDisplay, parseAIAnswer } from '../tsm/ai-format.js';
import { queryDeepSeek } from '../ai/deepseek.js';

let _autoLoopStarted = false;

export function startAutoAnswerLoop() {
  if (_autoLoopStarted) return;
  _autoLoopStarted = true;

  setInterval(() => {
    const now = Date.now();
    repo.problemStatus.forEach((status, pid) => {
      if (status.autoAnswerTime !== null && now >= status.autoAnswerTime) {
        const problem = repo.problems.get(pid);
        if (problem && !problem.result) {
          status.autoAnswerTime = null;      // 防重入
          actions.handleAutoAnswer(problem); // 已实现
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

    // toast + 通知
    if (ui.config.notifyProblems) ui.notifyProblem(problem, slide);

    // 自动作答
    if (ui.config.autoAnswer) {
      const delay = ui.config.autoAnswerDelay + randInt(0, ui.config.autoAnswerRandomDelay);
      status.autoAnswerTime = Date.now() + delay;
      ui.toast(`将在 ${Math.floor(delay / 1000)} 秒后自动作答本题`, 3000);
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
    const status = repo.problemStatus.get(problem.problemId);
    if (!status || status.answering || problem.result) return;
    if (Date.now() >= status.endTime) return;

    try {
      const q = formatProblemForAI(problem, PROBLEM_TYPE_MAP);
      const aiAnswer = await queryDeepSeek(q, ui.config.ai);
      const parsed = parseAIAnswer(problem, aiAnswer);
      if (!parsed) return ui.toast('无法解析AI答案，跳过自动作答', 2000);

      await submitAnswer(problem, parsed);
      this.onAnswerProblem(problem.problemId, parsed);
      ui.toast(`自动作答完成: ${String(problem.body || '').slice(0, 30)}...`, 3000);
      showAutoAnswerPopup(problem, typeof aiAnswer === 'string' ? aiAnswer : JSON.stringify(aiAnswer, null, 2));
    } catch (e) {
      console.error('[AutoAnswer] failed', e);
      ui.toast(`自动作答失败: ${e.message}`, 3000);
    }
  },

  // 定时器驱动（由 index.js 安装）
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
};
