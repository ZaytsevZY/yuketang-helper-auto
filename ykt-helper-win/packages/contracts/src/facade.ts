import type {
  AnswerInput,
  Lesson,
  ProblemContext,
  RuntimeStatus,
  SubmissionResult,
  ValidationResult,
} from './dto.js';
import type { BrowserEnvironment } from './browser.js';
import type { LessonEvent } from './events.js';
import type { AppLogEntry, AppSettings, UserProfile } from './storage.js';

export interface YuketangFacade {
  getStatus(): Promise<RuntimeStatus>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  getUser(environment: BrowserEnvironment): Promise<UserProfile | null>;
  refreshUser(environment: BrowserEnvironment): Promise<UserProfile>;
  listLogs(limit?: number): Promise<readonly AppLogEntry[]>;
  listLessons(): Promise<readonly Lesson[]>;
  refreshLessons(environment: BrowserEnvironment): Promise<readonly Lesson[]>;
  connectLesson(environment: BrowserEnvironment, id: string): Promise<void>;
  listProblems(lessonId: string): Promise<readonly ProblemContext[]>;
  watchLesson(id: string): AsyncIterable<LessonEvent>;
  getProblem(id: string): Promise<ProblemContext>;
  validateAnswer(input: AnswerInput): Promise<ValidationResult>;
  submitAnswer(input: AnswerInput): Promise<SubmissionResult>;
}
