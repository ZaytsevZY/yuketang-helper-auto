import type {
  ActiveHttpRequest,
  ActiveHttpResponse,
  ActiveHttpTransport,
} from '@ykt/routing';

interface ChromiumSession {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export class ChromiumHttpTransport implements ActiveHttpTransport {
  constructor(private readonly session: ChromiumSession) {}

  async request(request: ActiveHttpRequest): Promise<ActiveHttpResponse> {
    const headers = new Headers(request.headers);
    headers.delete('cookie');
    const init: RequestInit = {
      method: request.method,
      headers,
      credentials: 'include',
    };
    if (request.body !== null) init.body = request.body;
    const response = await this.session.fetch(request.url, init);
    const text = await response.text();
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: parseBody(text),
    };
  }
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
