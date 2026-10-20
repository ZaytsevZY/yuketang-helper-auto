import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import {
  FileSecretStore,
  MemorySecretStore,
  MemoryAppDataStore,
  type SecretCodec,
} from '@ykt/storage';
import { createBackendRuntime, type AiProviderPlugin } from '@ykt/backend';
import { ProblemType } from '@ykt/contracts';

const codec: SecretCodec = {
  encrypt: (value) => Buffer.from([...value].reverse().join('')),
  decrypt: (value) => [...Buffer.from(value).toString()].reverse().join(''),
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

it('does not publish a new profile when saving its API Key fails', async () => {
  const storage = new MemoryAppDataStore();
  const secretStore = new MemorySecretStore();
  vi.spyOn(secretStore, 'set').mockRejectedValueOnce(
    new Error('credential write failed'),
  );
  const runtime = createBackendRuntime({
    dataStore: storage,
    secretStore,
    aiProviders: [
      {
        id: 'fixture',
        discoverModels: async () => [
          {
            id: 'model',
            name: 'Model',
            ownedBy: 'fixture',
            created: null,
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportedParameters: [],
            contextWindow: null,
            outputLimit: null,
          },
        ],
        complete: async () => '',
      },
    ],
  });
  await expect(
    runtime.facade.connectAiProfile({
      providerId: 'fixture',
      baseUrl: 'https://example.test/v1',
      apiKey: 'key',
    }),
  ).rejects.toThrow('credential write failed');
  expect(await storage.getSettings()).toMatchObject({
    aiProfiles: [],
    activeAiProfileId: '',
  });
  expect(await runtime.facade.listAiProfiles()).toEqual([]);
});

it('uses the selected profile key after reconnect, a secret store reopen and parallel browser token updates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ykt-profile-keys-'));
  directories.push(dir);
  const path = join(dir, 'credentials.json');
  const storage = new MemoryAppDataStore();
  const model = {
    id: 'model',
    name: 'Model',
    ownedBy: 'fixture',
    created: null,
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportedParameters: [],
    contextWindow: null,
    outputLimit: null,
  };
  const complete = vi.fn<AiProviderPlugin['complete']>(async () =>
    JSON.stringify({ answer: ['A'], explanation: 'A', confidence: 1 }),
  );
  const provider: AiProviderPlugin = {
    id: 'fixture',
    discoverModels: async () => [model],
    complete,
  };
  let secretStore = new FileSecretStore(path, codec);
  let runtime = createBackendRuntime({
    dataStore: storage,
    secretStore,
    aiProviders: [provider],
  });
  const first = await runtime.facade.connectAiProfile({
    providerId: provider.id,
    baseUrl: 'https://first.example/v1',
    apiKey: 'first-key',
  });
  const firstId = first[0]!.id;
  const second = await runtime.facade.connectAiProfile({
    providerId: provider.id,
    baseUrl: 'https://second.example/v1',
    apiKey: 'second-key',
  });
  const secondId = second.find(
    (item) => item.baseUrl === 'https://second.example/v1',
  )!.id;
  await runtime.facade.selectAiProfile(firstId);
  await secretStore.delete(`ai-profile:${firstId}:main`);
  expect(
    (await runtime.facade.listAiProfiles()).some((p) => p.id === firstId),
  ).toBe(false);
  expect((await storage.getSettings()).aiProfiles.map((p) => p.id)).toEqual([
    secondId,
  ]);
  expect((await storage.getSettings()).activeAiProfileId).toBe(secondId);
  const context = runtime.lessons.upsertLesson({
    id: 'lesson',
    title: 'Test',
    status: 'active',
  });
  const problem = {
    id: 'question',
    lessonId: 'lesson',
    presentationId: 'deck',
    slideId: 'slide',
    type: ProblemType.SingleChoice,
    prompt: 'Test',
    options: ['A', 'B'],
    blanks: [],
    result: null,
  };
  context.upsertProblem(problem);
  const failed = await runtime.facade.generateAnswerProposal({
    problemId: problem.id,
  });
  expect(failed.status).toBe('ready');
  expect(complete.mock.calls[0]![0]).toMatchObject({ apiKey: 'second-key' });
  complete.mockClear();
  const restored = await runtime.facade.connectAiProfile({
    providerId: provider.id,
    baseUrl: 'https://first.example/v1',
    apiKey: 'replacement-key',
  });
  expect(restored).toHaveLength(2);
  expect(restored.find((p) => p.id === firstId)?.hasApiKey).toBe(true);
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      secretStore.set(`yuketang:env-${i}:bearer-token`, `browser-${i}`),
    ),
  );
  secretStore = new FileSecretStore(path, codec);
  runtime = createBackendRuntime({
    dataStore: storage,
    secretStore,
    aiProviders: [provider],
  });
  runtime.lessons
    .upsertLesson({ id: 'lesson', title: 'Test', status: 'active' })
    .upsertProblem(problem);
  expect(
    (await runtime.facade.generateAnswerProposal({ problemId: problem.id }))
      .status,
  ).toBe('ready');
  expect(complete.mock.calls[0]![0]).toMatchObject({
    apiKey: 'replacement-key',
    baseUrl: 'https://first.example/v1',
  });
  await runtime.facade.selectAiProfile(secondId);
  expect(
    (await runtime.facade.generateAnswerProposal({ problemId: problem.id }))
      .status,
  ).toBe('ready');
  expect(complete.mock.calls[1]![0]).toMatchObject({
    apiKey: 'second-key',
    baseUrl: 'https://second.example/v1',
  });
  expect(await readFile(path, 'utf8')).not.toMatch(
    /replacement-key|second-key/,
  );
});

it('removes all keyless profiles from persistent settings and clears the active choice', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ykt-profile-cleanup-'));
  directories.push(dir);
  const secretStore = new FileSecretStore(join(dir, 'credentials.json'), codec);
  const storage = new MemoryAppDataStore();
  const profile = {
    id: 'missing',
    name: 'Missing',
    providerId: 'fixture',
    baseUrl: 'https://example.test/v1',
    model: 'm',
    visionModel: 'm',
    ocrModel: 'm',
    translationModel: 'm',
    temperature: null,
    models: [],
    discoveredAt: new Date().toISOString(),
  };
  await storage.updateSettings({
    aiProfiles: [profile],
    activeAiProfileId: profile.id,
  });
  const runtime = createBackendRuntime({ dataStore: storage, secretStore });
  expect(await runtime.facade.listAiProfiles()).toEqual([]);
  expect(await storage.getSettings()).toMatchObject({
    aiProfiles: [],
    activeAiProfileId: '',
  });
  expect(await runtime.facade.listAiProfiles()).toEqual([]);
});
