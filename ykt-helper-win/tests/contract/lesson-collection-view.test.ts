// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import {
  BrowserEnvironment,
  DefaultAppSettings,
  type DesktopApi,
  type LessonCollectionStatus,
} from '@ykt/contracts';
import AssistantPanel from '../../apps/desktop/renderer/src/components/AssistantPanel.vue';

let app: App | undefined;
const oldApi = window.yuketang;
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = '';
  window.yuketang = oldApi;
});

it('shows collection progress instead of asking a connected user to reconnect', async () => {
  const page = ref('problems');
  let listener!: (status: LessonCollectionStatus) => void;
  let status: LessonCollectionStatus | null = null;
  const progress = (
    phase: LessonCollectionStatus['phase'],
    extra: Partial<LessonCollectionStatus> = {},
  ) => ({
    lessonId: 'lesson-1',
    environment: BrowserEnvironment.Pro,
    phase,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    receivedBytes: 0,
    slideCount: 0,
    problemCount: 0,
    detail: '',
    ...extra,
  });
  window.yuketang = {
    onNetworkEntryAdded: vi.fn(() => () => {}),
    onClassroomNotice: vi.fn(() => () => {}),
    onLessonCollectionStatusChanged: vi.fn((callback) => {
      listener = callback;
      return () => {};
    }),
    getLessonCollectionStatus: vi.fn(async () => status),
    getSettings: vi.fn(async () => ({
      ...DefaultAppSettings,
      autoJoinEnabled: false,
    })),
    listAiProfiles: vi.fn(async () => []),
    getUser: vi.fn(async () => null),
    listLessons: vi.fn(async () => [
      { id: 'lesson-1', title: 'Test', status: 'active' },
    ]),
    getNetworkSnapshot: vi.fn(async () => ({ entries: [] })),
    listProblems: vi.fn(async () => []),
    listPresentations: vi.fn(async () => []),
    connectLesson: vi.fn(async () => {
      status = progress('waiting');
      listener(status);
    }),
  } as unknown as DesktopApi;
  const host = document.createElement('div');
  document.body.append(host);
  app = createApp({
    render: () =>
      h(AssistantPanel, {
        page: page.value as 'classroom',
        environment: BrowserEnvironment.Pro,
        collapsed: false,
        runtime: undefined,
        browserUrl: undefined,
      }),
  });
  app.mount(host);
  await vi.waitFor(() =>
    expect(host.textContent).toContain('先在“课堂”页连接课堂'),
  );
  page.value = 'classroom';
  await nextTick();
  await vi.waitFor(() => expect(host.textContent).toContain('连接所选课堂'));
  const connect = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('连接所选课堂'),
  )!;
  await vi.waitFor(() => expect(connect.disabled).toBe(false));
  connect.click();
  await vi.waitFor(() => expect(host.textContent).toContain('已打开官方课堂'));
  page.value = 'problems';
  await nextTick();
  expect(host.textContent).not.toContain('先在“课堂”页连接课堂');
  expect(host.textContent).toContain('等待 PPT');
  listener(progress('receiving', { receivedBytes: 4096 }));
  await nextTick();
  expect(host.textContent).toContain('正在接收 PPT');
  expect(host.textContent).toContain('4.0 KB');
  listener(progress('network-error', { detail: 'net::ERR_TIMED_OUT' }));
  await nextTick();
  expect(host.textContent).toContain('网络或响应读取异常');
  expect(host.textContent).toContain('net::ERR_TIMED_OUT');
  listener(
    progress('format-error', { detail: '课件响应缺少 slides / pages 列表' }),
  );
  await nextTick();
  expect(host.textContent).toContain('课件格式异常');
  listener(progress('ready', { slideCount: 12, problemCount: 0 }));
  await nextTick();
  expect(host.textContent).toContain('12 页课件 · 0 道题目');
  expect(host.textContent).not.toContain('先在“课堂”页连接课堂');
  listener(
    progress('network-error', { lessonId: 'other', detail: 'wrong lesson' }),
  );
  await nextTick();
  expect(host.textContent).not.toContain('wrong lesson');
});
