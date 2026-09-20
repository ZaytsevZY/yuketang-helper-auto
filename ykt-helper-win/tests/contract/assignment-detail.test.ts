import { describe, expect, it, vi } from 'vitest';
import {
  BrowserEnvironment,
  canOpenAssignmentAnswer,
  type Assignment,
  type AssignmentDetail,
} from '@ykt/contracts';
import { createBackendRuntime } from '@ykt/backend';
import { YuketangActiveClient } from '@ykt/routing';
import { fetchAssignmentDetail } from '../../packages/routing/src/active/assignment-detail.js';

export const assignment: Assignment = {
  id: 'pro:1:19:2',
  classroomId: '1',
  leafTypeId: '22',
  courseName: '测试课程',
  title: '测试作业',
  kind: 'homework',
  deadline: 2000,
  url: 'https://pro.yuketang.cn/ai-workspace/lms-graph/1/exercise/2?is_chapter=1',
  status: 'unknown',
  graded: null,
  score: null,
  totalScore: null,
  audited: false,
  answeredCount: null,
  totalCount: null,
  questions: [],
  statusMessage: null,
};
const now = () => 1000;
const problem = {
  problem_id: 55,
  index: 2,
  content: {
    ProblemType: 1,
    TypeText: '单选题',
    Body: '<span class="xuetangx-com-encrypted-font">𛈒</span>',
    Options: [{ name: 'A', content: '<b>选项一</b>' }],
    score: 5,
    AllowResults: ['text'],
    max_retry: 1,
  },
  user: {
    status: 4,
    my_score: '0.00',
    count: 3,
    my_count: 1,
    my_answer: { content: '<p>A</p>', attachment: [{ name: '说明.png' }] },
    remark: '评语',
    comment: [{ name: '老师', content: '评语', index: 1 }],
  },
};
function load(data: unknown, item = assignment) {
  return fetchAssignmentDetail(async () => ({ data }), item, '2598', now);
}

describe('assignment detail protocol', () => {
  it('preserves rich fields and URL-bound font without passing credentials or hidden answers', async () => {
    const get = vi.fn(async () => ({
      data: {
        name: '详情名称',
        description: '<b>说明</b>',
        answer_count: 1,
        font: '//fe-static-yuketang.yuketang.cn/exam_font_1.ttf?v=2',
        problems: [problem],
        is_allowed_late_submission: true,
        late_submission: 3000,
        max_retry: 2,
      },
    }));
    const detail = await fetchAssignmentDetail(get, assignment, '1234', now);
    const request = new URL(get.mock.calls[0]![0]!);
    expect(request.pathname).toBe(
      '/mooc-api/v1/lms/exercise/get_exercise_list/22/',
    );
    expect(request.searchParams.get('classroom_id')).toBe('1');
    expect(request.searchParams.get('uv_id')).toBe('1234');
    expect(detail).toMatchObject({
      mode: 'exercise',
      fontUrl: 'https://fe-static-yuketang.yuketang.cn/exam_font_1.ttf?v=2',
      lateDeadline: 3000,
      lateAllowed: true,
      assignment: { title: '详情名称', graded: true, score: 0, totalScore: 5 },
    });
    expect(detail.problems[0]).toMatchObject({
      bodyHtml: problem.content.Body,
      options: [{ label: 'A', html: '<b>选项一</b>' }],
      status: 'graded',
      myScore: 0,
      answerHtml: '<p>A</p>',
      remainingRetries: 2,
      attachments: [{ name: '说明.png', url: null }],
      comments: [{ name: '老师', html: '评语', index: 1 }],
    });
    expect(JSON.stringify(detail)).not.toMatch(
      /cookie|authorization|AllowResults|Answer/,
    );
  });

  it('does not infer per-question submission from aggregate counts or answer text', async () => {
    const detail = await load({
      answer_count: 3,
      problems: [
        { content: {}, user: {} },
        { content: {}, user: { my_answer: { content: '有记录' } } },
        {
          content: {},
          user: { status: 3, my_score: '-1.00', my_answer: { content: '' } },
        },
        null,
      ],
    });
    expect(detail.problems.map((p) => p.status)).toEqual([
      'unknown',
      'answered',
      'submitted',
      'unknown',
    ]);
    expect(detail.problems.every((p) => p.myScore === null)).toBe(true);
    expect(detail.assignment.score).toBeNull();
  });

  it('handles missing fields and never treats a -1 placeholder as submission', async () => {
    expect(await load({})).toMatchObject({
      fontUrl: null,
      problems: [],
      assignment: { status: 'unknown', score: null },
    });
    const detail = await load({ problems: [{ user: { my_score: '-1.00' } }] });
    expect(detail.problems[0]?.status).toBe('unknown');
    expect(detail.problems[0]?.remainingRetries).toBeNull();
  });

  it('keeps scored exams without released viewing permission on the cover', async () => {
    const get = vi.fn(async () => ({
      data: {
        problem_count: 5,
        total_score: 100,
        result: {
          status: 4,
          unfinished_count: 1,
          score: 60,
          score_finish: true,
        },
      },
    }));
    const detail = await fetchAssignmentDetail(
      get,
      { ...assignment, kind: 'exam', skuId: 'sku' },
      '2598',
      now,
    );
    expect(get.mock.calls[0]![0]).toContain(
      '/v/exam/cover?exam_id=22&classroom_id=1&sku_id=sku',
    );
    expect(detail).toMatchObject({
      mode: 'exam-cover',
      problems: [],
      assignment: { examStatus: 'submitted', answeredCount: 4, score: 60 },
    });
    expect(canOpenAssignmentAnswer(detail, 1000)).toBe(false);
  });

  it.each([{ errcode: 401000 }, '<html>login</html>', { code: 1 }, {}])(
    'rejects failed or unauthenticated responses: %j',
    async (body) => {
      await expect(
        fetchAssignmentDetail(async () => body, assignment, '2598', now),
      ).rejects.toThrow();
    },
  );

  it('scores only fully graded and fully scored papers', async () => {
    const detail = await load({
      answer_count: 2,
      problems: [
        problem,
        { ...problem, user: { ...problem.user, status: 3, my_score: '-1.00' } },
      ],
    });
    expect(detail.assignment.graded).toBe(false);
    expect(detail.assignment.score).toBeNull();
    expect(
      (
        await load({
          answer_count: 1,
          problems: [
            { ...problem, user: { ...problem.user, my_score: undefined } },
          ],
        })
      ).assignment.score,
    ).toBeNull();
  });
});

