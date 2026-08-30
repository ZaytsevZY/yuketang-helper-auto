export type NetworkSource = 'browser' | 'active' | 'fixture';

interface NetworkEntryBase {
  id: string;
  sequence: number;
  timestamp: string;
  source: NetworkSource;
}

export interface HttpNetworkEntry extends NetworkEntryBase {
  kind: 'http';
  phase: 'complete' | 'body';
  requestId: string;
  method: string;
  url: string;
  resourceType: string;
  statusCode: number | null;
  durationMs: number | null;
  requestHeaders: Readonly<Record<string, string>>;
  responseHeaders: Readonly<Record<string, string>>;
  body: string | null;
  error: string | null;
}

export interface WebSocketNetworkEntry extends NetworkEntryBase {
  kind: 'websocket';
  requestId: string;
  url: string;
  direction: 'opened' | 'sent' | 'received' | 'closed' | 'error';
  opcode: number | null;
  payload: string | null;
  error: string | null;
}

export interface DomainNetworkEntry extends NetworkEntryBase {
  kind: 'domain';
  eventType: string;
  summary: string;
  normalizerId: string;
  sourceEntryId: string;
  data: unknown;
}

export type NetworkEntry =
  HttpNetworkEntry | WebSocketNetworkEntry | DomainNetworkEntry;

export interface NetworkCaptureState {
  paused: boolean;
  deepCapture: boolean;
  deepCaptureAvailable: boolean;
  deepCaptureError: string | null;
  entryCount: number;
  droppedEntries: number;
}

export interface NetworkSnapshot {
  state: NetworkCaptureState;
  entries: readonly NetworkEntry[];
}

export interface NetworkFixture {
  version: 1;
  exportedAt: string;
  entries: readonly NetworkEntry[];
}

export interface FixtureExportResult {
  filePath: string;
}
