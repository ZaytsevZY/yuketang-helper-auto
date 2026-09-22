import { fetchAssignmentDetail } from './assignment-detail.js';
import { openExamReviewSession } from './exam-review-session.js';
import {
  BrowserEnvironment,
  type AssignmentSnapshot,
  type Assignment,
  type AssignmentDetail,
  type Presentation,
} from '@ykt/contracts';
import { AssignmentAuthError, fetchAssignments } from './assignments.js';

import type { NetworkRecorder } from '../recorder.js';
import type {
  BrowserArchivedPresentationObservation,
  BrowserLessonCollector,
  BrowserLessonObservation,
} from './browser-lesson-collector.js';
import { hostAdapterFor } from './host-adapter.js';
import { FetchHttpTransport } from './http-transport.js';
import {
  LessonWebSocketManager,
  type LessonSocketFactory,
} from './lesson-websocket.js';
import { SessionManager } from './session-manager.js';
import type {
  ActiveHttpRequest,
  ActiveHttpResponse,
  ActiveHttpTransport,
  ActiveLesson,
  ActiveUser,
  CheckinResult,
  SessionCredentialSource,
} from './types.js';

export interface ActiveSubmissionPlan {
  route: 'answer' | 'retry';
  payload: unknown;
}

export interface ActiveClientOptions {
  credentials: SessionCredentialSource;
  transport?: ActiveHttpTransport;
  socketFactory?: LessonSocketFactory;
  recorder?: NetworkRecorder;
  browserCollector?: BrowserLessonCollector;
  now?: () => number;
}

export class YuketangActiveClient {
  readonly sessions: SessionManager;
  readonly sockets: LessonWebSocketManager;
  readonly #transport: ActiveHttpTransport;
  readonly #browserCollector: BrowserLessonCollector | undefined;
  readonly #now: () => number;

