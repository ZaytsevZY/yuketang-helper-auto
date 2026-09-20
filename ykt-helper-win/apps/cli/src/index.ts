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
  ykt settings update --from -
  ykt settings reset
  ykt user get --environment <standard|pro|changjiang> [--refresh]
  ykt assignment list [--environment pro] [--refresh]
  ykt lesson list [--environment <standard|pro|changjiang|all>] [--refresh]
  ykt lesson connect <lesson-id> --environment <standard|pro|changjiang>
  ykt presentation list --lesson <lesson-id>
  ykt presentation export <presentation-id> --lesson <lesson-id> --out <path.pdf>
  ykt slide get <slide-id> --lesson <lesson-id> [--presentation <id>]
  ykt slide read <slide-id> --lesson <lesson-id> [--presentation <id>]
  ykt slide download <slide-id> --lesson <lesson-id> [--presentation <id>] --out <path>
  ykt problem list --lesson <lesson-id>
  ykt problem get <problem-id>
  ykt ai profile list
  ykt ai profile connect --base-url <url> --api-key <key|-> [--provider <id>]
  ykt ai profile assign <profile-id> --model <m> --vision-model <m> --ocr-model <m> --translation-model <m> --temperature <number|null>
  ykt ai profile select <profile-id>
  ykt ai profile refresh <profile-id>
  ykt ai profile delete <profile-id>
  ykt ai ask --prompt <text|-> [--problem <problem-id>] [--context <id>] [--session <id>] [--images <url,url>] [--capture-page] [--retry]
  ykt ai translate --text <text|-> --to <language>
  ykt answer propose <problem-id> [--prompt <text>]
  ykt answer validate <problem-id> --from -
  ykt answer submit <problem-id> --from - --commit [--proposal <id>] [--confirmed-by <user|agent>] [--force-retry]
  ykt simulate <reset|show-slide|publish-courseware|publish-problem-object|publish-problem-scalar|finish-lesson>
  ykt simulate state
  ykt source open <renderer|ipc|backend|routing|storage>
  ykt browser state
  ykt browser environment <standard|pro|changjiang>
  ykt browser open <url>
  ykt browser back | forward | reload | home
  ykt browser tab-new
  ykt browser tab <tab-id>
  ykt browser tab-close <tab-id>
  ykt layout [--assistant <collapsed|expanded>] [--network-lab <collapsed|expanded>]
  ykt network snapshot
  ykt network pause | resume | clear
  ykt network deep-capture <on|off>
  ykt network export --out <path.json>
  ykt logs list [--limit <number>]

