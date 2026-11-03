// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import {
  BrowserEnvironment,
  assignmentRetentionCutoff,
  type Assignment,
} from '@ykt/contracts';
import AssignmentsPanel from '../../apps/desktop/renderer/src/components/AssignmentsPanel.vue';
import { assignmentCollection } from '../../apps/desktop/renderer/src/assignment-collection.js';

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  assignmentCollection.state.snapshot = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

it('hides expired cached cards and updates totals when the window advances without collecting again', async () => {
  vi.useFakeTimers();
  const now = Date.parse('2026-10-13T08:00:00Z');
  vi.setSystemTime(now);
  const cutoff = assignmentRetentionCutoff(now);
  const item: Assignment = {
    id: 'boundary',
    classroomId: '1',
    title: '边界考试',
    courseName: 'Course',
    kind: 'exam',
    deadline: cutoff,
    url: '',
    status: 'unanswered',
    graded: null,
    score: null,
    totalScore: null,
    audited: false,
    answeredCount: null,
    totalCount: null,
    questions: [],
    statusMessage: null,
  };
  assignmentCollection.state.snapshot = {
    environment: BrowserEnvironment.Pro,
    fetchedAt: now,
    warnings: [],
    assignments: [
      item,
      {
        ...item,
        id: 'old',
        title: '过期作业',
        kind: 'homework',
        deadline: cutoff - 1,
      },
      {
        ...item,
        id: 'undated',
        title: '无期限作业',
        kind: 'homework',
        deadline: null,
      },
    ],
  };
  const collect = vi.spyOn(assignmentCollection, 'refresh');
  const host = document.createElement('div');
  document.body.append(host);
  app = createApp({
    render: () => h(AssignmentsPanel, { environment: BrowserEnvironment.Pro }),
  });
  app.mount(host);
  expect(host.querySelectorAll('.assignment-card')).toHaveLength(2);
  expect(host.textContent).not.toContain('过期作业');
  expect(host.querySelector('.summary')?.textContent).toContain('2 项');
  await vi.advanceTimersByTimeAsync(30_000);
  await nextTick();
  expect(host.querySelectorAll('.assignment-card')).toHaveLength(1);
  expect(host.textContent).not.toContain('边界考试');
  expect(host.textContent).toContain('无期限作业');
  expect(host.querySelector('.summary')?.textContent).toContain('1 项');
  expect(collect).not.toHaveBeenCalled();
  collect.mockRestore();
});
