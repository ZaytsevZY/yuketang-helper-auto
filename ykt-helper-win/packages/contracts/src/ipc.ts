import type { BrowserEnvironment, BrowserState } from './browser.js';
import type {
  AnswerInput,
  Lesson,
  ProblemContext,
  RuntimeStatus,
  SubmissionResult,
  ValidationResult,
} from './dto.js';
import type {
  FixtureExportResult,
  NetworkCaptureState,
  NetworkEntry,
  NetworkSnapshot,
} from './network.js';

export const IpcChannel = {
  GetRuntimeStatus: 'runtime:get-status',
  RefreshLessons: 'backend:refresh-lessons',
  ConnectLesson: 'backend:connect-lesson',
  ListProblems: 'backend:list-problems',
  ValidateAnswer: 'backend:validate-answer',
  SubmitAnswer: 'backend:submit-answer',
  GetBrowserState: 'browser:get-state',
  SelectBrowserEnvironment: 'browser:select-environment',
  BrowserBack: 'browser:back',
  BrowserForward: 'browser:forward',
  BrowserReload: 'browser:reload',
  SetNetworkLabCollapsed: 'browser:set-network-lab-collapsed',
  BrowserStateChanged: 'browser:state-changed',
  GetNetworkSnapshot: 'network:get-snapshot',
  SetNetworkPaused: 'network:set-paused',
  SetDeepCapture: 'network:set-deep-capture',
  ClearNetworkEntries: 'network:clear',
  ExportNetworkFixture: 'network:export-fixture',
  NetworkEntryAdded: 'network:entry-added',
  NetworkCaptureStateChanged: 'network:capture-state-changed',
} as const;

export interface DesktopApi {
  getRuntimeStatus(): Promise<RuntimeStatus>;
  refreshLessons(environment: BrowserEnvironment): Promise<readonly Lesson[]>;
  connectLesson(environment: BrowserEnvironment, id: string): Promise<void>;
  listProblems(lessonId: string): Promise<readonly ProblemContext[]>;
  validateAnswer(input: AnswerInput): Promise<ValidationResult>;
  submitAnswer(input: AnswerInput): Promise<SubmissionResult>;
  getBrowserState(): Promise<BrowserState>;
  selectBrowserEnvironment(environment: BrowserEnvironment): Promise<void>;
  browserBack(): Promise<void>;
  browserForward(): Promise<void>;
  browserReload(): Promise<void>;
  setNetworkLabCollapsed(collapsed: boolean): Promise<void>;
  onBrowserStateChanged(listener: (state: BrowserState) => void): () => void;
  getNetworkSnapshot(): Promise<NetworkSnapshot>;
  setNetworkPaused(paused: boolean): Promise<void>;
  setDeepCapture(enabled: boolean): Promise<void>;
  clearNetworkEntries(): Promise<void>;
  exportNetworkFixture(): Promise<FixtureExportResult | null>;
  onNetworkEntryAdded(listener: (entry: NetworkEntry) => void): () => void;
  onNetworkCaptureStateChanged(
    listener: (state: NetworkCaptureState) => void,
  ): () => void;
}
