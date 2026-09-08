import {
  BrowserEnvironment,
  ProblemType,
  type AnswerValue,
  type Presentation,
  type Problem,
  type Slide,
} from '@ykt/contracts';

import type {
  ActiveLesson,
  ActiveUser,
  CheckinResult,
  HostAdapter,
} from './types.js';

const ADAPTERS = {
  [BrowserEnvironment.Standard]: createAdapter(
    BrowserEnvironment.Standard,
    'https://www.yuketang.cn',
  ),
  [BrowserEnvironment.Pro]: createAdapter(
    BrowserEnvironment.Pro,
    'https://pro.yuketang.cn',
  ),
  [BrowserEnvironment.Changjiang]: createAdapter(
    BrowserEnvironment.Changjiang,
    'https://changjiang.yuketang.cn',
  ),
} as const;

export function hostAdapterFor(environment: BrowserEnvironment): HostAdapter {
  return ADAPTERS[environment];
}

function createAdapter(
  environment: BrowserEnvironment,
  origin: string,
): HostAdapter {
  return {
    environment,
    origin,
    webSocketUrl: `${origin.replace('https:', 'wss:')}/wsapp/`,
    userUrl: `${origin}/api/v3/user/basic-info`,
    onLessonUrl: `${origin}/api/v3/classroom/on-lesson`,
    checkinUrl: `${origin}/api/v3/lesson/checkin`,
    answerUrl: `${origin}/api/v3/lesson/problem/answer`,
    retryUrl: `${origin}/api/v3/lesson/problem/retry`,
    presentationUrl: (id) =>
      `${origin}/api/v3/lesson/presentation/fetch?presentation_id=${encodeURIComponent(id)}`,
    parseUser,
    parseLessons,
    parseCheckin,
    parsePresentation,
  };
}

function parseUser(value: unknown): ActiveUser {
  const data = unwrap(value);
  const user = record(data.userInfo) ?? record(data.user_info) ?? data;
  const id = stringId(user.userId ?? user.user_id ?? user.id);
  if (!id) throw new Error('User response does not contain an id.');
  return {
    id,
    name: stringValue(user.name ?? user.nickname ?? user.nickName),
  };
}

function parseLessons(value: unknown): readonly ActiveLesson[] {
  const root = record(value);
  if (!root) throw new Error('Response is not an object.');
  const payload = root.data ?? root.result ?? root;
  const data = record(payload);
  const raw =
    array(payload) ??
    array(data?.onLessonClassrooms) ??
    array(data?.on_lesson_classrooms) ??
    [];
  return raw.flatMap((item) => {
    const lesson = record(item);
    if (!lesson) return [];
    const id = stringId(lesson.lessonId ?? lesson.lesson_id ?? lesson.id);
    if (!id) return [];
    return [
      {
        id,
        title: stringValue(
          lesson.title ??
            lesson.lessonName ??
            lesson.lesson_name ??
            lesson.name,
        ),
        status: Number(lesson.status) === 1 ? 'active' : 'upcoming',
        classroomId:
          stringId(lesson.classroomId ?? lesson.classroom_id) ?? null,
        presentationId:
          stringId(lesson.presentationId ?? lesson.presentation_id) ?? null,
      } satisfies ActiveLesson,
    ];
  });
}

function parseCheckin(value: unknown, now: number): CheckinResult {
  const data = unwrap(value);
  const lessonToken = stringValue(data.lessonToken ?? data.lesson_token);
  if (!lessonToken) throw new Error('Checkin response has no lesson token.');
  const expiresAt = normalizeTimestamp(
    data.expiresAt ?? data.expires_at ?? data.expireTime ?? data.expire_time,
  );
  const expiresIn = numberValue(data.expiresIn ?? data.expires_in);
  return {
    lessonToken,
    expiresAt:
      expiresAt ?? (expiresIn === null ? null : now + expiresIn * 1000),
  };
}

function parsePresentation(
  value: unknown,
  lessonId: string,
  presentationId: string,
): Presentation {
  const data = unwrap(value);
  const slides = array(data.slides) ?? array(data.pages) ?? [];
  return {
    id:
      stringId(data.id ?? data.presentationId ?? data.presentation_id) ??
      presentationId,
    lessonId,
    title: stringValue(data.title ?? data.name),
    width: numberValue(data.width),
    height: numberValue(data.height),
    slides: slides.map((value, index) =>
      parseSlide(value, index, lessonId, presentationId),
    ),
  };
}

function parseSlide(
  value: unknown,
  fallbackIndex: number,
  lessonId: string,
  presentationId: string,
): Slide {
  const slide = record(value) ?? {};
  const id =
    stringId(slide.id ?? slide.slideId ?? slide.slide_id) ??
    `${presentationId}-${fallbackIndex}`;
  return {
    id,
    index: numberValue(slide.index ?? slide.pageIndex) ?? fallbackIndex,
    title: stringValue(slide.title),
    imageUrl:
      nullableString(slide.imageUrl ?? slide.image_url ?? slide.cover) ?? null,
    problem: slide.problem
      ? parseProblem(slide.problem, lessonId, presentationId, id)
      : null,
  };
}

function parseProblem(
  value: unknown,
  lessonId: string,
  presentationId: string,
  slideId: string,
): Problem | null {
  const problem = record(value);
  if (!problem) return null;
  const id = stringId(problem.problemId ?? problem.problem_id ?? problem.id);
  if (!id) return null;
  const options =
    array(problem.options ?? problem.answers)?.map(optionText) ?? [];
  return {
    id,
    lessonId,
    presentationId,
    slideId,
    type: problemType(
      problem.problemType ?? problem.problem_type ?? problem.type,
    ),
    prompt: stringValue(problem.prompt ?? problem.content ?? problem.body),
    options,
    blanks: array(problem.blanks)?.map(stringValue) ?? [],
    result: parseAnswer(problem.result),
  };
}

function problemType(value: unknown): ProblemType {
  const numeric = Number(value);
  const values = [
    ProblemType.Unknown,
    ProblemType.SingleChoice,
    ProblemType.MultipleChoice,
    ProblemType.Poll,
    ProblemType.FillBlank,
    ProblemType.Subjective,
  ];
  return (
    values[numeric] ??
    (Object.values(ProblemType).includes(value as ProblemType)
      ? (value as ProblemType)
      : ProblemType.Unknown)
  );
}

function parseAnswer(value: unknown): AnswerValue | null {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  const answer = record(value);
  if (!answer || typeof answer.content !== 'string') return null;
  return {
    content: answer.content,
    pics: array(answer.pics)?.map(stringValue) ?? [],
  };
}

function optionText(value: unknown): string {
  const option = record(value);
  return option
    ? stringValue(option.content ?? option.text ?? option.value)
    : stringValue(value);
}

function unwrap(value: unknown): Record<string, unknown> {
  const root = record(value);
  if (!root) throw new Error('Response is not an object.');
  return record(root.data) ?? record(root.result) ?? root;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function array(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function stringId(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function numberValue(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function normalizeTimestamp(value: unknown): number | null {
  const result = numberValue(value);
  if (result === null) return null;
  return Math.abs(result) < 100_000_000_000 ? result * 1000 : result;
}
