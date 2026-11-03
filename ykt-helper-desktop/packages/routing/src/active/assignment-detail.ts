// Protocol adapted from OneTHU PR #32, 5225a05 (R20-B/C1).
import type {
  Assignment,
  AssignmentDetail,
  AssignmentProblemDetail,
} from '@ykt/contracts';
import { dataOf, parseExamProgress, parseProgress } from './assignments.js';

export async function fetchAssignmentDetail(
  get: (url: string) => Promise<unknown>,
  assignment: Assignment,
  universityId: string,
  now: () => number,
  openExamReview?: () => Promise<(path: string) => Promise<unknown>>,
): Promise<AssignmentDetail> {
  if (!assignment.leafTypeId) throw new Error('缺少详情标识，请在官网查看。');
  const base = 'https://pro.yuketang.cn';
  if (assignment.kind === 'exam') {
    const query = new URLSearchParams({
      exam_id: assignment.leafTypeId,
      classroom_id: assignment.classroomId,
    });
    if (assignment.skuId) query.set('sku_id', assignment.skuId);
    const data = dataOf(await get(`${base}/v/exam/cover?${query}`));
    const cover: AssignmentDetail = {
      assignment: { ...assignment, ...parseExamProgress(data) },
      fetchedAt: now(),
      mode: 'exam-cover',
      descriptionHtml: '',
      fontUrl: null,
      problems: [],
      maxRetry: 0,
      lateAllowed: false,
      lateDeadline: null,
    };
    // Recheck the live cover even when the cached list says graded. No token or
    // internal exam request is made for active, unsubmitted or unreleased exams.
    if (!canReviewExam(data, now()) || !openExamReview) return cover;
    const examGet = await openExamReview();
    const reviewCover = dataOf(await examGet('/exam_room/cover'));
    const refreshed = {
      ...cover,
      assignment: { ...assignment, ...parseExamProgress(reviewCover) },
    };
    if (!canReviewExam(reviewCover, now())) return refreshed;
    const results = dataOf(await examGet('/exam_room/problem_results'));
    const paper = dataOf(await examGet('/exam_room/show_paper'));
    const byId = new Map(
      (Array.isArray(results.problem_results)
        ? results.problem_results
        : []
      ).map((raw) => {
        const r = record(raw);
        return [textId(r.problem_id), r] as const;
      }),
    );
    const problems = (Array.isArray(paper.problems) ? paper.problems : []).map(
      (raw, i) => {
        const p = record(raw),
          id = textId(p.problem_id ?? p.ProblemID);
        const result = byId.get(id) ?? {};
        const grade = number(result.grade);
        const parsed = parseProblem(
          {
            problem_id: id,
            index: i + 1,
            content: {
              ...p,
              score: p.score ?? p.Score,
              Options: (Array.isArray(p.Options) ? p.Options : []).map(
                (raw) => {
                  const o = record(raw);
                  return { name: o.key, content: o.value };
                },
              ),
            },
            user: { my_answer: { content: result.result } },
          },
          i,
        );
        return {
          ...parsed,
          // Paper index is 0 for every question in the verified payload. Results
          // arrive in reverse order: join by problem_id, never by array position.
          status:
            grade !== null
              ? ('graded' as const)
              : result.finished === false
                ? ('unanswered' as const)
                : result.finished === true
                  ? ('submitted' as const)
                  : ('unknown' as const),
          myScore: grade,
          correct:
            grade !== null && typeof result.correct === 'boolean'
              ? result.correct
              : null,
          correctAnswerHtml:
            reviewCover.show_answer === true
              ? reviewAnswer(result.answer ?? p.Answer)
              : '',
          explanationHtml:
            reviewCover.show_answer === true ? text(p.Remark) : '',
        };
      },
    );
    return {
      ...refreshed,
      mode: 'exam-review',
      descriptionHtml: text(reviewCover.description),
      fontUrl: url(paper.font),
      problems,
      assignment: {
        ...refreshed.assignment,
        questions: problems.map((p) => ({
          id: p.id,
          index: p.index,
          answered:
            typeof byId.get(p.id)?.finished === 'boolean'
              ? (byId.get(p.id)!.finished as boolean)
              : null,
        })),
      },
    };
  }
  const query = new URLSearchParams({
    classroom_id: assignment.classroomId,
    term: 'latest',
    uv_id: universityId,
  });
  const data = dataOf(
    await get(
      `${base}/mooc-api/v1/lms/exercise/get_exercise_list/${encodeURIComponent(assignment.leafTypeId)}/?${query}`,
    ),
  );
  const problems = Array.isArray(data.problems)
    ? data.problems.map(parseProblem)
    : [];
  // Missing detail fields remain unknown; aggregate answer_count never supplies a per-question status.
  const progress =
    problems.length || number(data.answer_count) !== null
      ? parseProgress(data)
      : {
          status: 'unknown' as const,
          graded: null,
          score: null,
          totalScore: null,
          answeredCount: null,
          totalCount: null,
          questions: [],
          statusMessage: null,
        };
  return {
    assignment: {
      ...assignment,
      ...progress,
      title: text(data.name) || assignment.title,
    },
    fetchedAt: now(),
    mode: 'exercise',
    descriptionHtml: text(data.description),
    fontUrl: url(data.font),
    problems,
    maxRetry: number(data.max_retry) ?? 0,
    lateAllowed: data.is_allowed_late_submission === true,
    lateDeadline:
      (number(data.late_submission) ?? 0) > 0
        ? number(data.late_submission)
        : null,
  };
}

