import { BrowserEnvironment, type ClassroomNotice } from '@ykt/contracts';
import {
  BrowserLessonCollector,
  YuketangActiveClient,
  type ActiveHttpRequest,
  type ActiveHttpResponse,
  type ActiveHttpTransport,
  type LessonSocket,
} from '@ykt/routing';
import { describe, expect, it, vi } from 'vitest';

import { createBackendRuntime } from './runtime.js';

describe('M4 backend active client', () => {
  it('lists, connects, loads a problem and submits through mocked transports', async () => {
    const transport = new QueueTransport([
      response({
        data: {
          onLessonClassrooms: [
            {
              lessonId: 7,
              classroomId: 8,
              presentationId: 9,
              title: 'Active lesson',
              status: 1,
            },
          ],
        },
      }),
      response(
        { data: { lessonToken: 'lesson-token' } },
        { 'Set-Auth': 'new' },
      ),
      response({
        data: {
          id: 9,
          title: 'Presentation',
          slides: [
            {
              id: 10,
              problem: {
                problemId: 11,
                problemType: 1,
                content: 'Question',
                options: ['One', 'Two'],
              },
            },
            {
              id: 12,
              problem: {
                problemId: 13,
                problemType: 1,
                content: 'Expired question',
                options: ['One', 'Two'],
              },
            },
          ],
        },
      }),
      response({ code: 0 }),
      response({ code: 0, data: { success: ['13'] } }),
    ]);
    const socket = new FakeSocket();
    const activeClient = new YuketangActiveClient({
      credentials: {
        load: async () => ({
          cookieHeader: 'session=abc',
          bearerToken: 'old',
          userId: '42',
        }),
      },
      transport,
      socketFactory: () => socket,
    });
    const runtime = createBackendRuntime({ activeClient });
    await runtime.start();

    expect((await runtime.facade.getStatus()).capabilities).toContain(
      'active-client',
    );

    expect(
      await runtime.facade.refreshLessons(BrowserEnvironment.Standard),
    ).toEqual([{ id: '7', title: 'Active lesson', status: 'active' }]);
    await runtime.facade.connectLesson(BrowserEnvironment.Standard, '7');
    const unlockedAt = Date.now();
    socket.message(
      JSON.stringify({
        eventId: 'unlock-11',
        op: 'unlockproblem',
        problem: {
          problemId: 11,
          pres: 9,
          slideId: 10,
          dt: unlockedAt,
          limit: 0,
        },
      }),
    );
    socket.message(
      JSON.stringify({
        eventId: 'unlock-13',
        op: 'unlockproblem',
        problem: {
          problemId: 13,
          pres: 9,
          slideId: 12,
          dt: unlockedAt - 120_000,
          limit: 1,
        },
      }),
    );

    expect((await runtime.facade.listProblems('7'))[0]).toMatchObject({
      id: '11',
      presentationId: '9',
      slideId: '10',
      status: 'available',
      deadlineAt: null,
    });
    expect(transport.requests[2]?.headers.authorization).toBe('Bearer new');
    expect(
      await runtime.facade.submitAnswer({ problemId: '11', answer: 'B' }),
    ).toMatchObject({ problemId: '11', status: 'submitted' });
    expect(transport.requests[3]).toMatchObject({
      method: 'POST',
      url: 'https://www.yuketang.cn/api/v3/lesson/problem/answer',
    });
    expect(
      await runtime.facade.submitAnswer({
        problemId: '13',
        answer: 'A',
        forceRetry: true,
      }),
    ).toMatchObject({ problemId: '13', status: 'submitted' });
    expect(transport.requests[4]).toMatchObject({
      method: 'POST',
      url: 'https://www.yuketang.cn/api/v3/lesson/problem/retry',
    });
    expect(await runtime.facade.getProblem('11')).toMatchObject({
      status: 'answered',
      result: ['B'],
    });

    await runtime.stop();
    expect(socket.closed).toBe(true);
  });

  it('collects the official lesson page without issuing a check-in request', async () => {
    const transport = new QueueTransport([
      response({
        data: {
          onLessonClassrooms: [
            {
              lessonId: 7,
              presentationId: 9,
              title: 'Browser lesson',
              status: 1,
            },
          ],
        },
      }),
    ]);
    const collector = new BrowserLessonCollector();
    const activeClient = new YuketangActiveClient({
      credentials: {
        load: async () => ({
          cookieHeader: 'session=abc',
          bearerToken: null,
          userId: '42',
        }),
      },
      transport,
      browserCollector: collector,
      socketFactory: () => {
        throw new Error('The assistant must not create a classroom socket.');
      },
    });
    const runtime = createBackendRuntime({ activeClient });
    await runtime.start();

    await runtime.facade.refreshLessons(BrowserEnvironment.Standard);
    await runtime.facade.connectLesson(BrowserEnvironment.Standard, '7');
    expect(transport.requests).toHaveLength(1);

    await collector.observeHttp({
      url: 'https://www.yuketang.cn/api/v3/lesson/presentation/fetch?presentation_id=9',
      statusCode: 200,
      body: JSON.stringify({
        data: {
          id: 9,
          title: 'Presentation',
          slides: [
            {
              id: 10,
              problem: {
                problemId: 11,
                problemType: 1,
                content: 'Question',
                options: ['One', 'Two'],
              },
            },
          ],
        },
      }),
    });
    await collector.observeWebSocket({
      requestId: 'browser-ws-1',
      direction: 'sent',
      payload: JSON.stringify({
        op: 'hello',
        lessonid: 7,
        auth: 'browser-owned-token',
      }),
    });
    await collector.observeWebSocket({
      requestId: 'browser-ws-1',
      direction: 'received',
      payload: JSON.stringify({
        eventId: 'timeline-1',
        op: 'fetchtimeline',
        timeline: [
          {
            type: 'problem',
            prob: 11,
            pres: 9,
            sid: 10,
            dt: Date.now(),
            limit: 60,
          },
        ],
      }),
    });

    expect(await runtime.facade.listPresentations('7')).toHaveLength(1);
    expect(await runtime.facade.listProblems('7')).toMatchObject([
      {
        id: '11',
        presentationId: '9',
        slideId: '10',
        status: 'available',
      },
    ]);

    await runtime.stop();
  });

  it('collects slides from an ended classroom report without live ids', async () => {
    vi.useFakeTimers();
    try {
      const collector = new BrowserLessonCollector();
      const activeClient = new YuketangActiveClient({
        credentials: {
          load: async () => ({
            cookieHeader: 'session=abc',
            bearerToken: null,
            userId: '42',
          }),
        },
        transport: new QueueTransport([
          response({
            data: {
              onLessonClassrooms: [
                {
                  lessonId: 7,
                  title: 'Active lesson',
                  status: 1,
                },
              ],
            },
          }),
        ]),
        browserCollector: collector,
        socketFactory: () => {
          throw new Error(
            'An ended lesson must not create a classroom socket.',
          );
        },
      });
      const runtime = createBackendRuntime({ activeClient });
      await runtime.start();
      const contextId = 'ended-lesson-tab';
      const reportUrl =
        'https://pro.yuketang.cn/api/v3/classroom-report/student/detail?lesson_id=1767008521140274560';

      await collector.observeHttp({
        url: reportUrl,
        statusCode: 200,
        body: JSON.stringify({ data: { lesson_name: 'Ended lesson' } }),
        contextId,
        resourceType: 'XHR',
      });
      for (const imageUrl of [
        'https://thu-private-qn.yuketang.cn/slide/7272190/cover-1.jpg?token=first',
        'https://thu-private-qn.yuketang.cn/slide/7272190/cover-2.jpg?token=second',
      ]) {
        await collector.observeHttp({
          url: imageUrl,
          statusCode: 200,
          body: '',
          contextId,
          resourceType: 'Image',
        });
      }
      await vi.advanceTimersByTimeAsync(200);

      expect(await runtime.facade.listLessons()).toContainEqual({
        id: '1767008521140274560',
        title: 'Ended lesson',
        status: 'ended',
      });
      const refreshed = await runtime.facade.refreshLessons(
        BrowserEnvironment.Pro,
      );
      expect(refreshed).toContainEqual({
        id: '7',
        title: 'Active lesson',
        status: 'active',
      });
      expect(refreshed).toContainEqual({
        id: '1767008521140274560',
        title: 'Ended lesson',
        status: 'ended',
      });
      const presentations = await runtime.facade.listPresentations(
        '1767008521140274560',
      );
      expect(presentations).toMatchObject([
        {
          id: 'report-1767008521140274560',
          slides: [{ index: 0 }, { index: 1 }],
        },
      ]);
      await expect(
        runtime.facade.connectLesson(
          BrowserEnvironment.Pro,
          '1767008521140274560',
        ),
      ).resolves.toBeUndefined();

      await runtime.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs the independent classroom simulator through the real event normalizer', async () => {
    const notices: ClassroomNotice[] = [];
    const activeClient = new YuketangActiveClient({
      credentials: {
        load: async () => ({
          cookieHeader: '',
          bearerToken: null,
          userId: null,
        }),
      },
      transport: new QueueTransport([]),
      socketFactory: () => new FakeSocket(),
    });
    const runtime = createBackendRuntime({
      activeClient,
      onClassroomNotice: (notice) => notices.push(notice),
    });
    await runtime.start();

    const reset = await runtime.facade.runClassroomSimulation('reset');
    await runtime.facade.runClassroomSimulation('show-slide');
    await runtime.facade.runClassroomSimulation('publish-courseware');
    await runtime.facade.runClassroomSimulation('publish-courseware');
    const published = await runtime.facade.runClassroomSimulation(
      'publish-problem-scalar',
    );
    await runtime.facade.runClassroomSimulation('finish-lesson');

    expect(reset).toMatchObject({ status: 'active', currentSlide: 1 });
    expect(published.publishedProblemIds).toContain(
      'simulation-problem-scalar',
    );
    expect(await runtime.facade.listProblems(reset.lessonId)).toContainEqual(
      expect.objectContaining({
        id: 'simulation-problem-scalar',
        status: 'available',
      }),
    );
    expect(notices.map((notice) => notice.kind)).toEqual([
      'courseware-publish',
      'problem-start',
      'lesson-finished',
    ]);

    await runtime.stop();
  });
});

class QueueTransport implements ActiveHttpTransport {
  readonly requests: ActiveHttpRequest[] = [];

  constructor(private readonly responses: ActiveHttpResponse[]) {}

  async request(request: ActiveHttpRequest): Promise<ActiveHttpResponse> {
    this.requests.push(request);
    const next = this.responses.shift();
    if (!next) throw new Error('No mock response configured.');
    return next;
  }
}

class FakeSocket implements LessonSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  send(_data: string): void {}

  close(): void {
    this.closed = true;
  }

  message(data: string): void {
    this.onmessage?.({ data });
  }
}

function response(
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): ActiveHttpResponse {
  return { status: 200, headers, body };
}
