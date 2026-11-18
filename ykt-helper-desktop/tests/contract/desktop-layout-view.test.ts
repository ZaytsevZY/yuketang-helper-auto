// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import type { BrowserState, DesktopApi, ToolPanelAction } from '@ykt/contracts';
import DesktopApp from '../../apps/desktop/renderer/src/App.vue';

vi.mock(
  '../../apps/desktop/renderer/src/components/AssistantPanel.vue',
  () => ({
    default: {
      props: ['page', 'automationOwner'],
      setup: (props: { page: string; automationOwner: boolean }) => {
        const draft = ref('');
        return () =>
          h(
            'div',
            {
              'data-assistant': props.page,
              'data-owner': String(props.automationOwner),
            },
            [
              h('input', {
                'aria-label': '测试草稿',
                value: draft.value,
                onInput: (event: Event) => {
                  draft.value = (event.target as HTMLInputElement).value;
                },
              }),
            ],
          );
      },
    },
  }),
);
vi.mock('../../apps/desktop/renderer/src/components/NetworkLab.vue', () => ({
  default: { render: () => h('div', { 'data-network': '' }) },
}));
vi.mock('../../apps/desktop/renderer/src/assignment-collection.js', () => ({
  assignmentCollection: { initialize: async () => {} },
}));
vi.mock(
  '../../apps/desktop/renderer/src/course-progress-collection.js',
  () => ({
    courseProgressCollection: { initialize: async () => {} },
  }),
);

let app: App;
let host: HTMLDivElement;
let state: BrowserState;
let publish: (state: BrowserState) => void;
const originalApi = window.yuketang;
const controlPanel = vi.fn(async (action: ToolPanelAction) => {
  const panels = [...(state.panels ?? [])];
  if ('id' in action) {
    let panel = panels.find((panel) => panel.id === action.id);
    if (!panel) {
      panel = {
        id: action.id,
        visible: false,
        focused: false,
        maximized: false,
        error: null,
        bounds: { x: 12, y: 116, width: 560, height: 600 },
      };
      panels.push(panel);
    }
    if (action.action === 'open') panel.visible = true;
    if (action.action === 'close') panel.visible = false;
  } else if (action.action === 'hide-all')
    panels.forEach((panel) => {
      panel.visible = false;
    });
  state = { ...state, panels };
  publish(state);
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  state = {
    assistantPanelCollapsed: true,
    networkLabCollapsed: true,
    url: 'https://www.yuketang.cn/web',
    tabs: [],
    environment: 'standard',
  } as unknown as BrowserState;
  window.yuketang = {
    getRuntimeStatus: async () => ({ state: 'running' }),
    getBrowserState: async () => state,
    onBrowserStateChanged: (listener: typeof publish) => {
      publish = listener;
      return () => {};
    },
    setWebAreaBounds: async () => {},
    controlToolPanel: controlPanel,
  } as unknown as DesktopApi;
});
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = '';
  window.location.hash = '';
  window.yuketang = originalApi;
  vi.unstubAllGlobals();
});
async function mount(route: string) {
  window.location.hash = route;
  host = document.createElement('div');
  document.body.append(host);
  app = createApp(DesktopApp);
  app.mount(host);
  await new Promise((resolve) => setTimeout(resolve, 0));
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === text,
  );
  expect(button, `button ${text}`).toBeTruthy();
  button!.click();
  await nextTick();
}

it('keeps the main shell dedicated to the webpage and opens tools through the controller', async () => {
  await mount('');
  expect(host.querySelector('main.browser-placeholder')).not.toBeNull();
  expect(host.querySelector('[data-assistant]')).toBeNull();
  expect(host.querySelector('[data-network]')).toBeNull();
  await click('工具');
  expect(controlPanel).toHaveBeenCalledWith({ action: 'open', id: 'tools' });
  expect(
    host.querySelector('.tools-trigger')?.getAttribute('aria-expanded'),
  ).toBe('true');
  expect(host.querySelector('main.browser-placeholder')).not.toBeNull();
});

it('opens multiple features from the grid while leaving the launcher available', async () => {
  await mount('#tools');
  const arrange = host.querySelector<HTMLButtonElement>(
    '.floating-titlebar button[aria-label="自动排列"]',
  )!;
  expect(arrange.disabled).toBe(true);
  expect(host.querySelectorAll('.tool-grid button')).toHaveLength(11);
  await click('设置');
  await click('网络');
  expect(controlPanel).toHaveBeenCalledWith({ action: 'open', id: 'settings' });
  expect(controlPanel).toHaveBeenCalledWith({ action: 'open', id: 'network' });
  expect(host.querySelectorAll('.tool-open')).toHaveLength(2);
  expect(host.textContent).not.toMatch(
    /可同时打开|拖动标题栏|个面板已打开|已打开|Esc 收起/,
  );
  expect(
    [...host.querySelectorAll('.tool-open')].map((button) =>
      button.textContent?.trim(),
    ),
  ).toEqual(['设置', '网络']);
  expect(host.querySelector('.tool-launcher')).not.toBeNull();
  expect(arrange.disabled).toBe(false);
  arrange.click();
  expect(controlPanel).toHaveBeenLastCalledWith({ action: 'arrange' });
  host
    .querySelector<HTMLButtonElement>(
      '.floating-titlebar button[aria-label="收起全部"]',
    )!
    .click();
  expect(controlPanel).toHaveBeenLastCalledWith({ action: 'hide-all' });
});

it('keeps a feature draft mounted when its native view is closed and reopened', async () => {
  await mount('#panel=settings');
  await vi.waitFor(() =>
    expect(host.querySelector('[data-assistant="settings"]')).not.toBeNull(),
  );
  const input = host.querySelector('input')!;
  input.value = '尚未保存的设置';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await controlPanel({ action: 'close', id: 'settings' });
  await nextTick();
  await controlPanel({ action: 'open', id: 'settings' });
  await nextTick();
  expect(host.querySelector('input')).toBe(input);
  expect(input.value).toBe('尚未保存的设置');
  expect(host.querySelector('[data-owner]')?.getAttribute('data-owner')).toBe(
    'false',
  );
});

it('closes only the current panel with Escape', async () => {
  await mount('#tools');
  await click('网络');
  host
    .querySelector('.floating-workspace')!
    .dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(controlPanel).toHaveBeenLastCalledWith({
    action: 'close',
    id: 'tools',
  });
  expect(state.panels?.find((panel) => panel.id === 'network')?.visible).toBe(
    true,
  );
});
