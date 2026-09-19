// Protocol reference: smartThise/OneTHU PR #28 (b9b82ef, R16b), exthw/yuketang.ts.
// Implemented for this project's transport and DTOs; reuses the browser login.
import {
  BrowserEnvironment,
  type Assignment,
  type AssignmentQuestionStatus,
  type AssignmentSnapshot,
} from '@ykt/contracts';

const ORIGIN = 'https://pro.yuketang.cn';
const PAGE_SIZE = 200;
const MAX_PAGES = 50;
type JsonRecord = Record<string, unknown>;
type GetJson = (url: string) => Promise<unknown>;

export async function fetchAssignments(
  get: GetJson,
  universityId: string,
  now: () => number,
): Promise<AssignmentSnapshot> {
  const courses = dataOf(
    await get(`${ORIGIN}/v2/api/web/courses/list?identity=2`),
  );
  if (!Array.isArray(courses.list))
    throw new Error('雨课堂课程列表格式异常，请重新登录荷塘雨课堂后重试。');
  const warnings: string[] = [];
  const items = new Map<
    string,
    { assignment: Assignment; leafTypeId: string; skuId: string }
  >();
  const auditedClassrooms = new Set(
    courses.list.flatMap((value) => {
      const course = record(value);
      return course?.role === 6 ? [id(course.classroom_id)] : [];
    }),
  );

  for (const rawCourse of courses.list) {
    const course = record(rawCourse);
    const cid = id(course?.classroom_id);
    if (!course || !cid) continue;
    const courseName =
      id(course.name) || id(record(course.course)?.name) || '雨课堂课程';
    try {
      const seenPages = new Set<string>();
      for (let page = 0; page < MAX_PAGES; page++) {
        const data = dataOf(
          await get(
            `${ORIGIN}/v2/api/web/logs/learn/${encodeURIComponent(cid)}?page=${page}&offset=${PAGE_SIZE}&sort=0&actype=-1`,
          ),
        );
        if (!Array.isArray(data.activities))
          throw new Error('学习日志格式异常');
        const signature = JSON.stringify(data.activities);
        if (seenPages.has(signature)) {
          warnings.push(
            `${courseName}：学习日志分页返回重复数据，结果可能不完整。`,
          );
          break;
        }
        seenPages.add(signature);
        for (const raw of data.activities) {
          const activity = record(raw);
          if (!activity || (activity.type !== 19 && activity.type !== 20))
            continue;
          const content = record(activity.content) ?? {};
          const leaf = id(content.leaf_id);
          const leafTypeId = id(content.leaf_type_id);
          const activityId =
            id(activity.id) || id(activity.courseware_id) || leaf || leafTypeId;
          if (!activityId) {
            warnings.push(`${courseName}：一条作业缺少标识，未能读取。`);
            continue;
          }
          const classroomId = id(activity.classroom_id) || cid;
          const key = `pro:${classroomId}:${activity.type}:${activityId}`;
          items.set(key, {
            leafTypeId,
            skuId: id(content.sku_id),
            assignment: {
              id: key,
              classroomId,
              courseName,
              title:
                id(activity.title) || (activity.type === 20 ? '考试' : '作业'),
              kind: activity.type === 20 ? 'exam' : 'homework',
              deadline: deadline(content.score_d),
              // R16b 学生端直链使用 leaf_id；/subject 是教师入口，不能使用。
              url: leaf
                ? `${ORIGIN}/ai-workspace/lms-graph/${encodeURIComponent(classroomId)}/${activity.type === 20 ? 'quiz' : 'exercise'}/${encodeURIComponent(leaf)}?is_chapter=1`
                : `${ORIGIN}/v2/web/studentLog/${encodeURIComponent(classroomId)}`,
              status: 'unknown',
              graded: null,
              score: null,
              totalScore: null,
              audited: auditedClassrooms.has(classroomId),
              answeredCount: null,
              totalCount: null,
              questions: [],
              statusMessage: leafTypeId
                ? null
                : '暂无法获取作答状态，请在官网查看。',
            },
          });
        }
        if (data.activities.length < PAGE_SIZE) break;
        if (page === MAX_PAGES - 1)
          warnings.push(
            `${courseName}：学习日志过多，仅显示前 ${MAX_PAGES * PAGE_SIZE} 条活动中的作业。`,
          );
      }
    } catch (error) {
      if (error instanceof AssignmentAuthError) throw error;
      warnings.push(`${courseName}：部分学习日志未能读取，请刷新重试。`);
    }
  }

  // Bound status requests to four workers, as in the upstream implementation.
  const pending = [...items.values()];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (cursor < pending.length) {
        const item = pending[cursor++];
        if (!item?.leafTypeId) continue;
        const query = new URLSearchParams({
          classroom_id: item.assignment.classroomId,
          term: 'latest',
          uv_id: universityId,
        });
        try {
          if (item.assignment.kind === 'exam') {
            const examQuery = new URLSearchParams({
              exam_id: item.leafTypeId,
              classroom_id: item.assignment.classroomId,
            });
            if (item.skuId) examQuery.set('sku_id', item.skuId);
            const data = dataOf(
              await get(`${ORIGIN}/v/exam/cover?${examQuery}`),
            );
            item.assignment = {
              ...item.assignment,
              ...parseExamProgress(data),
            };
            continue;
          }
          const data = dataOf(
            await get(
              `${ORIGIN}/mooc-api/v1/lms/exercise/get_exercise_list/${encodeURIComponent(item.leafTypeId)}/?${query}`,
            ),
          );
          item.assignment = { ...item.assignment, ...parseProgress(data) };
        } catch (error) {
          if (error instanceof AssignmentAuthError) throw error;
          item.assignment = {
            ...item.assignment,
            statusMessage:
              item.assignment.kind === 'exam'
                ? '考试状态获取失败，请刷新或在官网查看。'
                : '作答状态获取失败，请刷新或在官网确认。',
          };
        }
      }
    }),
  );
  return {
    environment: BrowserEnvironment.Pro,
    fetchedAt: now(),
    assignments: pending
      .map((item) => item.assignment)
      .sort(
        (a, b) =>
          (a.deadline ?? Infinity) - (b.deadline ?? Infinity) ||
          a.id.localeCompare(b.id),
      ),
    warnings: [...new Set(warnings)],
  };
}

