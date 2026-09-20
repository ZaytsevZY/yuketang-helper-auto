import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  AssignmentReadError,
  HeadlessAssignments,
  parseAssignmentSession,
} from '@ykt/backend';
import {
  CliRpcMethod,
  type AssignmentDetail,
  type AssignmentSnapshot,
  type JsonValue,
} from '@ykt/contracts';
import { requestDesktop } from './rpc-client.js';

export interface AssignmentArgs {
  readonly positionals: readonly string[];
  readonly options: ReadonlyMap<string, string | true>;
}

export async function executeAssignments(
  args: AssignmentArgs,
): Promise<JsonValue> {
  const [group, action, id] = args.positionals;
  const option = (name: string) => {
    const value = args.options.get(name);
    return typeof value === 'string' ? value : undefined;
  };
  const invalid = (message: string): never => {
    throw new AssignmentReadError('INVALID_ARGUMENT', message);
  };
  if (!['list', 'detail', 'question', 'answer'].includes(action ?? ''))
    invalid('作业命令支持 list、detail、question 和 answer。');
  if (action !== 'list' && !id) invalid('请提供列表返回的作业/考试 id。');
  const environment = option('environment') ?? 'pro';
  if (environment !== 'pro') invalid('作业/考试目前仅支持 --environment pro。');
  const kind =
    group === 'homework' || group === 'exam' ? group : option('kind');
  if (kind && !['homework', 'exam'].includes(kind))
    invalid('--kind 只接受 homework 或 exam。');
  const status = option('status');
  if (
    status &&
    !['unanswered', 'partial', 'answered', 'unknown'].includes(status)
  )
    invalid('--status 无效。');
  const index = Number(option('index'));
  if (
    ['question', 'answer'].includes(action!) &&
    (!Number.isSafeInteger(index) || index < 1)
  )
    invalid('单题读取必须提供 --index <正整数题号>。');
  const refresh = args.options.has('refresh');
  let standalone: HeadlessAssignments | undefined;
  if (args.options.has('headless')) {
    const file = option('session-file') ?? process.env.YKT_SESSION_FILE;
    if (!file)
      invalid('独立模式需要 --session-file <path|-> 或 YKT_SESSION_FILE。');
    let input: string;
    if (file === '-') {
      input = '';
      for await (const chunk of process.stdin) input += String(chunk);
    } else input = await readFile(file!, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      invalid('会话文件不是有效 JSON。');
    }
    standalone = new HeadlessAssignments(
      parseAssignmentSession(parsed),
      option('cache-dir') ?? join(homedir(), '.yuketang-helper-cli', 'cache'),
    );
  } else if (
    args.options.has('session-file') ||
    args.options.has('cache-dir')
  ) {
    invalid('--session-file 和 --cache-dir 需要同时使用 --headless。');
  }
  if (action === 'list') {
    const snapshot = standalone
      ? await standalone.list(refresh)
      : ((await requestDesktop(CliRpcMethod.AssignmentList, {
          environment,
          refresh,
        })) as unknown as AssignmentSnapshot);
    const search = option('search')?.toLocaleLowerCase();
    return json({
      ...snapshot,
      assignments: snapshot.assignments.filter(
        (item) =>
          (!kind || item.kind === kind) &&
          (!status || item.status === status) &&
          (!args.options.has('graded') || item.graded === true) &&
          (!search ||
            `${item.title}\n${item.courseName}`
              .toLocaleLowerCase()
              .includes(search)),
      ),
    });
  }
  const detail = standalone
    ? await standalone.detail(id!, refresh)
    : ((await requestDesktop(CliRpcMethod.AssignmentDetail, {
        id: id!,
        environment,
        refresh,
      })) as unknown as AssignmentDetail);
  if (kind && detail.assignment.kind !== kind)
    throw new AssignmentReadError(
      'NOT_FOUND',
      '该 id 的作业/考试类型与命令不符。',
    );
  if (action === 'detail') return json(detail);
  return assignmentQuestion(detail, index, action === 'answer');
}

/** Select original paper numbering; never infer a reference answer from my answer. */
export function assignmentQuestion(
  detail: AssignmentDetail,
  index: number,
  answerOnly = false,
): JsonValue {
  if (detail.mode === 'exam-cover')
    throw new AssignmentReadError(
      'REVIEW_UNAVAILABLE',
      '该考试尚未开放已批改题目详情。',
    );
  const matches = detail.problems.filter((item) => item.index === index);
  if (matches.length !== 1)
    throw new AssignmentReadError(
      'NOT_FOUND',
      '题号不存在或不唯一，请检查详情中的题号。',
    );
  const problem = matches[0]!;
  if (answerOnly && !problem.correctAnswerHtml)
    throw new AssignmentReadError(
      'ANSWER_UNAVAILABLE',
      '平台未提供或未发布该题的标准答案。',
    );
  return json({
    assignment: detail.assignment,
    fetchedAt: detail.fetchedAt,
    mode: detail.mode,
    fontUrl: detail.fontUrl,
    // Keep HTML and font provenance. Unicode from encrypted fonts is not decoded.
    contentEncoding: 'source-html',
    ...(answerOnly
      ? {
          index: problem.index,
          problemId: problem.id,
          correctAnswerHtml: problem.correctAnswerHtml,
          explanationHtml: problem.explanationHtml ?? '',
        }
      : { problem }),
  });
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
