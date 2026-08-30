import type { BrowserEnvironment, BrowserState } from './browser.js';
import type { RuntimeStatus } from './dto.js';
import type {
  FixtureExportResult,
  NetworkCaptureState,
  NetworkEntry,
  NetworkSnapshot,
} from './network.js';

export const IpcChannel = {
  GetRuntimeStatus: 'runtime:get-status',
  GetBrowserState: 'browser:get-state',
  SelectBrowserEnvironment: 'browser:select-environment',
  BrowserBack: 'browser:back',
  BrowserForward: 'browser:forward',
  BrowserReload: 'browser:reload',
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
  getBrowserState(): Promise<BrowserState>;
  selectBrowserEnvironment(environment: BrowserEnvironment): Promise<void>;
  browserBack(): Promise<void>;
  browserForward(): Promise<void>;
  browserReload(): Promise<void>;
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
