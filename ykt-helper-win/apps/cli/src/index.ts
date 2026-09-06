#!/usr/bin/env node
import process from 'node:process';

import {
  CliRpcMethod,
  isBrowserEnvironment,
  type BrowserEnvironment,
  type JsonValue,
} from '@ykt/contracts';

import { DesktopCliError, requestDesktop } from './rpc-client.js';

interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly options: ReadonlyMap<string, string | true>;
}

const usage = `Usage:
  ykt status
  ykt settings get
  ykt user get --environment <standard|pro|changjiang> [--refresh]
  ykt lesson list [--environment <standard|pro|changjiang|all>] [--refresh]
  ykt lesson connect <lesson-id> --environment <standard|pro|changjiang>
  ykt presentation list --lesson <lesson-id>
  ykt slide get <slide-id> --lesson <lesson-id> [--presentation <id>]
  ykt slide read <slide-id> --lesson <lesson-id> [--presentation <id>]
  ykt problem list --lesson <lesson-id>
  ykt problem get <problem-id>
  ykt ai profile list
  ykt answer propose <problem-id> [--prompt <text>]
  ykt answer validate <problem-id> --from -
  ykt answer submit <problem-id> --from - --commit [--proposal <id>] [--confirmed-by <user|agent>] [--force-retry]
  ykt logs list [--limit <number>]

All successful results are written as JSON to stdout. The desktop app must be running.`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (
    args.positionals.length === 0 ||
    args.options.has('help') ||
    args.positionals[0] === 'help'
  ) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const result = await execute(args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function execute(args: ParsedArgs): Promise<JsonValue> {
  const [group, action, id] = args.positionals;
  if (group === 'status' && action === undefined) {
    return requestDesktop(CliRpcMethod.Status);
  }
  if (group === 'settings' && action === 'get') {
    return requestDesktop(CliRpcMethod.SettingsGet);
  }
  if (group === 'user' && action === 'get') {
    return requestDesktop(
      CliRpcMethod.UserGet,
      json({
        environment: environmentOption(args),
        refresh: args.options.has('refresh'),
      }),
    );
  }
  if (group === 'lesson' && action === 'list') {
    return requestDesktop(
      CliRpcMethod.LessonList,
      json({
        environment: option(args, 'environment') ?? 'all',
        refresh: args.options.has('refresh'),
      }),
    );
  }
  if (group === 'lesson' && action === 'connect' && id) {
    return requestDesktop(
      CliRpcMethod.LessonConnect,
      json({ id, environment: environmentOption(args) }),
    );
  }
  if (group === 'presentation' && action === 'list') {
    return requestDesktop(
      CliRpcMethod.PresentationList,
      json({ lessonId: requiredOption(args, 'lesson') }),
    );
  }
  if (group === 'slide' && (action === 'get' || action === 'read') && id) {
    const presentationId = option(args, 'presentation');
    const params = json({
      lessonId: requiredOption(args, 'lesson'),
      slideId: id,
      ...(presentationId ? { presentationId } : {}),
    });
    return requestDesktop(
      action === 'read' ? CliRpcMethod.SlideRead : CliRpcMethod.SlideGet,
      params,
    );
  }
  if (group === 'problem' && action === 'list') {
    return requestDesktop(
      CliRpcMethod.ProblemList,
      json({ lessonId: requiredOption(args, 'lesson') }),
    );
  }
  if (group === 'problem' && action === 'get' && id) {
    return requestDesktop(CliRpcMethod.ProblemGet, json({ id }));
  }
  if (group === 'ai' && action === 'profile' && id === 'list') {
    return requestDesktop(CliRpcMethod.AiProfileList);
  }
  if (group === 'answer' && action === 'propose' && id) {
    const customPrompt = option(args, 'prompt');
    return requestDesktop(
      CliRpcMethod.AnswerPropose,
      json({ problemId: id, ...(customPrompt ? { customPrompt } : {}) }),
    );
  }
  if (group === 'answer' && action === 'validate' && id) {
    return requestDesktop(
      CliRpcMethod.AnswerValidate,
      await answerInput(args, id, false),
    );
  }
  if (group === 'answer' && action === 'submit' && id) {
    if (!args.options.has('commit')) {
      throw new CliUsageError('提交答案必须显式提供 --commit。');
    }
    return requestDesktop(
      CliRpcMethod.AnswerSubmit,
      await answerInput(args, id, true),
    );
  }
  if (group === 'logs' && action === 'list') {
    const limit = option(args, 'limit');
    return requestDesktop(
      CliRpcMethod.LogsList,
      json(limit === undefined ? {} : { limit: numberValue(limit, 'limit') }),
    );
  }
  throw new CliUsageError(`未知命令：${args.positionals.join(' ')}`);
}

async function answerInput(
  args: ParsedArgs,
  problemId: string,
  submitting: boolean,
): Promise<JsonValue> {
  if (option(args, 'from') !== '-') {
    throw new CliUsageError('答案必须通过 --from - 从 stdin 读取 JSON。');
  }
  const source = await readStdinJson();
  const record =
    isRecord(source) && 'answer' in source ? source : { answer: source };
  const proposalId =
    option(args, 'proposal') ?? stringField(record, 'proposalId');
  const confirmedBy =
    option(args, 'confirmed-by') ?? stringField(record, 'confirmedBy');
  if (confirmedBy && confirmedBy !== 'user' && confirmedBy !== 'agent') {
    throw new CliUsageError('confirmed-by 只能是 user 或 agent。');
  }
  const idempotencyKey = stringField(record, 'idempotencyKey');
  return json({
    problemId,
    answer: record.answer,
    ...(submitting ? { commit: true } : {}),
    ...(proposalId ? { proposalId } : {}),
    ...(proposalId && submitting
      ? { confirmedBy: confirmedBy ?? 'agent' }
      : {}),
    ...(args.options.has('force-retry') || record.forceRetry === true
      ? { forceRetry: true }
      : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}

function parseArgs(values: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string | true>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const equals = value.indexOf('=');
    if (equals > 2) {
      options.set(value.slice(2, equals), value.slice(equals + 1));
      continue;
    }
    const name = value.slice(2);
    const next = values[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options.set(name, next);
      index += 1;
    } else {
      options.set(name, true);
    }
  }
  return { positionals, options };
}

function option(args: ParsedArgs, name: string): string | undefined {
  const value = args.options.get(name);
  return typeof value === 'string' ? value : undefined;
}

function requiredOption(args: ParsedArgs, name: string): string {
  const value = option(args, name);
  if (!value) throw new CliUsageError(`缺少 --${name}。`);
  return value;
}

function environmentOption(args: ParsedArgs): BrowserEnvironment {
  const value = requiredOption(args, 'environment');
  if (!isBrowserEnvironment(value)) {
    throw new CliUsageError(`不支持的雨课堂环境：${value}`);
  }
  return value;
}

function numberValue(value: string, name: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) {
    throw new CliUsageError(`--${name} 必须是数字。`);
  }
  return result;
}

async function readStdinJson(): Promise<unknown> {
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  if (!text.trim()) throw new CliUsageError('stdin 中没有答案 JSON。');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CliUsageError('stdin 不是有效 JSON。');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof value[key] === 'string' ? value[key] : undefined;
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

class CliUsageError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}

main().catch((error: unknown) => {
  const payload =
    error instanceof DesktopCliError || error instanceof CliUsageError
      ? {
          code: error.code,
          message: error.message,
          ...('details' in error && error.details !== undefined
            ? { details: error.details }
            : {}),
        }
      : {
          code: 'INTERNAL_ERROR',
          message:
            error instanceof Error ? error.message : 'Unexpected CLI failure.',
        };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  if (error instanceof CliUsageError) process.stderr.write(`${usage}\n`);
  process.exitCode = 1;
});
