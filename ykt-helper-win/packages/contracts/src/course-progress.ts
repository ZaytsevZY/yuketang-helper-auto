import type { BrowserEnvironment } from './browser.js';

export type CourseAttentionKind =
  | 'checkin-unrecorded'
  | 'live-unwatched'
  | 'replay-unwatched'
  | 'replay-incomplete';

export type CourseProgressRangeMonths = 1 | 3 | 6 | 12;

export function isCourseProgressRangeMonths(
  value: unknown,
): value is CourseProgressRangeMonths {
  return value === 1 || value === 3 || value === 6 || value === 12;
}

export interface CourseProgressItem {
  readonly lessonId: string;
  readonly classroomId: string;
  readonly courseName: string;
  readonly title: string;
  readonly startedAt: number | null;
  readonly url: string;
  readonly attention: readonly CourseAttentionKind[];
  readonly liveRate: number | null;
  readonly replayRate: number | null;
  readonly statusMessage: string | null;
}

export interface CourseProgressSnapshot {
  readonly environment: BrowserEnvironment;
  readonly rangeMonths: CourseProgressRangeMonths;
  readonly fetchedAt: number;
  readonly scannedLessons: number;
  readonly lessons: readonly CourseProgressItem[];
  readonly warnings: readonly string[];
}
