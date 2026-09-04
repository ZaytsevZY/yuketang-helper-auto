import type { BrowserEnvironment } from '@ykt/contracts';

import { hostAdapterFor } from './host-adapter.js';
import type {
  ActiveHttpResponse,
  BrowserCredentials,
  CheckinResult,
  SessionCredentialSource,
} from './types.js';

interface LessonTokenState extends CheckinResult {
  environment: BrowserEnvironment;
}

export class SessionManager {
  readonly #credentials = new Map<BrowserEnvironment, BrowserCredentials>();
  readonly #lessonTokens = new Map<string, LessonTokenState>();

  constructor(
    private readonly source: SessionCredentialSource,
    private readonly now: () => number = Date.now,
  ) {}

  async headers(
    environment: BrowserEnvironment,
    lessonId?: string,
  ): Promise<Readonly<Record<string, string>>> {
    const loaded = await this.source.load(environment);
    const current = this.#credentials.get(environment);
    const credentials = {
      cookieHeader: loaded.cookieHeader,
      bearerToken: current?.bearerToken ?? loaded.bearerToken,
      userId: loaded.userId ?? current?.userId ?? null,
    };
    this.#credentials.set(environment, credentials);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      xtbz: 'ykt',
      'x-client': 'h5',
      origin: hostAdapterFor(environment).origin,
      referer: `${hostAdapterFor(environment).origin}/`,
    };
    if (credentials.cookieHeader) headers.cookie = credentials.cookieHeader;
    if (credentials.bearerToken) {
      headers.authorization = `Bearer ${credentials.bearerToken}`;
    }
    if (lessonId) {
      const token = this.lessonToken(lessonId);
      if (token) headers['lesson-token'] = token;
    }
    return headers;
  }

  async captureResponse(
    environment: BrowserEnvironment,
    response: ActiveHttpResponse,
  ): Promise<void> {
    const setAuth = header(response.headers, 'set-auth');
    if (setAuth) {
      const current = this.#credentials.get(environment);
      this.#credentials.set(environment, {
        cookieHeader: current?.cookieHeader ?? '',
        bearerToken: setAuth.replace(/^Bearer\s+/i, ''),
        userId: current?.userId ?? null,
      });
      await this.source.saveBearerToken?.(
        environment,
        setAuth.replace(/^Bearer\s+/i, ''),
      );
    }
    if (response.status === 401 || response.status === 403) {
      const current = this.#credentials.get(environment);
      if (current) {
        this.#credentials.set(environment, {
          ...current,
          bearerToken: null,
        });
      }
      for (const [lessonId, state] of this.#lessonTokens) {
        if (state.environment === environment)
          this.#lessonTokens.delete(lessonId);
      }
      await this.source.saveBearerToken?.(environment, null);
    }
  }

  setLessonToken(
    environment: BrowserEnvironment,
    lessonId: string,
    result: CheckinResult,
  ): void {
    this.#lessonTokens.set(lessonId, { ...result, environment });
  }

  lessonToken(lessonId: string): string | null {
    const state = this.#lessonTokens.get(lessonId);
    if (!state) return null;
    if (state.expiresAt !== null && state.expiresAt <= this.now()) {
      this.#lessonTokens.delete(lessonId);
      return null;
    }
    return state.lessonToken;
  }

  userId(environment: BrowserEnvironment): string | null {
    return this.#credentials.get(environment)?.userId ?? null;
  }

  clearLesson(lessonId: string): void {
    this.#lessonTokens.delete(lessonId);
  }

  clear(): void {
    this.#credentials.clear();
    this.#lessonTokens.clear();
  }
}

function header(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | null {
  const match = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name,
  );
  return match?.[1] ?? null;
}
