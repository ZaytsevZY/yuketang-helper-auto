import type {
  WebProbeReport,
  WebProbeEvidence,
  WebProbeRequest,
  WebProbeResponse,
} from './web-probe.js';
import type { AssignmentSnapshot } from './assignments.js';
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
  ClassroomNotice,
  ClassroomSimulationAction,
  ClassroomSimulationState,
} from './events.js';
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
  GetClassroomSimulation: 'debug:get-classroom-simulation',
  RunClassroomSimulation: 'debug:run-classroom-simulation',
  GenerateAnswerProposal: 'ai:generate-answer-proposal',
  RecognizeSlide: 'ai:recognize-slide',
  TranslateText: 'ai:translate-text',
  GetUser: 'storage:get-user',
  RefreshUser: 'storage:refresh-user',
  ListLogs: 'storage:list-logs',
  RefreshLessons: 'backend:refresh-lessons',
  ListLessons: 'backend:list-lessons',
  ListAssignments: 'backend:list-assignments',
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
  SetWebAreaBounds: 'browser:set-web-area-bounds',
  BrowserStateChanged: 'browser:state-changed',
  ClassroomNotice: 'classroom:notice',
  GetWebProbeReport: 'network:web-probe-report',
  ScanWebPage: 'network:scan-web-page',
  AnalyzeWebAsset: 'network:analyze-web-asset',
  SearchWebSources: 'network:search-web-sources',
  ProbeWebGet: 'network:probe-web-get',
  CancelWebProbe: 'network:cancel-web-probe',
  ExportWebProbe: 'network:export-web-probe',
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
  getClassroomSimulation(): Promise<ClassroomSimulationState>;
  runClassroomSimulation(
    action: ClassroomSimulationAction,
  ): Promise<ClassroomSimulationState>;
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
  listAssignments(environment: BrowserEnvironment): Promise<AssignmentSnapshot>;
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
  setWebAreaBounds(bounds: WebAreaBounds): Promise<void>;
  onBrowserStateChanged(listener: (state: BrowserState) => void): () => void;
  onClassroomNotice(listener: (notice: ClassroomNotice) => void): () => void;
  getWebProbeReport(): Promise<WebProbeReport | null>;
  scanWebPage(): Promise<WebProbeReport>;
  analyzeWebAsset(url: string): Promise<WebProbeReport>;
  searchWebSources(query: string): Promise<readonly WebProbeEvidence[]>;
  probeWebGet(request: WebProbeRequest): Promise<WebProbeResponse>;
  cancelWebProbe(): Promise<void>;
  exportWebProbe(): Promise<FixtureExportResult | null>;
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

/**
 * Rectangle occupied by the embedded web page inside the window, measured
 * in DIPs by the renderer. The main process applies it verbatim to the
 * native view, so there is a single source of truth for web-area geometry.
 */
export interface WebAreaBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function isWebAreaBounds(value: unknown): value is WebAreaBounds {
  if (typeof value !== 'object' || value === null) return false;
  const rect = value as Record<string, unknown>;
  return (
    Number.isInteger(rect.x) &&
    Number.isInteger(rect.y) &&
    Number.isInteger(rect.width) &&
    Number.isInteger(rect.height) &&
    (rect.x as number) >= 0 &&
    (rect.y as number) >= 0 &&
    (rect.width as number) >= 0 &&
    (rect.height as number) >= 0
  );
}
