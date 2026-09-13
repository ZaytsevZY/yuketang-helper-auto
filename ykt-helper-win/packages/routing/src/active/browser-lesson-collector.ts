import {
  BrowserEnvironment,
  type AnswerValue,
  type Presentation,
  type Slide,
} from '@ykt/contracts';

import { hostAdapterFor } from './host-adapter.js';

export type BrowserLessonObservation =
  | { type: 'presentation'; presentation: Presentation }
  | { type: 'message'; message: unknown }
  | { type: 'error'; message: string };

export interface ObservedBrowserHttpResponse {
  method?: string;
  url: string;
  statusCode: number;
  body: string;
  requestBody?: string | null;
  contextId?: string;
  resourceType?: string;
}

export interface BrowserArchivedPresentationObservation {
  environment: BrowserEnvironment;
  lessonId: string;
  lessonTitle: string;
  presentation: Presentation;
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
  problemIds: Set<string>;
  seenMessages: Set<string>;
}

interface ArchivedReportState {
  environment: BrowserEnvironment;
  lessonId: string;
  lessonTitle: string;
  slides: Map<string, Slide>;
  emitTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Collects the official page's classroom traffic without creating another
 * check-in request or WebSocket connection.
 */
export class BrowserLessonCollector {
  readonly #lessons = new Map<string, LessonWatch>();
  readonly #socketLessons = new Map<string, string>();
  readonly #archivedReports = new Map<string, ArchivedReportState>();
  readonly #archivedListeners = new Set<
    (
      observation: BrowserArchivedPresentationObservation,
    ) => void | Promise<void>
  >();

  onArchivedPresentation(
    listener: (
      observation: BrowserArchivedPresentationObservation,
    ) => void | Promise<void>,
  ): () => void {
    this.#archivedListeners.add(listener);
    return () => this.#archivedListeners.delete(listener);
  }

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
      problemIds: new Set(),
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
    for (const report of this.#archivedReports.values()) {
      if (report.emitTimer) clearTimeout(report.emitTimer);
    }
    this.#archivedReports.clear();
  }

