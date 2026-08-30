import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type BrowserEnvironment,
  type BrowserState,
  type DesktopApi,
  type RuntimeStatus,
} from '@ykt/contracts';

const api: DesktopApi = Object.freeze({
  getRuntimeStatus: () =>
    ipcRenderer.invoke(IpcChannel.GetRuntimeStatus) as Promise<RuntimeStatus>,
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
});

contextBridge.exposeInMainWorld('yuketang', api);
