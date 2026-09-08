import type { ClassroomNotice } from '@ykt/contracts';

type RealtimeEvent =
  | { kind: 'timeline'; timeline: unknown }
  | { kind: 'unlockproblem'; problem: Record<string, unknown> }
  | { kind: 'lessonfinished' }
  | {
      kind: 'publish';
      notice: Omit<ClassroomNotice, 'lessonId' | 'occurredAt'>;
    }
  | null;

const assessmentMarkers = [
  'problem',
  'quiz',
  'exam',
  'test',
  'exercise',
  'paper',
];
const coursewareMarkers = ['presentation', 'courseware', 'ppt', 'slide'];
const publishAction = /^(send|publish|open|start|release)/;
const assessmentPublishAction = /^(send|publish|start|release)/;
const coursewarePublishAction = /^(send|publish|release)/;
const nestedKeys = ['data', 'payload', 'result', 'content'];
const entityKeys = [
  'quiz',
  'exam',
  'test',
  'exercise',
  'paper',
  'problemGroup',
  'problem_group',
  'problem',
  'presentation',
  'courseware',
  'activity',
];

export function getRealtimeEvent(
  message: Record<string, unknown>,
): RealtimeEvent {
  const op = normalizeOp(message);
  if (op === 'fetchtimeline') {
    return { kind: 'timeline', timeline: message.timeline };
  }
  if (op === 'unlockproblem') {
    const rawProblem = message.problem;
    return {
      kind: 'unlockproblem',
      problem:
        rawProblem &&
        typeof rawProblem === 'object' &&
        !Array.isArray(rawProblem)
          ? { ...message, ...(rawProblem as Record<string, unknown>) }
          : {
              ...message,
              prob: message.prob ?? rawProblem ?? message.problemid,
            },
    };
  }
  if (op === 'lessonfinished') return { kind: 'lessonfinished' };

  const category = publishCategory(op);
  if (!category) return null;
  const entity = findEntity(message);
  const id =
    firstText(entity, identifierKeys) ||
    findNestedText(message, identifierKeys) ||
    op;
  const detail =
    firstText(entity, ['title', 'name', 'subject', 'label', 'body']) ||
    firstText(message, ['title', 'name', 'subject', 'label']) ||
    '教师发布了新的课堂内容';
  const kind = `${category}-publish` as const;
  const title = {
    assessment: '考试/测试题组已发布',
    courseware: '课件已发布',
    other: '课堂内容已发布',
  }[category];
  return {
    kind: 'publish',
    notice: {
      kind,
      dedupeKey: `${category}:${id}`,
      title,
      detail,
    },
  };
}

function publishCategory(
  op: string,
): 'assessment' | 'courseware' | 'other' | null {
  if (op === 'probleminfo') return 'assessment';
  if (assessmentMarkers.some((marker) => op.includes(marker))) {
    return assessmentPublishAction.test(op) ? 'assessment' : null;
  }
  if (coursewareMarkers.some((marker) => op.includes(marker))) {
    return coursewarePublishAction.test(op) ? 'courseware' : null;
  }
  return publishAction.test(op) ? 'other' : null;
}

function normalizeOp(message: Record<string, unknown>): string {
  return String(message.op ?? message.type ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function findEntity(message: Record<string, unknown>): Record<string, unknown> {
  const queue: unknown[] = [message];
  const visited = new Set<object>();
  let fallback = message;
  while (queue.length) {
    const current = record(queue.shift());
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const key of entityKeys) {
      const entity = record(current[key]);
      if (entity) return entity;
    }
    for (const key of nestedKeys) {
      const nested = current[key];
      const nestedRecord = record(nested);
      if (nestedRecord) fallback = nestedRecord;
      if (Array.isArray(nested)) queue.push(...nested);
      else if (nestedRecord) queue.push(nestedRecord);
    }
  }
  return fallback;
}

const identifierKeys = [
  'id',
  'uuid',
  'quizId',
  'quiz_id',
  'examId',
  'exam_id',
  'testId',
  'test_id',
  'exerciseId',
  'exercise_id',
  'presentationId',
  'presentation_id',
  'problemId',
  'problem_id',
  'problemid',
  'problem',
  'presentation',
  'activityId',
  'activity_id',
];

function firstText(
  source: Record<string, unknown>,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = source[key];
    if (
      value !== undefined &&
      value !== null &&
      typeof value !== 'object' &&
      String(value).trim()
    ) {
      return String(value).trim();
    }
  }
  return '';
}

function findNestedText(
  source: Record<string, unknown>,
  keys: readonly string[],
): string {
  const queue: unknown[] = [source];
  const visited = new Set<object>();
  while (queue.length) {
    const current = record(queue.shift());
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const value = firstText(current, keys);
    if (value) return value;
    for (const key of nestedKeys) {
      const nested = current[key];
      if (Array.isArray(nested)) queue.push(...nested);
      else if (record(nested)) queue.push(nested);
    }
  }
  return '';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