  async observeHttp(input: ObservedBrowserHttpResponse): Promise<void> {
    if (input.statusCode < 200 || input.statusCode >= 300) return;
    const url = safeUrl(input.url);
    if (!url) return;

    if (isProblemSubmissionResponse(url.pathname)) {
      await this.observeProblemSubmission(input, url);
      return;
    }
    if (isClassroomReportResponse(url.pathname)) {
      await this.observeClassroomReport(input, url);
      return;
    }
    if (isSlideImageResponse(url)) {
      this.observeArchivedSlideImage(input, url);
      return;
    }
    if (!isPresentationResponse(url.pathname)) return;

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
      for (const slide of presentation.slides) {
        if (slide.problem) watch.problemIds.add(slide.problem.id);
      }
      await watch.listener({ type: 'presentation', presentation });
    } catch (error: unknown) {
      await watch.listener({
        type: 'error',
        message: error instanceof Error ? error.message : '课件响应解析失败。',
      });
    }
  }

  private async observeProblemSubmission(
    input: ObservedBrowserHttpResponse,
    url: URL,
  ): Promise<void> {
    if (input.method?.toUpperCase() !== 'POST') return;
    const environment = environmentForHostname(url.hostname);
    if (!environment || !isSuccessfulResponse(input.body)) return;
    const submission = parseProblemSubmission(
      url.pathname,
      input.requestBody ?? '',
    );
    if (!submission) return;

    const candidates = [...this.#lessons.entries()].filter(
      ([, watch]) =>
        watch.environment === environment &&
        watch.problemIds.has(submission.problemId),
    );
    const match = candidates.length === 1 ? candidates[0] : null;
    if (!match) return;
    const [, watch] = match;
    await watch.listener({
      type: 'message',
      message: {
        op: 'problemanswered',
        problemId: submission.problemId,
        answer: submission.answer,
      },
    });
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

  private async observeClassroomReport(
    input: ObservedBrowserHttpResponse,
    url: URL,
  ): Promise<void> {
    const environment = environmentForHostname(url.hostname);
    const lessonId = url.searchParams.get('lesson_id');
    if (!environment || !lessonId) return;
    const contextId = input.contextId ?? `${environment}:${lessonId}`;
    let report = this.#archivedReports.get(contextId);
    if (!report || report.lessonId !== lessonId) {
      if (report?.emitTimer) clearTimeout(report.emitTimer);
      report = {
        environment,
        lessonId,
        lessonTitle: '',
        slides: new Map(),
        emitTimer: null,
      };
      this.#archivedReports.set(contextId, report);
    }

    const value = parseJson(input.body);
    if (value === null) return;
    report.lessonTitle = reportLessonTitle(value) || report.lessonTitle;
    for (const candidate of reportSlides(value, lessonId)) {
      if (candidate.imageUrl) {
        report.slides.set(normalizeResourceUrl(candidate.imageUrl), candidate);
      }
    }
    if (report.slides.size > 0) await this.emitArchivedPresentation(report);
  }

  private observeArchivedSlideImage(
    input: ObservedBrowserHttpResponse,
    url: URL,
  ): void {
    const report = input.contextId
      ? this.#archivedReports.get(input.contextId)
      : this.#archivedReports.size === 1
        ? [...this.#archivedReports.values()][0]
        : undefined;
    if (!report) return;
    const imageUrl = url.toString();
    const key = normalizeResourceUrl(imageUrl);
    if (report.slides.has(key)) return;
    report.slides.set(key, {
      id: reportSlideId(report.lessonId, imageUrl, report.slides.size),
      index: report.slides.size,
      title: '',
      imageUrl,
      problem: null,
    });
    if (report.emitTimer) clearTimeout(report.emitTimer);
    report.emitTimer = setTimeout(() => {
      report.emitTimer = null;
      void this.emitArchivedPresentation(report);
    }, 150);
  }

  private async emitArchivedPresentation(
    report: ArchivedReportState,
  ): Promise<void> {
    const presentation: Presentation = {
      id: `report-${report.lessonId}`,
      lessonId: report.lessonId,
      title: report.lessonTitle || '课堂回顾',
      width: null,
      height: null,
      slides: [...report.slides.values()].sort(
        (left, right) => left.index - right.index,
      ),
    };
    const watch = this.#lessons.get(report.lessonId);
    if (watch?.environment === report.environment) {
      await watch.listener({ type: 'presentation', presentation });
      return;
    }
    const observation: BrowserArchivedPresentationObservation = {
      environment: report.environment,
      lessonId: report.lessonId,
      lessonTitle: report.lessonTitle,
      presentation,
    };
    for (const listener of this.#archivedListeners) await listener(observation);
  }
}

function isPresentationResponse(pathname: string): boolean {
  return pathname.includes('presentation') && pathname.includes('fetch');
}

export function isClassroomReportResponse(pathname: string): boolean {
  return pathname.includes('/classroom-report/student/detail');
}

export function isProblemSubmissionResponse(pathname: string): boolean {
  return (
    pathname === '/api/v3/lesson/problem/answer' ||
    pathname === '/api/v3/lesson/problem/retry' ||
    (pathname.includes('problem') &&
      (pathname.includes('answer') || pathname.includes('retry')))
  );
}

function isSlideImageResponse(url: URL): boolean {
  return (
    url.hostname.endsWith('.yuketang.cn') &&
    url.pathname.includes('/slide/') &&
    /\.(?:avif|gif|jpe?g|png|webp)$/i.test(url.pathname)
  );
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

function isSuccessfulResponse(value: string): boolean {
  const response = record(parseJson(value));
  return response?.code === 0 || Boolean(response?.success);
}

function parseProblemSubmission(
  pathname: string,
  body: string,
): { problemId: string; answer: AnswerValue } | null {
  const payload = record(parseJson(body));
  if (!payload) return null;
  const candidate = pathname.includes('retry')
    ? record(Array.isArray(payload.problems) ? payload.problems[0] : null)
    : payload;
  if (!candidate) return null;
  const problemId = stringId(
    candidate.problemId ?? candidate.problem_id ?? candidate.id,
  );
  const answer = parseAnswerValue(candidate.result ?? candidate.answer);
  return problemId && answer ? { problemId, answer } : null;
}

function parseAnswerValue(value: unknown): AnswerValue | null {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return [...value];
  }
  const answer = record(value);
  if (!answer || typeof answer.content !== 'string') return null;
  return {
    content: answer.content,
    pics: Array.isArray(answer.pics)
      ? answer.pics.filter((item): item is string => typeof item === 'string')
      : [],
  };
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

function reportLessonTitle(value: unknown): string {
  const root = record(value);
  const data = record(root?.data) ?? record(root?.result) ?? root;
  const lesson = record(data?.lesson) ?? record(data?.classroom);
  return stringValue(
    lesson?.title ??
      lesson?.name ??
      lesson?.lesson_name ??
      data?.lesson_title ??
      data?.lesson_name ??
      data?.title,
  );
}

function reportSlides(value: unknown, lessonId: string): Slide[] {
  const slides = new Map<string, Slide>();

  const visit = (current: unknown): void => {
    if (typeof current === 'string') {
      add(current, null);
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    const item = record(current);
    if (!item) return;
    const imageUrl = slideImageUrl(item);
    if (imageUrl) add(imageUrl, item);
    for (const child of Object.values(item)) visit(child);
  };

  const add = (
    imageUrl: string,
    source: Record<string, unknown> | null,
  ): void => {
    const url = safeUrl(imageUrl);
    if (!url || !isSlideImageResponse(url)) return;
    const key = normalizeResourceUrl(imageUrl);
    if (slides.has(key)) return;
    const fallbackIndex = slides.size;
    slides.set(key, {
      id:
        stringId(
          source?.slide_id ??
            source?.slideId ??
            source?.page_id ??
            source?.pageId ??
            source?.id,
        ) ?? reportSlideId(lessonId, imageUrl, fallbackIndex),
      index:
        numberValue(
          source?.index ??
            source?.page_index ??
            source?.pageIndex ??
            source?.position,
        ) ?? fallbackIndex,
      title: stringValue(source?.title ?? source?.name),
      imageUrl,
      problem: null,
    });
  };

  visit(value);
  return [...slides.values()];
}

function slideImageUrl(value: Record<string, unknown>): string | null {
  const candidate =
    value.image_url ??
    value.imageUrl ??
    value.cover_url ??
    value.coverUrl ??
    value.cover ??
    value.src ??
    value.url;
  return typeof candidate === 'string' ? candidate : null;
}

function normalizeResourceUrl(value: string): string {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function reportSlideId(
  lessonId: string,
  imageUrl: string,
  fallbackIndex: number,
): string {
  const key = normalizeResourceUrl(imageUrl);
  let hash = 2_166_136_261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `report-${lessonId}-${(hash >>> 0).toString(36) || fallbackIndex}`;
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

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

function numberValue(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
