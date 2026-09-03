const ASSESSMENT_MARKERS = ['problem', 'quiz', 'exam', 'test', 'exercise', 'paper'];
const COURSEWARE_MARKERS = ['presentation', 'courseware', 'ppt', 'slide'];
const PUBLISH_ACTION = /^(send|publish|open|start|release)/;
const ENTITY_KEYS = [
  'quiz', 'exam', 'test', 'exercise', 'paper', 'problemGroup', 'problem_group',
  'problem', 'presentation', 'courseware', 'activity',
];
const NESTED_PAYLOAD_KEYS = ['data', 'payload', 'result', 'content'];

export const PUBLISH_REMINDER_DEFAULTS = {
  notifyAssessmentPublishes: true,
  notifyCoursewarePublishes: true,
  notifyOtherPublishes: true,
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
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function getIdentifier(message, entity, op) {
  return firstText(entity, [
    'id', 'uuid', 'quizId', 'quiz_id', 'examId', 'exam_id', 'testId', 'test_id',
    'exerciseId', 'exercise_id', 'presentationId', 'presentation_id', 'problemId',
    'problem_id', 'activityId', 'activity_id',
  ]) || firstText(message, [
    'id', 'uuid', 'quizId', 'quiz_id', 'examId', 'exam_id', 'testId', 'test_id',
    'exerciseId', 'exercise_id', 'presentationId', 'presentation_id', 'problemId',
    'problem_id', 'activityId', 'activity_id',
  ]) || op;
}

function getDetail(message, entity) {
  return firstText(entity, ['title', 'name', 'subject', 'label', 'body'])
    || firstText(message, ['title', 'name', 'subject', 'label'])
    || '教师发布了新的课堂内容';
}

function getCategory(op) {
  if (op === 'unlockproblem') return null;
  if (op === 'probleminfo' || includesOneOf(op, ASSESSMENT_MARKERS)) return 'assessment';
  if (includesOneOf(op, COURSEWARE_MARKERS)) return 'courseware';
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
  if (config.notifyProblems === false) return false;

  const key = {
    assessment: 'notifyAssessmentPublishes',
    courseware: 'notifyCoursewarePublishes',
    other: 'notifyOtherPublishes',
  }[event.category];

  return key ? config[key] !== false : false;
}

export function getRealtimeEvent(message) {
  const op = normalizeOp(message);

  if (op === 'fetchtimeline') return { kind: 'timeline', timeline: message?.timeline };
  if (op === 'unlockproblem') return { kind: 'unlockproblem', problem: message?.problem };
  if (op === 'lessonfinished') return { kind: 'lessonfinished' };

  const event = classifyPublishEvent(message);
  return event ? { kind: 'publish', event } : null;
}
