import type {
  DomainNetworkEntry,
  HttpNetworkEntry,
  NetworkEntry,
  NetworkSource,
  WebSocketNetworkEntry,
} from '@ykt/contracts';

import {
  sanitizeHeaders,
  sanitizeText,
  sanitizeUnknown,
  sanitizeUrl,
} from './redactor.js';

export interface HttpEntryInput {
  source: NetworkSource;
  phase: HttpNetworkEntry['phase'];
  requestId: string;
  method: string;
  url: string;
  resourceType: string;
  statusCode: number | null;
  durationMs: number | null;
  requestHeaders: Readonly<Record<string, string>>;
  requestBody?: string | null;
  responseHeaders: Readonly<Record<string, string>>;
  body: string | null;
  bodyEncoding?: 'utf8' | 'base64' | null;
  error: string | null;
  timestamp?: string;
}

export interface WebSocketEntryInput {
  source: NetworkSource;
  requestId: string;
  url: string;
  direction: WebSocketNetworkEntry['direction'];
  opcode: number | null;
  payload: string | null;
  error: string | null;
  timestamp?: string;
}

export interface DomainEntryInput {
  source: NetworkSource;
  eventType: string;
  summary: string;
  normalizerId: string;
  sourceEntryId: string;
  data: unknown;
  timestamp?: string;
}

export interface RecorderOptions {
  maxEntries?: number;
  maxBytes?: number;
}

export interface NetworkCaptureProfile {
  readonly mode: 'safe' | 'development';
  readonly deepCaptureByDefault: boolean;
  readonly responseBodyLimitBytes: number;
  readonly resourceBufferLimitBytes: number;
  readonly totalBufferLimitBytes: number;
  readonly postDataLimitBytes: number;
  readonly captureBinaryBodies: boolean;
}

const SAFE_CAPTURE_PROFILE: NetworkCaptureProfile = Object.freeze({
  mode: 'safe',
  deepCaptureByDefault: false,
  responseBodyLimitBytes: 64 * 1024,
  resourceBufferLimitBytes: 2 * 1024 * 1024,
  totalBufferLimitBytes: 8 * 1024 * 1024,
  postDataLimitBytes: 64 * 1024,
  captureBinaryBodies: false,
});

export class NetworkRecorder {
  readonly #entries: NetworkEntry[] = [];
  readonly #listeners = new Set<(entry: NetworkEntry) => void>();
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  #bytes = 0;
  #sequence = 0;
  #droppedEntries = 0;
  #paused = false;

  constructor(options: RecorderOptions = {}) {
    this.#maxEntries = options.maxEntries ?? 1_000;
    this.#maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  }

  get entries(): readonly NetworkEntry[] {
    return this.#entries;
  }

  get captureProfile(): NetworkCaptureProfile {
    return SAFE_CAPTURE_PROFILE;
  }

  get paused(): boolean {
    return this.#paused;
  }

  get droppedEntries(): number {
    return this.#droppedEntries;
  }

  setPaused(paused: boolean): void {
    this.#paused = paused;
  }

  clear(): void {
    this.#entries.length = 0;
    this.#bytes = 0;
    this.#droppedEntries = 0;
  }

  subscribe(listener: (entry: NetworkEntry) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  addHttp(input: HttpEntryInput): HttpNetworkEntry | null {
    return this.add({
      ...this.base(input.source, input.timestamp),
      kind: 'http',
      phase: input.phase,
      requestId: input.requestId,
      method: input.method,
      url: this.prepareUrl(input.url),
      resourceType: input.resourceType,
      statusCode: input.statusCode,
      durationMs: input.durationMs,
      requestHeaders: this.prepareHeaders(input.requestHeaders),
      requestBody:
        input.requestBody == null ? null : this.prepareText(input.requestBody),
      responseHeaders: this.prepareHeaders(input.responseHeaders),
      body: input.body === null ? null : this.prepareText(input.body),
      bodyEncoding: input.body === null ? null : (input.bodyEncoding ?? 'utf8'),
      error: input.error === null ? null : this.prepareText(input.error),
    });
  }

  addWebSocket(input: WebSocketEntryInput): WebSocketNetworkEntry | null {
    return this.add({
      ...this.base(input.source, input.timestamp),
      kind: 'websocket',
      requestId: input.requestId,
      url: this.prepareUrl(input.url),
      direction: input.direction,
      opcode: input.opcode,
      payload: input.payload === null ? null : this.prepareText(input.payload),
      error: input.error === null ? null : this.prepareText(input.error),
    });
  }

  addDomain(input: DomainEntryInput): DomainNetworkEntry | null {
    return this.add({
      ...this.base(input.source, input.timestamp),
      kind: 'domain',
      eventType: input.eventType,
      summary: this.prepareText(input.summary),
      normalizerId: input.normalizerId,
      sourceEntryId: input.sourceEntryId,
      data: this.prepareUnknown(input.data),
    });
  }

  protected prepareHeaders(
    headers: Readonly<Record<string, string>>,
  ): Readonly<Record<string, string>> {
    return sanitizeHeaders(headers);
  }

  protected prepareUrl(value: string): string {
    return sanitizeUrl(value);
  }

  protected prepareText(value: string): string {
    return sanitizeText(value);
  }

  protected prepareUnknown(value: unknown): unknown {
    return sanitizeUnknown(value);
  }

  private base(source: NetworkSource, timestamp?: string) {
    const sequence = ++this.#sequence;
    return {
      id: `${Date.now().toString(36)}-${sequence}`,
      sequence,
      timestamp: timestamp ?? new Date().toISOString(),
      source,
    };
  }

  private add<T extends NetworkEntry>(entry: T): T | null {
    if (this.#paused) return null;

    const size = JSON.stringify(entry).length * 2;
    this.#entries.push(entry);
    this.#bytes += size;

    while (
      this.#entries.length > this.#maxEntries ||
      this.#bytes > this.#maxBytes
    ) {
      const removed = this.#entries.shift();
      if (!removed) break;
      this.#bytes -= JSON.stringify(removed).length * 2;
      this.#droppedEntries += 1;
    }

    for (const listener of this.#listeners) listener(entry);
    return entry;
  }
}
