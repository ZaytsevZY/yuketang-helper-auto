import type {
  AnswerInput,
  Lesson,
  Presentation,
  ProblemContext,
  RuntimeStatus,
  SubmissionResult,
  ValidationResult,
} from './dto.js';
import type { BrowserEnvironment } from './browser.js';
import type { LessonEvent } from './events.js';
import type { AppLogEntry, AppSettings, UserProfile } from './storage.js';
import type {
  AiProfileView,
  AnswerProposal,
  ConnectAiProfileInput,
  GenerateAnswerProposalInput,
  GeneratedTextResult,
  RecognizeSlideInput,
  TranslateTextInput,
  UpdateAiProfileSelectionInput,
} from './assistant.js';

export interface YuketangFacade {
  getStatus(): Promise<RuntimeStatus>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  resetSettings(): Promise<AppSettings>;
  listAiProfiles(): Promise<readonly AiProfileView[]>;
  connectAiProfile(
    input: ConnectAiProfileInput,
  ): Promise<readonly AiProfileView[]>;
  refreshAiProfile(id: string): Promise<readonly AiProfileView[]>;
  updateAiProfileSelection(
    input: UpdateAiProfileSelectionInput,
  ): Promise<readonly AiProfileView[]>;
  deleteAiProfile(id: string): Promise<readonly AiProfileView[]>;
  selectAiProfile(id: string): Promise<readonly AiProfileView[]>;
  generateAnswerProposal(
    input: GenerateAnswerProposalInput,
  ): Promise<AnswerProposal>;
  recognizeSlide(input: RecognizeSlideInput): Promise<GeneratedTextResult>;
  translateText(input: TranslateTextInput): Promise<GeneratedTextResult>;
  getUser(environment: BrowserEnvironment): Promise<UserProfile | null>;
  refreshUser(environment: BrowserEnvironment): Promise<UserProfile>;
  listLogs(limit?: number): Promise<readonly AppLogEntry[]>;
  listLessons(): Promise<readonly Lesson[]>;
  refreshLessons(environment: BrowserEnvironment): Promise<readonly Lesson[]>;
  connectLesson(environment: BrowserEnvironment, id: string): Promise<void>;
  listPresentations(lessonId: string): Promise<readonly Presentation[]>;
  listProblems(lessonId: string): Promise<readonly ProblemContext[]>;
  watchLesson(id: string): AsyncIterable<LessonEvent>;
  getProblem(id: string): Promise<ProblemContext>;
  validateAnswer(input: AnswerInput): Promise<ValidationResult>;
  submitAnswer(input: AnswerInput): Promise<SubmissionResult>;
}