Conventions:
  '-' reads text/JSON from stdin (prompts, translations, API keys, answer JSON).
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
  const [group, action, id, extra] = args.positionals;

  if (group === 'status' && action === undefined) {
    return requestDesktop(CliRpcMethod.Status);
  }

  if (group === 'settings') {
    if (action === 'get') return requestDesktop(CliRpcMethod.SettingsGet);
    if (action === 'reset') return requestDesktop(CliRpcMethod.SettingsReset);
    if (action === 'update') {
      if (option(args, 'from') !== '-') {
        throw new CliUsageError(
          '设置更新必须通过 --from - 从 stdin 读取 JSON。',
        );
      }
      const patch = await readStdinJson();
      if (!isRecord(patch) || Array.isArray(patch)) {
        throw new CliUsageError('stdin 必须是 JSON 设置对象。');
      }
      return requestDesktop(CliRpcMethod.SettingsUpdate, json(patch));
    }
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

  if (group === 'assignment' && action === 'list') {
    return requestDesktop(
      CliRpcMethod.AssignmentList,
      json({
        environment: option(args, 'environment') ?? 'pro',
        refresh: args.options.has('refresh'),
      }),
    );
  }

  if (group === 'lesson') {
    if (action === 'list') {
      return requestDesktop(
        CliRpcMethod.LessonList,
        json({
          environment: option(args, 'environment') ?? 'all',
          refresh: args.options.has('refresh'),
        }),
      );
    }
    if (action === 'connect' && id) {
      return requestDesktop(
        CliRpcMethod.LessonConnect,
        json({ id, environment: environmentOption(args) }),
      );
    }
  }

  if (group === 'presentation') {
    if (action === 'list') {
      return requestDesktop(
        CliRpcMethod.PresentationList,
        json({ lessonId: requiredOption(args, 'lesson') }),
      );
    }
    if (action === 'export' && id) {
      return requestDesktop(
        CliRpcMethod.PresentationExport,
        json({
          lessonId: requiredOption(args, 'lesson'),
          presentationId: id,
          filePath: requiredOption(args, 'out'),
        }),
      );
    }
  }

  if (
    group === 'slide' &&
    id &&
    ['get', 'read', 'download'].includes(action ?? '')
  ) {
    const params = json({
      lessonId: requiredOption(args, 'lesson'),
      slideId: id,
      ...(option(args, 'presentation')
        ? { presentationId: option(args, 'presentation') }
        : {}),
      ...(action === 'download'
        ? { filePath: requiredOption(args, 'out') }
        : {}),
    });
    const method =
      action === 'get'
        ? CliRpcMethod.SlideGet
        : action === 'read'
          ? CliRpcMethod.SlideRead
          : CliRpcMethod.SlideDownload;
    return requestDesktop(method, params);
  }

  if (group === 'problem') {
    if (action === 'list') {
      return requestDesktop(
        CliRpcMethod.ProblemList,
        json({ lessonId: requiredOption(args, 'lesson') }),
      );
    }
    if (action === 'get' && id) {
      return requestDesktop(CliRpcMethod.ProblemGet, json({ id }));
    }
  }

  if (group === 'ai') {
    if (action === 'profile') return executeProfile(args, id, extra);
    if (action === 'ask') return executeAsk(args);
    if (action === 'translate') return executeTranslate(args);
  }

  if (group === 'answer') {
    if (action === 'propose' && id) {
      const customPrompt = option(args, 'prompt');
      return requestDesktop(
        CliRpcMethod.AnswerPropose,
        json({ problemId: id, ...(customPrompt ? { customPrompt } : {}) }),
      );
    }
    if (action === 'validate' && id) {
      return requestDesktop(
        CliRpcMethod.AnswerValidate,
        await answerInput(args, id, false),
      );
    }
    if (action === 'submit' && id) {
      if (!args.options.has('commit')) {
        throw new CliUsageError('提交答案必须显式提供 --commit。');
      }
      return requestDesktop(
        CliRpcMethod.AnswerSubmit,
        await answerInput(args, id, true),
      );
    }
  }

  if (group === 'simulate' && action) {
    if (action === 'state') {
      return requestDesktop(CliRpcMethod.DebugGetSimulation);
    }
    const actions = [
      'reset',
      'show-slide',
      'publish-courseware',
      'publish-problem-object',
      'publish-problem-scalar',
      'finish-lesson',
    ];
    if (!actions.includes(action)) {
      throw new CliUsageError(`不支持的模拟动作：${action}`);
    }
    return requestDesktop(CliRpcMethod.DebugSimulate, json({ action }));
  }

  if (group === 'source') {
    if (action === 'open' && id) {
      return requestDesktop(CliRpcMethod.SourceOpenModule, json({ id }));
    }
    throw new CliUsageError(
      '用法：ykt source open <renderer|ipc|backend|routing|storage>',
    );
  }

  if (group === 'browser') return executeBrowser(args, action, id);

  if (group === 'layout') return executeLayout(args);

  if (group === 'network') return executeNetwork(args, action);

  if (group === 'logs' && action === 'list') {
    const limit = option(args, 'limit');
    return requestDesktop(
      CliRpcMethod.LogsList,
      json(limit === undefined ? {} : { limit: numberValue(limit, 'limit') }),
    );
  }

  throw new CliUsageError(`未知命令：${args.positionals.join(' ')}`);
}