function parseExamProgress(
  data: JsonRecord,
): Pick<
  Assignment,
  | 'status'
  | 'examStatus'
  | 'answeredCount'
  | 'totalCount'
  | 'questions'
  | 'statusMessage'
  | 'graded'
  | 'score'
  | 'totalScore'
> {
  // Verified against the official cover component (web/1.2.310, chunk 33139):
  // result.status 4/5 => 已交卷, 6 => 缺考; monitor_status 2 overrides as 作废.
  const result = record(data.result);
  const code = result?.status;
  const submitted = code === 4 || code === 5;
  const invalid = record(data.face_auth_status)?.monitor_status === 2;
  const examStatus = invalid
    ? 'invalid'
    : submitted
      ? 'submitted'
      : code === 6
        ? 'absent'
        : 'unknown';
  const total = nonnegativeInteger(data.problem_count);
  const unfinished = nonnegativeInteger(result?.unfinished_count);
  const totalCount = total !== null && total > 0 ? total : null;
  // A missing/null count is not zero. Submission alone does not prove all questions answered.
  const answeredCount =
    submitted &&
    !invalid &&
    totalCount !== null &&
    unfinished !== null &&
    unfinished <= totalCount
      ? totalCount - unfinished
      : null;
  // R9/R16：只展示已交卷且已出分的有限数值；零分有效，-1 占位无效。
  // 保留本项目已由官网验证的交卷判定，不用“有作答”推断已交卷。
  const score = nonnegativeNumber(result?.score);
  const totalScore = nonnegativeNumber(data.total_score);
  const graded =
    submitted &&
    !invalid &&
    result?.score_finish !== false &&
    score !== null &&
    totalScore !== null;
  return {
    examStatus,
    graded,
    score: graded ? score : null,
    totalScore: graded ? totalScore : null,
    status:
      answeredCount === null
        ? 'unknown'
        : answeredCount === totalCount
          ? 'answered'
          : answeredCount > 0
            ? 'partial'
            : 'unanswered',
    answeredCount,
    totalCount,
    // 考试封面接口仅提供总题数和未答题数，不提供逐题明细。
    questions: [],
    statusMessage:
      examStatus === 'unknown' ? '暂无法获取考试状态，请在官网查看。' : null,
  };
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function nonnegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function parseProgress(
  data: JsonRecord,
): Pick<
  Assignment,
  | 'status'
  | 'answeredCount'
  | 'totalCount'
  | 'questions'
  | 'statusMessage'
  | 'graded'
> {
  const raw = Array.isArray(data.problems) ? data.problems : [];
  const aggregate =
    typeof data.answer_count === 'number' &&
    Number.isInteger(data.answer_count) &&
    data.answer_count >= 0
      ? data.answer_count
      : null;
  if (!raw.length && aggregate === null)
    throw new Error('Empty exercise status');
  const questions: AssignmentQuestionStatus[] = raw.map((value, index) => {
    const problem = record(value);
    const user = record(problem?.user);
    const answer = record(user?.my_answer);
    const content = answer?.content;
    return {
      id: id(problem?.problem_id) || id(problem?.id) || String(index + 1),
      index: index + 1,
      // Missing user data is not evidence that the question was left blank.
      answered: !user ? null : hasAnswer(content),
    };
  });
  const answered = questions.filter(
    (question) => question.answered === true,
  ).length;
  const allKnown =
    questions.length > 0 &&
    questions.every((question) => question.answered !== null);
  // An aggregate count may prove some activity but cannot identify answered questions.
  const count = answered > 0 ? answered : (aggregate ?? (allKnown ? 0 : null));
  const status =
    allKnown && answered === questions.length
      ? 'answered'
      : count !== null && count > 0
        ? 'partial'
        : allKnown || aggregate === 0
          ? 'unanswered'
          : 'unknown';
  return {
    status,
    graded: homeworkGraded(raw, aggregate, answered),
    answeredCount: count,
    totalCount: questions.length || null,
    questions,
    // 总作答数与逐题信息可能不完整；未知题目已通过 answered: null 表达。
    statusMessage: null,
  };
}

function homeworkGraded(
  problems: unknown[],
  aggregate: number | null,
  answered: number,
): boolean | null {
  if (answered === 0 && (aggregate ?? 0) === 0) return false;
  const relevant = problems.filter(
    (value) =>
      (aggregate ?? 0) > 0 ||
      hasAnswer(record(record(record(value)?.user)?.my_answer)?.content),
  );
  if (!relevant.length) return null;
  let allGraded = true;
  for (const value of relevant) {
    const user = record(record(value)?.user);
    const rawScore = user?.my_score;
    const score =
      typeof rawScore === 'string' && rawScore.trim()
        ? Number(rawScore)
        : rawScore;
    // R16：status=3 或 my_score=-1（含 "-1.00"）优先表示待批改。
    if (user?.status === 3 || score === -1) return false;
    // 缺少批改字段不能被“没有待批改标记”误判成已批改。
    if (user?.status !== 4 && nonnegativeNumber(score) === null)
      allGraded = false;
  }
  return allGraded ? true : null;
}

function hasAnswer(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasAnswer);
  return typeof value === 'number' && Number.isFinite(value);
}

export class AssignmentAuthError extends Error {
  constructor() {
    super('荷塘雨课堂登录已失效，请在内嵌网页重新登录后刷新作业。');
  }
}

function dataOf(value: unknown): JsonRecord {
  const body = record(value);
  if (!body) throw new Error('雨课堂返回非 JSON，请重新登录后重试。');
  for (const field of ['errcode', 'error_code', 'code']) {
    const code = body[field];
    if (code === undefined || code === null || code === 0 || code === '0')
      continue;
    if (['401000', '401', '403'].includes(String(code)))
      throw new AssignmentAuthError();
    throw new Error(`雨课堂作业接口失败（${field}=${String(code)}）。`);
  }
  if (body.success === false) throw new Error('雨课堂作业接口未成功。');
  const data = record(body.data);
  if (!data) throw new Error('雨课堂作业接口未返回数据。');
  return data;
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function id(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

function deadline(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    !Number.isNaN(new Date(value).getTime())
    ? value
    : null;
}
