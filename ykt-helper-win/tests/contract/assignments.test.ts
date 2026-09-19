import { readFileSync } from 'node:fs';
import { BrowserEnvironment } from '@ykt/contracts';
import { createBackendRuntime } from '@ykt/backend';
import { describe, expect, it, vi } from 'vitest';
import { YuketangActiveClient } from '../../packages/routing/src/active/client.js';
import type {
  ActiveHttpRequest,
  ActiveHttpResponse,
} from '../../packages/routing/src/active/types.js';

const deadline = 1_800_000_000_000;
const activity = (
  id: number,
  type = 19,
  extra: Record<string, unknown> = {},
) => ({
  id,
  type,
  title: `作业 ${id}`,
  content: {
    leaf_id: `leaf ${id}`,
    leaf_type_id: id,
    score_d: deadline,
    ...extra,
  },
});
const question = (content: unknown) => ({ user: { my_answer: { content } } });

function setup(
  options: {
    activities?: unknown[];
    courses?: unknown[];
    status?: (id: string) => unknown | Promise<unknown>;
    logs?: (cid: string, page: number) => unknown;
    response?: (request: ActiveHttpRequest) => ActiveHttpResponse | undefined;
  } = {},
) {
  const requests: ActiveHttpRequest[] = [];
  const client = new YuketangActiveClient({
    credentials: {
      load: async () => ({
        cookieHeader: 'sessionid=secret; uv_id=1234',
        bearerToken: null,
        userId: null,
      }),
    },
    now: () => deadline - 1000,
    transport: {
      request: async (request) => {
        requests.push(request);
        const override = options.response?.(request);
        if (override) return override;
        const url = new URL(request.url);
        const base = { status: 200, headers: {} };
        if (url.pathname.includes('/courses/list'))
          return {
            ...base,
            body: {
              errcode: 0,
              data: {
                list: options.courses ?? [
                  { classroom_id: 1, name: '线性代数' },
                ],
              },
            },
          };
        if (url.pathname.includes('/logs/learn/'))
          return {
            ...base,
            body: options.logs?.(
              url.pathname.split('/').at(-1)!,
              Number(url.searchParams.get('page')),
            ) ?? {
              errcode: 0,
              data: { activities: options.activities ?? [activity(10)] },
            },
          };
        const id =
          url.searchParams.get('exam_id') ?? url.pathname.split('/').at(-2)!;
        return {
          ...base,
          body: options.status
            ? await options.status(id)
            : { data: { answer_count: 0, problems: [question('')] } },
        };
      },
    },
  });
  return { client, requests };
}

