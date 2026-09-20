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
function mount(onExplain = vi.fn()) {
  const host = document.createElement('div');
  document.body.append(host);
  app = createApp({
    render: () => h(AssignmentDetailView, { assignment, onExplain }),
  });
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

it('offers trial AI extraction only for loaded questions and emits an editable draft', async () => {
  const onExplain = vi.fn();
  const get = vi.fn(async () => detail);
  window.yuketang = { getAssignmentDetail: get } as unknown as DesktopApi;
  let host = mount(onExplain);
  await flush();
  expect(host.textContent).not.toContain('AI解释');
  app!.unmount();
  get.mockResolvedValue({
    ...detail,
    mode: 'exam-review',
    problems: [
      {
        id: '1',
        index: 1,
        type: 1,
        typeText: '单选题',
        score: 10,
        bodyHtml: '<p>测试题干</p>',
        options: [],
        answerHtml: 'A',
        attachments: [],
        status: 'graded',
        myScore: 10,
        remarkHtml: '',
        comments: [],
        externalUrl: null,
        maxRetry: 0,
        remainingRetries: null,
        allowResults: [],
      },
    ],
  });
  const data = await get();
  get.mockResolvedValue({
    ...data,
    problems: [
      ...data.problems,
      {
        ...data.problems[0]!,
        id: '2',
        index: 2,
        bodyHtml: '<p>另一题专属内容</p>',
      },
    ],
  });
  host = mount(onExplain);
  await flush();
  expect(host.querySelector('.actions')?.textContent).not.toContain('AI解释');
  expect(
    [...host.querySelectorAll('button')].filter((b) =>
      b.textContent?.includes('AI解释'),
    ),
  ).toHaveLength(2);
  const button = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('AI解释'),
  )!;
  expect(button).toBeDefined();
  expect(onExplain).not.toHaveBeenCalled();
  button.click();
  expect(onExplain.mock.calls[0]![0].text).not.toContain('另一题专属内容');
  expect(onExplain).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Exam · 第 1 题',
      text: expect.stringContaining('测试题干'),
      hasEncryptedText: false,
    }),
  );
  host
    .querySelector<HTMLButtonElement>('[aria-label="AI解释第 2 题（试用）"]')!
    .click();
  expect(onExplain.mock.calls[1]![0].title).toBe('Exam · 第 2 题');
  expect(onExplain.mock.calls[1]![0].text).toContain('另一题专属内容');
  expect(onExplain.mock.calls[1]![0].text).not.toContain('测试题干');
});
