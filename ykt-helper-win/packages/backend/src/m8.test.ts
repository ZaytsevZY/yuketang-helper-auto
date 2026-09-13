import { BrowserEnvironment, ProblemType } from '@ykt/contracts';
import { MemoryAppDataStore, type AppDataStore } from '@ykt/storage';
import {
  YuketangActiveClient,
  type ActiveHttpRequest,
  type ActiveHttpResponse,
  type ActiveHttpTransport,
  type LessonSocket,
} from '@ykt/routing';
import { describe, expect, it } from 'vitest';

import type { AiProviderPlugin } from './llm/provider.js';
import { createBackendRuntime } from './runtime.js';
import { InMemoryLessonRepository } from './repositories/lesson-repository.js';

describe('M8 LLM workflow', () => {
  it('uses a provider plugin and records proposal-to-submission differences', async () => {
    const storage = new MemoryAppDataStore();
    const provider = new FixtureProvider();
    const transport = new QueueTransport([
      response({
        data: {
          onLessonClassrooms: [
            {
              lessonId: 7,
              classroomId: 8,
              presentationId: 9,
              title: 'LLM workflow',
              status: 1,
            },
          ],
        },
      }),
      response({ data: { lessonToken: 'lesson-token' } }),
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
      response({ code: 0 }),
    ]);
    const socket = new FakeSocket();
    const activeClient = new YuketangActiveClient({
      credentials: {
        load: async () => ({
          cookieHeader: 'session=fixture',
          bearerToken: 'bearer',
          userId: '42',
        }),
      },
      transport,
      socketFactory: () => socket,
    });
    const runtime = createBackendRuntime({
      activeClient,
      dataStore: storage,
      aiProviders: [provider],
    });
    await runtime.start();
    await runtime.facade.connectAiProfile({
      providerId: provider.id,
      baseUrl: 'https://fixture.example/v1',
      apiKey: 'fixture-key',
    });
    await runtime.facade.refreshLessons(BrowserEnvironment.Standard);
    await runtime.facade.connectLesson(BrowserEnvironment.Standard, '7');
    socket.message(
      JSON.stringify({
        eventId: 'unlock-11',
        op: 'unlockproblem',
        problem: {
          problemId: 11,
          pres: 9,
          slideId: 10,
          dt: Date.now(),
          limit: 60,
        },
      }),
    );

    const proposal = await runtime.facade.generateAnswerProposal({
      problemId: '11',
      customPrompt: '优先考虑第二项',
    });
    await runtime.facade.updateSettings({
      llmAutoGenerate: true,
      llmManagedSubmit: true,
    });
    const result = await runtime.facade.submitAnswer({
      problemId: '11',
      answer: 'A',
      proposalId: proposal.id,
      confirmedBy: 'agent',
    });

    expect(proposal).toMatchObject({
      status: 'ready',
      answer: ['B'],
      confidence: 0.82,
      failureReason: null,
      validationIssues: [],
      profileId: 'fixture',
    });
    expect(result.proposalOutcome).toMatchObject({
      proposalId: proposal.id,
      confirmedBy: 'agent',
      proposedAnswer: ['B'],
      submittedAnswer: ['A'],
      changed: true,
    });
    expect(await proposalDocument(storage, proposal.id)).toMatchObject({
      kind: 'answer-proposal',
    });
    expect(
      await storage.getDocument(`ai:proposal-outcome:${proposal.id}`),
    ).toMatchObject({ kind: 'answer-proposal-outcome' });
    expect(provider.lastPrompt).toContain('用户补充要求：优先考虑第二项');
    expect(await runtime.facade.listLogs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: 'answer',
          message: 'Agent 答案已提交。',
          details: expect.objectContaining({ confirmedBy: 'agent' }),
        }),
      ]),
    );
    await runtime.stop();
  });

  it('keeps manual problem workflows available without an AI profile', async () => {
    const lessons = new InMemoryLessonRepository();
    const session = lessons.upsertLesson({
      id: 'lesson-manual',
      title: 'Manual lesson',
      status: 'active',
    });
    session.upsertPresentation({
      id: 'presentation-manual',
      lessonId: 'lesson-manual',
      title: 'Manual presentation',
      width: null,
      height: null,
      slides: [
        {
          id: 'slide-manual',
          index: 0,
          title: 'Question',
          imageUrl: null,
          problem: {
            id: 'problem-manual',
            lessonId: 'lesson-manual',
            presentationId: 'presentation-manual',
            slideId: 'slide-manual',
            type: ProblemType.SingleChoice,
            prompt: 'Manual question',
            options: ['One', 'Two'],
            blanks: [],
            result: null,
          },
        },
      ],
    });
    session.unlockProblem(
      'problem-manual',
      'presentation-manual',
      'slide-manual',
      Date.now(),
      Date.now() + 60_000,
      Date.now(),
    );
    const storage = new MemoryAppDataStore();
    const runtime = createBackendRuntime({ lessons, dataStore: storage });
    await runtime.start();

    expect(await runtime.facade.listLessons()).toHaveLength(1);
    expect(
      await runtime.facade.validateAnswer({
        problemId: 'problem-manual',
        answer: 'A',
      }),
    ).toMatchObject({ valid: true, normalizedAnswer: ['A'] });
    expect(
      await runtime.facade.generateAnswerProposal({
        problemId: 'problem-manual',
      }),
    ).toMatchObject({
      status: 'failed',
      answer: null,
      failureReason: '请先在“模型”页连接 AI 服务。',
    });
    await runtime.stop();
  });

  it('keeps a structurally valid AI proposal ready while submission is locked', async () => {
    const lessons = new InMemoryLessonRepository();
    const session = lessons.upsertLesson({
      id: 'lesson-locked',
      title: 'Locked lesson',
      status: 'active',
    });
    session.upsertPresentation({
      id: 'presentation-locked',
      lessonId: 'lesson-locked',
      title: 'Locked presentation',
      width: null,
      height: null,
      slides: [
        {
          id: 'slide-locked',
          index: 0,
          title: 'Locked question',
          imageUrl: null,
          problem: {
            id: 'problem-locked',
            lessonId: 'lesson-locked',
            presentationId: 'presentation-locked',
            slideId: 'slide-locked',
            type: ProblemType.SingleChoice,
            prompt: '1 + 1 = ?',
            options: ['3', '2', '4', '22'],
            blanks: [],
            result: null,
          },
        },
      ],
    });
    const storage = new MemoryAppDataStore();
    const provider = new FixtureProvider();
    const runtime = createBackendRuntime({
      lessons,
      dataStore: storage,
      aiProviders: [provider],
    });
    await runtime.start();
    await runtime.facade.connectAiProfile({
      providerId: provider.id,
      baseUrl: 'https://fixture.example/v1',
      apiKey: 'fixture-key',
    });

    expect(
      await runtime.facade.generateAnswerProposal({
        problemId: 'problem-locked',
        imageUrls: ['data:image/png;base64,d2ViLXZpZXc='],
        imageSource: 'browser-page',
      }),
    ).toMatchObject({
      status: 'ready',
      answer: ['B'],
      failureReason: null,
      validationIssues: [],
      contextSources: ['problem:problem-locked', 'browser-page:1'],
    });
    expect(
      await runtime.facade.validateAnswer({
        problemId: 'problem-locked',
        answer: 'B',
      }),
    ).toMatchObject({
      valid: false,
      normalizedAnswer: ['B'],
      issues: ['problem is locked'],
    });

    await runtime.stop();
  });
});

class FixtureProvider implements AiProviderPlugin {
  readonly id = 'fixture';
  lastPrompt = '';

  async discoverModels() {
    return [
      {
        id: 'fixture-model',
        name: 'Fixture Model',
        ownedBy: 'fixture',
        created: null,
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportedParameters: ['temperature'],
        contextWindow: 32_000,
        outputLimit: 2_000,
      },
    ];
  }

  async complete(request: Parameters<AiProviderPlugin['complete']>[0]) {
    this.lastPrompt = JSON.stringify(request.messages);
    return JSON.stringify({
      answer: 'B',
      explanation: '第二项符合题意。',
      confidence: 0.82,
      failureReason: null,
    });
  }
}

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

  send(_data: string): void {}

  close(): void {}

  message(data: string): void {
    this.onmessage?.({ data });
  }
}

function response(body: unknown): ActiveHttpResponse {
  return { status: 200, headers: {}, body };
}

function proposalDocument(storage: AppDataStore, id: string) {
  return storage.getDocument(`ai:proposal:${id}`);
}
