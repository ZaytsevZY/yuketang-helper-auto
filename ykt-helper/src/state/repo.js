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

  setPresentation(id, data) {
    this.presentations.set(id, { id, ...data });
    storage.alterMap('presentations', (m) => {
      m.set(id, data);
      const excess = m.size - (storage.get('config', {})?.maxPresentations ?? 5);
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
};
