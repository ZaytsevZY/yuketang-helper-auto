import type { BrowserEnvironment, Presentation } from '@ykt/contracts';

import type { NetworkRecorder } from '../recorder.js';
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
  now?: () => number;
}

export class YuketangActiveClient {
  readonly sessions: SessionManager;
  readonly sockets: LessonWebSocketManager;
  readonly #transport: ActiveHttpTransport;
  readonly #now: () => number;

  constructor(options: ActiveClientOptions) {
    this.#now = options.now ?? Date.now;
    this.sessions = new SessionManager(options.credentials, this.#now);
    this.#transport =
      options.transport ?? new FetchHttpTransport(options.recorder);
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
    return response.body;
  }

  connectLesson(
    environment: BrowserEnvironment,
    lessonId: string,
    onMessage: (message: unknown) => void,
  ): void {
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
    this.sockets.closeLesson(lessonId);
    this.sessions.clearLesson(lessonId);
  }

  close(): void {
    this.sockets.closeAll();
    this.sessions.clear();
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
    this.sessions.captureResponse(environment, response);
    assertSuccess(response);
    return response;
  }
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
