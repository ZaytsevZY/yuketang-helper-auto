import { BrowserEnvironment, type Presentation } from '@ykt/contracts';

import { hostAdapterFor } from './host-adapter.js';

export type BrowserLessonObservation =
  | { type: 'presentation'; presentation: Presentation }
  | { type: 'message'; message: unknown }
  | { type: 'error'; message: string };

export interface ObservedBrowserHttpResponse {
  url: string;
  statusCode: number;
  body: string;
}

export interface ObservedBrowserWebSocketFrame {
  requestId: string;
  direction: 'sent' | 'received' | 'closed';
  payload: string | null;
}

interface LessonWatch {
  environment: BrowserEnvironment;
  presentationId: string | null;
  listener: (observation: BrowserLessonObservation) => void | Promise<void>;
  seenMessages: Set<string>;
}

/**
 * Collects the official page's classroom traffic without creating another
 * check-in request or WebSocket connection.
 */
export class BrowserLessonCollector {
  readonly #lessons = new Map<string, LessonWatch>();
  readonly #socketLessons = new Map<string, string>();

  watchLesson(
    environment: BrowserEnvironment,
    lessonId: string,
    presentationId: string | null,
    listener: LessonWatch['listener'],
  ): void {
    this.#lessons.set(lessonId, {
      environment,
      presentationId,
      listener,
      seenMessages: new Set(),
    });
  }

  unwatchLesson(lessonId: string): void {
    this.#lessons.delete(lessonId);
    for (const [requestId, mappedLessonId] of this.#socketLessons) {
      if (mappedLessonId === lessonId) this.#socketLessons.delete(requestId);
    }
  }

  clear(): void {
    this.#lessons.clear();
    this.#socketLessons.clear();
  }

  async observeHttp(input: ObservedBrowserHttpResponse): Promise<void> {
    if (input.statusCode < 200 || input.statusCode >= 300) return;
    const url = safeUrl(input.url);
    if (!url || !isPresentationResponse(url.pathname)) return;

    const environment = environmentForHostname(url.hostname);
    if (!environment) return;
    const value = parseJson(input.body);
    if (value === null) return;

    const responsePresentationId =
      url.searchParams.get('presentation_id') ??
      url.searchParams.get('presentationId') ??
      presentationIdFromResponse(value);
    const match = this.findLesson(environment, responsePresentationId);
    if (!match) return;

    const [lessonId, watch] = match;
    const presentationId = responsePresentationId ?? watch.presentationId;
    if (!presentationId) return;
    try {
      const presentation = hostAdapterFor(environment).parsePresentation(
        value,
        lessonId,
        presentationId,
      );
      await watch.listener({ type: 'presentation', presentation });
    } catch (error: unknown) {
      await watch.listener({
        type: 'error',
        message: error instanceof Error ? error.message : '课件响应解析失败。',
      });
    }
  }

  async observeWebSocket(input: ObservedBrowserWebSocketFrame): Promise<void> {
    if (input.direction === 'closed') {
      this.#socketLessons.delete(input.requestId);
      return;
    }
    const message = parseJson(input.payload ?? '');
    if (message === null) return;

    if (input.direction === 'sent') {
      const lessonId = helloLessonId(message);
      if (lessonId && this.#lessons.has(lessonId)) {
        this.#socketLessons.set(input.requestId, lessonId);
      }
      return;
    }

    const lessonId = this.#socketLessons.get(input.requestId);
    if (!lessonId) return;
    const watch = this.#lessons.get(lessonId);
    if (!watch) return;
    const key = eventKey(message);
    if (watch.seenMessages.has(key)) return;
    watch.seenMessages.add(key);
    await watch.listener({ type: 'message', message });
  }

  private findLesson(
    environment: BrowserEnvironment,
    presentationId: string | null,
  ): [string, LessonWatch] | null {
    const candidates = [...this.#lessons.entries()].filter(
      ([, watch]) => watch.environment === environment,
    );
    if (presentationId) {
      const exact = candidates.find(
        ([, watch]) => watch.presentationId === presentationId,
      );
      if (exact) return exact;
    }
    return candidates.length === 1 ? candidates[0]! : null;
  }
}

function isPresentationResponse(pathname: string): boolean {
  return pathname.includes('presentation') && pathname.includes('fetch');
}

function environmentForHostname(hostname: string): BrowserEnvironment | null {
  if (hostname === 'www.yuketang.cn') return BrowserEnvironment.Standard;
  if (hostname === 'pro.yuketang.cn') return BrowserEnvironment.Pro;
  if (hostname === 'changjiang.yuketang.cn') {
    return BrowserEnvironment.Changjiang;
  }
  return null;
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function helloLessonId(value: unknown): string | null {
  const message = record(value);
  if (!message || message.op !== 'hello') return null;
  return stringId(message.lessonid ?? message.lessonId ?? message.lesson_id);
}

function presentationIdFromResponse(value: unknown): string | null {
  const root = record(value);
  const data = record(root?.data) ?? record(root?.result) ?? root;
  return stringId(data?.id ?? data?.presentationId ?? data?.presentation_id);
}

function eventKey(value: unknown): string {
  const message = record(value);
  const explicit = message?.eventId ?? message?.messageId ?? message?.id;
  return typeof explicit === 'string' || typeof explicit === 'number'
    ? String(explicit)
    : (JSON.stringify(value) ?? String(value));
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringId(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null;
}
