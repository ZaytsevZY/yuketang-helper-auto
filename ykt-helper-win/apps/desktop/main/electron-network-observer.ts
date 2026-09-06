import type { WebContents } from 'electron';
import {
  isClassroomReportResponse,
  type BrowserLessonCollector,
  type NetworkRecorder,
} from '@ykt/routing';

interface RequestMetadata {
  method: string;
  url: string;
  resourceType: string;
  requestHeaders: Readonly<Record<string, string>>;
  startedAt: number;
}

interface CdpRequestMetadata {
  method: string;
  url: string;
}

interface CdpResponseMetadata {
  url: string;
  status: number;
  mimeType: string;
  resourceType: string;
  headers: Readonly<Record<string, string>>;
}

interface CdpMessage {
  requestId?: string;
  type?: string;
  encodedDataLength?: number;
  request?: { method?: string; url?: string };
  response?: {
    url?: string;
    status?: number;
    mimeType?: string;
    headers?: Readonly<Record<string, unknown>>;
    opcode?: number;
    payloadData?: string;
  };
  url?: string;
  errorMessage?: string;
}

const LAB_BODY_LIMIT = 64 * 1024;
const COLLECTOR_BODY_LIMIT = 2 * 1024 * 1024;

export class ElectronNetworkObserver {
  readonly #requests = new Map<number, RequestMetadata>();
  readonly #cdpRequests = new Map<string, CdpRequestMetadata>();
  readonly #cdpResponses = new Map<string, CdpResponseMetadata>();
  readonly #webSockets = new Map<string, string>();
  #deepCapture = false;
  #deepCaptureError: string | null = null;
  #manualDetach = false;

  constructor(
    private readonly contents: WebContents,
    private readonly recorder: NetworkRecorder,
    private readonly onDeepStateChanged: () => void,
    private readonly lessonCollector?: BrowserLessonCollector,
    private readonly captureSessionRequests = true,
  ) {}

  get deepCapture(): boolean {
    return this.#deepCapture;
  }

  get deepCaptureError(): string | null {
    return this.#deepCaptureError;
  }

