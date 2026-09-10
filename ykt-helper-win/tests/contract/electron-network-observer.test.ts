import { EventEmitter } from 'node:events';

import { BrowserLessonCollector, NetworkRecorder } from '@ykt/routing';
import { describe, expect, it, vi } from 'vitest';

import { ElectronNetworkObserver } from '../../apps/desktop/main/electron-network-observer.js';

describe('Electron classroom network observer', () => {
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