async function executeProfile(
  args: ParsedArgs,
  subAction: string | undefined,
  profileId: string | undefined,
): Promise<JsonValue> {
  if (subAction === undefined || subAction === 'list') {
    return requestDesktop(CliRpcMethod.AiProfileList);
  }
  if (subAction === 'connect') {
    const baseUrl = requiredOption(args, 'base-url');
    const apiKeyOption = requiredOption(args, 'api-key');
    const apiKey =
      apiKeyOption === '-' ? (await readStdinText()).trim() : apiKeyOption;
    if (!apiKey) throw new CliUsageError('API key 不能为空。');
    return requestDesktop(
      CliRpcMethod.AiProfileConnect,
      json({
        baseUrl,
        apiKey,
        ...(option(args, 'provider')
          ? { providerId: option(args, 'provider') }
          : {}),
      }),
    );
  }
  if (!profileId) {
    throw new CliUsageError(`ai profile ${subAction} 需要提供 profile id。`);
  }
  if (subAction === 'refresh') {
    return requestDesktop(
      CliRpcMethod.AiProfileRefresh,
      json({ id: profileId }),
    );
  }
  if (subAction === 'select') {
    return requestDesktop(
      CliRpcMethod.AiProfileSelect,
      json({ id: profileId }),
    );
  }
  if (subAction === 'delete') {
    return requestDesktop(
      CliRpcMethod.AiProfileDelete,
      json({ id: profileId }),
    );
  }
  if (subAction === 'assign') {
    const temperatureRaw = requiredOption(args, 'temperature');
    const temperature =
      temperatureRaw === 'null'
        ? null
        : numberValue(temperatureRaw, 'temperature');
    return requestDesktop(
      CliRpcMethod.AiProfileUpdateSelection,
      json({
        id: profileId,
        model: requiredOption(args, 'model'),
        visionModel: requiredOption(args, 'vision-model'),
        ocrModel: requiredOption(args, 'ocr-model'),
        translationModel: requiredOption(args, 'translation-model'),
        temperature,
      }),
    );
  }
  throw new CliUsageError(`未知 profile 命令：${subAction}`);
}