describe('read-only assignments', () => {
  it.each([
    [19, 'leaf /?#', 'exercise/leaf%20%2F%3F%23?is_chapter=1'],
    [20, 42, 'quiz/42?is_chapter=1'],
    [19, null, null],
    [20, '   ', null],
  ])(
    'builds the student deep link for type %s and leaf %s',
    async (type, leafId, route) => {
      const { client } = setup({
        activities: [activity(10, type, { leaf_id: leafId })],
      });
      const item = (await client.listAssignments(BrowserEnvironment.Pro))
        .assignments[0];
      expect(item?.url).toBe(
        route
          ? `https://pro.yuketang.cn/ai-workspace/lms-graph/1/${route}`
          : 'https://pro.yuketang.cn/v2/web/studentLog/1',
      );
      expect(item?.url).not.toContain('/subject');
    },
  );

  it('uses the activity classroom for deep links and auditing, and passes the optional exam SKU', async () => {
    const { client, requests } = setup({
      courses: [
        { classroom_id: 1, role: 5 },
        { classroom_id: 2, role: 6 },
      ],
      logs: (cid) => ({
        data: {
          activities:
            cid === '1'
              ? [
                  {
                    ...activity(10, 20, {
                      sku_id: 'sku /1',
                      leaf_id: 'leaf-id',
                    }),
                    classroom_id: 2,
                  },
                ]
              : [],
        },
      }),
    });
    const item = (await client.listAssignments(BrowserEnvironment.Pro))
      .assignments[0];
    expect(item).toMatchObject({
      audited: true,
      classroomId: '2',
      url: 'https://pro.yuketang.cn/ai-workspace/lms-graph/2/quiz/leaf-id?is_chapter=1',
    });
    const url = new URL(
      requests.find((r) => r.url.includes('/v/exam/cover'))!.url,
    );
    expect(url.searchParams.get('sku_id')).toBe('sku /1');
    expect(url.searchParams.get('exam_id')).toBe('10');
    expect(url.searchParams.get('classroom_id')).toBe('2');
  });

  it.each([5, undefined, 7])(
    'does not mark regular or unknown course role %s as audited',
    async (role) => {
      const { client } = setup({ courses: [{ classroom_id: 1, role }] });
      expect(
        (await client.listAssignments(BrowserEnvironment.Pro)).assignments[0]
          ?.audited,
      ).toBe(false);
    },
  );

  it.each([
    [{ status: 4, my_score: '30.00' }, true],
    [{ status: 4, my_score: '0.00' }, true],
    [{ status: 4 }, true],
    [{ my_score: 0 }, true],
    [{ status: 3, my_score: '30.00' }, false],
    [{ status: 4, my_score: '-1.00' }, false],
    [{ my_score: -1 }, false],
    [{ my_score: ' -1 ' }, false],
    [{}, null],
    [{ my_score: null }, null],
    [{ my_score: '' }, null],
    [{ my_score: 'NaN' }, null],
  ])(
    'recognizes homework grading fields without treating placeholders as marks: %j',
    async (user, graded) => {
      const { client } = setup({
        status: () => ({
          data: {
            answer_count: 1,
            problems: [{ user: { ...user, my_answer: { content: 'A' } } }],
          },
        }),
      });
      const item = (await client.listAssignments(BrowserEnvironment.Pro))
        .assignments[0];
      expect(item).toMatchObject({
        graded,
        status: 'answered',
        answeredCount: 1,
        score: null,
      });
    },
  );

  it.each([
    [
      {
        answer_count: 2,
        problems: [
          { user: { status: 4, my_score: 30, my_answer: { content: 'A' } } },
          {
            user: { status: 3, my_score: '-1.00', my_answer: { content: 'B' } },
          },
        ],
      },
      false,
    ],
    [
      {
        answer_count: 2,
        problems: [
          { user: { status: 4, my_score: 30 } },
          { user: { status: 3, my_score: -1 } },
        ],
      },
      false,
    ],
    [
      {
        answer_count: 2,
        problems: [{ user: { status: 4, my_score: 30 } }, {}],
      },
      null,
    ],
    [{ answer_count: 2, problems: [] }, null],
    [
      { answer_count: 0, problems: [{ user: { status: 3, my_score: -1 } }] },
      false,
    ],
  ])(
    'requires grading evidence for the whole relevant homework: %j',
    async (data, graded) => {
      const { client } = setup({ status: () => ({ data }) });
      expect(
        (await client.listAssignments(BrowserEnvironment.Pro)).assignments[0]
          ?.graded,
      ).toBe(graded);
    },
  );

  it.each([
    [{ score: 60, score_finish: true }, 100, true, 60],
    [{ score: 0, score_finish: true }, 100, true, 0],
    [{ score: 60 }, 100, true, 60],
    [{ score: 60, score_finish: false }, 100, false, null],
    [{ score: 60, score_finish: true }, undefined, false, null],
    [{ score: null, score_finish: true }, 100, false, null],
    [{ score: -1, score_finish: true }, 100, false, null],
    [{ score: Infinity, score_finish: true }, 100, false, null],
    [{ score: '60', score_finish: true }, 100, false, null],
  ])(
    'shows exam marks only when released: %j',
    async (marks, totalScore, graded, score) => {
      const { client } = setup({
        activities: [activity(10, 20)],
        status: () => ({
          data: {
            problem_count: 10,
            total_score: totalScore,
            result: { status: 4, unfinished_count: 0, ...marks },
          },
        }),
      });
      expect(
        (await client.listAssignments(BrowserEnvironment.Pro)).assignments[0],
      ).toMatchObject({
        graded,
        score,
        totalScore: graded ? totalScore : null,
        examStatus: 'submitted',
      });
    },
  );

  it.each([6, 99])(
    'does not expose a score for absent or unconfirmed exam status %s',
    async (status) => {
      const { client } = setup({
        activities: [activity(10, 20)],
        status: () => ({
          data: {
            problem_count: 10,
            total_score: 100,
            result: {
              status,
              unfinished_count: 0,
              score: 90,
              score_finish: true,
            },
          },
        }),
      });
      expect(
        (await client.listAssignments(BrowserEnvironment.Pro)).assignments[0],
      ).toMatchObject({ graded: false, score: null, totalScore: null });
    },
  );

  it.each([
    [{ status: 5, unfinished_count: 2 }, 'submitted', 'partial', 8],
    [{ status: 4, unfinished_count: 10 }, 'submitted', 'unanswered', 0],
    [{ status: 4 }, 'submitted', 'unknown', null],
    [{ status: 4, unfinished_count: null }, 'submitted', 'unknown', null],
    [{ status: 4, unfinished_count: 11 }, 'submitted', 'unknown', null],
    [{ status: 4, unfinished_count: -1 }, 'submitted', 'unknown', null],
    [{ status: 6, unfinished_count: 10 }, 'absent', 'unknown', null],
    [{ status: 99, unfinished_count: 0 }, 'unknown', 'unknown', null],
    [null, 'unknown', 'unknown', null],
  ])(
    'keeps exam submission separate from answer progress: %j',
    async (result, examStatus, status, answeredCount) => {
      const { client } = setup({
        activities: [activity(12, 20)],
        response: (request) =>
          new URL(request.url).pathname === '/v/exam/cover'
            ? {
                status: 200,
                headers: {},
                body: { success: true, data: { problem_count: 10, result } },
              }
            : undefined,
      });
      const snapshot = await client.listAssignments(BrowserEnvironment.Pro);
      expect(snapshot.assignments[0]).toMatchObject({
        examStatus,
        status,
        answeredCount,
        totalCount: 10,
        questions: [],
      });
    },
  );

  it('honors invalidated exams even when a submitted result remains present', async () => {
    const { client } = setup({
      activities: [activity(12, 20)],
      response: (request) =>
        new URL(request.url).pathname === '/v/exam/cover'
          ? {
              status: 200,
              headers: {},
              body: {
                success: true,
                data: {
                  problem_count: 10,
                  result: { status: 4, unfinished_count: 0 },
                  face_auth_status: { monitor_status: 2 },
                },
              },
            }
          : undefined,
    });
    expect(
      (await client.listAssignments(BrowserEnvironment.Pro)).assignments[0],
    ).toMatchObject({
      examStatus: 'invalid',
      status: 'unknown',
      answeredCount: null,
    });
  });

  it('reads the completed exam from the recorded cover response instead of the homework endpoint', async () => {
    // Minimal allowlisted fields from the 2026-09-19 real response; no identity or scores.
    const cover = JSON.parse(
      readFileSync(
        new URL('../fixtures/exam-cover-completed.json', import.meta.url),
        'utf8',
      ),
    ) as unknown;
    const { client, requests } = setup({
      activities: [activity(12, 20)],
      response: (request) =>
        new URL(request.url).pathname === '/v/exam/cover'
          ? { status: 200, headers: {}, body: cover }
          : undefined,
      status: () => ({ success: false, error_code: 20009, data: {} }),
    });
    const result = await client.listAssignments(BrowserEnvironment.Pro);
    expect(result.assignments[0]).toMatchObject({
      status: 'answered',
      examStatus: 'submitted',
      answeredCount: 10,
      totalCount: 10,
      questions: [],
    });
    expect(
      requests.some(
        (request) =>
          request.url.includes('/v/exam/cover?') &&
          request.url.includes('exam_id=12') &&
          request.url.includes('classroom_id=1'),
      ),
    ).toBe(true);
    expect(
      requests.some((request) => request.url.includes('/get_exercise_list/')),
    ).toBe(false);
  });

  it('uses the shared facade, browser cookies and XTBZ; preserves milliseconds and question-level progress', async () => {
    const { client, requests } = setup({
      activities: [activity(10), activity(11), activity(12, 20)],
      status: (id) =>
        id === '12'
          ? { success: false, error_code: 20009, data: {} }
          : {
              data: {
                answer_count: id === '10' ? 2 : 0,
                problems:
                  id === '10'
                    ? [question('A'), question(''), question('<p>答案</p>')]
                    : [question(''), question('  ')],
              },
            },
    });
    const snapshot = await createBackendRuntime({
      activeClient: client,
    }).facade.listAssignments(BrowserEnvironment.Pro);
    expect(snapshot.assignments).toHaveLength(3);
    expect(snapshot.assignments[0]).toMatchObject({
      status: 'partial',
      answeredCount: 2,
      totalCount: 3,
      deadline,
      courseName: '线性代数',
      url: 'https://pro.yuketang.cn/ai-workspace/lms-graph/1/exercise/leaf%2010?is_chapter=1',
    });
    expect(snapshot.assignments[0]?.questions.map((q) => q.answered)).toEqual([
      true,
      false,
      true,
    ]);
    expect(snapshot.assignments[1]?.status).toBe('unanswered');
    expect(snapshot.assignments[2]).toMatchObject({
      kind: 'exam',
      status: 'unknown',
      answeredCount: null,
    });
    expect(snapshot.assignments[2]?.statusMessage).toContain('官网');
    expect(
      requests.every(
        (r) =>
          r.method === 'GET' &&
          r.body === null &&
          r.headers.xtbz === 'ykt' &&
          r.headers.cookie === 'sessionid=secret; uv_id=1234',
      ),
    ).toBe(true);
    expect(
      requests
        .filter((r) => r.url.includes('/get_exercise_list/'))
        .every(
          (r) =>
            r.url.includes('uv_id=1234') && r.url.includes('classroom_id=1'),
        ),
    ).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/secret|<p>答案|my_answer/);
  });

  it.each([
    [{ problems: [question('A'), question(['B'])] }, 'answered', 2],
    [{ answer_count: 3 }, 'partial', 3],
    [{ answer_count: 0 }, 'unanswered', 0],
    [{ problems: [{ id: 3 }] }, 'unknown', null],
    [{ problems: [question('A'), { id: 3 }] }, 'partial', 1],
    [{}, 'unknown', null],
  ])(
    'handles aggregate and incomplete status data %j',
    async (data, status, answeredCount) => {
      const { client } = setup({ status: () => ({ data }) });
      const result = await client.listAssignments(BrowserEnvironment.Pro);
      expect(result.assignments[0]).toMatchObject({ status, answeredCount });
    },
  );

  it('keeps undated and expired assignments and ignores unrelated activities', async () => {
    const { client } = setup({
      activities: [
        activity(1, 19, { score_d: null, leaf_type_id: null }),
        activity(2, 19, { score_d: deadline - 100_000 }),
        activity(3, 14),
        activity(4, 20, { score_d: deadline + 365 * 86400_000 }),
      ],
    });
    const result = await client.listAssignments(BrowserEnvironment.Pro);
    expect(result.assignments.map((a) => a.title)).toEqual([
      '作业 2',
      '作业 4',
      '作业 1',
    ]);
    expect(result.assignments[2]).toMatchObject({
      deadline: null,
      status: 'unknown',
    });
  });

  it('isolates a failed course and a failed status request with visible warnings', async () => {
    const { client } = setup({
      courses: [
        { classroom_id: 1, name: '失败课程' },
        { classroom_id: 2, course: { name: '成功课程' } },
      ],
      logs: (cid) =>
        cid === '1'
          ? { errcode: 500 }
          : { data: { activities: [activity(10), activity(11)] } },
      status: (id) => {
        if (id === '10') throw new Error('temporary failure');
        return { data: { problems: [question('A')] } };
      },
    });
    const result = await client.listAssignments(BrowserEnvironment.Pro);
    expect(result.warnings).toEqual([
      '失败课程：部分学习日志未能读取，请刷新重试。',
    ]);
    expect(result.assignments.map((a) => a.status)).toEqual([
      'unknown',
      'answered',
    ]);
  });

  it.each([401, 403, 401000])(
    'reports expired sessions instead of returning an empty success (%s)',
    async (code) => {
      const { client } = setup({
        response: () => ({
          status: code === 401000 ? 200 : code,
          headers: {},
          body: { errcode: code },
        }),
      });
      await expect(
        client.listAssignments(BrowserEnvironment.Pro),
      ).rejects.toThrow('登录已失效');
    },
  );

  it('does not suppress session expiry in a course or a status response', async () => {
    for (const path of ['/logs/learn/', '/get_exercise_list/']) {
      const { client } = setup({
        response: (request) =>
          request.url.includes(path)
            ? { status: 200, headers: {}, body: { errcode: 401000 } }
            : undefined,
      });
      await expect(
        client.listAssignments(BrowserEnvironment.Pro),
      ).rejects.toThrow('登录已失效');
    }
  });

  it('rejects HTML login pages and malformed course lists', async () => {
    for (const body of ['<html>login</html>', { data: {} }]) {
      const { client } = setup({
        response: () => ({ status: 200, headers: {}, body }),
      });
      await expect(
        client.listAssignments(BrowserEnvironment.Pro),
      ).rejects.toThrow();
    }
  });

  it('fetches subsequent log pages and deduplicates overlapping activities', async () => {
    const { client, requests } = setup({
      logs: (_cid, page) => ({
        data: {
          activities:
            page === 0
              ? Array.from({ length: 200 }, (_, i) => activity(i, 14))
              : [activity(10), activity(10)],
        },
      }),
    });
    const result = await client.listAssignments(BrowserEnvironment.Pro);
    expect(requests.some((r) => r.url.includes('page=1'))).toBe(true);
    expect(result.assignments).toHaveLength(1);
  });

  it('limits concurrent status requests to four', async () => {
    let running = 0;
    let peak = 0;
    const { client } = setup({
      activities: Array.from({ length: 12 }, (_, i) => activity(i + 1)),
      status: async () => {
        peak = Math.max(peak, ++running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running--;
        return { data: { answer_count: 0 } };
      },
    });
    await client.listAssignments(BrowserEnvironment.Pro);
    expect(peak).toBe(4);
  });

  it('does not request unsupported hosts and fails clearly without a network client', async () => {
    const { client, requests } = setup();
    await expect(
      client.listAssignments(BrowserEnvironment.Standard),
    ).rejects.toThrow('仅支持荷塘');
    expect(requests).toHaveLength(0);
    await expect(
      createBackendRuntime().facade.listAssignments(BrowserEnvironment.Pro),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('refreshes state on each request after a submission on the official page', async () => {
    const status = vi
      .fn()
      .mockReturnValueOnce({ data: { problems: [question('')] } })
      .mockReturnValueOnce({ data: { problems: [question('A')] } });
    const { client } = setup({ status });
    expect(
      (await client.listAssignments(BrowserEnvironment.Pro)).assignments[0]
        ?.status,
    ).toBe('unanswered');
    expect(
      (await client.listAssignments(BrowserEnvironment.Pro)).assignments[0]
        ?.status,
    ).toBe('answered');
  });
});
