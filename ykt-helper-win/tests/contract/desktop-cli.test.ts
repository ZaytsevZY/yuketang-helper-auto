import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import {
  BrowserEnvironment,
  CliRpcMethod,
  DesktopCliPipePath,
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
  it('uses a platform-appropriate local endpoint', () => {
    if (process.platform === 'win32') {
      expect(DesktopCliPipePath).toBe(
        String.raw`\\.\pipe\yuketang-helper-desktop-v1`,
      );
      return;
    }
    expect(isAbsolute(DesktopCliPipePath)).toBe(true);
    expect(DesktopCliPipePath).toMatch(/\.sock$/);
  });

  it.skipIf(process.platform === 'win32')(
    'recovers a stale Unix socket left by a terminated process',
    async () => {
      const pipePath = testPipePath();
      await leaveStaleSocket(pipePath);
      const server = new DesktopCliServer(
        async () => ({ recovered: true }),
        pipePath,
      );
      try {
        await server.start();
        await expect(
          requestDesktop(CliRpcMethod.Status, undefined, pipePath),
        ).resolves.toEqual({ recovered: true });
      } finally {
        await server.close();
        await rm(pipePath, { force: true });
      }
    },
  );

  it('does not replace an active CLI endpoint', async () => {
    const pipePath = testPipePath();
    const first = new DesktopCliServer(
      async () => ({ owner: 'first' }),
      pipePath,
    );
    const second = new DesktopCliServer(
      async () => ({ owner: 'second' }),
      pipePath,
    );
    servers.push(first);
    await first.start();

    await expect(second.start()).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
    await expect(
      requestDesktop(CliRpcMethod.Status, undefined, pipePath),
    ).resolves.toEqual({ owner: 'first' });
  });

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

  it('opens a lesson in the environment resolved by the connector', async () => {
    const connectLesson = vi.fn(async () => BrowserEnvironment.Pro);
    const openLesson = vi.fn(async () => undefined);
    const handler = createDesktopCliHandler({
      facade: {
        connectLesson,
        listLessons: vi.fn(async () => [
          {
            id: 'ended-lesson',
            title: 'Ended lesson',
            status: 'ended' as const,
          },
        ]),
      } as unknown as YuketangFacade,
      openLesson,
      prepareImage: vi.fn(),
    });

    await expect(
      handler(CliRpcMethod.LessonConnect, {
        environment: BrowserEnvironment.Standard,
        id: 'ended-lesson',
      }),
    ).resolves.toMatchObject({
      id: 'ended-lesson',
      environment: BrowserEnvironment.Pro,
    });
    expect(connectLesson).toHaveBeenCalledWith(
      BrowserEnvironment.Standard,
      'ended-lesson',
    );
    expect(openLesson).toHaveBeenCalledWith(
      BrowserEnvironment.Pro,
      'ended-lesson',
      'ended',
    );
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

async function leaveStaleSocket(pipePath: string): Promise<void> {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "const net=require('node:net');const server=net.createServer();server.listen(process.argv[1],()=>process.stdout.write('ready'));setInterval(()=>{},1000);",
      pipePath,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  await once(child.stdout, 'data');
  child.kill('SIGKILL');
  await once(child, 'exit');
}
