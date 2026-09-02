import type { WebContents } from 'electron';
import type { BrowserEnvironment } from '@ykt/contracts';
import {
  hostAdapterFor,
  type BrowserCredentials,
  type SessionCredentialSource,
} from '@ykt/routing';

export class ElectronSessionCredentialSource implements SessionCredentialSource {
  constructor(private readonly contents: WebContents) {}

  async load(environment: BrowserEnvironment): Promise<BrowserCredentials> {
    const adapter = hostAdapterFor(environment);
    const cookies = await this.contents.session.cookies.get({
      url: adapter.origin,
    });
    const cookieHeader = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
    const userId = cookies.find((cookie) => cookie.name === 'user_id')?.value;
    return {
      cookieHeader,
      bearerToken: await this.readBearerToken(adapter.origin),
      userId: userId ?? null,
    };
  }

  private async readBearerToken(origin: string): Promise<string | null> {
    try {
      if (new URL(this.contents.getURL()).origin !== origin) return null;
      const value: unknown = await this.contents.executeJavaScript(
        "localStorage.getItem('Authorization')",
        true,
      );
      if (typeof value !== 'string' || !value) return null;
      return value.replace(/^Bearer\s+/i, '');
    } catch {
      return null;
    }
  }
}
