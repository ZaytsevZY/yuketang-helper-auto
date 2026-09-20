// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import {
  BrowserEnvironment,
  type Assignment,
  type AssignmentDetail,
  type DesktopApi,
} from '@ykt/contracts';
import AssignmentDetailView from '../../apps/desktop/renderer/src/components/AssignmentDetail.vue';

let app: App | undefined;
const oldApi = window.yuketang;
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = '';
  window.yuketang = oldApi;
});
const assignment: Assignment = {
  id: 'exam',
  kind: 'exam',
  title: 'Exam',
  courseName: 'Course',
  classroomId: '1',
  url: 'https://pro.yuketang.cn/',
  status: 'answered',
  graded: true,
  score: 90,
  totalScore: 100,
  deadline: null,
  audited: false,
  answeredCount: 10,
  totalCount: 10,
  questions: [],
  statusMessage: null,
};
const detail: AssignmentDetail = {
  assignment,
  fetchedAt: 100,
  mode: 'exam-cover',
  descriptionHtml: '',
  fontUrl: null,
  problems: [],
  maxRetry: 0,
  lateAllowed: false,
  lateDeadline: null,
};
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}
function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  app = createApp({ render: () => h(AssignmentDetailView, { assignment }) });
  app.mount(host);
  return host;
}
it('uses cached reads on entry/remount and forces the explicit refresh without dropping displayed detail on failure', async () => {
  const get = vi.fn(async () => detail);
  window.yuketang = { getAssignmentDetail: get } as unknown as DesktopApi;
  const host = mount();
  await flush();
  expect(get).toHaveBeenLastCalledWith(BrowserEnvironment.Pro, 'exam', false);
  get.mockRejectedValueOnce(new Error('offline'));
  const button = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('刷新详情'),
  )!;
  button.click();
  await flush();
  expect(get).toHaveBeenLastCalledWith(BrowserEnvironment.Pro, 'exam', true);
  expect(host.textContent).toContain('90 / 100');
  expect(host.textContent).toContain('offline');
  app!.unmount();
  mount();
  await flush();
  expect(get).toHaveBeenLastCalledWith(BrowserEnvironment.Pro, 'exam', false);
});