  constructor(options: ActiveClientOptions) {
    this.#now = options.now ?? Date.now;
    this.sessions = new SessionManager(options.credentials, this.#now);
    this.#transport =
      options.transport ?? new FetchHttpTransport(options.recorder);
    this.#browserCollector = options.browserCollector;
    this.sockets = new LessonWebSocketManager(
      options.socketFactory,
      options.recorder,
    );
  }

  async getUser(environment: BrowserEnvironment): Promise<ActiveUser> {
    const adapter = hostAdapterFor(environment);
    const response = await this.request(environment, {
      method: 'GET',
      url: adapter.userUrl,
      headers: {},
      body: null,
    });
    return adapter.parseUser(response.body);
  }

  async listAssignments(
    environment: BrowserEnvironment,
  ): Promise<AssignmentSnapshot> {
    if (environment !== BrowserEnvironment.Pro) {
      throw new Error('作业接口目前仅支持荷塘雨课堂，请切换到荷塘雨课堂。');
    }
    return fetchAssignments(
      (url) => this.assignmentJson(environment, url),
      await this.assignmentUniversity(environment),
      this.#now,
    );
  }

  async getAssignmentDetail(
    environment: BrowserEnvironment,
    assignment: Assignment,
  ): Promise<AssignmentDetail> {
    if (environment !== BrowserEnvironment.Pro)
      throw new Error('详情仅支持荷塘雨课堂。');
    return fetchAssignmentDetail(
      (url) => this.assignmentJson(environment, url),
      assignment,
      await this.assignmentUniversity(environment),
      this.#now,
      async () => {
        const sessionHeaders = await this.sessions.headers(environment);
        const csrf = /(?:^|;\s*)csrftoken=([^;]+)/.exec(
          sessionHeaders.cookie ?? '',
        )?.[1];
        // This web login handoff uses CSRF + the browser cookie session, unlike
        // the h5 classroom APIs. Copying their x-client/Bearer headers fails.
        const headers: Record<string, string> = {
          'content-type': 'application/json;charset=UTF-8',
          xtbz: 'ykt',
          'xt-agent': 'web',
          'classroom-id': assignment.classroomId,
          'university-id': '0',
          'uv-id': '0',
          origin: 'https://pro.yuketang.cn',
          referer: `https://pro.yuketang.cn/v2/web/trans/${encodeURIComponent(assignment.classroomId)}/${encodeURIComponent(assignment.leafTypeId!)}?status=4&isFrom=2`,
        };
        if (sessionHeaders.cookie) headers.cookie = sessionHeaders.cookie;
        if (csrf) headers['x-csrftoken'] = csrf;
        const response = await this.#transport.request({
          method: 'POST',
          url: 'https://pro.yuketang.cn/v/exam/gen_token',
          headers,
          body: JSON.stringify({
            exam_id: assignment.leafTypeId,
            classroom_id: assignment.classroomId,
          }),
        });
        if (response.status !== 200) throw new AssignmentAuthError();
        return openExamReviewSession(
          this.#transport,
          response.body,
          assignment.leafTypeId!,
        );
      },
    );
  }

  private async assignmentUniversity(
    environment: BrowserEnvironment,
  ): Promise<string> {
    const headers = await this.sessions.headers(environment);
    const cookie = headers.cookie ?? '';
    return (
      /(?:^|;\s*)uv_id=([^;]+)/.exec(cookie)?.[1] ??
      /(?:^|;\s*)university_id=([^;]+)/.exec(cookie)?.[1] ??
      '2598'
    );
  }

  private async assignmentJson(
    environment: BrowserEnvironment,
    url: string,
  ): Promise<unknown> {
    const response = await this.#transport.request({
      method: 'GET',
      url,
      body: null,
      headers: await this.sessions.headers(environment),
    });
    await this.sessions.captureResponse(environment, response);
    if (response.status === 401 || response.status === 403)
      throw new AssignmentAuthError();
    if (response.status < 200 || response.status >= 300)
      throw new Error(`雨课堂作业请求失败（HTTP ${response.status}）。`);
    return response.body;
  }

  async listLessons(
    environment: BrowserEnvironment,
  ): Promise<readonly ActiveLesson[]> {
    const adapter = hostAdapterFor(environment);
    const response = await this.request(environment, {
      method: 'GET',
      url: adapter.onLessonUrl,
      headers: {},
      body: null,
    });
    return adapter.parseLessons(response.body);
  }

  async checkin(
    environment: BrowserEnvironment,
    lessonId: string,
    classroomId?: string,
  ): Promise<CheckinResult> {
    const adapter = hostAdapterFor(environment);
    const response = await this.request(environment, {
      method: 'POST',
      url: adapter.checkinUrl,
      headers: {},
      body: JSON.stringify({
        lessonId,
        ...(classroomId ? { classroomId } : {}),
      }),
    });
    const result = adapter.parseCheckin(response.body, this.#now());
    this.sessions.setLessonToken(environment, lessonId, result);
    return result;
  }

  async fetchPresentation(
    environment: BrowserEnvironment,
    lessonId: string,
    presentationId: string,
  ): Promise<Presentation> {
    const adapter = hostAdapterFor(environment);
    const response = await this.request(
      environment,
      {
        method: 'GET',
        url: adapter.presentationUrl(presentationId),
        headers: {},
        body: null,
      },
      lessonId,
    );
    return adapter.parsePresentation(response.body, lessonId, presentationId);
  }

  async submit(
    environment: BrowserEnvironment,
    lessonId: string,
    plan: ActiveSubmissionPlan,
  ): Promise<unknown> {
    const adapter = hostAdapterFor(environment);
    const response = await this.request(
      environment,
      {
        method: 'POST',
        url: plan.route === 'answer' ? adapter.answerUrl : adapter.retryUrl,
        headers: {},
        body: JSON.stringify(plan.payload),
      },
      lessonId,
    );
    if (plan.route === 'retry')
      assertRetryAccepted(response.body, plan.payload);
    return response.body;
  }

  connectLesson(
    environment: BrowserEnvironment,
    lessonId: string,
    onMessage: (message: unknown) => void | Promise<void>,
    presentationId: string | null = null,
  ): void {
    if (this.#browserCollector) {
      this.#browserCollector.watchLesson(
        environment,
        lessonId,
        presentationId,
        async (observation: BrowserLessonObservation) => {
          if (observation.type === 'presentation') {
            await onMessage({
              op: 'presentationloaded',
              presentation: observation.presentation,
            });
            return;
          }
          await onMessage(
            observation.type === 'error'
              ? { op: 'collectionerror', error: observation.message }
              : observation.message,
          );
        },
      );
      return;
    }
    const lessonToken = this.sessions.lessonToken(lessonId);
    if (!lessonToken) throw new Error('Lesson has not been checked in.');
    this.sockets.connect({
      environment,
      lessonId,
      lessonToken,
      userId: this.sessions.userId(environment),
      onMessage,
    });
  }

  closeLesson(lessonId: string): void {
    this.#browserCollector?.unwatchLesson(lessonId);
    this.sockets.closeLesson(lessonId);
    this.sessions.clearLesson(lessonId);
  }

  close(): void {
    this.#browserCollector?.clear();
    this.sockets.closeAll();
    this.sessions.clear();
  }

  onArchivedPresentation(
    listener: (
      observation: BrowserArchivedPresentationObservation,
    ) => void | Promise<void>,
  ): () => void {
    return (
      this.#browserCollector?.onArchivedPresentation(listener) ?? (() => {})
    );
  }

  private async request(
    environment: BrowserEnvironment,
    request: ActiveHttpRequest,
    lessonId?: string,
  ): Promise<ActiveHttpResponse> {
    const response = await this.#transport.request({
      ...request,
      headers: await this.sessions.headers(environment, lessonId),
    });
    await this.sessions.captureResponse(environment, response);
    assertSuccess(response);
    return response;
  }

  get usesBrowserCollection(): boolean {
    return this.#browserCollector !== undefined;
  }
}

function assertRetryAccepted(body: unknown, payload: unknown): void {
  const expectedIds = retryProblemIds(payload);
  const data =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).data
      : null;
  const success =
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>).success
      : null;
  const successIds = Array.isArray(success) ? success.map(String) : [];
  if (
    expectedIds.length === 0 ||
    expectedIds.some((id) => !successIds.includes(id))
  ) {
    throw new Error('雨课堂服务端未确认补交成功。');
  }
}

function retryProblemIds(payload: unknown): readonly string[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const problems = (payload as Record<string, unknown>).problems;
  if (!Array.isArray(problems)) return [];
  return problems.flatMap((problem) => {
    if (typeof problem !== 'object' || problem === null) return [];
    const id = (problem as Record<string, unknown>).problemId;
    return typeof id === 'string' || typeof id === 'number' ? [String(id)] : [];
  });
}

function assertSuccess(response: ActiveHttpResponse): void {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Yuketang request failed with HTTP ${response.status}.`);
  }
  if (typeof response.body === 'object' && response.body !== null) {
    const code = (response.body as Record<string, unknown>).code;
    if (typeof code === 'number' && code !== 0) {
      throw new Error(`Yuketang request failed with code ${code}.`);
    }
  }
}
