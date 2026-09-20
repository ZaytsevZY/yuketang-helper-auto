import type { Assignment } from './assignments.js';

export interface AssignmentComment {
  readonly html: string;
  readonly name: string;
  readonly index: number | null;
}

export interface AssignmentProblemDetail {
  readonly id: string;
  readonly index: number;
  readonly type: number;
  readonly typeText: string;
  readonly score: number | null;
  /** Untrusted source HTML, possibly substituted Unicode. Never AI/plaintext input. */
  readonly bodyHtml: string;
  readonly options: readonly { label: string; html: string }[];
  readonly answerHtml: string;
  readonly attachments: readonly { name: string; url: string | null }[];
  readonly status:
    'unknown' | 'unanswered' | 'answered' | 'submitted' | 'graded';
  readonly myScore: number | null;
  /** Released exam review fields only; never populated from an active exam. */
  readonly correct?: boolean | null;
  readonly correctAnswerHtml?: string;
  readonly explanationHtml?: string;
  readonly remarkHtml: string;
  readonly comments: readonly AssignmentComment[];
  readonly externalUrl: string | null;
  readonly maxRetry: number;
  readonly remainingRetries: number | null;
  readonly allowResults: readonly string[];
}

export interface AssignmentDetail {
  readonly assignment: Assignment;
  readonly fetchedAt: number;
  /** Exam review requires fresh submitted/scored covers and released viewing permission. */
  readonly mode: 'exercise' | 'exam-cover' | 'exam-review';
  readonly descriptionHtml: string;
  readonly fontUrl: string | null;
  readonly problems: readonly AssignmentProblemDetail[];
  readonly maxRetry: number;
  readonly lateAllowed: boolean;
  readonly lateDeadline: number | null;
}

export interface AssignmentAsset {
  readonly dataUrl: string;
}

/** Only opens the official page; all actual validation/submission stays there. */
export function canOpenAssignmentAnswer(
  detail: AssignmentDetail,
  now = Date.now(),
): boolean {
  const { assignment, problems } = detail;
  if (assignment.kind !== 'homework' || detail.mode !== 'exercise')
    return false;
  const eligible = problems.filter((p) => p.type !== 9 && p.type !== 6);
  if (!eligible.length || problems.some((p) => p.type === 6)) return false;
  if (
    !/^https:\/\/pro\.yuketang\.cn\/ai-workspace\/lms-graph\/[^/]+\/exercise\/[^/?]+\?is_chapter=1$/.test(
      assignment.url,
    )
  )
    return false;
  if (
    assignment.deadline !== null &&
    now >= assignment.deadline &&
    (!detail.lateAllowed ||
      (detail.lateDeadline !== null && now >= detail.lateDeadline))
  )
    return false;
  return eligible.some((p) => {
    if (p.remainingRetries !== null) return p.remainingRetries > 0;
    return (
      !['submitted', 'graded'].includes(p.status) ||
      Math.max(p.maxRetry, detail.maxRetry) > 0
    );
  });
}
