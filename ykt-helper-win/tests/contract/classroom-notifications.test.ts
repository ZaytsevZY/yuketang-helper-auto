import { effectScope } from 'vue';
import type * as Vue from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserEnvironment,
  DefaultAppSettings,
  type ClassroomNotice,
} from '@ykt/contracts';
import AssistantPanel from '../../apps/desktop/renderer/src/components/AssistantPanel.vue';

vi.mock('vue', async (importOriginal) => ({
  ...(await importOriginal<typeof Vue>()),
  onMounted: vi.fn(),
  onUnmounted: vi.fn(),
  useSSRContext: () => ({ modules: new Set() }),
}));
const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const notice: ClassroomNotice = {
  kind: 'problem-start',
  lessonId: '1805636637836030848',
  dedupeKey: 'problem-start:1805636637836030848:1805636748909589426',
  title: '习题已发布',
  detail: '新题目',
  occurredAt: 1_000_000,
};
function setup(collapsed = false) {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  const api = {
    showNotification: vi.fn(async () => {}),
    reportNoticeDelivery: vi.fn(async () => {}),
  };
  vi.stubGlobal('window', { yuketang: api });
  const emit = vi.fn();
  const scope = effectScope();
  scopes.push(scope);
  const panel = scope.run(() =>
    (AssistantPanel as any).setup(
      {
        page: 'classroom',
        environment: BrowserEnvironment.Pro,
        runtime: undefined,
        browserUrl: undefined,
        collapsed,
      },
      { expose: vi.fn(), emit },
    ),
  );
  panel.applySettings({ ...DefaultAppSettings, notifySound: false });
  return { panel, api, emit };
}

describe('classroom notice delivery', () => {
  it('still sends native and popup notices when the sound API throws', async () => {
    const { panel, api } = setup();
    panel.applySettings({ ...DefaultAppSettings, notifySound: true });
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('Audio unavailable');
        }
      },
    );
    await panel.handleClassroomNotice(notice);
    expect(api.showNotification).toHaveBeenCalledWith(
      notice.title,
      notice.detail,
    );
    expect(panel.noticeToasts.value).toHaveLength(1);
    expect(api.reportNoticeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'sound',
        outcome: 'failed',
        error: 'Audio unavailable',
      }),
    );
  });

  it('shows the popup before native IPC completes and preserves it if native delivery fails', async () => {
    const { panel, api } = setup();
    let reject!: (error: Error) => void;
    api.showNotification.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const pending = panel.handleClassroomNotice(notice);
    expect(panel.noticeToasts.value).toHaveLength(1);
    reject(new Error('Native notification rejected'));
    await pending;
    expect(panel.noticeToasts.value).toHaveLength(1);
  });

  it('reveals a collapsed panel for a popup, but does not redeliver duplicate problem events', async () => {
    const { panel, api, emit } = setup(true);
    await panel.handleClassroomNotice(notice);
    await panel.handleClassroomNotice({
      ...notice,
      occurredAt: notice.occurredAt + 1000,
    });
    expect(emit).toHaveBeenCalledWith('revealNotice');
    expect(panel.noticeToasts.value).toHaveLength(1);
    expect(api.showNotification).toHaveBeenCalledOnce();
  });

  it('does not hold later classroom automation indefinitely when native IPC stalls', async () => {
    const { panel, api } = setup();
    api.showNotification.mockImplementation(() => new Promise(() => {}));
    const pending = panel.handleClassroomNotice(notice);
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
    expect(panel.noticeToasts.value).toHaveLength(1);
    expect(api.reportNoticeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'native',
        outcome: 'failed',
        error: '提醒渠道响应超时',
      }),
    );
  });

  it('honors event and channel switches instead of forcing reminders on', async () => {
    const { panel, api } = setup();
    panel.applySettings({
      ...DefaultAppSettings,
      notifyProblemStarts: false,
      notifySound: false,
    });
    await panel.handleClassroomNotice(notice);
    expect(panel.noticeToasts.value).toHaveLength(0);
    expect(api.showNotification).not.toHaveBeenCalled();
    panel.applySettings({
      ...DefaultAppSettings,
      notifyPopup: false,
      notifySound: false,
    });
    await panel.handleClassroomNotice(notice);
    expect(panel.noticeToasts.value).toHaveLength(0);
    expect(api.showNotification).toHaveBeenCalledOnce();
  });
});
