import { REMINDER_DEFAULTS, isReminderEnabled } from './reminder-preferences.js';

const ASSESSMENT_MARKERS = ['problem', 'quiz', 'exam', 'test', 'exercise', 'paper'];
const COURSEWARE_MARKERS = ['presentation', 'courseware', 'ppt', 'slide'];
const PUBLISH_ACTION = /^(send|publish|open|start|release)/;
const COURSEWARE_PUBLISH_ACTION = /^(send|publish|release)/;
const ASSESSMENT_PUBLISH_ACTION = /^(send|publish|start|release)/;
const ENTITY_KEYS = [
  'quiz', 'exam', 'test', 'exercise', 'paper', 'problemGroup', 'problem_group',
  'problem', 'presentation', 'courseware', 'activity',
];
const NESTED_PAYLOAD_KEYS = ['data', 'payload', 'result', 'content'];

// 保留导出，避免其他脚本依赖旧名称；真实配置集中在 reminder-preferences。
export const PUBLISH_REMINDER_DEFAULTS = {
  notifyAssessmentPublishes: REMINDER_DEFAULTS.notifyAssessmentPublishes,
  notifyCoursewarePublishes: REMINDER_DEFAULTS.notifyCoursewarePublishes,
  notifyOtherPublishes: REMINDER_DEFAULTS.notifyOtherPublishes,
};

function normalizeOp(message) {
  return String(message?.op || message?.type || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function includesOneOf(value, markers) {
  return markers.some(marker => value.includes(marker));
}

function getEntity(message) {
  const queue = [message];
  const visited = new Set();
  let fallback = message && typeof message === 'object' ? message : {};

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);

    for (const key of ENTITY_KEYS) {
      const entity = current[key];
      if (entity && typeof entity === 'object') return entity;
    }

    for (const key of NESTED_PAYLOAD_KEYS) {
      const nested = current[key];
      if (nested && typeof nested === 'object') {
        fallback = nested;
        if (Array.isArray(nested)) queue.push(...nested);
        else queue.push(nested);
      }
    }
  }

  return fallback;
}

function firstText(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value === undefined || value === null || typeof value === 'object') continue;
    if (String(value).trim()) return String(value).trim();
  }
  return '';
}

const IDENTIFIER_KEYS = [
  'id', 'uuid', 'quizId', 'quiz_id', 'examId', 'exam_id', 'testId', 'test_id',
  'exerciseId', 'exercise_id', 'presentationId', 'presentation_id', 'problemId',
  'problem_id', 'problemid', 'presentation', 'activityId', 'activity_id',
];

function findNestedText(source, keys) {
  const queue = [source];
  const visited = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);

    const value = firstText(current, keys);
    if (value) return value;

    for (const key of NESTED_PAYLOAD_KEYS) {
      const nested = current[key];
      if (Array.isArray(nested)) queue.push(...nested);
      else if (nested && typeof nested === 'object') queue.push(nested);
    }
  }

  return '';
}

function getIdentifier(message, entity, op) {
  return firstText(entity, IDENTIFIER_KEYS)
    || findNestedText(message, IDENTIFIER_KEYS)
    || op;
}

function getDetail(message, entity) {
  return firstText(entity, ['title', 'name', 'subject', 'label', 'body'])
    || firstText(message, ['title', 'name', 'subject', 'label'])
    || '教师发布了新的课堂内容';
}

function getCategory(op) {
  if (op === 'unlockproblem') return null;
  if (op === 'probleminfo') return 'assessment';
  // 结果、关闭、展示、更新等操作同样会带 problem，不能当成新题发布。
  if (includesOneOf(op, ASSESSMENT_MARKERS)) {
    return ASSESSMENT_PUBLISH_ACTION.test(op) ? 'assessment' : null;
  }
  // 打开旧课件、翻页等操作也会带 presentation/slide，不能误落入通用发布提醒。
  if (includesOneOf(op, COURSEWARE_MARKERS)) {
    return COURSEWARE_PUBLISH_ACTION.test(op) ? 'courseware' : null;
  }
  if (PUBLISH_ACTION.test(op)) return 'other';
  return null;
}

export function classifyPublishEvent(message) {
  const op = normalizeOp(message);
  const category = getCategory(op);
  if (!category) return null;

  const entity = getEntity(message);
  const id = getIdentifier(message, entity, op);
  const detail = getDetail(message, entity);
  const title = {
    assessment: '考试/测试题组已发布',
    courseware: '课件已发布',
    other: '课堂内容已发布',
  }[category];

  return {
    category,
    dedupeKey: `${category}:${id}`,
    title,
    detail,
  };
}

export function isPublishReminderEnabled(event, config = {}) {
  if (!event?.category) return false;
  const kind = {
    assessment: 'assessment-publish',
    courseware: 'courseware-publish',
    other: 'other-publish',
  }[event.category];
  return kind ? isReminderEnabled(kind, config) : false;
}

export function getRealtimeEvent(message) {
  const op = normalizeOp(message);

  if (op === 'fetchtimeline') return { kind: 'timeline', timeline: message?.timeline };
  if (op === 'unlockproblem') {
    const rawProblem = message?.problem;
    const problem = rawProblem && typeof rawProblem === 'object'
      ? { ...message, ...rawProblem }
      : { ...message, prob: message?.prob ?? rawProblem ?? message?.problemid };
    return { kind: 'unlockproblem', problem };
  }
  if (op === 'lessonfinished') return { kind: 'lessonfinished' };

  const event = classifyPublishEvent(message);
  return event ? { kind: 'publish', event } : null;
}
