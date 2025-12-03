// src/state/repo.js
import { storage } from '../core/storage.js';

export const repo = {
  presentations: new Map(), // id -> presentation
  slides: new Map(),        // slideId -> slide
  problems: new Map(),      // problemId -> problem
  problemStatus: new Map(), // problemId -> {presentationId, slideId, startTime, endTime, done, autoAnswerTime, answering}
  encounteredProblems: [],  // [{problemId, ...ref}]

  currentPresentationId: null,
  currentSlideId: null,
  currentLessonId: null,
  currentSelectedUrl: null,

  // 按课程分组存储课件
  setPresentation(id, data) {
    this.presentations.set(id, { id, ...data });
    const key = this.currentLessonId ? `presentations-${this.currentLessonId}` : 'presentations';
    storage.alterMap(key, (m) => {
      m.set(id, data);
      // 仍然做容量裁剪
      const max = (storage.get('config', {})?.maxPresentations ?? 5);
      const excess = m.size - max;
      if (excess > 0) [...m.keys()].slice(0, excess).forEach(k => m.delete(k));
    });
  },

  upsertSlide(slide) { this.slides.set(slide.id, slide); },
  upsertProblem(prob) { this.problems.set(prob.problemId, prob); },

  pushEncounteredProblem(prob, slide, presentationId) {
    if (!this.encounteredProblems.some(p => p.problemId === prob.problemId)) {
      this.encounteredProblems.push({
        problemId: prob.problemId,
        problemType: prob.problemType,
        body: prob.body || `题目ID: ${prob.problemId}`,
        options: prob.options || [],
        blanks: prob.blanks || [],
        answers: prob.answers || [],
        slide, presentationId,
      });
    }
  },

  // === 自动进入课堂所需的多“线程”（多课堂）状态 ===
  listeningLessons: new Set(),      // lessonId 的集合，表示已经建立WS监听
  lessonTokens: new Map(),          // lessonId -> lessonToken（/lesson/checkin 返回）
  lessonSockets: new Map(),         // lessonId -> WebSocket 实例
  autoJoinRunning: false,           // 轮询开关
  autoJoinedLessons: new Set(),     // 被“自动进入”的课堂集合（仅标记自动进入建立的连接）
  forceAutoAnswerLessons: new Set(),// 若需要，可以对某些课强制视为“自动答题开启”

  // 载入本课（按课程分组）在本地存储过的课件
  loadStoredPresentations() {
    if (!this.currentLessonId) return;
    const key = `presentations-${this.currentLessonId}`;
    const stored = storage.getMap(key);
    for (const [id, data] of stored.entries()) {
      this.setPresentation(id, data);
    }
  },

  markLessonConnected(lessonId, ws, token) {
    if (token) this.lessonTokens.set(lessonId, token);
    if (ws) this.lessonSockets.set(lessonId, ws);
    this.listeningLessons.add(lessonId);
  },

  isLessonConnected(lessonId) {
    return this.listeningLessons.has(lessonId) && this.lessonSockets.get(lessonId);
  },

  markLessonAutoJoined(lessonId, enabled = true) {
    if (!lessonId) return;
    if (enabled) this.autoJoinedLessons.add(lessonId);
    else this.autoJoinedLessons.delete(lessonId);
  },
};