  async start(): Promise<void> {
    if (this.contents.isDestroyed()) return;
    if (this.captureSessionRequests) {
      const webRequest = this.contents.session.webRequest;
      const filter = { urls: ['<all_urls>'] };

      webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        this.#requests.set(details.id, {
          method: details.method,
          url: details.url,
          resourceType: details.resourceType,
          requestHeaders: flattenHeaders(details.requestHeaders),
          startedAt: Date.now(),
        });
        callback({});
      });

      webRequest.onCompleted(filter, (details) => {
        const request = this.#requests.get(details.id);
        this.#requests.delete(details.id);
        this.recorder.addHttp({
          source: 'browser',
          phase: 'complete',
          requestId: String(details.id),
          method: request?.method ?? details.method,
          url: request?.url ?? details.url,
          resourceType: request?.resourceType ?? details.resourceType,
          statusCode: details.statusCode,
          durationMs: request
            ? Math.max(0, Date.now() - request.startedAt)
            : null,
          requestHeaders: request?.requestHeaders ?? {},
          responseHeaders: flattenHeaders(details.responseHeaders),
          body: null,
          error: null,
        });
      });

      webRequest.onErrorOccurred(filter, (details) => {
        const request = this.#requests.get(details.id);
        this.#requests.delete(details.id);
        this.recorder.addHttp({
          source: 'browser',
          phase: 'complete',
          requestId: String(details.id),
          method: request?.method ?? details.method,
          url: request?.url ?? details.url,
          resourceType: request?.resourceType ?? details.resourceType,
          statusCode: null,
          durationMs: request
            ? Math.max(0, Date.now() - request.startedAt)
            : null,
          requestHeaders: request?.requestHeaders ?? {},
          responseHeaders: {},
          body: null,
          error: details.error,
        });
      });
    }

    this.contents.debugger.on('message', (_event, method, params) => {
      void this.handleDebuggerMessage(method, params as CdpMessage);
    });
    this.contents.debugger.on('detach', (_event, reason) => {
      this.#deepCapture = false;
      if (!this.#manualDetach) {
        this.#deepCaptureError = `深度捕获已断开：${reason}`;
      }
      this.#manualDetach = false;
      this.onDeepStateChanged();
    });
    await this.ensureDebuggerAttached();
  }

  async setDeepCapture(enabled: boolean): Promise<void> {
    if (this.contents.isDestroyed()) return;
    if (enabled === this.#deepCapture) return;

    if (!enabled) {
      this.#deepCapture = false;
      this.onDeepStateChanged();
      return;
    }

    if (await this.ensureDebuggerAttached()) {
      this.#deepCapture = true;
    }
    this.onDeepStateChanged();
  }

  destroy(): void {
    if (this.captureSessionRequests && !this.contents.isDestroyed()) {
      const webRequest = this.contents.session.webRequest;
      webRequest.onBeforeSendHeaders(null);
      webRequest.onCompleted(null);
      webRequest.onErrorOccurred(null);
    }
    if (this.contents.isDestroyed()) return;
    if (this.contents.debugger.isAttached()) {
      this.#manualDetach = true;
      this.contents.debugger.detach();
    }
  }

  private async handleDebuggerMessage(
    method: string,
    params: CdpMessage,
  ): Promise<void> {
    const requestId = params.requestId;
    if (!requestId) return;

    if (method === 'Network.requestWillBeSent') {
      this.#cdpRequests.set(requestId, {
        method: params.request?.method ?? 'GET',
        url: params.request?.url ?? '',
      });
      return;
    }

    if (method === 'Network.responseReceived') {
      const response = params.response;
      if (!response) return;
      const metadata = {
        url: response.url ?? this.#cdpRequests.get(requestId)?.url ?? '',
        status: response.status ?? 0,
        mimeType: response.mimeType ?? '',
        resourceType: params.type ?? 'Other',
        headers: flattenUnknownHeaders(response.headers),
      };
      this.#cdpResponses.set(requestId, metadata);
      if (
        this.lessonCollector &&
        metadata.status >= 200 &&
        metadata.status < 300 &&
        (metadata.resourceType === 'Image' ||
          isClassroomReportUrl(metadata.url))
      ) {
        await this.lessonCollector.observeHttp({
          url: metadata.url,
          statusCode: metadata.status,
          body: '',
          contextId: String(this.contents.id),
          resourceType: metadata.resourceType,
        });
      }
      return;
    }

    if (method === 'Network.loadingFinished') {
      await this.captureResponseBody(requestId, params.encodedDataLength ?? 0);
      this.#cdpRequests.delete(requestId);
      this.#cdpResponses.delete(requestId);
      return;
    }

    if (method === 'Network.webSocketCreated') {
      const url = params.url ?? '';
      this.#webSockets.set(requestId, url);
      if (this.#deepCapture) {
        this.recorder.addWebSocket({
          source: 'browser',
          requestId,
          url,
          direction: 'opened',
          opcode: null,
          payload: null,
          error: null,
        });
      }
      return;
    }

    if (
      method === 'Network.webSocketFrameSent' ||
      method === 'Network.webSocketFrameReceived'
    ) {
      const direction =
        method === 'Network.webSocketFrameSent' ? 'sent' : 'received';
      const payload = params.response?.payloadData ?? null;
      await this.lessonCollector?.observeWebSocket({
        requestId,
        direction,
        payload,
      });
      if (this.#deepCapture) {
        this.recorder.addWebSocket({
          source: 'browser',
          requestId,
          url: this.#webSockets.get(requestId) ?? '',
          direction,
          opcode: params.response?.opcode ?? null,
          payload,
          error: null,
        });
      }
      return;
    }

    if (method === 'Network.webSocketFrameError') {
      this.recorder.addWebSocket({
        source: 'browser',
        requestId,
        url: this.#webSockets.get(requestId) ?? '',
        direction: 'error',
        opcode: null,
        payload: null,
        error: params.errorMessage ?? 'WebSocket frame error',
      });
      return;
    }

    if (method === 'Network.webSocketClosed') {
      await this.lessonCollector?.observeWebSocket({
        requestId,
        direction: 'closed',
        payload: null,
      });
      if (this.#deepCapture) {
        this.recorder.addWebSocket({
          source: 'browser',
          requestId,
          url: this.#webSockets.get(requestId) ?? '',
          direction: 'closed',
          opcode: null,
          payload: null,
          error: null,
        });
      }
      this.#webSockets.delete(requestId);
    }
  }

  private async captureResponseBody(
    requestId: string,
    encodedDataLength: number,
  ): Promise<void> {
    const response = this.#cdpResponses.get(requestId);
    if (!response || !isTextResponse(response, encodedDataLength)) return;
    const neededByLessonCollector =
      this.lessonCollector !== undefined &&
      (isPresentationResponseUrl(response.url) ||
        isClassroomReportUrl(response.url));
    if (!this.#deepCapture && !neededByLessonCollector) return;

    try {
      const result = (await this.contents.debugger.sendCommand(
        'Network.getResponseBody',
        { requestId },
      )) as { body?: string; base64Encoded?: boolean };
      if (!result.body || result.base64Encoded) return;

      const request = this.#cdpRequests.get(requestId);
      await this.lessonCollector?.observeHttp({
        url: response.url,
        statusCode: response.status,
        body: result.body,
        contextId: String(this.contents.id),
        resourceType: response.resourceType,
      });
      if (this.#deepCapture && encodedDataLength <= LAB_BODY_LIMIT) {
        this.recorder.addHttp({
          source: 'browser',
          phase: 'body',
          requestId,
          method: request?.method ?? 'GET',
          url: response.url,
          resourceType: response.resourceType,
          statusCode: response.status,
          durationMs: null,
          requestHeaders: {},
          responseHeaders: response.headers,
          body: result.body,
          error: null,
        });
      }
    } catch {
      // Bodies can disappear from the CDP cache before they are requested.
    }
  }

  private async ensureDebuggerAttached(): Promise<boolean> {
    if (this.contents.isDestroyed()) return false;
    if (this.contents.debugger.isAttached()) return true;
    try {
      this.contents.debugger.attach('1.3');
      await this.contents.debugger.sendCommand('Network.enable', {
        maxTotalBufferSize: 8 * 1024 * 1024,
        maxResourceBufferSize: COLLECTOR_BODY_LIMIT,
        maxPostDataSize: LAB_BODY_LIMIT,
      });
      this.#deepCaptureError = null;
      return true;
    } catch (error: unknown) {
      if (this.contents.debugger.isAttached()) {
        this.#manualDetach = true;
        this.contents.debugger.detach();
      }
      this.#deepCapture = false;
      this.#deepCaptureError =
        error instanceof Error ? error.message : '无法监听浏览器课堂数据';
      return false;
    }
  }
}

function isPresentationResponseUrl(value: string): boolean {
  return value.includes('presentation') && value.includes('fetch');
}

function isClassroomReportUrl(value: string): boolean {
  try {
    return isClassroomReportResponse(new URL(value).pathname);
  } catch {
    return false;
  }
}

function isTextResponse(
  response: CdpResponseMetadata,
  encodedDataLength: number,
): boolean {
  return (
    ['XHR', 'Fetch'].includes(response.resourceType) &&
    encodedDataLength <= COLLECTOR_BODY_LIMIT &&
    /json|text|javascript|xml/i.test(response.mimeType)
  );
}

function flattenHeaders(
  headers: Readonly<Record<string, string[] | string>> | undefined,
): Readonly<Record<string, string>> {
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join('\n') : value,
    ]),
  );
}

function flattenUnknownHeaders(
  headers: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, string>> {
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, String(value)]),
  );
}
