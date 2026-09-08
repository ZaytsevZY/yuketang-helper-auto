import type { LessonEvent } from '@ykt/contracts';

import type { LessonSession } from '../domain/lesson-session.js';

export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export interface TransitionResult {
  applied: boolean;
  reason: string | null;
}

export class LessonStateMachine {
  constructor(
    readonly session: LessonSession,
    private readonly clock: Clock = systemClock,
  ) {}

  apply(event: LessonEvent): TransitionResult {
    if (event.lessonId !== this.session.lesson.id) {
      return rejected('event belongs to another lesson');
    }

    switch (event.type) {
      case 'lesson.started':
        this.session.setLessonStatus('active');
        return applied();
      case 'lesson.ended':
        this.session.setLessonStatus('ended');
        return applied();
      case 'presentation.loaded':
        if (event.presentation.lessonId !== event.lessonId) {
          return rejected('presentation belongs to another lesson');
        }
        this.session.upsertPresentation(event.presentation);
        return applied();
      case 'problem.published':
        if (event.problem.lessonId !== event.lessonId) {
          return rejected('problem belongs to another lesson');
        }
        this.session.upsertProblem(event.problem);
        return applied();
      case 'problem.unlocked':
        return this.unlock(event);
      case 'problem.answered':
        if (!this.session.problems.has(event.problemId)) {
          return rejected('problem is not loaded');
        }
        this.session.answerProblem(event.problemId, event.answer);
        return applied();
      case 'problem.closed':
        if (!this.session.problemStates.has(event.problemId)) {
          return rejected('problem was not unlocked');
        }
        this.session.closeProblem(event.problemId);
        return applied();
    }
  }

  private unlock(
    event: Extract<LessonEvent, { type: 'problem.unlocked' }>,
  ): TransitionResult {
    const problem = this.session.problems.get(event.problemId);
    if (!problem) return rejected('problem is not loaded');
    if (!this.session.presentations.has(event.presentationId)) {
      return rejected('presentation is not loaded');
    }
    if (!this.session.slides.has(event.slideId)) {
      return rejected('slide is not loaded');
    }
    if (
      problem.presentationId !== event.presentationId ||
      problem.slideId !== event.slideId
    ) {
      return rejected('unlock references do not match the problem');
    }
    if (event.deadlineAt !== null && event.deadlineAt < event.unlockedAt) {
      return rejected('deadline precedes unlock time');
    }

    this.session.unlockProblem(
      event.problemId,
      event.presentationId,
      event.slideId,
      event.unlockedAt,
      event.deadlineAt,
      this.clock.now(),
    );
    return applied();
  }
}

function applied(): TransitionResult {
  return { applied: true, reason: null };
}

function rejected(reason: string): TransitionResult {
  return { applied: false, reason };
}
