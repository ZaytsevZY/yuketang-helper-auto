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

  // 1.16.4:按课程分组存储课件（presentations-<lessonId>）
  setPresentation(id, data) {
    this.presentations.set(id, { id, ...data });
    const key = this.currentLessonId ? `presentations-${this.currentLessonId}` : 'presentations';
    storage.alterMap(key, (m) => {
      m.set(id, data);
      // 仍然做容量裁剪（向后兼容）
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

  // 1.16.4:载入本课（按课程分组）在本地存储过的课件
  loadStoredPresentations() {
    if (!this.currentLessonId) return;
    const key = `presentations-${this.currentLessonId}`;
    const stored = storage.getMap(key);
    for (const [id, data] of stored.entries()) {
      this.setPresentation(id, data);
    }
  },
};
