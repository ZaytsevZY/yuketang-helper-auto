import type {
  AnswerInput,
  Lesson,
  ProblemContext,
  RuntimeStatus,
  SubmissionResult,
  ValidationResult,
} from './dto.js';
import type { LessonEvent } from './events.js';

export interface YuketangFacade {
  getStatus(): Promise<RuntimeStatus>;
  listLessons(): Promise<readonly Lesson[]>;
  watchLesson(id: string): AsyncIterable<LessonEvent>;
  getProblem(id: string): Promise<ProblemContext>;
  validateAnswer(input: AnswerInput): Promise<ValidationResult>;
  submitAnswer(input: AnswerInput): Promise<SubmissionResult>;
}
