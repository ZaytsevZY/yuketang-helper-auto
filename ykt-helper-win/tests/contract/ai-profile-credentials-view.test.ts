// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import {
  BrowserEnvironment,
  DefaultAppSettings,
  type AiProfileView,
  type DesktopApi,
} from '@ykt/contracts';
import AssistantPanel from '../../apps/desktop/renderer/src/components/AssistantPanel.vue';

let app: App | undefined;
const oldApi = window.yuketang;
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = '';
  window.yuketang = oldApi;
});
async function mount(hasApiKey: boolean) {
  const profile: AiProfileView = {
    id: 'deepseek',
    name: 'DeepSeek',
    providerId: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    visionModel: 'deepseek-flash',
    ocrModel: 'deepseek-flash',
    translationModel: 'deepseek-flash',
    temperature: null,
    models: [],
    discoveredAt: '2026-09-22T00:00:00Z',
    hasApiKey,
  };
  window.yuketang = {
    onNetworkEntryAdded: vi.fn(() => () => {}),
    onClassroomNotice: vi.fn(() => () => {}),
    getSettings: vi.fn(async () => ({
      ...DefaultAppSettings,
      aiProfiles: [profile],
      activeAiProfileId: profile.id,
    })),
    listAiProfiles: vi.fn(async () => (hasApiKey ? [profile] : [])),
    getUser: vi.fn(async () => null),
    listLessons: vi.fn(async () => []),
    getNetworkSnapshot: vi.fn(async () => ({ entries: [] })),
  } as unknown as DesktopApi;
  const host = document.createElement('div');
  document.body.append(host);
  app = createApp({
    render: () =>
      h(AssistantPanel, {
        page: 'profiles',
        environment: BrowserEnvironment.Pro,
        runtime: undefined,
        browserUrl: undefined,
        collapsed: false,
      }),
  });
  app.mount(host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
  return host;
}

it('omits profiles removed for missing credentials and reports no available profile', async () => {
  const host = await mount(false);
  expect(host.querySelector('.profile-card')).toBeNull();
  expect(host.textContent).toContain('尚未连接 AI 服务');
  expect(host.textContent).not.toContain('补充 API Key');
});

it('keeps a configured current profile marked ready without showing the missing-key action', async () => {
  const host = await mount(true);
  expect(host.querySelector('.profile-state')?.textContent).toContain(
    '当前 Profile',
  );
  expect(host.querySelector('.profile-state')?.textContent).not.toContain(
    '缺少',
  );
  expect(host.querySelector('[aria-label="补充 DeepSeek API Key"]')).toBeNull();
});
