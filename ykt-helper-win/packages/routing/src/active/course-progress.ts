import {
  BrowserEnvironment,
  isCourseProgressRangeMonths,
  type CourseAttentionKind,
  type CourseProgressItem,
  type CourseProgressRangeMonths,
  type CourseProgressSnapshot,
} from '@ykt/contracts';

import { AssignmentAuthError } from './assignments.js';

const ORIGIN = 'https://pro.yuketang.cn';
const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const MAX_REPORTS = 80;
type JsonRecord = Record<string, unknown>;
type GetJson = (url: string) => Promise<unknown>;

interface Candidate {
  lessonId: string;
  classroomId: string;
  courseName: string;
  title: string;
  startedAt: number | null;
  attendStatus: boolean | null;
}

/** Read-only scan of ended lecture activities and their student reports. */
export async function fetchCourseProgress(
  get: GetJson,
  now: () => number,
  rangeMonths: CourseProgressRangeMonths = 1,
): Promise<CourseProgressSnapshot> {
  if (!isCourseProgressRangeMonths(rangeMonths))
    throw new Error('课程时间范围仅支持最近 1、3、6 或 12 个月。');
  const cutoffAt = monthsAgo(now(), rangeMonths);
  const courses = dataOf(
    await get(`${ORIGIN}/v2/api/web/courses/list?identity=2`),
  );
  if (!Array.isArray(courses.list))
    throw new Error('雨课堂课程列表格式异常，请重新登录荷塘雨课堂后重试。');
  const warnings: string[] = [];
  const candidates = new Map<string, Candidate>();
  const uniqueCourses = [
    ...new Map(
      courses.list.flatMap((value) => {
        const course = record(value);
        const classroomId = id(course?.classroom_id);
        return course && classroomId && course.role !== 6
          ? [[classroomId, course] as const]
          : [];
      }),
    ).values(),
  ];

  await mapConcurrent(uniqueCourses, async (course) => {
    const classroomId = id(course.classroom_id);
    const courseName =
      id(course.name) || id(record(course.course)?.name) || '雨课堂课程';
    try {
      const seenPages = new Set<string>();
      for (let page = 0; page < MAX_PAGES; page++) {
        const data = dataOf(
          await get(
            `${ORIGIN}/v2/api/web/logs/learn/${encodeURIComponent(classroomId)}?page=${page}&offset=${PAGE_SIZE}&sort=0&actype=-1`,
          ),
        );
        if (!Array.isArray(data.activities))
          throw new Error('学习日志格式异常');
        const signature = JSON.stringify(data.activities);
        if (seenPages.has(signature)) {
          warnings.push(`${courseName}：学习日志分页重复，结果可能不完整。`);
          break;
        }
        seenPages.add(signature);
        const activityTimes = data.activities.map((value) =>
          timestamp(record(value)?.create_time),
        );
        const pageIsNewestFirst = activityTimes.every(
          (time, index) =>
            time !== null &&
            (index === 0 || time <= (activityTimes[index - 1] ?? 0)),
        );
        for (const value of data.activities) {
          const activity = record(value);
          if (activity?.type !== 14 || activity.is_finished !== true) continue;
          const startedAt = timestamp(activity.create_time);
          if (startedAt === null || startedAt < cutoffAt) continue;
          const lessonId = id(activity.courseware_id);
          if (!/^\d+$/.test(lessonId)) continue;
          candidates.set(lessonId, {
            lessonId,
            classroomId,
            courseName,
            title: id(activity.title) || '未命名课堂',
            startedAt,
            attendStatus:
              typeof activity.attend_status === 'boolean'
                ? activity.attend_status
                : null,
          });
        }
        // sort=0 returns newest-first activities. Stop as soon as an ordered
        // page reaches the cutoff, so older pages are never requested.
        if (
          pageIsNewestFirst &&
          activityTimes.some((time) => time !== null && time < cutoffAt)
        )
          break;
        if (data.activities.length < PAGE_SIZE) break;
        if (page === MAX_PAGES - 1)
          warnings.push(
            `${courseName}：学习日志过多，仅检查了前 ${MAX_PAGES * PAGE_SIZE} 条活动。`,
          );
      }
    } catch (error) {
      if (error instanceof AssignmentAuthError) throw error;
      warnings.push(`${courseName}：部分学习日志读取失败，请刷新重试。`);
    }
  });

  const recent = [...candidates.values()].sort(
    (a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0),
  );
  if (recent.length > MAX_REPORTS)
    warnings.push(`课堂数量较多，本次仅核对最近 ${MAX_REPORTS} 节已结束课堂。`);
  const lessons = await mapConcurrent(
    recent.slice(0, MAX_REPORTS),
    async (item) => {
      try {
        const response = dataOf(
          await get(
            `${ORIGIN}/api/v3/classroom-report/student/detail?lesson_id=${encodeURIComponent(item.lessonId)}`,
          ),
        );
        return parseCourseProgress(item, response);
      } catch (error) {
        if (error instanceof AssignmentAuthError) throw error;
        warnings.push(`${item.courseName} · ${item.title}：学生报告读取失败。`);
        return toItem(
          item,
          [],
          null,
          null,
          '状态暂不可用，请刷新或在官网确认。',
        );
      }
    },
  );
  return {
    environment: BrowserEnvironment.Pro,
    rangeMonths,
    fetchedAt: now(),
    scannedLessons: candidates.size,
    lessons,
    warnings: [...new Set(warnings)],
  };
}

