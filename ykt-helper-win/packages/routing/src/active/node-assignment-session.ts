import { CookieJar } from 'tough-cookie';
import type {
  ActiveHttpRequest,
  ActiveHttpTransport,
  BrowserCredentials,
  SessionCredentialSource,
} from './types.js';

const origin = 'https://pro.yuketang.cn';
const hosts = new Set([
  'pro.yuketang.cn',
  'tsinghua-exam.yuketang.cn',
  'examination.xuetangx.com',
]);

/** A pure Node session. Platform cookies never become exam-domain cookies. */
export class NodeAssignmentSession
  implements ActiveHttpTransport, SessionCredentialSource
{
  private readonly jar = new CookieJar();
  private bearerToken: string | null;

  constructor(
    private readonly credentials: BrowserCredentials,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.bearerToken = credentials.bearerToken;
    for (const cookie of credentials.cookieHeader.split(';')) {
      if (cookie.trim())
        this.jar.setCookieSync(`${cookie.trim()}; Path=/; Secure`, origin);
    }
  }

  async load(): Promise<BrowserCredentials> {
    return {
      ...this.credentials,
      cookieHeader: await this.jar.getCookieString(origin),
      bearerToken: this.bearerToken,
    };
  }

  async saveBearerToken(_environment: string, token: string | null) {
    this.bearerToken = token;
  }

  async request(request: ActiveHttpRequest) {
    const url = new URL(request.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !hosts.has(url.hostname)
    )
      throw new Error('独立作业会话不支持此服务地址。');
    const headers = new Headers(request.headers);
    // Always resolve cookies by target URL, including Set-Cookie from /login.
    headers.delete('cookie');
    if (url.origin !== origin) headers.delete('authorization');
    const cookies = await this.jar.getCookieString(url.href);
    if (cookies) headers.set('cookie', cookies);
    let response: Response;
    try {
      response = await this.fetcher(url.href, {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // Do not expose token-bearing login URLs in error messages.
      throw new Error(
        `雨课堂网络请求失败或超时（${url.hostname}${url.pathname}）。`,
      );
    }
    for (const cookie of response.headers.getSetCookie()) {
      await this.jar.setCookie(cookie, url.href, { ignoreError: true });
    }
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* HTML login responses are valid. */
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  }
}
