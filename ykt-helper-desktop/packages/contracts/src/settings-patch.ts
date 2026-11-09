import { ErrorCode, YuketangError } from './errors.js';
import type { BrowserEnvironment } from './browser.js';
import type { AppSettings } from './storage.js';

/**
 * GUI 可写的开关型设置。AI Profile 与当前选中项只能通过专门的
 * `ai profile` 命令维护，不允许塞进通用设置补丁。
 */
const BOOLEAN_KEYS = [
  'notifyProblems',
  'notifyProblemStarts',
  'notifyAssessmentPublishes',
  'notifyCoursewarePublishes',
  'notifyOtherPublishes',
  'notifyLessonFinished',
  'notifyAutoAnswerScheduled',
  'notifyAutoAnswerStarted',
  'notifyAutoAnswerSucceeded',
  'notifyAutoAnswerFailed',
  'notifyNative',
  'notifyPopup',
  'notifySound',
  'autoJoinEnabled',
  'llmAutoGenerate',
  'llmManagedSubmit',
  'keepScreenAwake',
  'aiAnalyzeLatestOnOpen',
  'aiSlidePickPriority',
  'aiCaptureCurrentPage',
  'iftex',
  'showAllSlides',
] as const satisfies readonly (keyof AppSettings)[];

/** 整数型设置的允许区间，单位与存储层一致（毫秒 / 字节 / 天 / 个）。 */
const INTEGER_RANGES = {
  notifyPopupDuration: { min: 2_000, max: 60_000 },
  autoAnswerDelay: { min: 1_000, max: 60_000 },
  autoAnswerRandomDelay: { min: 0, max: 30_000 },
  maxPresentations: { min: 1, max: 50 },
  cacheMaxBytes: { min: 64 * 1024 * 1024, max: 4096 * 1024 * 1024 },
  logRetentionDays: { min: 1, max: 365 },
} as const satisfies Record<
  string,
  { readonly min: number; readonly max: number }
>;

const STRING_KEYS = ['customNotifyAudioSrc', 'customNotifyAudioName'] as const;

const RESERVED_KEYS = new Set(['activeAiProfileId', 'aiProfiles']);

const ENVIRONMENTS = new Set<BrowserEnvironment>([
  'standard',
  'pro',
  'changjiang',
]);

function invalid(message: string): never {
  throw new YuketangError({ code: ErrorCode.InvalidArgument, message });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 校验来自外部（CLI / 未来其他入口）的设置补丁，规则与 GUI 设置页的
 * 前端约束保持一致；内部服务（如 AI Profile 管理）直接写存储层，
 * 不走此校验。
 */
export function assertSettingsPatch(
  patch: unknown,
): asserts patch is Partial<AppSettings> {
  if (!isPlainObject(patch)) {
    invalid('设置补丁必须是 JSON 对象。');
  }
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    invalid('设置补丁不能为空。');
  }

  for (const key of keys) {
    const value = patch[key];
    if (RESERVED_KEYS.has(key)) {
      invalid(`设置项 ${key} 只能通过 ai profile 相关命令修改。`);
    }
    if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') invalid(`设置项 ${key} 必须是布尔值。`);
      continue;
    }
    if ((STRING_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== 'string') invalid(`设置项 ${key} 必须是字符串。`);
      continue;
    }
    if (key === 'notifyVolume') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        invalid('设置项 notifyVolume 必须是数字。');
      }
      if (value < 0 || value > 1) {
        invalid('设置项 notifyVolume 必须在 0 到 1 之间。');
      }
      continue;
    }
    if (key === 'browserEnvironment') {
      if (value !== null && !ENVIRONMENTS.has(value as BrowserEnvironment)) {
        invalid(
          '设置项 browserEnvironment 必须是 standard、pro、changjiang 或 null。',
        );
      }
      continue;
    }
    const range = INTEGER_RANGES[key as keyof typeof INTEGER_RANGES];
    if (range) {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        invalid(`设置项 ${key} 必须是整数。`);
      }
      if (value < range.min || value > range.max) {
        invalid(`设置项 ${key} 必须在 ${range.min} 到 ${range.max} 之间。`);
      }
      continue;
    }
    invalid(`未知设置项：${key}。`);
  }
}
