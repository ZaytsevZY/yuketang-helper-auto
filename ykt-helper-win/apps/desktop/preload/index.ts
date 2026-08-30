import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type DesktopApi,
  type RuntimeStatus,
} from '@ykt/contracts';

const api: DesktopApi = Object.freeze({
  getRuntimeStatus: () =>
    ipcRenderer.invoke(IpcChannel.GetRuntimeStatus) as Promise<RuntimeStatus>,
});

contextBridge.exposeInMainWorld('yuketang', api);