describe('official answer entry eligibility', () => {
  it('allows an available homework and blocks cutoff, exhausted, exam and external-only cases', async () => {
    const detail = await load({ problems: [problem] });
    expect(canOpenAssignmentAnswer(detail, 1000)).toBe(true);
    expect(canOpenAssignmentAnswer(detail, 2000)).toBe(false);
    expect(
      canOpenAssignmentAnswer(
        { ...detail, lateAllowed: true, lateDeadline: 3000 },
        2500,
      ),
    ).toBe(true);
    expect(
      canOpenAssignmentAnswer(
        { ...detail, lateAllowed: true, lateDeadline: 3000 },
        3000,
      ),
    ).toBe(false);
    for (const type of [6, 9])
      expect(
        canOpenAssignmentAnswer(
          { ...detail, problems: [{ ...detail.problems[0]!, type }] },
          1000,
        ),
      ).toBe(false);
    expect(
      canOpenAssignmentAnswer(
        {
          ...detail,
          problems: [{ ...detail.problems[0]!, remainingRetries: 0 }],
        },
        1000,
      ),
    ).toBe(false);
    expect(
      canOpenAssignmentAnswer(
        {
          ...detail,
          assignment: { ...assignment, url: 'https://example.com' },
        },
        1000,
      ),
    ).toBe(false);
  });
});

describe('detail requests and collection lifetime', () => {
  it('coalesces detail reads and updates one entry without another full scan', async () => {
    const client = new YuketangActiveClient({
      credentials: {
        load: async () => ({
          cookieHeader: '',
          bearerToken: null,
          userId: null,
        }),
      },
    });
    const collect = vi.spyOn(client, 'listAssignments').mockResolvedValue({
      environment: BrowserEnvironment.Pro,
      fetchedAt: 100,
      assignments: [assignment],
      warnings: [],
    });
    let finish!: (detail: AssignmentDetail) => void;
    const read = vi.spyOn(client, 'getAssignmentDetail').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const facade = createBackendRuntime({ activeClient: client }).facade;
    await facade.listAssignments(BrowserEnvironment.Pro);
    const a = facade.getAssignmentDetail(BrowserEnvironment.Pro, assignment.id),
      b = facade.getAssignmentDetail(BrowserEnvironment.Pro, assignment.id);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const detail = await load({
      name: '新状态',
      answer_count: 1,
      problems: [problem],
    });
    finish(detail);
    expect(await a).toEqual(await b);
    expect(
      (await facade.listAssignments(BrowserEnvironment.Pro)).assignments[0]
        ?.title,
    ).toBe('新状态');
    expect(collect).toHaveBeenCalledTimes(1);
    await expect(
      facade.getAssignmentDetail(BrowserEnvironment.Pro, 'other'),
    ).rejects.toThrow('不存在');
  });
});

