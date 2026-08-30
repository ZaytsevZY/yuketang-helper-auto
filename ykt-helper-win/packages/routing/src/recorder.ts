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
  responseHeaders: Readonly<Record<string, string>>;
  body: string | null;
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
      url: sanitizeUrl(input.url),
      resourceType: input.resourceType,
      statusCode: input.statusCode,
      durationMs: input.durationMs,
      requestHeaders: sanitizeHeaders(input.requestHeaders),
      responseHeaders: sanitizeHeaders(input.responseHeaders),
      body: input.body === null ? null : sanitizeText(input.body),
      error: input.error === null ? null : sanitizeText(input.error),
    });
  }

  addWebSocket(input: WebSocketEntryInput): WebSocketNetworkEntry | null {
    return this.add({
      ...this.base(input.source, input.timestamp),
      kind: 'websocket',
      requestId: input.requestId,
      url: sanitizeUrl(input.url),
      direction: input.direction,
      opcode: input.opcode,
      payload: input.payload === null ? null : sanitizeText(input.payload),
      error: input.error === null ? null : sanitizeText(input.error),
    });
  }

  addDomain(input: DomainEntryInput): DomainNetworkEntry | null {
    return this.add({
      ...this.base(input.source, input.timestamp),
      kind: 'domain',
      eventType: input.eventType,
      summary: sanitizeText(input.summary),
      normalizerId: input.normalizerId,
      sourceEntryId: input.sourceEntryId,
      data: sanitizeUnknown(input.data),
    });
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
