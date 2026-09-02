import type { BrowserEnvironment } from '@ykt/contracts';

import type { NetworkRecorder } from '../recorder.js';
import { hostAdapterFor } from './host-adapter.js';

export interface LessonSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type LessonSocketFactory = (url: string) => LessonSocket;

interface Scheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface ConnectionState {
  environment: BrowserEnvironment;
  lessonId: string;
  lessonToken: string;
  userId: string | null;
  onMessage: (message: unknown) => void;
  seen: Set<string>;
  socket: LessonSocket | null;
  reconnectTimer: unknown;
  stopped: boolean;
}

const systemScheduler: Scheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class LessonWebSocketManager {
  readonly #connections = new Map<string, ConnectionState>();
  #requestSequence = 0;

  constructor(
    private readonly factory: LessonSocketFactory = (url) =>
      new WebSocket(url) as unknown as LessonSocket,
    private readonly recorder?: NetworkRecorder,
    private readonly scheduler: Scheduler = systemScheduler,
    private readonly reconnectDelayMs = 1000,
  ) {}

  connect(input: {
    environment: BrowserEnvironment;
    lessonId: string;
    lessonToken: string;
    userId: string | null;
    onMessage: (message: unknown) => void;
  }): void {
    const existing = this.#connections.get(input.lessonId);
    if (existing) {
      existing.environment = input.environment;
      existing.lessonToken = input.lessonToken;
      existing.userId = input.userId;
      existing.onMessage = input.onMessage;
      existing.stopped = false;
      if (!existing.socket && existing.reconnectTimer === null) {
        this.open(existing);
      }
      return;
    }
    const state: ConnectionState = {
      ...input,
      seen: new Set(),
      socket: null,
      reconnectTimer: null,
      stopped: false,
    };
    this.#connections.set(input.lessonId, state);
    this.open(state);
  }

  closeLesson(lessonId: string): void {
    const state = this.#connections.get(lessonId);
    if (!state) return;
    state.stopped = true;
    if (state.reconnectTimer !== null) {
      this.scheduler.clearTimeout(state.reconnectTimer);
    }
    const socket = state.socket;
    state.socket = null;
    socket?.close();
    this.#connections.delete(lessonId);
  }

  closeAll(): void {
    for (const lessonId of [...this.#connections.keys()]) {
      this.closeLesson(lessonId);
    }
  }

  private open(state: ConnectionState): void {
    const url = hostAdapterFor(state.environment).webSocketUrl;
    const requestId = `active-ws-${++this.#requestSequence}`;
    const socket = this.factory(url);
    state.socket = socket;
    state.reconnectTimer = null;

    socket.onopen = () => {
      if (state.socket !== socket || state.stopped) return;
      const hello = JSON.stringify({
        op: 'hello',
        role: 'student',
        auth: state.lessonToken,
        lessonid: state.lessonId,
        ...(state.userId ? { userid: state.userId } : {}),
      });
      socket.send(hello);
      this.recorder?.addWebSocket({
        source: 'active',
        requestId,
        url,
        direction: 'opened',
        opcode: null,
        payload: null,
        error: null,
      });
      this.recorder?.addWebSocket({
        source: 'active',
        requestId,
        url,
        direction: 'sent',
        opcode: 1,
        payload: hello,
        error: null,
      });
    };
    socket.onmessage = (event) => {
      if (state.socket !== socket || state.stopped) return;
      const text = typeof event.data === 'string' ? event.data : '';
      this.recorder?.addWebSocket({
        source: 'active',
        requestId,
        url,
        direction: 'received',
        opcode: 1,
        payload: text,
        error: null,
      });
      const message = parseMessage(event.data);
      const key = eventKey(message);
      if (state.seen.has(key)) return;
      state.seen.add(key);
      state.onMessage(message);
    };
    socket.onerror = () => {
      this.recorder?.addWebSocket({
        source: 'active',
        requestId,
        url,
        direction: 'error',
        opcode: null,
        payload: null,
        error: 'WebSocket error',
      });
    };
    socket.onclose = () => {
      if (state.socket !== socket) return;
      state.socket = null;
      this.recorder?.addWebSocket({
        source: 'active',
        requestId,
        url,
        direction: 'closed',
        opcode: null,
        payload: null,
        error: null,
      });
      if (!state.stopped) {
        state.reconnectTimer = this.scheduler.setTimeout(
          () => this.open(state),
          this.reconnectDelayMs,
        );
      }
    };
  }
}

function parseMessage(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function eventKey(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const event = value as Record<string, unknown>;
    const explicit = event.eventId ?? event.messageId ?? event.id;
    if (typeof explicit === 'string' || typeof explicit === 'number') {
      return String(explicit);
    }
  }
  return JSON.stringify(value) ?? String(value);
}
