import { EventEmitter } from 'node:events';

import { BrowserLessonCollector, NetworkRecorder } from '@ykt/routing';
import { describe, expect, it, vi } from 'vitest';

import { ElectronNetworkObserver } from '../../apps/desktop/main/electron-network-observer.js';
import { DevelopmentNetworkRecorder } from '../../apps/desktop/main/development-network-recorder.js';

describe('Electron classroom network observer', () => {
  it('streams actual PPT transfer stages and failures without deep capture', async () => {
    const collector = new BrowserLessonCollector();
    const stages: string[] = [];
    collector.onCollectionStatusChanged((status) => stages.push(status.phase));
    collector.watchLesson('standard', 'lesson-1', 'deck-1', vi.fn());
    const contents = new FakeContents();
    const observer = new ElectronNetworkObserver(
      contents as never,
      new NetworkRecorder(),
      vi.fn(),
      collector,
      false,
    );
    await observer.start();
    const url =
      'https://www.yuketang.cn/api/v3/lesson/presentation/fetch?presentation_id=deck-1';
    const emit = (method: string, params: object = {}) =>
      contents.debugger.emit('message', {}, `Network.${method}`, {
        requestId: 'ppt',
        ...params,
      });
    emit('requestWillBeSent', { request: { method: 'GET', url } });
    expect(collector.getCollectionStatus('lesson-1')?.phase).toBe('requesting');
    emit('responseReceived', {
      type: 'XHR',
      response: { url, status: 200, mimeType: 'application/json' },
    });
    emit('dataReceived', { dataLength: 2048 });
    emit('dataReceived', { dataLength: 1024 });
    expect(collector.getCollectionStatus('lesson-1')).toMatchObject({
      phase: 'receiving',
      receivedBytes: 3072,
    });
    contents.debugger.responseBody = JSON.stringify({
      data: { slides: [{ id: 's1', problem: { id: 'p1', type: 1 } }] },
    });
    emit('loadingFinished', { encodedDataLength: 3072 });
    await vi.waitFor(() =>
      expect(collector.getCollectionStatus('lesson-1')).toMatchObject({
        phase: 'ready',
        slideCount: 1,
        problemCount: 1,
      }),
    );
    expect(stages).toContain('parsing');
    emit('requestWillBeSent', { request: { method: 'GET', url } });
    emit('loadingFailed', { errorText: 'net::ERR_TIMED_OUT' });
    expect(collector.getCollectionStatus('lesson-1')).toMatchObject({
      phase: 'network-error',
      detail: 'net::ERR_TIMED_OUT',
      receivedBytes: 0,
    });
    emit('requestWillBeSent', { request: { method: 'GET', url } });
    emit('responseReceived', {
      type: 'XHR',
      response: { url, status: 503, mimeType: 'text/html' },
    });
    emit('dataReceived', { dataLength: 500 });
    expect(collector.getCollectionStatus('lesson-1')).toMatchObject({
      phase: 'network-error',
      detail: 'HTTP 503',
    });
    emit('requestWillBeSent', { request: { method: 'GET', url } });
    emit('responseReceived', {
      type: 'XHR',
      response: { url, status: 200, mimeType: 'application/json' },
    });
    vi.spyOn(contents.debugger, 'sendCommand').mockRejectedValueOnce(
      new Error('Response body evicted'),
    );
    emit('loadingFinished', { encodedDataLength: 100 });
    await vi.waitFor(() =>
      expect(collector.getCollectionStatus('lesson-1')).toMatchObject({
        phase: 'network-error',
        detail: expect.stringContaining('响应读取失败'),
      }),
    );
  });

  it('collects report names and extensionless slides without deep capture', async () => {
    const collector = new BrowserLessonCollector();
    const received = vi.fn();
    collector.onArchivedPresentation(received);
    const contents = new FakeContents();
    const observer = new ElectronNetworkObserver(
      contents as never,
      new NetworkRecorder(),
      vi.fn(),
      collector,
      false,
    );
    await observer.start();
    const responses = [
      { endpoint: 'lesson-info', data: { lessonName: 'lec3-cnn-v3.6' } },
      {
        endpoint: 'review',
        data: {
          timelineList: [
            {
              id: 'slide-1',
              type: 'slide',
              cover:
                'https://thu-pri-ups.yuketang.cn/common_uploads/test-slide',
            },
          ],
          avatar: {
            cover: 'https://thu-pri-ups.yuketang.cn/common_uploads/avatar',
          },
        },
      },
    ];
    for (const { endpoint, data } of responses) {
      const url = `https://pro.yuketang.cn/api/v3/classroom-report/student/${endpoint}?lesson_id=1785174499833394944`;
      contents.debugger.responseBody = JSON.stringify({ code: 0, data });
      contents.debugger.emit('message', {}, 'Network.requestWillBeSent', {
        requestId: endpoint,
        request: { method: 'GET', url },
      });
      contents.debugger.emit('message', {}, 'Network.responseReceived', {
        requestId: endpoint,
        type: 'XHR',
        response: {
          url,
          status: 200,
          mimeType: 'application/json',
          headers: {},
        },
      });
      contents.debugger.emit('message', {}, 'Network.loadingFinished', {
        requestId: endpoint,
        encodedDataLength: 100,
      });
      await vi.waitFor(() =>
        expect(received).toHaveBeenCalledWith(
          expect.objectContaining({
            lessonTitle: 'lec3-cnn-v3.6',
            presentation: expect.objectContaining({
              slides:
                endpoint === 'review'
                  ? [expect.objectContaining({ id: 'slide-1' })]
                  : [],
            }),
          }),
        ),
      );
    }
  });

  it('forwards successful browser answer responses without deep capture', async () => {
    const collector = new BrowserLessonCollector();
    const observations: unknown[] = [];
    collector.watchLesson('standard', 'lesson-1', 'presentation-1', (value) => {
      observations.push(value);
    });
    await collector.observeHttp({
      url: 'https://www.yuketang.cn/api/v3/lesson/presentation/fetch?presentation_id=presentation-1',
      statusCode: 200,
      body: JSON.stringify({
        data: {
          id: 'presentation-1',
          slides: [
            {
              id: 'slide-1',
              problem: {
                problemId: 'problem-1',
                problemType: 1,
                options: ['One', 'Two'],
              },
            },
          ],
        },
      }),
    });
    observations.length = 0;

    const contents = new FakeContents();
    const observer = new ElectronNetworkObserver(
      contents as never,
      new NetworkRecorder(),
      vi.fn(),
      collector,
      false,
    );
    await observer.start();
    contents.debugger.responseBody = JSON.stringify({ code: 0 });
    contents.debugger.emit('message', {}, 'Network.requestWillBeSent', {
      requestId: 'answer-1',
      request: {
        method: 'POST',
        url: 'https://www.yuketang.cn/api/v3/lesson/problem/answer',
        postData: JSON.stringify({ problemId: 'problem-1', result: ['B'] }),
      },
    });
    contents.debugger.emit('message', {}, 'Network.responseReceived', {
      requestId: 'answer-1',
      type: 'XHR',
      response: {
        url: 'https://www.yuketang.cn/api/v3/lesson/problem/answer',
        status: 200,
        mimeType: 'application/json',
        headers: {},
      },
    });
    contents.debugger.emit('message', {}, 'Network.loadingFinished', {
      requestId: 'answer-1',
      encodedDataLength: 12,
    });

    await vi.waitFor(() => {
      expect(observations).toContainEqual({
        type: 'message',
        message: {
          op: 'problemanswered',
          problemId: 'problem-1',
          answer: ['B'],
        },
      });
    });
  });

  it('records API bodies above the safe preview limit with the development recorder', async () => {
    const contents = new FakeContents();
    const recorder = new DevelopmentNetworkRecorder();
    const observer = new ElectronNetworkObserver(
      contents as never,
      recorder,
      vi.fn(),
      undefined,
      false,
    );
    await observer.start();
    await observer.setDeepCapture(true);

    const body = JSON.stringify({ courses: ['x'.repeat(80 * 1024)] });
    contents.debugger.responseBody = body;
    contents.debugger.emit('message', {}, 'Network.requestWillBeSent', {
      requestId: 'courses-1',
      request: {
        method: 'GET',
        url: 'https://pro.yuketang.cn/v2/api/web/courses/list?identity=2',
      },
    });
    contents.debugger.emit('message', {}, 'Network.responseReceived', {
      requestId: 'courses-1',
      type: 'XHR',
      response: {
        url: 'https://pro.yuketang.cn/v2/api/web/courses/list?identity=2',
        status: 200,
        mimeType: 'application/json',
        headers: {},
      },
    });
    contents.debugger.emit('message', {}, 'Network.loadingFinished', {
      requestId: 'courses-1',
      encodedDataLength: Buffer.byteLength(body),
    });

    await vi.waitFor(() => {
      expect(
        recorder.entries.find(
          (entry) => entry.kind === 'http' && entry.phase === 'body',
        ),
      ).toEqual(expect.objectContaining({ body }));
    });
  });
});

class FakeDebugger extends EventEmitter {
  responseBody = '';
  #attached = false;

  isAttached(): boolean {
    return this.#attached;
  }

  attach(): void {
    this.#attached = true;
  }

  detach(): void {
    this.#attached = false;
  }

  async sendCommand(method: string): Promise<unknown> {
    return method === 'Network.getResponseBody'
      ? { body: this.responseBody, base64Encoded: false }
      : {};
  }
}

class FakeContents {
  readonly id = 1;
  readonly debugger = new FakeDebugger();

  isDestroyed(): boolean {
    return false;
  }
}