describe('assignment detail cache', () => {
  async function setup() {
    let session = 'first';
    let csrf = 'csrf-a';
    const client = new YuketangActiveClient({
      credentials: {
        load: async () => ({
          cookieHeader: `sessionid=${session}; csrftoken=${csrf}`,
          bearerToken: null,
          userId: session,
        }),
      },
    });
    const collect = vi
      .spyOn(client, 'listAssignments')
      .mockImplementation(async (environment) => ({
        environment,
        fetchedAt: Date.now(),
        assignments: [assignment],
        warnings: [],
      }));
    const detail = await load({ problems: [problem] });
    const read = vi
      .spyOn(client, 'getAssignmentDetail')
      .mockResolvedValue(detail);
    const facade = createBackendRuntime({ activeClient: client }).facade;
    const get = (refresh = false) =>
      facade.getAssignmentDetail(
        BrowserEnvironment.Pro,
        assignment.id,
        refresh,
      );
    return {
      facade,
      get,
      read,
      collect,
      detail,
      login: (value: string) => {
        session = value;
      },
      csrf: () => {
        csrf = 'csrf-b';
      },
    };
  }

  it('reuses a successful detail on re-entry and forces only that detail on refresh', async () => {
    const s = await setup();
    await s.get();
    await s.get();
    s.csrf();
    await s.get();
    expect(s.read).toHaveBeenCalledTimes(1);
    const updated = { ...s.detail, fetchedAt: 2000 };
    s.read.mockResolvedValue(updated);
    expect(await s.get(true)).toEqual(updated);
    expect(await s.get()).toEqual(updated);
    expect(s.read).toHaveBeenCalledTimes(2);
    expect(s.collect).toHaveBeenCalledTimes(1);
  });

  it('expires entries after 30 minutes without extending TTL on cache hits', async () => {
    const s = await setup();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      await s.get();
      clock.mockReturnValue(1000 + 29 * 60_000);
      await s.get();
      expect(s.read).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(1000 + 30 * 60_000);
      await s.get();
      expect(s.read).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('does not cache failures or silently reuse stale detail after a failed explicit refresh', async () => {
    const s = await setup();
    await s.get();
    s.read.mockRejectedValueOnce(new Error('offline'));
    await expect(s.get(true)).rejects.toThrow('offline');
    await s.get();
    expect(s.read).toHaveBeenCalledTimes(3);
  });

  it('invalidates details after a full list refresh and separates environments and accounts', async () => {
    const s = await setup();
    await s.get();
    await s.facade.listAssignments(BrowserEnvironment.Pro, true);
    await s.get();
    expect(s.read).toHaveBeenCalledTimes(2);
    s.login('second');
    await s.get();
    expect(s.read).toHaveBeenCalledTimes(3);
    await s.facade.getAssignmentDetail(
      BrowserEnvironment.Standard,
      assignment.id,
    );
    expect(s.read).toHaveBeenCalledTimes(4);
    await s.get();
    expect(s.read).toHaveBeenCalledTimes(4);
    expect(s.collect).toHaveBeenCalledTimes(4);
  });

  it('shares concurrent refreshes and does not let an old completion populate a newer scan', async () => {
    const s = await setup();
    let finish!: (value: AssignmentDetail) => void;
    s.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = s.get();
    const refresh = s.get(true);
    await vi.waitFor(() => expect(s.read).toHaveBeenCalledTimes(1));
    await s.facade.listAssignments(BrowserEnvironment.Pro, true);
    finish(s.detail);
    await Promise.all([first, refresh]);
    await s.get();
    expect(s.read).toHaveBeenCalledTimes(2);
  });

  it('rejects old-user data if the login changes during a detail request', async () => {
    const s = await setup();
    let finish!: (value: AssignmentDetail) => void;
    s.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = s.get();
    await vi.waitFor(() => expect(s.read).toHaveBeenCalledTimes(1));
    s.login('second');
    finish(s.detail);
    await expect(first).rejects.toThrow('登录状态已变化');
    await s.get();
    await s.get();
    expect(s.read).toHaveBeenCalledTimes(2);
    expect(s.collect).toHaveBeenCalledTimes(2);
  });
});
