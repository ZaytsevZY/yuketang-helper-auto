import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type AnswerInput,
  type AppLogEntry,
  type AppSettings,
  type BrowserEnvironment,
  type BrowserState,
  type DesktopApi,
  type FixtureExportResult,
  type NetworkCaptureState,
  type NetworkEntry,
  type NetworkSnapshot,
  type Lesson,
  type ProblemContext,
  type RuntimeStatus,
  type SubmissionResult,
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
  connectLesson: (environment: BrowserEnvironment, id: string) =>
    ipcRenderer.invoke(
      IpcChannel.ConnectLesson,
      environment,
      id,
    ) as Promise<void>,
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
  setNetworkLabCollapsed: (collapsed: boolean) =>
    ipcRenderer.invoke(
      IpcChannel.SetNetworkLabCollapsed,
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
