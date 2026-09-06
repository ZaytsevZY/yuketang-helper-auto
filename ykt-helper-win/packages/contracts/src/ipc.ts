import type { BrowserEnvironment, BrowserState } from './browser.js';
import type {
  AnswerInput,
  Lesson,
  Presentation,
  ProblemContext,
  RuntimeStatus,
  SubmissionResult,
  ValidationResult,
} from './dto.js';
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
import type {
  FixtureExportResult,
  NetworkCaptureState,
  NetworkEntry,
  NetworkSnapshot,
} from './network.js';

export const IpcChannel = {
  GetRuntimeStatus: 'runtime:get-status',
  GetSettings: 'storage:get-settings',
  UpdateSettings: 'storage:update-settings',
  ResetSettings: 'storage:reset-settings',
  ListAiProfiles: 'ai:list-profiles',
  ConnectAiProfile: 'ai:connect-profile',
  RefreshAiProfile: 'ai:refresh-profile',
  UpdateAiProfileSelection: 'ai:update-profile-selection',
  DeleteAiProfile: 'ai:delete-profile',
  SelectAiProfile: 'ai:select-profile',
  GenerateAnswerProposal: 'ai:generate-answer-proposal',
  RecognizeSlide: 'ai:recognize-slide',
  TranslateText: 'ai:translate-text',
  GetUser: 'storage:get-user',
  RefreshUser: 'storage:refresh-user',
  ListLogs: 'storage:list-logs',
  RefreshLessons: 'backend:refresh-lessons',
  ListLessons: 'backend:list-lessons',
  ConnectLesson: 'backend:connect-lesson',
  ListPresentations: 'backend:list-presentations',
  ListProblems: 'backend:list-problems',
  ValidateAnswer: 'backend:validate-answer',
  SubmitAnswer: 'backend:submit-answer',
  GetBrowserState: 'browser:get-state',
  SelectBrowserEnvironment: 'browser:select-environment',
  BrowserBack: 'browser:back',
  BrowserForward: 'browser:forward',
  BrowserReload: 'browser:reload',
  BrowserHome: 'browser:home',
  BrowserNavigate: 'browser:navigate',
  BrowserNewTab: 'browser:new-tab',
  BrowserActivateTab: 'browser:activate-tab',
  BrowserCloseTab: 'browser:close-tab',
  SetNetworkLabCollapsed: 'browser:set-network-lab-collapsed',
  SetAssistantPanelCollapsed: 'browser:set-assistant-panel-collapsed',
  BrowserStateChanged: 'browser:state-changed',
  GetNetworkSnapshot: 'network:get-snapshot',
  SetNetworkPaused: 'network:set-paused',
  SetDeepCapture: 'network:set-deep-capture',
  ClearNetworkEntries: 'network:clear',
  ExportNetworkFixture: 'network:export-fixture',
  ExportPresentationPdf: 'media:export-presentation-pdf',
  DownloadSlide: 'media:download-slide',
  ShowNotification: 'desktop:show-notification',
  OpenSourceModule: 'desktop:open-source-module',
  NetworkEntryAdded: 'network:entry-added',
  NetworkCaptureStateChanged: 'network:capture-state-changed',
} as const;

export interface DesktopApi {
  getRuntimeStatus(): Promise<RuntimeStatus>;
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
  refreshLessons(environment: BrowserEnvironment): Promise<readonly Lesson[]>;
  listLessons(): Promise<readonly Lesson[]>;
  connectLesson(environment: BrowserEnvironment, id: string): Promise<void>;
  listPresentations(lessonId: string): Promise<readonly Presentation[]>;
  listProblems(lessonId: string): Promise<readonly ProblemContext[]>;
  validateAnswer(input: AnswerInput): Promise<ValidationResult>;
  submitAnswer(input: AnswerInput): Promise<SubmissionResult>;
  getBrowserState(): Promise<BrowserState>;
  selectBrowserEnvironment(environment: BrowserEnvironment): Promise<void>;
  browserBack(): Promise<void>;
  browserForward(): Promise<void>;
  browserReload(): Promise<void>;
  browserHome(): Promise<void>;
  browserNavigate(url: string): Promise<void>;
  browserNewTab(): Promise<void>;
  browserActivateTab(tabId: string): Promise<void>;
  browserCloseTab(tabId: string): Promise<void>;
  setNetworkLabCollapsed(collapsed: boolean): Promise<void>;
  setAssistantPanelCollapsed(collapsed: boolean): Promise<void>;
  onBrowserStateChanged(listener: (state: BrowserState) => void): () => void;
  getNetworkSnapshot(): Promise<NetworkSnapshot>;
  setNetworkPaused(paused: boolean): Promise<void>;
  setDeepCapture(enabled: boolean): Promise<void>;
  clearNetworkEntries(): Promise<void>;
  exportNetworkFixture(): Promise<FixtureExportResult | null>;
  exportPresentationPdf(
    lessonId: string,
    presentationId: string,
  ): Promise<FixtureExportResult | null>;
  downloadSlide(
    imageUrl: string,
    suggestedName: string,
  ): Promise<FixtureExportResult | null>;
  showNotification(title: string, body: string): Promise<void>;
  openSourceModule(id: SourceModuleId): Promise<void>;
  onNetworkEntryAdded(listener: (entry: NetworkEntry) => void): () => void;
  onNetworkCaptureStateChanged(
    listener: (state: NetworkCaptureState) => void,
  ): () => void;
}

export type SourceModuleId =
  'renderer' | 'ipc' | 'backend' | 'routing' | 'storage';