function monthsAgo(now: number, months: CourseProgressRangeMonths): number {
  const date = new Date(now);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() - months);
  const lastDay = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
  ).getDate();
  date.setDate(Math.min(day, lastDay));
  return date.getTime();
}

export function parseCourseProgress(
  item: Candidate,
  data: JsonRecord,
): CourseProgressItem {
  const detail = record(data.detail);
  const live = record(data.live);
  if (!detail)
    return toItem(item, [], null, null, '学生报告缺少考勤状态，请在官网确认。');
  const liveRate = positive(live?.lives_count)
    ? nonnegativeNumber(live?.live_rate)
    : null;
  const replayRate = positive(live?.replay_count)
    ? nonnegativeNumber(live?.replay_rate)
    : null;
  const attention: CourseAttentionKind[] = [];
  if (
    item.attendStatus === false &&
    zero(detail.checkInTime) &&
    detail.checkinSource === -1 &&
    detail.valid === 0
  )
    attention.push('checkin-unrecorded');
  if (
    positive(live?.lives_count) &&
    zero(liveRate) &&
    zero(live?.finish_live) &&
    zero(live?.finish_live_count)
  )
    attention.push('live-unwatched');
  if (positive(live?.replay_count) && zero(live?.finish_replay)) {
    if (zero(replayRate) && zero(live?.finish_replay_count))
      attention.push('replay-unwatched');
    else if (replayRate !== null && replayRate > 0)
      attention.push('replay-incomplete');
  }
  const statusMessage = !live
    ? '学生报告未提供观看状态。'
    : item.attendStatus === null
      ? '学习日志未提供签到状态，请在官网确认。'
      : null;
  return toItem(item, attention, liveRate, replayRate, statusMessage);
}

function toItem(
  item: Candidate,
  attention: readonly CourseAttentionKind[],
  liveRate: number | null,
  replayRate: number | null,
  statusMessage: string | null,
): CourseProgressItem {
  return {
    lessonId: item.lessonId,
    classroomId: item.classroomId,
    courseName: item.courseName,
    title: item.title,
    startedAt: item.startedAt,
    url: `${ORIGIN}/m/v2/lesson/student/${encodeURIComponent(item.lessonId)}/overview`,
    attention,
    liveRate,
    replayRate,
    statusMessage,
  };
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (!failed && cursor < items.length) {
        const index = cursor++;
        try {
          results[index] = await task(items[index]!);
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
      }
    }),
  );
  if (failed) throw failure;
  return results;
}

function dataOf(value: unknown): JsonRecord {
  const root = record(value);
  if (
    !root ||
    (root.code !== undefined && root.code !== 0) ||
    (root.errcode !== undefined && root.errcode !== 0)
  )
    throw new Error('雨课堂返回了无效数据。');
  const data = record(root.data);
  if (!data) throw new Error('雨课堂响应缺少 data。');
  return data;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function id(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function nonnegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function zero(value: unknown): boolean {
  return value === 0;
}

function positive(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
