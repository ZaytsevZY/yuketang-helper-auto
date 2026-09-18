import { BrowserEnvironment, type ClassroomNotice } from '@ykt/contracts';
import {
  BrowserLessonCollector,
  type SessionCredentialSource,
  YuketangActiveClient,
  type ActiveHttpRequest,
  type ActiveHttpResponse,
  type ActiveHttpTransport,
  type BrowserCredentials,
  type LessonSocket,
} from '@ykt/routing';
import { describe, expect, it, vi } from 'vitest';

import { createBackendRuntime } from './runtime.js';

class DynamicCredentialsSource implements SessionCredentialSource {
  #token: string;
  readonly cookieHeader: string;
  readonly userId: string | null;

  constructor(token: string, cookieHeader: string, userId: string | null) {
    this.#token = token;
    this.cookieHeader = cookieHeader;
    this.userId = userId;
  }

  async load(_environment: BrowserEnvironment): Promise<BrowserCredentials> {
    return {
      cookieHeader: this.cookieHeader,
      bearerToken: this.#token,
      userId: this.userId,
    };
  }

  async saveBearerToken(
    _environment: BrowserEnvironment,
    value: string | null,
  ): Promise<void> {
    if (value) this.#token = value;
  }
}

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

  it('retries submit after re-check-in when the server returns 50004', async () => {
    const credentialsSource = new DynamicCredentialsSource(
      'initial-token',
      'session=abc',
      '42',
    );
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
        { 'Set-Auth': 'set-by-checkin' },
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
          ],
        },
      }),
      response({ code: 50004 }),
      response(
        { data: { lessonToken: 'fresh-token' } },
        { 'Set-Auth': 'refreshed-token' },
      ),
      response({ code: 0 }),
    ]);
    const socket = new FakeSocket();
    const activeClient = new YuketangActiveClient({
      credentials: credentialsSource,
      transport,
      socketFactory: () => socket,
    });
    const runtime = createBackendRuntime({ activeClient });
    await runtime.start();

    await runtime.facade.refreshLessons(BrowserEnvironment.Standard);
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

    const result = await runtime.facade.submitAnswer({
      problemId: '11',
      answer: 'B',
    });
    expect(result).toMatchObject({ problemId: '11', status: 'submitted' });
    expect(transport.requests).toHaveLength(6);
    // First submit attempt (failed with 50004)
    expect(transport.requests[3]).toMatchObject({
      method: 'POST',
      url: 'https://www.yuketang.cn/api/v3/lesson/problem/answer',
    });
    // Re-checkin to refresh lesson token
    expect(transport.requests[4]).toMatchObject({
      method: 'POST',
      url: 'https://www.yuketang.cn/api/v3/lesson/checkin',
    });
    // Retry submit with fresh token — header must carry the new token
    expect(transport.requests[5]).toMatchObject({
      method: 'POST',
      url: 'https://www.yuketang.cn/api/v3/lesson/problem/answer',
      headers: expect.objectContaining({
        'lesson-token': 'fresh-token',
      }),
    });

    await runtime.stop();
  });

  it('recalculates the submission route when retrying after re-checkin', async () => {
    const credentialsSource = new DynamicCredentialsSource(
      'initial-token',
      'session=abc',
      '42',
    );
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
        { 'Set-Auth': 'set-by-checkin' },
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
          ],
        },
      }),
      // First submit fails with 50004 (token expired)
      response({ code: 50004 }),
      // Re-checkin returns fresh token
      response(
        { data: { lessonToken: 'fresh-token' } },
        { 'Set-Auth': 'refreshed-token' },
      ),
      // Retry with forceRetry=true must use /retry
      response({ code: 0, data: { success: ['11'] } }),
    ]);
    const socket = new FakeSocket();
    const activeClient = new YuketangActiveClient({
      credentials: credentialsSource,
      transport,
      socketFactory: () => socket,
    });
    const runtime = createBackendRuntime({ activeClient });
    await runtime.start();

    await runtime.facade.refreshLessons(BrowserEnvironment.Standard);
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

    const result = await runtime.facade.submitAnswer({
      problemId: '11',
      answer: 'B',
      forceRetry: true,
    });
    expect(result).toMatchObject({ problemId: '11', status: 'submitted' });
    // First attempt used /answer (deadline not crossed, but forceRetry only
    // affects the second planSubmission call)
    expect(transport.requests[3]).toMatchObject({
      method: 'POST',
      url: 'https://www.yuketang.cn/api/v3/lesson/problem/answer',
    });
    // After re-checkin, planSubmission is recalculated with forceRetry=true
    // → route switches to /retry
    expect(transport.requests[5]).toMatchObject({
      method: 'POST',
      url: 'https://www.yuketang.cn/api/v3/lesson/problem/retry',
    });

    await runtime.stop();
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

    expect(await runtime.facade.listPresentations('7')).toHaveLength(1);
    expect(await runtime.facade.listProblems('7')).toMatchObject([
      {
        id: '11',
        presentationId: '9',
        slideId: '10',
        status: 'available',
      },
    ]);
    expect(await runtime.facade.listLogs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          scope: 'lesson',
          message: '题目事件等待课件绑定。',
          details: expect.objectContaining({
            lessonId: '7',
            problemId: '11',
            reason: 'problem is not loaded',
          }),
        }),
      ]),
    );

    await collector.observeWebSocket({
      requestId: 'browser-ws-1',
      direction: 'received',
      payload: JSON.stringify({
        eventId: 'unlock-with-stale-references',
        op: 'unlockproblem',
        problem: {
          problemId: 11,
          pres: 999,
          slideId: 999,
          dt: Date.now(),
          limit: 0,
        },
      }),
    });
    expect(await runtime.facade.getProblem('11')).toMatchObject({
      status: 'available',
      deadlineAt: null,
    });
    expect(await runtime.facade.listLogs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warn',
          scope: 'lesson',
          message: '题目事件关联已按题目 ID 修正。',
          details: expect.objectContaining({
            lessonId: '7',
            problemId: '11',
            receivedPresentationId: '999',
            receivedSlideId: '999',
            presentationId: '9',
            slideId: '10',
          }),
        }),
      ]),
    );

    await collector.observeHttp({
      method: 'POST',
      url: 'https://www.yuketang.cn/api/v3/lesson/problem/answer',
      statusCode: 200,
      requestBody: JSON.stringify({ problemId: 11, result: ['B'] }),
      body: JSON.stringify({ code: 0 }),
    });

    expect(await runtime.facade.getProblem('11')).toMatchObject({
      status: 'answered',
      result: ['B'],
    });

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
          BrowserEnvironment.Standard,
          '1767008521140274560',
        ),
      ).resolves.toBe(BrowserEnvironment.Pro);

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

  it('applies problem.published state when receiving a probleminfo publish event', async () => {
    const notices: ClassroomNotice[] = [];
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
                content: 'Test Question',
                options: ['A', 'B', 'C', 'D'],
              },
            },
          ],
        },
      }),
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
    const runtime = createBackendRuntime({
      activeClient,
      onClassroomNotice: (notice) => notices.push(notice),
    });
    await runtime.start();

    await runtime.facade.refreshLessons(BrowserEnvironment.Standard);
    await runtime.facade.connectLesson(BrowserEnvironment.Standard, '7');

    // Before unlock, problem should be in session but status is 'locked'
    const problemsBefore = await runtime.facade.listProblems('7');
    expect(problemsBefore).toHaveLength(1);
    expect(problemsBefore[0]).toMatchObject({
      id: '11',
      status: 'locked',
    });

    // Simulate receiving a probleminfo publish event (with problemid in message)
    socket.message(
      JSON.stringify({
        eventId: 'publish-problem-11',
        op: 'probleminfo',
        problemid: '11',  // This should be found first
        quiz: { id: 'quiz-1', title: '测试题组' },
      }),
    );

    // Verify the publish event was logged with problemId '11' (not 'quiz-1')
    // and that a problem-start notice was emitted (problem was already loaded
    // from the presentation, so it is not deferred).
    const logs = await runtime.facade.listLogs();
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          scope: 'lesson',
          message: '已应用题目发布事件到状态机。',
          details: expect.objectContaining({
            lessonId: '7',
            problemId: '11',
          }),
        }),
      ]),
    );
    expect(notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'problem-start',
          lessonId: '7',
          detail: 'Test Question',
        }),
      ]),
    );

    // Now send unlockproblem event
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
          limit: 60,
        },
      }),
    );

    // After unlock, problem should become 'available'
    const problemsAfter = await runtime.facade.listProblems('7');
    expect(problemsAfter).toHaveLength(1);
    expect(problemsAfter[0]).toMatchObject({
      id: '11',
      presentationId: '9',
      slideId: '10',
      status: 'available',
      unlockedAt,
      deadlineAt: unlockedAt + 60_000,
    });

    await runtime.stop();
  });

  it('defers probleminfo publish until the presentation loads, then replays it', async () => {
    const notices: ClassroomNotice[] = [];
    const collector = new BrowserLessonCollector();
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
    ]);
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
        throw new Error('Deferred publish test must not create a classroom socket.');
      },
    });
    const runtime = createBackendRuntime({
      activeClient,
      onClassroomNotice: (notice) => notices.push(notice),
    });
    await runtime.start();

    await runtime.facade.refreshLessons(BrowserEnvironment.Standard);
    await runtime.facade.connectLesson(BrowserEnvironment.Standard, '7');

    // probleminfo arrives before the presentation/problem data is loaded.
    // The problem is not yet in the session, so the publish is deferred.
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
        eventId: 'publish-early',
        op: 'probleminfo',
        problemid: '11',
        quiz: { id: 'quiz-1', title: '测试题组' },
      }),
    });

    // No problem-start notice yet — problem is not loaded.
    // The assessment-publish notice is emitted immediately by handleMessage.
    expect(notices).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'problem-start' })]),
    );

    // Now the browser loads the presentation with the actual problem data
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
                content: 'Test Question',
                options: ['A', 'B', 'C', 'D'],
              },
            },
          ],
        },
      }),
    });

    // Deferred publish is now replayed — problem-start notice emitted
    expect(notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'problem-start',
          lessonId: '7',
          detail: 'Test Question',
        }),
      ]),
    );

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