async function executeAsk(args: ParsedArgs): Promise<JsonValue> {
  const promptOption = requiredOption(args, 'prompt');
  const prompt = promptOption === '-' ? await readStdinText() : promptOption;
  if (!prompt.trim()) throw new CliUsageError('提问内容不能为空。');
  const images = (option(args, 'images') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return requestDesktop(
    CliRpcMethod.AiAsk,
    json({
      prompt,
      ...(option(args, 'problem')
        ? { problemId: option(args, 'problem') }
        : {}),
      ...(option(args, 'context')
        ? { contextId: option(args, 'context') }
        : {}),
      ...(option(args, 'session')
        ? { sessionId: option(args, 'session') }
        : {}),
      ...(images.length ? { images } : {}),
      ...(args.options.has('capture-page') ? { captureCurrentPage: true } : {}),
      ...(args.options.has('retry') ? { retry: true } : {}),
    }),
  );
}

async function executeTranslate(args: ParsedArgs): Promise<JsonValue> {
  const textOption = requiredOption(args, 'text');
  const text = textOption === '-' ? await readStdinText() : textOption;
  if (!text.trim()) throw new CliUsageError('翻译内容不能为空。');
  return requestDesktop(
    CliRpcMethod.AiTranslate,
    json({ text, targetLanguage: requiredOption(args, 'to') }),
  );
}

async function executeBrowser(
  args: ParsedArgs,
  action: string | undefined,
  id: string | undefined,
): Promise<JsonValue> {
  switch (action) {
    case undefined:
    case 'state':
      return requestDesktop(CliRpcMethod.BrowserState);
    case 'environment': {
      const value = requiredPositional(
        id,
        '环境名称（standard|pro|changjiang）',
      );
      if (!isBrowserEnvironment(value)) {
        throw new CliUsageError(`不支持的雨课堂环境：${value}`);
      }
      return requestDesktop(
        CliRpcMethod.BrowserSelectEnvironment,
        json({ environment: value }),
      );
    }
    case 'open':
      return requestDesktop(
        CliRpcMethod.BrowserNavigate,
        json({ url: requiredPositional(id, 'url') }),
      );
    case 'back':
      return requestDesktop(CliRpcMethod.BrowserBack);
    case 'forward':
      return requestDesktop(CliRpcMethod.BrowserForward);
    case 'reload':
      return requestDesktop(CliRpcMethod.BrowserReload);
    case 'home':
      return requestDesktop(CliRpcMethod.BrowserHome);
    case 'tab-new':
      return requestDesktop(CliRpcMethod.BrowserNewTab);
    case 'tab':
      return requestDesktop(
        CliRpcMethod.BrowserActivateTab,
        json({ id: requiredPositional(id, 'tab id') }),
      );
    case 'tab-close':
      return requestDesktop(
        CliRpcMethod.BrowserCloseTab,
        json({ id: requiredPositional(id, 'tab id') }),
      );
    default:
      throw new CliUsageError(`未知 browser 命令：${action}`);
  }
}

async function executeLayout(args: ParsedArgs): Promise<JsonValue> {
  const params: Record<string, boolean> = {};
  const assistant = option(args, 'assistant');
  const networkLab = option(args, 'network-lab');
  if (assistant === undefined && networkLab === undefined) {
    throw new CliUsageError(
      '至少提供 --assistant collapsed|expanded 或 --network-lab collapsed|expanded。',
    );
  }
  if (assistant !== undefined)
    params.assistantCollapsed = collapsedValue(assistant);
  if (networkLab !== undefined)
    params.networkLabCollapsed = collapsedValue(networkLab);
  return requestDesktop(CliRpcMethod.LayoutSetPanels, json(params));
}

async function executeNetwork(
  args: ParsedArgs,
  action: string | undefined,
): Promise<JsonValue> {
  switch (action) {
    case 'snapshot':
      return requestDesktop(CliRpcMethod.NetworkSnapshot);
    case 'pause':
      return requestDesktop(
        CliRpcMethod.NetworkSetPaused,
        json({ paused: true }),
      );
    case 'resume':
      return requestDesktop(
        CliRpcMethod.NetworkSetPaused,
        json({ paused: false }),
      );
    case 'clear':
      return requestDesktop(CliRpcMethod.NetworkClear);
    case 'deep-capture': {
      const value = requiredPositional(args.positionals[2], 'on 或 off');
      if (value !== 'on' && value !== 'off') {
        throw new CliUsageError('deep-capture 只接受 on 或 off。');
      }
      return requestDesktop(
        CliRpcMethod.NetworkSetDeepCapture,
        json({ enabled: value === 'on' }),
      );
    }
    case 'export':
      return requestDesktop(
        CliRpcMethod.NetworkExport,
        json({ filePath: requiredOption(args, 'out') }),
      );
    default:
      throw new CliUsageError(`未知 network 命令：${action ?? ''}`);
  }
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

function requiredPositional(value: string | undefined, label: string): string {
  if (!value) throw new CliUsageError(`缺少参数：${label}`);
  return value;
}

function collapsedValue(value: string): boolean {
  if (value === 'collapsed') return true;
  if (value === 'expanded') return false;
  throw new CliUsageError('取值只能是 collapsed 或 expanded。');
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

async function readStdinText(): Promise<string> {
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text.replace(/\r?\n$/, '');
}

async function readStdinJson(): Promise<unknown> {
  const text = await readStdinText();
  if (!text.trim()) throw new CliUsageError('stdin 中没有内容。');
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
