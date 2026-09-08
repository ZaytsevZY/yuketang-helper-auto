import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BrowserEnvironment,
  CliRpcMethod,
  type YuketangFacade,
} from '@ykt/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestDesktop } from '../../apps/cli/src/rpc-client.js';
import { createDesktopCliHandler } from '../../apps/desktop/main/cli-handler.js';
import { DesktopCliServer } from '../../apps/desktop/main/cli-server.js';

const servers: DesktopCliServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('desktop-attached CLI', () => {
  it('exchanges one JSON request over the local pipe', async () => {
    const pipePath = testPipePath();
    const server = new DesktopCliServer(
      async (method) => ({ method, attached: true }),
      pipePath,
    );
    servers.push(server);
    await server.start();

    await expect(
      requestDesktop(CliRpcMethod.Status, undefined, pipePath),
    ).resolves.toEqual({ method: 'status', attached: true });
  });

  it('refreshes every environment and keeps partial results', async () => {
    const refreshLessons = vi.fn(async (environment: BrowserEnvironment) => {
      if (environment === BrowserEnvironment.Changjiang) {
        throw new Error('not logged in');
      }
      return [
        {
          id: `${environment}-lesson`,
          title: environment,
          status: 'active' as const,
        },
      ];
    });
    const handler = createDesktopCliHandler({
      facade: { refreshLessons } as unknown as YuketangFacade,
      openLesson: vi.fn(),
      prepareImage: vi.fn(),
    });

    await expect(
      handler(CliRpcMethod.LessonList, {
        environment: 'all',
        refresh: true,
      }),
    ).resolves.toEqual({
      lessons: [
        {
          id: 'standard-lesson',
          title: 'standard',
          status: 'active',
          environment: 'standard',
        },
        {
          id: 'pro-lesson',
          title: 'pro',
          status: 'active',
          environment: 'pro',
        },
      ],
      errors: [{ environment: 'changjiang', message: 'not logged in' }],
    });
  });

  it('reads a slide through the desktop image pipeline before OCR', async () => {
    const recognizeSlide = vi.fn(
      async ({ imageUrl }: { imageUrl: string }) => ({
        text: imageUrl === 'data:image/png;base64,c2xpZGU=' ? 'slide text' : '',
        profileId: 'profile',
        model: 'vision',
      }),
    );
    const handler = createDesktopCliHandler({
      facade: {
        listPresentations: vi.fn(async () => [
          {
            id: 'presentation-1',
            lessonId: 'lesson-1',
            title: 'Deck',
            width: 1600,
            height: 900,
            slides: [
              {
                id: 'slide-1',
                index: 0,
                title: 'Intro',
                imageUrl: 'https://example.test/slide.png',
                problem: null,
              },
            ],
          },
        ]),
        recognizeSlide,
      } as unknown as YuketangFacade,
      openLesson: vi.fn(),
      prepareImage: vi.fn(async () => 'data:image/png;base64,c2xpZGU='),
    });

    const result = await handler(CliRpcMethod.SlideRead, {
      lessonId: 'lesson-1',
      slideId: 'slide-1',
    });

    expect(result).toMatchObject({
      lessonId: 'lesson-1',
      presentationId: 'presentation-1',
      recognized: { text: 'slide text' },
    });
    expect(recognizeSlide).toHaveBeenCalledWith({
      imageUrl: 'data:image/png;base64,c2xpZGU=',
    });
  });

  it('rejects answer submission without explicit commit confirmation', async () => {
    const submitAnswer = vi.fn();
    const handler = createDesktopCliHandler({
      facade: { submitAnswer } as unknown as YuketangFacade,
      openLesson: vi.fn(),
      prepareImage: vi.fn(),
    });

    await expect(
      handler(CliRpcMethod.AnswerSubmit, {
        problemId: 'problem-1',
        answer: ['A'],
      }),
    ).rejects.toThrow('explicit commit confirmation');
    expect(submitAnswer).not.toHaveBeenCalled();
  });
});

function testPipePath(): string {
  const name = `yuketang-helper-cli-${process.pid}-${Date.now()}-${Math.random()}`;
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\${name}`
    : join(tmpdir(), `${name}.sock`);
}
