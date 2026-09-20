import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeadlessAssignments, parseAssignmentSession } from '@ykt/backend';
import {
  AssignmentAuthError,
  NodeAssignmentSession,
  YuketangActiveClient,
} from '@ykt/routing';
import type {
  Assignment,
  AssignmentDetail,
  AssignmentProblemDetail,
} from '@ykt/contracts';
import {
  assignmentQuestion,
  executeAssignments,
} from '../../apps/cli/src/assignments.js';

const session = {
  environment: 'pro' as const,
  cookieHeader: 'sessionid=private-test; csrftoken=csrf',
  bearerToken: 'platform-token',
};
const assignment: Assignment = {
  id: 'pro:12:20:56',
  classroomId: '12',
  leafTypeId: '34',
  kind: 'exam',
  title: 'Test exam',
  courseName: 'Test course',
  deadline: null,
  url: '',
  status: 'answered',
  graded: true,
  score: 0,
  totalScore: 10,
  audited: false,
  answeredCount: 1,
  totalCount: 1,
  questions: [],
  statusMessage: null,
};
const problem: AssignmentProblemDetail = {
  id: '99',
  index: 2,
  type: 1,
  typeText: '单选题',
  score: 10,
  bodyHtml: '<span class="xuetangx-com-encrypted-font">𛈒</span>',
  options: [{ label: 'B', html: '正确选项' }],
  answerHtml: 'A',
  attachments: [],
  status: 'graded',
  myScore: 0,
  correctAnswerHtml: 'B',
  explanationHtml: '解释',
  remarkHtml: '',
  comments: [],
  externalUrl: null,
  maxRetry: 0,
  remainingRetries: null,
  allowResults: [],
};
const detail: AssignmentDetail = {
  assignment,
  fetchedAt: 1000,
  mode: 'exam-review',
  descriptionHtml: '',
  fontUrl: 'https://fe-static-yuketang.yuketang.cn/test.ttf',
  problems: [problem],
  maxRetry: 0,
  lateAllowed: false,
  lateDeadline: null,
};
const directories: string[] = [];
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'ykt-headless-'));
  directories.push(dir);
  return dir;
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('standalone assignments', () => {
  it('runs CLI aliases, filters and single-question reads from a standalone cache', async () => {
    const dir = await directory();
    const sessionFile = join(dir, 'session.json');
    await writeFile(sessionFile, JSON.stringify(session), { mode: 0o600 });
    const fetchedAt = Date.now();
    const client = {
      listAssignments: vi.fn(async () => ({
        environment: 'pro' as const,
        fetchedAt,
        warnings: ['partial course'],
        assignments: [
          assignment,
          { ...assignment, id: 'homework', kind: 'homework' as const },
        ],
      })),
      getAssignmentDetail: vi.fn(async () => ({ ...detail, fetchedAt })),
    };
    await new HeadlessAssignments(session, dir, Date.now, client).detail(
      assignment.id,
    );
    const options = new Map<string, string | true>([
      ['headless', true],
      ['session-file', sessionFile],
      ['cache-dir', dir],
      ['search', 'TEST EXAM'],
      ['graded', true],
      ['index', '2'],
    ]);
    const network = vi.fn(() => {
      throw new Error('must use cached data');
    });
    vi.stubGlobal('fetch', network);
    const list = await executeAssignments({
      positionals: ['exam', 'list'],
      options,
    });
    expect(list).toMatchObject({
      assignments: [assignment],
      warnings: ['partial course'],
    });
    expect(
      await executeAssignments({
        positionals: ['exam', 'question', assignment.id],
        options,
      }),
    ).toMatchObject({ problem });
    expect(
      await executeAssignments({
        positionals: ['exam', 'answer', assignment.id],
        options,
      }),
    ).toMatchObject({ correctAnswerHtml: 'B' });
    await expect(
      executeAssignments({
        positionals: ['homework', 'detail', assignment.id],
        options,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(network).not.toHaveBeenCalled();
  });

  it('clears cache on expired authentication and gives a CLI-specific recovery error', async () => {
    const dir = await directory();
    const client = {
      listAssignments: vi.fn(async () => ({
        environment: 'pro' as const,
        fetchedAt: 1000,
        assignments: [assignment],
        warnings: [],
      })),
      getAssignmentDetail: vi
        .fn()
        .mockResolvedValueOnce(detail)
        .mockRejectedValueOnce(new AssignmentAuthError()),
    };
    const reader = new HeadlessAssignments(session, dir, () => 1000, client);
    await reader.detail(assignment.id);
    await expect(reader.detail(assignment.id, true)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    expect(await readdir(dir)).toEqual([]);
  });

  it('persists account-scoped detail cache across commands, refreshes and expires it', async () => {
    let time = 1000;
    const client = {
      listAssignments: vi.fn(async () => ({
        environment: 'pro' as const,
        fetchedAt: time,
        assignments: [assignment],
        warnings: ['partial collection'],
      })),
      getAssignmentDetail: vi.fn(async () => ({ ...detail, fetchedAt: time })),
    };
    const dir = await directory();
    const reader = () =>
      new HeadlessAssignments(session, dir, () => time, client);
    await reader().detail(assignment.id);
    expect(await reader().detail(assignment.id)).toEqual(detail);
    expect(client.getAssignmentDetail).toHaveBeenCalledTimes(1);
    expect(client.listAssignments).toHaveBeenCalledTimes(1);
    expect((await reader().list()).warnings).toEqual(['partial collection']);
    await reader().detail(assignment.id, true);
    expect(client.getAssignmentDetail).toHaveBeenCalledTimes(2);
    await reader().list(true);
    await reader().detail(assignment.id);
    expect(client.getAssignmentDetail).toHaveBeenCalledTimes(3);
    time += 30 * 60_000;
    await reader().detail(assignment.id);
    expect(client.getAssignmentDetail).toHaveBeenCalledTimes(4);
    await new HeadlessAssignments(
      { ...session, cookieHeader: 'sessionid=another-user' },
      dir,
      () => time,
      client,
    ).detail(assignment.id);
    expect(client.getAssignmentDetail).toHaveBeenCalledTimes(5);
    const files = await readdir(dir);
    expect(files).toHaveLength(2);
    for (const file of files) {
      expect(await readFile(join(dir, file), 'utf8')).not.toMatch(
        /private-test|platform-token|another-user/,
      );
      if (process.platform !== 'win32')
        expect((await stat(join(dir, file))).mode & 0o777).toBe(0o600);
    }
  });

  it('does not substitute old cached answers when explicit refresh fails', async () => {
    const dir = await directory();
    const client = {
      listAssignments: vi.fn(async () => ({
        environment: 'pro' as const,
        fetchedAt: 1000,
        assignments: [assignment],
        warnings: [],
      })),
      getAssignmentDetail: vi
        .fn()
        .mockResolvedValueOnce(detail)
        .mockRejectedValueOnce(new Error('session expired')),
    };
    await new HeadlessAssignments(session, dir, () => 1000, client).detail(
      assignment.id,
    );
    await expect(
      new HeadlessAssignments(session, dir, () => 1000, client).detail(
        assignment.id,
        true,
      ),
    ).rejects.toThrow('session expired');
  });

  it('selects a single original question number and preserves font provenance', () => {
    const result = assignmentQuestion(
      {
        ...detail,
        problems: [
          { ...problem, index: 1, bodyHtml: 'other question' },
          problem,
        ],
      },
      2,
    );
    expect(result).toMatchObject({
      fontUrl: detail.fontUrl,
      contentEncoding: 'source-html',
      problem,
    });
    expect(JSON.stringify(result)).not.toContain('other question');
    expect(assignmentQuestion(detail, 2, true)).toMatchObject({
      index: 2,
      correctAnswerHtml: 'B',
    });
    expect(() => assignmentQuestion(detail, 1)).toThrow('题号不存在');
    expect(() =>
      assignmentQuestion({ ...detail, mode: 'exam-cover', problems: [] }, 2),
    ).toThrow('尚未开放');
    expect(() =>
      assignmentQuestion(
        { ...detail, problems: [{ ...problem, correctAnswerHtml: '' }] },
        2,
        true,
      ),
    ).toThrow('未提供或未发布');
  });

  it('requires explicit pro credentials and validates CLI inputs before any connection', async () => {
    expect(() =>
      parseAssignmentSession({ ...session, environment: 'standard' }),
    ).toThrow('pro 会话');
    expect(() =>
      parseAssignmentSession({ ...session, cookieHeader: 'csrftoken=only' }),
    ).toThrow('cookieHeader');
    await expect(
      executeAssignments({
        positionals: ['exam', 'question', 'id'],
        options: new Map([
          ['index', '0'],
          ['headless', true],
        ]),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      executeAssignments({
        positionals: ['exam', 'list'],
        options: new Map([['headless', true]]),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('Node exam session', () => {
  it('handles login Set-Cookie without redirects or platform credential leakage', async () => {
    const cover = {
      user: { user_id: 7 },
      problem_count: 1,
      total_score: 10,
      show_perm: true,
      show_score: true,
      show_answer: true,
      result: { status: 4, score: 0, score_finish: true, unfinished_count: 0 },
    };
    const calls: {
      path: string;
      headers: Headers;
      redirect: string | undefined;
    }[] = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        calls.push({ path: url.pathname, headers, redirect: init?.redirect });
        if (url.hostname === 'pro.yuketang.cn') {
          expect(headers.get('cookie')).toContain('sessionid=private-test');
          if (url.pathname === '/v/exam/gen_token') {
            expect(headers.get('authorization')).toBeNull();
            expect(headers.get('x-csrftoken')).toBe('csrf');
            return Response.json({
              data: {
                exam_host: 'https://tsinghua-exam.yuketang.cn',
                user_id: 7,
                token: 'handoff-secret',
              },
            });
          }
          return Response.json({ data: cover });
        }
        expect(headers.get('authorization')).toBeNull();
        expect(headers.get('cookie') ?? '').not.toMatch(/private-test|csrf/);
        if (url.pathname === '/login')
          return new Response('', {
            status: 302,
            headers: {
              'set-cookie':
                'exam_session=result-session; Path=/; HttpOnly; Secure',
              location: 'https://untrusted.example/',
            },
          });
        expect(headers.get('cookie')).toBe('exam_session=result-session');
        if (url.pathname === '/exam_room/cover')
          return Response.json({ data: cover });
        if (url.pathname === '/exam_room/problem_results')
          return Response.json({
            data: {
              problem_results: [
                {
                  problem_id: 99,
                  grade: 0,
                  finished: true,
                  result: ['A'],
                  answer: ['B'],
                },
              ],
            },
          });
        return Response.json({
          data: {
            problems: [
              { problem_id: 99, Body: 'Second question', ProblemType: 1 },
            ],
          },
        });
      },
    );
    const transport = new NodeAssignmentSession(
      { ...session, userId: null },
      fetcher as typeof fetch,
    );
    const client = new YuketangActiveClient({
      credentials: transport,
      transport,
    });
    const result = await client.getAssignmentDetail('pro', assignment);
    expect(result.mode).toBe('exam-review');
    expect(result.problems[0]).toMatchObject({
      answerHtml: 'A',
      correctAnswerHtml: 'B',
      myScore: 0,
    });
    expect(calls.map((call) => call.path)).toEqual([
      '/v/exam/cover',
      '/v/exam/gen_token',
      '/login',
      '/exam_room/cover',
      '/exam_room/problem_results',
      '/exam_room/show_paper',
    ]);
    expect(calls.every((call) => call.redirect === 'manual')).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /handoff-secret|result-session|private-test/,
    );
  });

  it('never creates an exam login session for an active/unreleased exam', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ data: { result: { status: 1 } } }),
    );
    const transport = new NodeAssignmentSession(
      { ...session, userId: null },
      fetcher,
    );
    const client = new YuketangActiveClient({
      credentials: transport,
      transport,
    });
    expect((await client.getAssignmentDetail('pro', assignment)).mode).toBe(
      'exam-cover',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects external origins and redacts login tokens from network errors', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('failed at secret URL');
    });
    const transport = new NodeAssignmentSession(
      { ...session, userId: null },
      fetcher,
    );
    const request = { method: 'GET' as const, headers: {}, body: null };
    await expect(
      transport.request({ ...request, url: 'https://external.example/' }),
    ).rejects.toThrow('不支持');
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      transport.request({
        ...request,
        url: 'https://tsinghua-exam.yuketang.cn/login?crypt=secret',
      }),
    ).rejects.toThrow('tsinghua-exam.yuketang.cn/login');
  });
});
