import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type AiProfileView,
  type AnswerInput,
  type AnswerProposal,
  type AppLogEntry,
  type AppSettings,
  type BrowserEnvironment,
  type BrowserState,
  type ClassroomNotice,
  type ClassroomSimulationAction,
  type ClassroomSimulationState,
  type ConnectAiProfileInput,
  type DesktopApi,
  type FixtureExportResult,
  type GenerateAnswerProposalInput,
  type GeneratedTextResult,
  type NetworkCaptureState,
  type NetworkEntry,
  type NetworkSnapshot,
  type Lesson,
  type ProblemContext,
  type Presentation,
  type RuntimeStatus,
  type RecognizeSlideInput,
  type SourceModuleId,
  type SubmissionResult,
  type TranslateTextInput,
  type UpdateAiProfileSelectionInput,
  type UserProfile,
  type ValidationResult,
} from '@ykt/contracts';

const api: DesktopApi = Object.freeze({
  getRuntimeStatus: () =>
    ipcRenderer.invoke(IpcChannel.GetRuntimeStatus) as Promise<RuntimeStatus>,
  getSettings: () =>
    ipcRenderer.invoke(IpcChannel.GetSettings) as Promise<AppSettings>,
  updateSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke(
      IpcChannel.UpdateSettings,
      settings,
    ) as Promise<AppSettings>,
  resetSettings: () =>
    ipcRenderer.invoke(IpcChannel.ResetSettings) as Promise<AppSettings>,
  listAiProfiles: () =>
    ipcRenderer.invoke(IpcChannel.ListAiProfiles) as Promise<
      readonly AiProfileView[]
    >,
  connectAiProfile: (input: ConnectAiProfileInput) =>
    ipcRenderer.invoke(IpcChannel.ConnectAiProfile, input) as Promise<
      readonly AiProfileView[]
    >,
  refreshAiProfile: (id: string) =>
    ipcRenderer.invoke(IpcChannel.RefreshAiProfile, id) as Promise<
      readonly AiProfileView[]
    >,
  updateAiProfileSelection: (input: UpdateAiProfileSelectionInput) =>
    ipcRenderer.invoke(IpcChannel.UpdateAiProfileSelection, input) as Promise<
      readonly AiProfileView[]
    >,
  deleteAiProfile: (id: string) =>
    ipcRenderer.invoke(IpcChannel.DeleteAiProfile, id) as Promise<
      readonly AiProfileView[]
    >,
  selectAiProfile: (id: string) =>
    ipcRenderer.invoke(IpcChannel.SelectAiProfile, id) as Promise<
      readonly AiProfileView[]
    >,
  getClassroomSimulation: () =>
    ipcRenderer.invoke(
      IpcChannel.GetClassroomSimulation,
    ) as Promise<ClassroomSimulationState>,
  runClassroomSimulation: (action: ClassroomSimulationAction) =>
    ipcRenderer.invoke(
      IpcChannel.RunClassroomSimulation,
      action,
    ) as Promise<ClassroomSimulationState>,
  generateAnswerProposal: (input: GenerateAnswerProposalInput) =>
    ipcRenderer.invoke(
      IpcChannel.GenerateAnswerProposal,
      input,
    ) as Promise<AnswerProposal>,
  recognizeSlide: (input: RecognizeSlideInput) =>
    ipcRenderer.invoke(
      IpcChannel.RecognizeSlide,
      input,
    ) as Promise<GeneratedTextResult>,
  translateText: (input: TranslateTextInput) =>
    ipcRenderer.invoke(
      IpcChannel.TranslateText,
      input,
    ) as Promise<GeneratedTextResult>,
  getUser: (environment: BrowserEnvironment) =>
    ipcRenderer.invoke(
      IpcChannel.GetUser,
      environment,
    ) as Promise<UserProfile | null>,
  refreshUser: (environment: BrowserEnvironment) =>
    ipcRenderer.invoke(
      IpcChannel.RefreshUser,
      environment,
    ) as Promise<UserProfile>,
  listLogs: (limit?: number) =>
    ipcRenderer.invoke(IpcChannel.ListLogs, limit) as Promise<
      readonly AppLogEntry[]
    >,
  refreshLessons: (environment: BrowserEnvironment) =>
    ipcRenderer.invoke(IpcChannel.RefreshLessons, environment) as Promise<
      readonly Lesson[]
    >,
  listLessons: () =>
    ipcRenderer.invoke(IpcChannel.ListLessons) as Promise<readonly Lesson[]>,
  connectLesson: (environment: BrowserEnvironment, id: string) =>
    ipcRenderer.invoke(
      IpcChannel.ConnectLesson,
      environment,
      id,
    ) as Promise<void>,
  listPresentations: (lessonId: string) =>
    ipcRenderer.invoke(IpcChannel.ListPresentations, lessonId) as Promise<
      readonly Presentation[]
    >,
  listProblems: (lessonId: string) =>
    ipcRenderer.invoke(IpcChannel.ListProblems, lessonId) as Promise<
      readonly ProblemContext[]
    >,
  validateAnswer: (input: AnswerInput) =>
    ipcRenderer.invoke(
      IpcChannel.ValidateAnswer,
      input,
    ) as Promise<ValidationResult>,
  submitAnswer: (input: AnswerInput) =>
    ipcRenderer.invoke(
      IpcChannel.SubmitAnswer,
      input,
    ) as Promise<SubmissionResult>,
  getBrowserState: () =>
    ipcRenderer.invoke(IpcChannel.GetBrowserState) as Promise<BrowserState>,
  selectBrowserEnvironment: (environment: BrowserEnvironment) =>
    ipcRenderer.invoke(
      IpcChannel.SelectBrowserEnvironment,
      environment,
    ) as Promise<void>,
  browserBack: () =>
    ipcRenderer.invoke(IpcChannel.BrowserBack) as Promise<void>,
  browserForward: () =>
    ipcRenderer.invoke(IpcChannel.BrowserForward) as Promise<void>,
  browserReload: () =>
    ipcRenderer.invoke(IpcChannel.BrowserReload) as Promise<void>,
  browserHome: () =>
    ipcRenderer.invoke(IpcChannel.BrowserHome) as Promise<void>,
  browserNavigate: (url: string) =>
    ipcRenderer.invoke(IpcChannel.BrowserNavigate, url) as Promise<void>,
  browserNewTab: () =>
    ipcRenderer.invoke(IpcChannel.BrowserNewTab) as Promise<void>,
  browserActivateTab: (tabId: string) =>
    ipcRenderer.invoke(IpcChannel.BrowserActivateTab, tabId) as Promise<void>,
  browserCloseTab: (tabId: string) =>
    ipcRenderer.invoke(IpcChannel.BrowserCloseTab, tabId) as Promise<void>,
  setNetworkLabCollapsed: (collapsed: boolean) =>
    ipcRenderer.invoke(
      IpcChannel.SetNetworkLabCollapsed,
      collapsed,
    ) as Promise<void>,
  setAssistantPanelCollapsed: (collapsed: boolean) =>
    ipcRenderer.invoke(
      IpcChannel.SetAssistantPanelCollapsed,
      collapsed,
    ) as Promise<void>,
  onBrowserStateChanged: (listener: (state: BrowserState) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: BrowserState,
    ) => {
      listener(state);
    };
    ipcRenderer.on(IpcChannel.BrowserStateChanged, handler);
    return () =>
      ipcRenderer.removeListener(IpcChannel.BrowserStateChanged, handler);
  },
  onClassroomNotice: (listener: (notice: ClassroomNotice) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      notice: ClassroomNotice,
    ) => listener(notice);
    ipcRenderer.on(IpcChannel.ClassroomNotice, handler);
    return () =>
      ipcRenderer.removeListener(IpcChannel.ClassroomNotice, handler);
  },
  getNetworkSnapshot: () =>
    ipcRenderer.invoke(
      IpcChannel.GetNetworkSnapshot,
    ) as Promise<NetworkSnapshot>,
  setNetworkPaused: (paused: boolean) =>
    ipcRenderer.invoke(IpcChannel.SetNetworkPaused, paused) as Promise<void>,
  setDeepCapture: (enabled: boolean) =>
    ipcRenderer.invoke(IpcChannel.SetDeepCapture, enabled) as Promise<void>,
  clearNetworkEntries: () =>
    ipcRenderer.invoke(IpcChannel.ClearNetworkEntries) as Promise<void>,
  exportNetworkFixture: () =>
    ipcRenderer.invoke(
      IpcChannel.ExportNetworkFixture,
    ) as Promise<FixtureExportResult | null>,
  exportPresentationPdf: (lessonId: string, presentationId: string) =>
    ipcRenderer.invoke(
      IpcChannel.ExportPresentationPdf,
      lessonId,
      presentationId,
    ) as Promise<FixtureExportResult | null>,
  downloadSlide: (imageUrl: string, suggestedName: string) =>
    ipcRenderer.invoke(
      IpcChannel.DownloadSlide,
      imageUrl,
      suggestedName,
    ) as Promise<FixtureExportResult | null>,
  showNotification: (title: string, body: string) =>
    ipcRenderer.invoke(
      IpcChannel.ShowNotification,
      title,
      body,
    ) as Promise<void>,
  openSourceModule: (id: SourceModuleId) =>
    ipcRenderer.invoke(IpcChannel.OpenSourceModule, id) as Promise<void>,
  onNetworkEntryAdded: (listener: (entry: NetworkEntry) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      entry: NetworkEntry,
    ) => {
      listener(entry);
    };
    ipcRenderer.on(IpcChannel.NetworkEntryAdded, handler);
    return () =>
      ipcRenderer.removeListener(IpcChannel.NetworkEntryAdded, handler);
  },
  onNetworkCaptureStateChanged: (
    listener: (state: NetworkCaptureState) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: NetworkCaptureState,
    ) => {
      listener(state);
    };
    ipcRenderer.on(IpcChannel.NetworkCaptureStateChanged, handler);
    return () =>
      ipcRenderer.removeListener(
        IpcChannel.NetworkCaptureStateChanged,
        handler,
      );
  },
});

contextBridge.exposeInMainWorld('yuketang', api);