function canReviewExam(data: Record<string, unknown>, now: number): boolean {
  const progress = parseExamProgress(data);
  const release = number(data.show_score_time);
  return (
    progress.examStatus === 'submitted' &&
    progress.graded === true &&
    data.show_perm === true &&
    data.show_score === true &&
    (release === null || release <= (number(data.server_time) ?? now))
  );
}

function reviewAnswer(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .map((v) => escapeText(String(v)))
      .join('<br>');
  return typeof value === 'number' ? String(value) : '';
}

function parseProblem(raw: unknown, position: number): AssignmentProblemDetail {
  const problem = record(raw),
    content = record(problem.content),
    user = record(problem.user);
  const answer = record(user.my_answer);
  const answerHtml =
    typeof answer.content === 'string'
      ? answer.content
      : Array.isArray(answer.content)
        ? answer.content
            .filter((v) => typeof v === 'string' || typeof v === 'number')
            .map((v) => escapeText(String(v)))
            .join('<br>')
        : typeof answer.content === 'number'
          ? String(answer.content)
          : '';
  const attachments = (
    Array.isArray(answer.attachment) ? answer.attachment : []
  ).flatMap((raw) => {
    const item = record(raw),
      name = text(item.name),
      href = url(item.url);
    return name || href ? [{ name: name || '附件', url: href }] : [];
  });
  const userStatus = number(user.status),
    score = number(user.my_score);
  const pendingScore =
    String(user.my_score ?? '').trim() !== '' && Number(user.my_score) === -1;
  const status =
    userStatus === 3
      ? 'submitted'
      : !pendingScore && (userStatus === 4 || score !== null)
        ? 'graded'
        : answerHtml.trim() || attachments.length
          ? 'answered'
          : Object.hasOwn(answer, 'content')
            ? 'unanswered'
            : 'unknown';
  const count = number(user.count),
    used = number(user.my_count) ?? 0;
  const type = number(content.ProblemType ?? content.Type) ?? 0;
  const typeNames: Record<number, string> = {
    1: '单选题',
    2: '多选题',
    3: '判断题',
    4: '填空题',
    5: '主观题',
    6: '试卷',
    9: '外链题',
  };
  return {
    id: textId(problem.problem_id) || String(position + 1),
    index: number(problem.index) ?? position + 1,
    type,
    typeText: text(content.TypeText) || typeNames[type] || '题目',
    score: number(content.score),
    bodyHtml: text(content.Body),
    options: (Array.isArray(content.Options) ? content.Options : []).map(
      (raw, i) => {
        const option = record(raw);
        return {
          label: text(option.name) || String.fromCharCode(65 + i),
          html:
            typeof raw === 'string'
              ? raw
              : text(option.content ?? option.Body ?? option.text),
        };
      },
    ),
    answerHtml,
    attachments,
    status,
    myScore: status === 'graded' ? score : null,
    remarkHtml: text(user.remark),
    comments: (Array.isArray(user.comment) ? user.comment : []).flatMap(
      (raw) => {
        const item = record(raw),
          html = text(item.content);
        return html.trim()
          ? [{ html, name: text(item.name), index: number(item.index) }]
          : [];
      },
    ),
    externalUrl:
      type === 9 ? url(record(content.data).answer_problem_url) : null,
    maxRetry: number(content.max_retry ?? problem.max_retry) ?? 0,
    remainingRetries:
      count !== null && count > 0 ? Math.max(0, count - used) : null,
    allowResults: (Array.isArray(content.AllowResults)
      ? content.AllowResults
      : []
    ).filter((v): v is string => typeof v === 'string'),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function textId(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string'
    ? String(value)
    : '';
}
function number(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}
function url(value: unknown): string | null {
  try {
    const u = new URL(text(value), 'https://pro.yuketang.cn/');
    return text(value).trim() &&
      u.protocol === 'https:' &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
function escapeText(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}
