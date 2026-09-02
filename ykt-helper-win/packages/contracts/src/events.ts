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
      deadlineAt: number;
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
