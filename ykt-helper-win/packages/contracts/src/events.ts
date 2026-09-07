import type { AnswerValue, Lesson, Presentation, Problem } from './dto.js';

interface LessonEventBase {
  lessonId: string;
  occurredAt: number;
}

export type LessonEvent =
  | (LessonEventBase & {
      type: 'lesson.started' | 'lesson.ended';
    })
  | (LessonEventBase & {
      type: 'presentation.loaded';
      presentation: Presentation;
    })
  | (LessonEventBase & {
      type: 'problem.published';
      problem: Problem;
    })
  | (LessonEventBase & {
      type: 'problem.unlocked';
      problemId: string;
      presentationId: string;
      slideId: string;
      unlockedAt: number;
      deadlineAt: number | null;
    })
  | (LessonEventBase & {
      type: 'problem.answered';
      problemId: string;
      answer: AnswerValue;
    })
  | (LessonEventBase & {
      type: 'problem.closed';
      problemId: string;
    });

export interface LessonFixture {
  version: 1;
  lesson: Lesson;
  events: readonly LessonEvent[];
}

export type ClassroomNoticeKind =
  | 'problem-start'
  | 'assessment-publish'
  | 'courseware-publish'
  | 'other-publish'
  | 'lesson-finished'
  | 'auto-answer-scheduled'
  | 'auto-answer-started'
  | 'auto-answer-succeeded'
  | 'auto-answer-failed';

export interface ClassroomNotice {
  readonly kind: ClassroomNoticeKind;
  readonly lessonId: string;
  readonly dedupeKey: string;
  readonly title: string;
  readonly detail: string;
  readonly occurredAt: number;
}

export type ClassroomSimulationAction =
  | 'reset'
  | 'show-slide'
  | 'publish-courseware'
  | 'publish-problem-object'
  | 'publish-problem-scalar'
  | 'finish-lesson';

export interface ClassroomSimulationState {
  readonly lessonId: string;
  readonly status: Lesson['status'];
  readonly currentSlide: number;
  readonly publishedProblemIds: readonly string[];
  readonly lastEvent: string;
}
