import type { BrowserEnvironment } from './browser.js';

export type AssignmentStatus =
  'unanswered' | 'partial' | 'answered' | 'unknown';

export interface AssignmentQuestionStatus {
  readonly id: string;
  readonly index: number;
  readonly answered: boolean | null;
}

/** Read-only learning-log metadata; question bodies are fetched separately on demand. */
export interface Assignment {
  readonly id: string;
  readonly classroomId: string;
  readonly leafTypeId?: string;
  readonly skuId?: string;
  readonly courseName: string;
  readonly title: string;
  readonly kind: 'homework' | 'exam';
  /** Unix milliseconds, as returned by content.score_d; null means unavailable. */
  readonly deadline: number | null;
  readonly url: string;
  readonly status: AssignmentStatus;
  /** Null means grading evidence is unavailable, not that grading is pending. */
  readonly graded: boolean | null;
  readonly score: number | null;
  readonly totalScore: number | null;
  readonly audited: boolean;
  /** Cover-level exam outcome, independent of whether every question was answered. */
  readonly examStatus?: 'submitted' | 'absent' | 'invalid' | 'unknown';
  readonly answeredCount: number | null;
  readonly totalCount: number | null;
  readonly questions: readonly AssignmentQuestionStatus[];
  readonly statusMessage: string | null;
}

export interface AssignmentSnapshot {
  readonly environment: BrowserEnvironment;
  readonly fetchedAt: number;
  readonly assignments: readonly Assignment[];
  /** Partial course failures or truncated logs must remain visible to the user. */
  readonly warnings: readonly string[];
}

/** Three calendar months, clamped at month-end and independent of host timezone. */
export function assignmentRetentionCutoff(now = Date.now()): number {
  const date = new Date(now);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 3);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}

/** Missing deadlines cannot prove expiry; keep them and all future assignments. */
export function isAssignmentRetained(
  assignment: Pick<Assignment, 'deadline'>,
  now = Date.now(),
): boolean {
  return (
    assignment.deadline === null ||
    !Number.isFinite(assignment.deadline) ||
    assignment.deadline >= assignmentRetentionCutoff(now)
  );
}

/** Also apply on cached reads: collecting once must not freeze the time window. */
export function retainAssignmentSnapshot(
  snapshot: AssignmentSnapshot,
  now = Date.now(),
): AssignmentSnapshot {
  const assignments = snapshot.assignments.filter((item) =>
    isAssignmentRetained(item, now),
  );
  return assignments.length === snapshot.assignments.length
    ? snapshot
    : { ...snapshot, assignments };
}
