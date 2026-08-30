import type { BrowserEnvironment, BrowserState } from './browser.js';
import type { RuntimeStatus } from './dto.js';

export const IpcChannel = {
  GetRuntimeStatus: 'runtime:get-status',
  GetBrowserState: 'browser:get-state',
  SelectBrowserEnvironment: 'browser:select-environment',
  BrowserBack: 'browser:back',
  BrowserForward: 'browser:forward',
  BrowserReload: 'browser:reload',
  BrowserStateChanged: 'browser:state-changed',
} as const;

export interface DesktopApi {
  getRuntimeStatus(): Promise<RuntimeStatus>;
  getBrowserState(): Promise<BrowserState>;
  selectBrowserEnvironment(environment: BrowserEnvironment): Promise<void>;
  browserBack(): Promise<void>;
  browserForward(): Promise<void>;
  browserReload(): Promise<void>;
  onBrowserStateChanged(listener: (state: BrowserState) => void): () => void;
}
