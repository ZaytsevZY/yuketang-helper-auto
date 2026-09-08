import { ProblemType, type AiProfileConfig } from '@ykt/contracts';
import { MemoryAppDataStore, MemorySecretStore } from '@ykt/storage';
import { describe, expect, it, vi } from 'vitest';

import { BackendRuntime } from './runtime.js';
import { InMemoryLessonRepository } from './repositories/lesson-repository.js';

describe('M6 facade support', () => {
  it('lists connected presentation data for the desktop courseware page', async () => {
    const lessons = new InMemoryLessonRepository();
    const session = lessons.upsertLesson({
      id: 'lesson-1',
      title: '测试课堂',
      status: 'active',
    });
    session.upsertPresentation({
      id: 'presentation-1',
      lessonId: 'lesson-1',
      title: '测试课件',
      width: 1280,
      height: 720,
      slides: [
        {
          id: 'slide-1',
          index: 0,
          title: '第一页',
          imageUrl: 'https://www.yuketang.cn/slide/1.png',
          problem: null,
        },
      ],
    });
    const runtime = new BackendRuntime({ lessons });

    await runtime.start();
    const presentations = await runtime.facade.listPresentations('lesson-1');

    expect(presentations).toHaveLength(1);
    expect(presentations[0]?.slides[0]?.imageUrl).toContain('yuketang.cn');
    await runtime.stop();
  });

  it('records settings operations for the diagnostics page', async () => {
    const runtime = new BackendRuntime();
    await runtime.start();

    await runtime.facade.updateSettings({ notifyProblems: false });
    const logs = await runtime.facade.listLogs();

    expect(logs.some((entry) => entry.scope === 'settings')).toBe(true);
    await runtime.stop();
  });

  it('does not seed the obsolete hard-coded Kimi profile', async () => {
    const runtime = new BackendRuntime();
    await runtime.start();

    const settings = await runtime.facade.getSettings();
    const profiles = await runtime.facade.listAiProfiles();

    expect(settings.activeAiProfileId).toBe('');
    expect(profiles).toEqual([]);
    await runtime.stop();
  });

  it('removes the obsolete Kimi profile from existing settings', async () => {
    const dataStore = new MemoryAppDataStore();
    const secretStore = new MemorySecretStore();
    await dataStore.updateSettings({
      activeAiProfileId: 'default',
      aiProfiles: [
        {
          id: 'default',
          name: 'Kimi',
          baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
          model: 'moonshot-v1-8k',
          visionModel: 'moonshot-v1-8k-vision-preview',
        } as unknown as AiProfileConfig,
      ],
    });
    await secretStore.set('ai-profile:default:main', 'obsolete-key');
    const runtime = new BackendRuntime({ dataStore, secretStore });
    await runtime.start();

    expect(await runtime.facade.listAiProfiles()).toEqual([]);
    expect((await runtime.facade.getSettings()).activeAiProfileId).toBe('');
    expect(await secretStore.get('ai-profile:default:main')).toBeNull();
    await runtime.stop();
  });

  it('discovers the new Moonshot API through /models and adds it to the profile pool', async () => {
    const secretStore = new MemorySecretStore();
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('https://api.moonshot.cn/v1/models');
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            {
              id: 'kimi-k2.6',
              object: 'model',
              owned_by: 'moonshot',
              input_modalities: ['text', 'image'],
              supported_parameters: ['temperature'],
              context_window: 262_144,
            },
            {
              id: 'kimi-k2.6-preview',
              object: 'model',
              owned_by: 'moonshot',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const runtime = new BackendRuntime({ secretStore, fetcher });
    await runtime.start();

    const profiles = await runtime.facade.connectAiProfile({
      baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
      apiKey: 'moonshot-test-key',
    });
    const settings = await runtime.facade.getSettings();

    expect(profiles).toEqual([
      expect.objectContaining({
        id: 'moonshot',
        name: 'Moonshot',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.6',
        visionModel: 'kimi-k2.6',
        ocrModel: 'kimi-k2.6',
        translationModel: 'kimi-k2.6',
        hasApiKey: true,
        models: [
          expect.objectContaining({ id: 'kimi-k2.6' }),
          expect.objectContaining({ id: 'kimi-k2.6-preview' }),
        ],
      }),
    ]);
    expect(settings.activeAiProfileId).toBe('moonshot');
    expect(await secretStore.get('ai-profile:moonshot:main')).toBe(
      'moonshot-test-key',
    );
    await runtime.stop();
  });

  it('assigns independent LLM, VLM, OCR and Translate models', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/models')
        ? new Response(
            JSON.stringify({
              data: [
                { id: 'text-model', owned_by: 'test' },
                {
                  id: 'vision-model',
                  owned_by: 'test',
                  input_modalities: ['text', 'image'],
                },
                {
                  id: 'ocr-model',
                  owned_by: 'test',
                  input_modalities: ['text', 'image'],
                },
                { id: 'translate-model', owned_by: 'test' },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        : new Response(
            JSON.stringify({ choices: [{ message: { content: '完成' } }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
    );
    const runtime = new BackendRuntime({ fetcher });
    await runtime.start();
    const connected = await runtime.facade.connectAiProfile({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
    });
    const id = connected[0]!.id;

    const profiles = await runtime.facade.updateAiProfileSelection({
      id,
      model: 'text-model',
      visionModel: 'vision-model',
      ocrModel: 'ocr-model',
      translationModel: 'translate-model',
      temperature: 0.4,
    });
    const ocr = await runtime.facade.recognizeSlide({
      imageUrl: 'https://example.com/slide.png',
    });
    const translation = await runtime.facade.translateText({
      text: 'hello',
      targetLanguage: '中文',
    });

    expect(profiles[0]).toEqual(
      expect.objectContaining({
        model: 'text-model',
        visionModel: 'vision-model',
        ocrModel: 'ocr-model',
        translationModel: 'translate-model',
        temperature: 0.4,
      }),
    );
    expect(ocr.model).toBe('ocr-model');
    expect(translation.model).toBe('translate-model');
    expect(
      fetcher.mock.calls
        .slice(1)
        .map((call) => JSON.parse(String(call[1]?.body)).temperature),
    ).toEqual([0.4, 0.4]);
    await runtime.stop();
  });

  it('stores profile credentials outside ordinary settings and generates a proposal', async () => {
    const lessons = new InMemoryLessonRepository();
    const session = lessons.upsertLesson({
      id: 'lesson-ai',
      title: 'AI 测试课堂',
      status: 'active',
    });
    session.upsertPresentation({
      id: 'presentation-ai',
      lessonId: 'lesson-ai',
      title: 'AI 测试课件',
      width: 1280,
      height: 720,
      slides: [
        {
          id: 'slide-ai',
          index: 0,
          title: '题目页',
          imageUrl: null,
          problem: {
            id: 'problem-ai',
            lessonId: 'lesson-ai',
            presentationId: 'presentation-ai',
            slideId: 'slide-ai',
            type: ProblemType.SingleChoice,
            prompt: '测试题目',
            options: ['选项一', '选项二'],
            blanks: [],
            result: null,
          },
        },
      ],
    });
    session.unlockProblem(
      'problem-ai',
      'presentation-ai',
      'slide-ai',
      1000,
      61_000,
      1000,
    );
    const dataStore = new MemoryAppDataStore();
    const secretStore = new MemorySecretStore();
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/models')
        ? new Response(
            JSON.stringify({
              data: [
                {
                  id: 'kimi-k2.6',
                  owned_by: 'moonshot',
                  input_modalities: ['text', 'image'],
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        : new Response(
            JSON.stringify({
              choices: [
                { message: { content: '答案: B\n解释: 基础功能测试' } },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
    );
    const runtime = new BackendRuntime({
      lessons,
      dataStore,
      secretStore,
      fetcher,
    });
    await runtime.start();

    await runtime.facade.connectAiProfile({
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: 'test-secret',
    });
    const proposal = await runtime.facade.generateAnswerProposal({
      problemId: 'problem-ai',
    });
    const exported = await dataStore.exportData();

    expect(proposal.answer).toEqual(['B']);
    expect(proposal.explanation).toBe('基础功能测试');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const requestBody = JSON.parse(
      String(fetcher.mock.calls[1]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(requestBody).toEqual(
      expect.objectContaining({ model: 'kimi-k2.6' }),
    );
    expect(requestBody).not.toHaveProperty('temperature');
    expect(JSON.stringify(exported)).not.toContain('test-secret');
    expect(await secretStore.get('ai-profile:moonshot:main')).toBe(
      'test-secret',
    );
    await runtime.stop();
  });
});
