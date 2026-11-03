import {
  BrowserEnvironment,
  type AnswerValue,
  type Presentation,
  type LessonCollectionStatus,
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
  status: LessonCollectionStatus;
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
  titlePriority: number;
  slides: Map<string, Slide>;
  emitTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Collects the official page's classroom traffic without creating another
 * check-in request or WebSocket connection.
 */
export class BrowserLessonCollector {
  readonly #statusListeners = new Set<
    (status: LessonCollectionStatus) => void
  >();
  readonly #lessons = new Map<string, LessonWatch>();
  readonly #socketLessons = new Map<string, string>();
  readonly #archivedReports = new Map<string, ArchivedReportState>();
  readonly #archivedListeners = new Set<
    (
      observation: BrowserArchivedPresentationObservation,
    ) => void | Promise<void>
  >();

  getCollectionStatus(lessonId: string): LessonCollectionStatus | null {
    return this.#lessons.get(lessonId)?.status ?? null;
  }

  onCollectionStatusChanged(
    listener: (status: LessonCollectionStatus) => void,
  ): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  private updateStatus(
    lessonId: string,
    patch: Partial<LessonCollectionStatus>,
  ): void {
    const watch = this.#lessons.get(lessonId);
    if (!watch) return;
    watch.status = { ...watch.status, ...patch, updatedAt: Date.now() };
    for (const listener of this.#statusListeners) listener(watch.status);
  }

  /** Only matching PPT traffic can change a connected lesson's progress. */
  observeCollectionRequest(input: {
    url: string;
    phase:
      | 'requesting'
      | 'receiving'
      | 'network-error'
      | 'response-error'
      | 'format-error';
    receivedBytes?: number;
    detail?: string;
  }): void {
    const url = safeUrl(input.url);
    if (!url || !isCollectionResponse(url.pathname)) return;
    const environment = environmentForHostname(url.hostname);
    if (!environment) return;
    const reportLessonId = url.searchParams.get('lesson_id');
    const reportWatch = reportLessonId
      ? this.#lessons.get(reportLessonId)
      : undefined;
    const match = isClassroomReportResponse(url.pathname)
      ? reportLessonId && reportWatch
        ? ([reportLessonId, reportWatch] as const)
        : null
      : this.findLesson(
          environment,
          url.searchParams.get('presentation_id') ??
            url.searchParams.get('presentationId'),
          true,
        );
    if (!match || match[1].environment !== environment) return;
    const [lessonId, watch] = match;
    // Archived reports may collect several resources at once. Metadata traffic
    // must not hide a usable deck already collected from a different response.
    if (isClassroomReportResponse(url.pathname) && watch.status.slideCount > 0)
      return;
    this.updateStatus(lessonId, {
      phase: input.phase,
      ...(input.phase === 'requesting' ? { startedAt: Date.now() } : {}),
      receivedBytes:
        input.phase === 'requesting'
          ? 0
          : (input.receivedBytes ?? watch.status.receivedBytes),
      detail: input.detail ?? '',
    });
  }

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
      status: {
        lessonId,
        environment,
        phase: 'waiting',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        receivedBytes: 0,
        slideCount: 0,
        problemCount: 0,
        detail: '',
      },
      environment,
      presentationId,
      listener,
      problemIds: new Set(),
      seenMessages: new Set(),
    });
    this.updateStatus(lessonId, {});
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
    if (input.statusCode < 200 || input.statusCode >= 300) {
      this.observeCollectionRequest({
        url: input.url,
        phase: 'network-error',
        detail: `HTTP ${input.statusCode}`,
      });
      return;
    }
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

    const responsePresentationId =
      url.searchParams.get('presentation_id') ??
      url.searchParams.get('presentationId') ??
      presentationIdFromResponse(value);
    const match = this.findLesson(environment, responsePresentationId);
    if (!match) return;

    const [lessonId, watch] = match;
    const presentationId = responsePresentationId ?? watch.presentationId;
    this.updateStatus(lessonId, { phase: 'parsing', detail: '' });
    let failurePhase: 'format-error' | 'response-error' = 'format-error';
    try {
      if (value === null) throw new Error('课件响应不是有效 JSON');
      if (!presentationId) throw new Error('课件响应缺少课件 ID');
      const root = record(value);
      if (root?.code !== undefined && root.code !== 0) {
        failurePhase = 'response-error';
        throw new Error(`课件接口返回错误码 ${String(root.code)}`);
      }
      const data = record(root?.data) ?? record(root?.result) ?? root;
      // parsePresentation historically defaults missing slide arrays to [].
      // Keep an explicitly empty deck valid, but surface schema changes.
      if (!data || (!Array.isArray(data.slides) && !Array.isArray(data.pages)))
        throw new Error('课件响应缺少 slides / pages 列表');
      const presentation = hostAdapterFor(environment).parsePresentation(
        value,
        lessonId,
        presentationId,
      );
      for (const slide of presentation.slides) {
        if (slide.problem) watch.problemIds.add(slide.problem.id);
      }
      await watch.listener({ type: 'presentation', presentation });
      this.updateStatus(lessonId, {
        phase: 'ready',
        slideCount: presentation.slides.length,
        problemCount: presentation.slides.filter((slide) => slide.problem)
          .length,
        detail: '',
      });
    } catch (error: unknown) {
      this.updateStatus(lessonId, {
        phase: failurePhase,
        detail: error instanceof Error ? error.message : '课件响应解析失败',
      });
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
    strictPresentationId = false,
  ): [string, LessonWatch] | null {
    const candidates = [...this.#lessons.entries()].filter(
      ([, watch]) => watch.environment === environment,
    );
    if (presentationId) {
      const exact = candidates.find(
        ([, watch]) => watch.presentationId === presentationId,
      );
      if (exact) return exact;
      // Request-only diagnostics lack a body to bind a changed presentation.
      // Preserve the existing response fallback for teachers switching decks.
      if (
        strictPresentationId &&
        candidates.some(([, watch]) => watch.presentationId)
      )
        return null;
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
        titlePriority: -1,
        slides: new Map(),
        emitTimer: null,
      };
      this.#archivedReports.set(contextId, report);
    }

    const value = parseJson(input.body);
    if (value === null) {
      // An empty body is sent at responseReceived to bind lazy slide images.
      if (input.body)
        this.observeCollectionRequest({
          url: input.url,
          phase: 'format-error',
          detail: '课件响应不是有效 JSON',
        });
      return;
    }
    const root = record(value);
    if (root?.code !== undefined && root.code !== 0) {
      this.observeCollectionRequest({
        url: input.url,
        phase: 'response-error',
        detail: `课件接口返回错误码 ${String(root.code)}`,
      });
      return;
    }
    const title = reportLessonTitle(value);
    const priority = url.pathname.endsWith('/student/lesson-info')
      ? 3
      : url.pathname.endsWith('/replay')
        ? 2
        : 1;
    if (title && priority >= report.titlePriority) {
      report.lessonTitle = title;
      report.titlePriority = priority;
    }
    for (const candidate of reportSlides(value, lessonId, environment)) {
      if (candidate.imageUrl) {
        report.slides.set(normalizeResourceUrl(candidate.imageUrl), candidate);
      }
    }
    // Metadata alone discovers a lesson; lazy or cached images need not emit
    // any new Image response at all.
    if (report.lessonTitle || report.slides.size > 0)
      await this.emitArchivedPresentation(report);
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
    if (presentation.slides.length > 0)
      this.updateStatus(report.lessonId, {
        phase: 'ready',
        slideCount: presentation.slides.length,
        problemCount: presentation.slides.filter((slide) => slide.problem)
          .length,
        detail: '',
      });
    if (
      this.#archivedListeners.size === 0 &&
      watch?.environment === report.environment
    ) {
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

function isCollectionResponse(pathname: string): boolean {
  return (
    isPresentationResponse(pathname) ||
    (isClassroomReportResponse(pathname) &&
      /\/(?:ppt|review|detail|replay)\/?$/.test(pathname))
  );
}

export function isClassroomReportResponse(pathname: string): boolean {
  return /^\/api\/v3\/classroom-report\/(?:lesson\/basic-info|student\/(?:lesson-info|detail|review|ppt)|replay)\/?$/.test(
    pathname,
  );
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
  const lesson = record(data?.lesson);
  const title = stringValue(
    lesson?.title ??
      lesson?.name ??
      lesson?.lesson_name ??
      data?.lessonName ??
      data?.lesson_title ??
      data?.lesson_name ??
      data?.title,
  );
  const course = stringValue(
    data?.courseName ??
      data?.classroomName ??
      record(lesson?.course)?.name ??
      record(lesson?.classroom)?.name,
  );
  return course && title && course !== title
    ? `${course} · ${title}`
    : title || course;
}

function reportSlides(
  value: unknown,
  lessonId: string,
  environment: BrowserEnvironment,
): Slide[] {
  const slides = new Map<string, Slide>();

  const visit = (current: unknown, slideListItem = false): void => {
    if (typeof current === 'string') {
      add(current, null, false);
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item, slideListItem);
      return;
    }
    const item = record(current);
    if (!item) return;
    const imageUrl = slideImageUrl(item);
    if (imageUrl) add(imageUrl, item, slideListItem);
    for (const [key, child] of Object.entries(item)) {
      visit(child, key === 'slideList');
    }
  };

  const add = (
    imageUrl: string,
    source: Record<string, unknown> | null,
    slideListItem: boolean,
  ): void => {
    const url = safeUrl(imageUrl);
    if (!url || url.protocol !== 'https:' || url.username || url.password)
      return;
    // Modern reports use signed, extensionless common_uploads covers. Only
    // accept those on a structured slide record, never arbitrary nested URLs
    // (avatars, attachments and student details are also in report responses).
    const structuredCover =
      source &&
      (source.type === 'slide' ||
        source.presentationId !== undefined ||
        source.slideId !== undefined ||
        source.slide_id !== undefined) &&
      url.hostname.endsWith('.yuketang.cn') &&
      url.pathname.startsWith('/common_uploads/');
    // Standard's student/ppt slideList uses extensionless qn-scd1 covers.
    // Require a slideList record so report avatars and presentation thumbnails
    // from other parts of the response cannot become courseware pages.
    const standardSlideCover =
      environment === BrowserEnvironment.Standard &&
      slideListItem &&
      source?.presentationId !== undefined &&
      source.cover === imageUrl &&
      url.hostname === 'qn-scd1.yuketang.cn' &&
      /^\/[a-zA-Z0-9]+$/.test(url.pathname);
    if (!isSlideImageResponse(url) && !structuredCover && !standardSlideCover)
      return;
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
    value.coverAlt ??
    value.cover_url ??
    value.coverUrl ??
    value.cover ??
    value.image ??
    value.thumbnail ??
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
