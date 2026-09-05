// src/core/reminder-preferences.js

const EVENT_PREFERENCE_KEYS = {
  'problem-start': 'notifyProblemStarts',
  'assessment-publish': 'notifyAssessmentPublishes',
  'courseware-publish': 'notifyCoursewarePublishes',
  'other-publish': 'notifyOtherPublishes',
  'lesson-finished': 'notifyLessonFinished',
  'auto-answer-scheduled': 'notifyAutoAnswerScheduled',
  'auto-answer-started': 'notifyAutoAnswerStarted',
  'auto-answer-succeeded': 'notifyAutoAnswerSucceeded',
  'auto-answer-failed': 'notifyAutoAnswerFailed',
};

export const REMINDER_DEFAULTS = {
  // 兼容旧版工具栏铃铛：关闭后静音所有课堂提醒。
  notifyProblems: true,

  // 事件开关
  notifyProblemStarts: true,
  notifyAssessmentPublishes: true,
  notifyCoursewarePublishes: true,
  notifyOtherPublishes: true,
  notifyLessonFinished: true,
  notifyAutoAnswerScheduled: true,
  notifyAutoAnswerStarted: true,
  notifyAutoAnswerSucceeded: true,
  notifyAutoAnswerFailed: true,

  // 提醒方式开关
  notifyNative: true,
  notifyPopup: true,
  notifySound: true,
};

export const REMINDER_EVENT_OPTIONS = [
  {
    kind: 'problem-start',
    key: 'notifyProblemStarts',
    label: '新题 / 答题开始',
    detail: '老师开启一道可作答的习题时提醒。',
  },
  {
    kind: 'assessment-publish',
    key: 'notifyAssessmentPublishes',
    label: '考试 / 测试题组发布',
    detail: '老师发布测试、考试或题组时提醒。',
  },
  {
    kind: 'courseware-publish',
    key: 'notifyCoursewarePublishes',
    label: '新课件发布',
    detail: '只在老师发布新课件时提醒；翻阅旧课件和翻页不会提醒。',
  },
  {
    kind: 'other-publish',
    key: 'notifyOtherPublishes',
    label: '其他课堂发布',
    detail: '服务器发送无法细分的发布事件时提醒。',
  },
  {
    kind: 'lesson-finished',
    key: 'notifyLessonFinished',
    label: '课程结束',
    detail: '老师结束当前课程时提醒。',
  },
  {
    kind: 'auto-answer-scheduled',
    key: 'notifyAutoAnswerScheduled',
    label: '自动作答已排队',
    detail: '脚本已经为新题安排延迟作答时提醒。',
  },
  {
    kind: 'auto-answer-started',
    key: 'notifyAutoAnswerStarted',
    label: '自动作答开始',
    detail: '脚本开始调用本地或 AI 作答流程时提醒。',
  },
  {
    kind: 'auto-answer-succeeded',
    key: 'notifyAutoAnswerSucceeded',
    label: '自动作答成功',
    detail: '答案提交成功时提醒。',
  },
  {
    kind: 'auto-answer-failed',
    key: 'notifyAutoAnswerFailed',
    label: '自动作答失败',
    detail: '截图、AI 分析或提交失败时提醒。',
  },
];

export const REMINDER_CHANNEL_OPTIONS = [
  {
    key: 'notifyNative',
    label: '系统通知',
    detail: '调用浏览器 / 篡改猴的原生通知。',
  },
  {
    key: 'notifyPopup',
    label: '页面弹窗',
    detail: '在当前页面右下角显示提醒卡片。',
  },
  {
    key: 'notifySound',
    label: '提示声音',
    detail: '播放内置或自定义的提示音。',
  },
];

export const REMINDER_SETTING_KEYS = [
  'notifyProblems',
  ...REMINDER_EVENT_OPTIONS.map(item => item.key),
  ...REMINDER_CHANNEL_OPTIONS.map(item => item.key),
];

export function isReminderEnabled(kind, config = {}) {
  const key = EVENT_PREFERENCE_KEYS[kind];
  if (!key || config.notifyProblems === false) return false;
  return config[key] !== false;
}

export function getReminderChannels(config = {}) {
  return {
    native: config.notifyNative !== false,
    popup: config.notifyPopup !== false,
    sound: config.notifySound !== false,
  };
}

/** Keep an explicit 0-volume choice instead of falling back to the default. */
export function getReminderVolume(config = {}) {
  const rawValue = config.notifyVolume;
  if (rawValue === '' || rawValue === undefined || rawValue === null) return 0.6;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return 0.6;
  return Math.max(0, Math.min(1, value));
}
