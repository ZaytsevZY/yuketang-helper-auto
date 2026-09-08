import type { NetworkRecorder } from '../recorder.js';
import type {
  ActiveHttpRequest,
  ActiveHttpResponse,
  ActiveHttpTransport,
} from './types.js';

export class FetchHttpTransport implements ActiveHttpTransport {
  #requestSequence = 0;

  constructor(
    private readonly recorder?: NetworkRecorder,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async request(request: ActiveHttpRequest): Promise<ActiveHttpResponse> {
    const requestId = `active-http-${++this.#requestSequence}`;
    const startedAt = Date.now();
    try {
      const response = await this.fetcher(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
      const text = await response.text();
      const result = {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: parseBody(text),
      } satisfies ActiveHttpResponse;
      this.record(request, requestId, startedAt, result, text, null);
      return result;
    } catch (error) {
      this.record(
        request,
        requestId,
        startedAt,
        null,
        null,
        error instanceof Error ? error.message : 'Network request failed.',
      );
      throw error;
    }
  }

  private record(
    request: ActiveHttpRequest,
    requestId: string,
    startedAt: number,
    response: ActiveHttpResponse | null,
    body: string | null,
    error: string | null,
  ): void {
    this.recorder?.addHttp({
      source: 'active',
      phase: 'body',
      requestId,
      method: request.method,
      url: request.url,
      resourceType: 'fetch',
      statusCode: response?.status ?? null,
      durationMs: Math.max(0, Date.now() - startedAt),
      requestHeaders: request.headers,
      responseHeaders: response?.headers ?? {},
      body,
      error,
    });
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
