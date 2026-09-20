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
import {
  createDesktopCliHandler,
  type CliDesktopControls,
} from '../../apps/desktop/main/cli-handler.js';
import { DesktopCliServer } from '../../apps/desktop/main/cli-server.js';

const servers: DesktopCliServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('desktop-attached CLI', () => {
  it('reads one assignment detail through the facade with validated parameters', async () => {
    const getAssignmentDetail = vi.fn(async () => ({
      mode: 'exercise',
      problems: [],
    }));
    const handler = createDesktopCliHandler({
      facade: { getAssignmentDetail } as unknown as YuketangFacade,
      openLesson: async () => {},
      prepareImage: async (url) => url,
    });
    expect(
      await handler(CliRpcMethod.AssignmentDetail, { id: 'pro:1:19:2' }),
    ).toMatchObject({ mode: 'exercise' });
    expect(getAssignmentDetail).toHaveBeenCalledWith(
      BrowserEnvironment.Pro,
      'pro:1:19:2',
      false,
    );
    await handler(CliRpcMethod.AssignmentDetail, {
      id: 'pro:1:19:2',
      refresh: true,
    });
    expect(getAssignmentDetail).toHaveBeenLastCalledWith(
      BrowserEnvironment.Pro,
      'pro:1:19:2',
      true,
    );
    await expect(
      handler(CliRpcMethod.AssignmentDetail, { id: 'x', refresh: 'yes' }),
    ).rejects.toThrow();
    await expect(handler(CliRpcMethod.AssignmentDetail, {})).rejects.toThrow();
    await expect(
      handler(CliRpcMethod.AssignmentDetail, {
        id: 'x',
        environment: 'invalid',
      }),
    ).rejects.toThrow();
  });

  it('reads assignments through the shared facade and validates the environment', async () => {
    const listAssignments = vi.fn(async () => ({
      environment: 'pro',
      fetchedAt: 123,
      assignments: [],
      warnings: [],
    }));
    const handler = createDesktopCliHandler({
      facade: { listAssignments } as unknown as YuketangFacade,
      openLesson: async () => {},
      prepareImage: async (url) => url,
    });
    expect(await handler(CliRpcMethod.AssignmentList)).toMatchObject({
      environment: 'pro',
      assignments: [],
    });
    expect(listAssignments).toHaveBeenCalledWith(BrowserEnvironment.Pro, false);
    await handler(CliRpcMethod.AssignmentList, { refresh: true });
    expect(listAssignments).toHaveBeenLastCalledWith(
      BrowserEnvironment.Pro,
      true,
    );
    await expect(
      handler(CliRpcMethod.AssignmentList, { refresh: 'yes' }),
    ).rejects.toThrow();
    await expect(
      handler(CliRpcMethod.AssignmentList, {
        environment: 'https://evil.example',
      }),
    ).rejects.toThrow();
    expect(listAssignments).toHaveBeenCalledTimes(2);
  });

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

describe('CLI command parity', () => {
  const presentationDeck = [
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
  ];

  function handlerFor(
    facadeMethods: Record<string, unknown>,
    desktop?: Partial<CliDesktopControls>,
  ) {
    return createDesktopCliHandler({
      facade: facadeMethods as unknown as YuketangFacade,
      openLesson: vi.fn(),
      prepareImage: vi.fn(async (url: string) => `prepared:${url}`),
      ...(desktop ? { desktop: desktop as unknown as CliDesktopControls } : {}),
    });
  }

  async function expectErrorCode(
    promise: Promise<unknown>,
    code: string,
  ): Promise<void> {
    const error = await promise.then(
      () => new Error('should have rejected'),
      (caught: unknown) => caught,
    );
    expect((error as { code?: string }).code).toBe(code);
  }

  it('applies a non-empty settings patch and rejects empty patches', async () => {
    const updateSettings = vi.fn(async (patch: unknown) => patch);
    const handler = handlerFor({ updateSettings });

    await expect(
      handler(CliRpcMethod.SettingsUpdate, { browserEnvironment: 'pro' }),
    ).resolves.toEqual({ browserEnvironment: 'pro' });
    expect(updateSettings).toHaveBeenCalledWith({ browserEnvironment: 'pro' });
    await expectErrorCode(
      handler(CliRpcMethod.SettingsUpdate, {}),
      'INVALID_ARGUMENT',
    );
  });

  it('resets settings', async () => {
    const resetSettings = vi.fn(async () => ({ ok: true }));
    const handler = handlerFor({ resetSettings });

    await expect(handler(CliRpcMethod.SettingsReset)).resolves.toEqual({
      ok: true,
    });
    expect(resetSettings).toHaveBeenCalledOnce();
  });

  it('connects an AI profile and forwards the optional provider id', async () => {
    const connectAiProfile = vi.fn(async (input: unknown) => input);
    const handler = handlerFor({ connectAiProfile });

    await expect(
      handler(CliRpcMethod.AiProfileConnect, {
        baseUrl: 'https://ai.example.test',
        apiKey: 'secret',
        providerId: 'openai-compatible',
      }),
    ).resolves.toEqual({
      baseUrl: 'https://ai.example.test',
      apiKey: 'secret',
      providerId: 'openai-compatible',
    });
    await expectErrorCode(
      handler(CliRpcMethod.AiProfileConnect, { baseUrl: 'https://ai.test' }),
      'INVALID_ARGUMENT',
    );
  });

  it('assigns the full model selection for a profile', async () => {
    const updateAiProfileSelection = vi.fn(async (input: unknown) => input);
    const handler = handlerFor({ updateAiProfileSelection });

    await expect(
      handler(CliRpcMethod.AiProfileUpdateSelection, {
        id: 'profile-1',
        model: 'gpt',
        visionModel: 'gpt-vision',
        ocrModel: 'ocr',
        translationModel: 'translator',
        temperature: null,
      }),
    ).resolves.toMatchObject({ id: 'profile-1', temperature: null });
    await expectErrorCode(
      handler(CliRpcMethod.AiProfileUpdateSelection, {
        id: 'profile-1',
        model: 'gpt',
      }),
      'INVALID_ARGUMENT',
    );
  });

  it.each([
    ['AiProfileRefresh', 'refreshAiProfile'],
    ['AiProfileSelect', 'selectAiProfile'],
    ['AiProfileDelete', 'deleteAiProfile'],
  ] as const)('addresses %s by profile id', async (rpcName, facadeName) => {
    const method = vi.fn(async () => null);
    const handler = handlerFor({ [facadeName]: method });

    await handler(CliRpcMethod[rpcName], { id: 'profile-1' });
    expect(method).toHaveBeenCalledWith('profile-1');
  });

  it('synthesises a CLI context id for free-form AI questions', async () => {
    const generateAnswerProposal = vi.fn(async (input: unknown) => input);
    const handler = handlerFor({ generateAnswerProposal });

    const result = (await handler(CliRpcMethod.AiAsk, {
      prompt: '解释这道题',
    })) as { contextId: string; customPrompt: string };

    expect(result.contextId).toMatch(/^cli:/);
    expect(result.customPrompt).toBe('解释这道题');
  });

  it('prepares explicitly attached images for AI questions', async () => {
    const generateAnswerProposal = vi.fn(async (input: unknown) => input);
    const prepareImage = vi.fn(async (url: string) => `prepared:${url}`);
    const handler = createDesktopCliHandler({
      facade: {
        generateAnswerProposal,
      } as unknown as YuketangFacade,
      openLesson: vi.fn(),
      prepareImage,
    });

    await handler(CliRpcMethod.AiAsk, {
      prompt: '看图',
      images: ['https://a.test/1.png', 'https://b.test/2.png'],
    });

    expect(prepareImage).toHaveBeenCalledTimes(2);
    expect(generateAnswerProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrls: [
          'prepared:https://a.test/1.png',
          'prepared:https://b.test/2.png',
        ],
        imageSource: 'slide',
      }),
    );
  });

  it('captures the browser page for AI questions when requested', async () => {
    const generateAnswerProposal = vi.fn(async (input: unknown) => input);
    const captureCurrentPage = vi.fn(
      async () => 'data:image/png;base64,capture',
    );
    const handler = handlerFor(
      { generateAnswerProposal },
      { captureCurrentPage },
    );

    await handler(CliRpcMethod.AiAsk, {
      prompt: '当前页面是什么',
      captureCurrentPage: true,
    });

    expect(captureCurrentPage).toHaveBeenCalledOnce();
    expect(generateAnswerProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrls: ['data:image/png;base64,capture'],
        imageSource: 'browser-page',
      }),
    );
  });

  it('cannot capture the page without desktop capabilities', async () => {
    const handler = handlerFor({});
    await expectErrorCode(
      handler(CliRpcMethod.AiAsk, { prompt: 'x', captureCurrentPage: true }),
      'NOT_IMPLEMENTED',
    );
  });

  it('translates text through the selected profile', async () => {
    const translateText = vi.fn(async (input: unknown) => input);
    const handler = handlerFor({ translateText });

    await expect(
      handler(CliRpcMethod.AiTranslate, {
        text: '你好',
        targetLanguage: 'English',
      }),
    ).resolves.toEqual({ text: '你好', targetLanguage: 'English' });
  });

  it('rejects unknown classroom simulation actions', async () => {
    const runClassroomSimulation = vi.fn();
    const handler = handlerFor({ runClassroomSimulation });

    await expectErrorCode(
      handler(CliRpcMethod.DebugSimulate, { action: 'rewind' }),
      'INVALID_ARGUMENT',
    );
    await handler(CliRpcMethod.DebugSimulate, { action: 'reset' });
    expect(runClassroomSimulation).toHaveBeenCalledWith('reset');
  });

  it.each([
    ['BrowserState'],
    ['BrowserBack'],
    ['BrowserHome'],
    ['LayoutSetPanels', { assistantCollapsed: true }],
    ['NetworkSnapshot'],
    ['NetworkSetPaused', { paused: true }],
    ['NetworkClear'],
  ] as const)(
    'gates %s behind the running desktop app',
    async (rpcName, params) => {
      const handler = handlerFor({});
      await expectErrorCode(
        handler(CliRpcMethod[rpcName], params),
        'NOT_IMPLEMENTED',
      );
    },
  );

  it('drives browser navigation and tabs through desktop controls', async () => {
    const navigateBrowser = vi.fn(async () => undefined);
    const browserBack = vi.fn();
    const activateBrowserTab = vi.fn();
    const state = { activeTabId: 'tab-1', tabs: [] };
    const getBrowserState = vi.fn(async () => state);
    const handler = handlerFor(
      {},
      { navigateBrowser, browserBack, activateBrowserTab, getBrowserState },
    );

    await handler(CliRpcMethod.BrowserNavigate, {
      url: 'https://yuketang.cn/web',
    });
    await handler(CliRpcMethod.BrowserBack);
    await handler(CliRpcMethod.BrowserActivateTab, { id: 'tab-2' });

    expect(navigateBrowser).toHaveBeenCalledWith('https://yuketang.cn/web');
    expect(browserBack).toHaveBeenCalledOnce();
    expect(activateBrowserTab).toHaveBeenCalledWith('tab-2');
    await expect(handler(CliRpcMethod.BrowserState)).resolves.toBe(state);
  });

  it('sets panel layout and returns the refreshed browser state', async () => {
    const setPanels = vi.fn();
    const state = { activeTabId: 'tab-1', tabs: [] };
    const getBrowserState = vi.fn(async () => state);
    const handler = handlerFor({}, { setPanels, getBrowserState });

    await expect(
      handler(CliRpcMethod.LayoutSetPanels, {
        assistantCollapsed: true,
        networkLabCollapsed: false,
      }),
    ).resolves.toBe(state);
    expect(setPanels).toHaveBeenCalledWith({
      assistantCollapsed: true,
      networkLabCollapsed: false,
    });
    await expectErrorCode(
      handler(CliRpcMethod.LayoutSetPanels, {}),
      'INVALID_ARGUMENT',
    );
  });

  it('drives network lab controls with boolean validation', async () => {
    const setNetworkPaused = vi.fn();
    const setDeepCapture = vi.fn(async () => undefined);
    const clearNetworkEntries = vi.fn();
    const exportNetworkFixture = vi.fn(async (filePath: string) => ({
      filePath,
    }));
    const handler = handlerFor(
      {},
      {
        setNetworkPaused,
        setDeepCapture,
        clearNetworkEntries,
        exportNetworkFixture,
      },
    );

    await handler(CliRpcMethod.NetworkSetPaused, { paused: true });
    await handler(CliRpcMethod.NetworkSetDeepCapture, { enabled: true });
    await handler(CliRpcMethod.NetworkClear, undefined);
    await expect(
      handler(CliRpcMethod.NetworkExport, {
        filePath: 'C:/tmp/fixture.json',
      }),
    ).resolves.toEqual({ filePath: 'C:/tmp/fixture.json' });

    expect(setNetworkPaused).toHaveBeenCalledWith(true);
    expect(setDeepCapture).toHaveBeenCalledWith(true);
    expect(clearNetworkEntries).toHaveBeenCalledOnce();
    await expectErrorCode(
      handler(CliRpcMethod.NetworkSetPaused, { paused: 'yes' }),
      'INVALID_ARGUMENT',
    );
  });

  it('exports a presentation PDF only after verifying the lesson', async () => {
    const exportPresentationPdfToFile = vi.fn(async (input: unknown) => ({
      filePath: (input as { filePath: string }).filePath,
    }));
    const handler = handlerFor(
      { listPresentations: vi.fn(async () => presentationDeck) },
      { exportPresentationPdfToFile },
    );

    await expect(
      handler(CliRpcMethod.PresentationExport, {
        lessonId: 'lesson-1',
        presentationId: 'presentation-1',
        filePath: 'C:/tmp/deck.pdf',
      }),
    ).resolves.toEqual({ filePath: 'C:/tmp/deck.pdf' });
    expect(exportPresentationPdfToFile).toHaveBeenCalledWith({
      lessonId: 'lesson-1',
      presentationId: 'presentation-1',
      filePath: 'C:/tmp/deck.pdf',
    });

    await expectErrorCode(
      handler(CliRpcMethod.PresentationExport, {
        lessonId: 'lesson-1',
        presentationId: 'presentation-other',
        filePath: 'C:/tmp/deck.pdf',
      }),
      'NOT_FOUND',
    );
  });

  it('downloads a slide image through desktop controls', async () => {
    const downloadSlideToFile = vi.fn(async (input: unknown) => ({
      filePath: (input as { filePath: string }).filePath,
    }));
    const handler = handlerFor(
      { listPresentations: vi.fn(async () => presentationDeck) },
      { downloadSlideToFile },
    );

    await handler(CliRpcMethod.SlideDownload, {
      lessonId: 'lesson-1',
      slideId: 'slide-1',
      filePath: 'C:/tmp/slide.png',
    });

    expect(downloadSlideToFile).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: 'https://example.test/slide.png',
        filePath: 'C:/tmp/slide.png',
      }),
    );
  });

  it('reads the classroom simulation state from the facade', async () => {
    const getClassroomSimulation = vi.fn(async () => ({ phase: 'idle' }));
    const handler = handlerFor({ getClassroomSimulation });

    await expect(handler(CliRpcMethod.DebugGetSimulation)).resolves.toEqual({
      phase: 'idle',
    });
    expect(getClassroomSimulation).toHaveBeenCalledOnce();
  });

  it('opens a source module through desktop controls only', async () => {
    const openSourceModule = vi.fn(async () => undefined);
    const withDesktop = handlerFor({}, { openSourceModule });
    await withDesktop(CliRpcMethod.SourceOpenModule, { id: 'backend' });
    expect(openSourceModule).toHaveBeenCalledWith('backend');

    const handler = handlerFor({});
    await expectErrorCode(
      handler(CliRpcMethod.SourceOpenModule, { id: 'backend' }),
      'NOT_IMPLEMENTED',
    );
    await expectErrorCode(
      handler(CliRpcMethod.SourceOpenModule, {}),
      'INVALID_ARGUMENT',
    );
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
