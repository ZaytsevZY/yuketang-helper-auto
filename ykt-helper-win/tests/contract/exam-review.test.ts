// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  BrowserEnvironment,
  canOpenAssignmentAnswer,
  type Assignment,
} from '@ykt/contracts';
import { YuketangActiveClient, type ActiveHttpRequest } from '@ykt/routing';
import { fetchAssignmentDetail } from '../../packages/routing/src/active/assignment-detail.js';
import { openExamReviewSession } from '../../packages/routing/src/active/exam-review-session.js';
import {
  detailBodyHtml,
  sanitizeAssignmentHtml,
} from '../../apps/desktop/renderer/src/assignment-body.js';

const assignment: Assignment = {
  id: 'exam',
  classroomId: '12',
  leafTypeId: '34',
  kind: 'exam',
  title: 'Review',
  courseName: 'Course',
  url: 'https://pro.yuketang.cn/ai-workspace/lms-graph/12/quiz/56?is_chapter=1',
  status: 'answered',
  graded: true,
  score: 10,
  totalScore: 20,
  deadline: null,
  audited: false,
  answeredCount: 2,
  totalCount: 2,
  questions: [],
  statusMessage: null,
};
const cover = {
  user: { user_id: 7 },
  problem_count: 2,
  total_score: 20,
  show_perm: true,
  show_score: true,
  show_answer: true,
  show_score_time: 0,
  server_time: 1000,
  result: { status: 4, score: 10, score_finish: true, unfinished_count: 0 },
};
const paper = {
  font: '//fe-static-yuketang.yuketang.cn/current.ttf',
  problems: [
    {
      problem_id: 20,
      index: 0,
      ProblemType: 1,
      score: 10,
      Body: '<b>Second</b>',
      Options: [{ key: 'A', value: 'Option' }],
      Answer: ['A'],
      Remark: '<p>Explanation</p>',
    },
    {
      problem_id: 10,
      index: 0,
      ProblemType: 1,
      score: 10,
      Body: '<span class="xuetangx-com-encrypted-font">𛈒</span>',
    },
  ],
};
const results = {
  problem_results: [
    {
      problem_id: 10,
      finished: true,
      grade: 10,
      correct: true,
      result: ['B'],
      answer: ['B'],
    },
    {
      problem_id: 20,
      finished: true,
      grade: 0,
      correct: false,
      result: ['C'],
      answer: ['A'],
    },
  ],
};
function readers(secondCover = cover, resultData: unknown = results) {
  const get = vi.fn(async (path: string) => ({
    data: path.endsWith('/cover')
      ? secondCover
      : path.endsWith('/show_paper')
        ? paper
        : resultData,
  }));
  return { get, open: vi.fn(async () => get) };
}

