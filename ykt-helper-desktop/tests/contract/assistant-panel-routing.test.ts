// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import {
  BrowserEnvironment,
  DefaultAppSettings,
  type DesktopApi,
  type WorkspacePage,
} from '@ykt/contracts';
import AssistantPanel from '../../apps/desktop/renderer/src/components/AssistantPanel.vue';

vi.mock(
  '../../apps/desktop/renderer/src/components/AssignmentsPanel.vue',
  () => ({
    default: {
      render: () => h('div', { 'data-page': 'assignments' }, '作业内容'),
    },
  }),
);
vi.mock(
  '../../apps/desktop/renderer/src/components/CourseProgressPanel.vue',
  () => ({
    default: { render: () => h('div', { 'data-page': 'courses' }, '课程内容') },
  }),
);
let app: App | undefined;
const originalApi = window.yuketang;
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = '';
  window.yuketang = originalApi;
  vi.unstubAllGlobals();
});
it('renders diagnostics only when selected, never beneath cached assignments or courses', async () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  window.yuketang = {
    onNetworkEntryAdded: () => () => {},
    onClassroomNotice: () => () => {},
    onLessonCollectionStatusChanged: () => () => {},
    getSettings: async () => ({
      ...DefaultAppSettings,
      autoJoinEnabled: false,
    }),
    listAiProfiles: async () => [],
    getUser: async () => null,
    listLessons: async () => [],
    getNetworkSnapshot: async () => ({ entries: [] }),
  } as unknown as DesktopApi;
  const page = ref<WorkspacePage>('assignments');
  const host = document.createElement('div');
  document.body.append(host);
  app = createApp({
    render: () =>
      h(AssistantPanel, {
        page: page.value,
        environment: BrowserEnvironment.Pro,
        collapsed: false,
        automationOwner: false,
        runtime: undefined,
        browserUrl: undefined,
      }),
  });
  app.mount(host);
  await nextTick();
  for (const selected of [
    'assignments',
    'courses',
    'diagnostics',
    'assignments',
  ] as const) {
    page.value = selected;
    await nextTick();
    expect(host.querySelector('.diagnostics-page') !== null).toBe(
      selected === 'diagnostics',
    );
    if (selected !== 'diagnostics')
      expect(host.querySelector(`[data-page="${selected}"]`)).not.toBeNull();
  }
});
