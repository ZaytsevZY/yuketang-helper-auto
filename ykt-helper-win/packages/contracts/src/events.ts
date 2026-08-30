import type { ProblemContext } from './dto.js';

interface LessonEventBase {
  lessonId: string;
  occurredAt: string;
}

export type LessonEvent =
  | (LessonEventBase & {
      type: 'lesson.started' | 'lesson.ended';
    })
  | (LessonEventBase & {
      type: 'problem.published';
      problem: ProblemContext;
    })
  | (LessonEventBase & {
      type: 'problem.closed';
      problemId: string;
    });