describe('graded exam review', () => {
  it.each([
    { result: { ...cover.result, status: 0 } },
    { result: { ...cover.result, status: 1 } },
    { result: { ...cover.result, status: 2 } },
    { result: { ...cover.result, status: 3 } },
    { result: { ...cover.result, status: 6 } },
    { result: { ...cover.result, score: null } },
    { result: { ...cover.result, score: -1 } },
    { result: { ...cover.result, score_finish: false } },
    { face_auth_status: { monitor_status: 2 } },
    { show_perm: false },
    { show_perm: undefined },
    { show_score: false },
    { show_score_time: 2000 },
  ])(
    'uses only a fresh cover despite a previously graded cache: %j',
    async (change) => {
      const get = vi.fn(async () => ({ data: { ...cover, ...change } }));
      const { open } = readers();
      const detail = await fetchAssignmentDetail(
        get,
        assignment,
        '1',
        () => 1000,
        open,
      );
      expect(get).toHaveBeenCalledTimes(1);
      expect(open).not.toHaveBeenCalled();
      expect(detail.mode).toBe('exam-cover');
      expect(detail.problems).toEqual([]);
    },
  );

  it('rechecks the exam-domain cover after authentication before reading any questions', async () => {
    const { get, open } = readers({
      ...cover,
      result: { ...cover.result, status: 1 },
    });
    const detail = await fetchAssignmentDetail(
      async () => ({ data: cover }),
      assignment,
      '1',
      () => 1000,
      open,
    );
    expect(get.mock.calls).toEqual([['/exam_room/cover']]);
    expect(detail.mode).toBe('exam-cover');
  });

  it('matches reversed result order by ID, preserves zero scores and renders released feedback', async () => {
    const { get, open } = readers();
    const detail = await fetchAssignmentDetail(
      async () => ({ data: cover }),
      assignment,
      '1',
      () => 1000,
      open,
    );
    expect(get.mock.calls).toEqual([
      ['/exam_room/cover'],
      ['/exam_room/problem_results'],
      ['/exam_room/show_paper'],
    ]);
    expect(detail.mode).toBe('exam-review');
    expect(detail.fontUrl).toBe(
      'https://fe-static-yuketang.yuketang.cn/current.ttf',
    );
    expect(
      detail.problems.map((p) => [p.id, p.index, p.myScore, p.answerHtml]),
    ).toEqual([
      ['20', 1, 0, 'C'],
      ['10', 2, 10, 'B'],
    ]);
    expect(detail.problems[0]).toMatchObject({
      status: 'graded',
      correct: false,
      correctAnswerHtml: 'A',
      explanationHtml: '<p>Explanation</p>',
      options: [{ label: 'A', html: 'Option' }],
    });
    expect(detail.assignment.questions).toEqual([
      { id: '20', index: 1, answered: true },
      { id: '10', index: 2, answered: true },
    ]);
    expect(canOpenAssignmentAnswer(detail)).toBe(false);
    const html = sanitizeAssignmentHtml(detailBodyHtml(detail)).html;
    expect(html).toContain('得分 0 / 10');
    expect(html).toContain('错误');
    expect(html).toContain('参考答案');
    expect(html).toContain('Explanation');
    expect(html).toContain('xuetangx-com-encrypted-font');
  });

  it('withholds unpublished answers/analysis and does not invent missing question results', async () => {
    const { open } = readers(
      { ...cover, show_answer: false },
      { problem_results: [{ problem_id: 20, finished: false, grade: -1 }] },
    );
    const detail = await fetchAssignmentDetail(
      async () => ({ data: cover }),
      assignment,
      '1',
      () => 1000,
      open,
    );
    expect(
      detail.problems.map((p) => [
        p.status,
        p.myScore,
        p.correctAnswerHtml,
        p.explanationHtml,
      ]),
    ).toEqual([
      ['unanswered', null, '', ''],
      ['unknown', null, '', ''],
    ]);
    expect(detail.assignment.questions.map((p) => p.answered)).toEqual([
      false,
      null,
    ]);
    expect(detailBodyHtml(detail)).not.toContain('参考答案');
  });

  it('authenticates only after the review gate and never forwards platform credentials to the exam host', async () => {
    const requests: ActiveHttpRequest[] = [];
    const client = new YuketangActiveClient({
      now: () => 1000,
      credentials: {
        load: async () => ({
          cookieHeader: 'uv_id=2598; platform=secret; csrftoken=csrf-secret',
          bearerToken: 'platform-secret',
          userId: '7',
        }),
      },
      transport: {
        request: async (request) => {
          requests.push(request);
          const path = new URL(request.url).pathname;
          const body =
            path === '/v/exam/gen_token'
              ? {
                  data: {
                    token: 'review-token',
                    user_id: 7,
                    exam_host: 'https://tsinghua-exam.yuketang.cn',
                  },
                }
              : {
                  data: path.endsWith('/cover')
                    ? cover
                    : path.endsWith('/show_paper')
                      ? paper
                      : results,
                };
          return { status: path === '/login' ? 302 : 200, headers: {}, body };
        },
      },
    });
    const detail = await client.getAssignmentDetail(
      BrowserEnvironment.Pro,
      assignment,
    );
    expect(detail.mode).toBe('exam-review');
    expect(requests.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
      ['GET', '/v/exam/cover'],
      ['POST', '/v/exam/gen_token'],
      ['GET', '/login'],
      ['GET', '/exam_room/cover'],
      ['GET', '/exam_room/problem_results'],
      ['GET', '/exam_room/show_paper'],
    ]);
    expect(JSON.parse(requests[1]!.body!)).toEqual({
      exam_id: '34',
      classroom_id: '12',
    });
    expect(requests[1]!.headers).toMatchObject({
      'x-csrftoken': 'csrf-secret',
      'xt-agent': 'web',
      'classroom-id': '12',
    });
    expect(requests[1]!.headers).not.toHaveProperty('authorization');
    expect(requests[1]!.headers).not.toHaveProperty('x-client');
    const login = new URL(requests[2]!.url);
    expect(login.searchParams.get('next')).toBe(
      'https://tsinghua-exam.yuketang.cn/result/34?isFrom=2',
    );
    expect(requests[2]!.redirect).toBe('manual');
    for (const request of requests.slice(2))
      expect(JSON.stringify(request.headers)).not.toMatch(
        /secret|authorization|cookie/i,
      );
    expect(JSON.stringify(detail)).not.toMatch(/review-token|platform-secret/);
  });

  it.each([7, 8])(
    'verifies the login user after Electron cancels a manual redirect (user %s)',
    async (userId) => {
      const request = vi.fn(async (request: ActiveHttpRequest) => {
        if (new URL(request.url).pathname === '/login')
          throw new Error('Redirect was cancelled');
        return {
          status: 200,
          headers: {},
          body: { data: { ...cover, user: { user_id: userId } } },
        };
      });
      const get = await openExamReviewSession(
        { request },
        {
          data: {
            exam_host: 'https://tsinghua-exam.yuketang.cn',
            token: 'token',
            user_id: 7,
          },
        },
        '34',
      );
      await expect(get('/exam_room/show_paper')).rejects.toThrow();
      if (userId === 7) {
        await get('/exam_room/cover');
        await expect(get('/exam_room/show_paper')).resolves.toBeDefined();
      } else {
        await expect(get('/exam_room/cover')).rejects.toThrow();
        await expect(get('/exam_room/show_paper')).rejects.toThrow();
        expect(request).toHaveBeenCalledTimes(2);
      }
    },
  );

  it('does not swallow unrelated login transport errors', async () => {
    const request = vi.fn(async () => {
      throw new Error('Network unavailable');
    });
    await expect(
      openExamReviewSession(
        { request },
        { data: { token: 'token', user_id: 7 } },
        '34',
      ),
    ).rejects.toThrow('Network unavailable');
  });

  it.each([
    'https://evil.test',
    'http://tsinghua-exam.yuketang.cn',
    'https://tsinghua-exam.yuketang.cn.evil.test',
    'https://user@tsinghua-exam.yuketang.cn',
  ])(
    'rejects token forwarding to an untrusted exam host: %s',
    async (exam_host) => {
      const request = vi.fn();
      await expect(
        openExamReviewSession(
          { request },
          { data: { exam_host, token: 'secret', user_id: 7 } },
          '34',
        ),
      ).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    },
  );
});
