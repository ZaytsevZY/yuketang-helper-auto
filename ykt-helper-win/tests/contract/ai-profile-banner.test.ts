// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import type { DesktopApi } from '@ykt/contracts';
import DesktopApp from '../../apps/desktop/renderer/src/App.vue';

const control = vi.hoisted(() => ({ publish: (_available: boolean) => {} }));
vi.mock(
  '../../apps/desktop/renderer/src/components/AssistantPanel.vue',
  () => ({
    default: {
      emits: ['profileAvailability'],
      setup(
        _props: unknown,
        { emit }: { emit: (event: string, value: boolean) => void },
      ) {
        control.publish = (value) => emit('profileAvailability', value);
        return () => null;
      },
    },
  }),
);
vi.mock('../../apps/desktop/renderer/src/components/NetworkLab.vue', () => ({
  default: { render: () => null },
}));
vi.mock('../../apps/desktop/renderer/src/assignment-collection.js', () => ({
  assignmentCollection: { initialize: async () => {} },
}));
vi.mock(
  '../../apps/desktop/renderer/src/course-progress-collection.js',
  () => ({ courseProgressCollection: { initialize: async () => {} } }),
);

let app: App | undefined;
const oldApi = window.yuketang;
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = '';
  window.yuketang = oldApi;
  vi.unstubAllGlobals();
});
it('shows the no-profile status in the logo area and restores the brand after connecting', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  window.yuketang = {
    onBrowserStateChanged: () => () => {},
    getRuntimeStatus: async () => ({ state: 'running' }),
    getBrowserState: async () => ({
      assistantPanelCollapsed: false,
      url: 'https://pro.yuketang.cn/',
      tabs: [],
    }),
    setWebAreaBounds: async () => {},
  } as unknown as DesktopApi;
  const host = document.createElement('div');
  document.body.append(host);
  app = createApp({ render: () => h(DesktopApp) });
  app.mount(host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  control.publish(false);
  await nextTick();
  expect(host.querySelector('.brand [role="status"]')?.textContent).toBe(
    '无可用 Profile',
  );
  expect(host.querySelector('.brand-mark')).toBeNull();
  control.publish(true);
  await nextTick();
  expect(host.querySelector('.profile-unavailable')).toBeNull();
  expect(host.querySelector('.brand')?.textContent).toContain('雨课堂助手');
});
