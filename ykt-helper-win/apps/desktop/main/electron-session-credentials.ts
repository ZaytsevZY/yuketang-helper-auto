import type { WebContents } from 'electron';
import type { BrowserEnvironment } from '@ykt/contracts';
import {
  hostAdapterFor,
  type BrowserCredentials,
  type SessionCredentialSource,
} from '@ykt/routing';
import type { SecretStore } from '@ykt/storage';

export class ElectronSessionCredentialSource implements SessionCredentialSource {
  constructor(
    private readonly getContents: () => WebContents,
    private readonly secrets: SecretStore,
  ) {}

  async load(environment: BrowserEnvironment): Promise<BrowserCredentials> {
    const adapter = hostAdapterFor(environment);
    const contents = this.getContents();
    const cookies = await contents.session.cookies.get({
      url: adapter.origin,
    });
    const cookieHeader = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
    const userId = cookies.find((cookie) => cookie.name === 'user_id')?.value;
    return {
      cookieHeader,
      bearerToken: await this.readBearerToken(
        contents,
        environment,
        adapter.origin,
      ),
      userId: userId ?? null,
    };
  }

  async saveBearerToken(
    environment: BrowserEnvironment,
    value: string | null,
  ): Promise<void> {
    const key = tokenKey(environment);
    if (value) await this.secrets.set(key, value);
    else await this.secrets.delete(key);
  }

  private async readBearerToken(
    contents: WebContents,
    environment: BrowserEnvironment,
    origin: string,
  ): Promise<string | null> {
    try {
      if (new URL(contents.getURL()).origin === origin) {
        const value: unknown = await contents.executeJavaScript(
          "localStorage.getItem('Authorization')",
          true,
        );
        if (typeof value === 'string' && value) {
          const token = value.replace(/^Bearer\s+/i, '');
          await this.saveBearerToken(environment, token);
          return token;
        }
      }
    } catch {
      // Fall back to the encrypted copy when the page is unavailable.
    }
    return this.secrets.get(tokenKey(environment));
  }
}

function tokenKey(environment: BrowserEnvironment): string {
  return `yuketang:${environment}:bearer-token`;
}
