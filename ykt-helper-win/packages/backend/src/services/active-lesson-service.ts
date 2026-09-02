import {
  ErrorCode,
  YuketangError,
  type AnswerInput,
  type BrowserEnvironment,
  type Lesson,
  type SubmissionResult,
} from '@ykt/contracts';
import {
  normalizeTimestamp,
  type ActiveLesson,
  type YuketangActiveClient,
} from '@ykt/routing';

import type { LessonRepository } from '../repositories/lesson-repository.js';
import {
  LessonStateMachine,
  systemClock,
  type Clock,
} from '../workflows/lesson-state-machine.js';
import { AnswerService, planSubmission } from './answer-service.js';
import { ProblemService } from './problem-service.js';

export class ActiveLessonService {
  readonly #remoteLessons = new Map<string, ActiveLesson>();
  readonly #environments = new Map<string, BrowserEnvironment>();
  readonly #problems: ProblemService;
  readonly #answers = new AnswerService();

  constructor(
    private readonly client: YuketangActiveClient,
    private readonly repository: LessonRepository,
    private readonly clock: Clock = systemClock,
  ) {
    this.#problems = new ProblemService(repository, clock, this.#answers);
  }

  async refreshLessons(
    environment: BrowserEnvironment,
  ): Promise<readonly Lesson[]> {
    const lessons = await this.client.listLessons(environment);
    for (const lesson of lessons) {
      this.#remoteLessons.set(lesson.id, lesson);
      this.#environments.set(lesson.id, environment);
      this.repository.upsertLesson({
        id: lesson.id,
        title: lesson.title,
        status: lesson.status,
      });
    }
    return this.repository.listLessons();
  }

  async connectLesson(
    environment: BrowserEnvironment,
    lessonId: string,
  ): Promise<void> {
    const remote = this.#remoteLessons.get(lessonId);
    if (!remote) {
      throw new YuketangError({
        code: ErrorCode.NotFound,
        message: `Lesson ${lessonId} was not found in the active list.`,
      });
    }
    if (this.#environments.get(lessonId) !== environment) {
      throw new YuketangError({
        code: ErrorCode.InvalidArgument,
        message: 'Lesson belongs to another environment.',
      });
    }
    const session = this.repository.upsertLesson({
      id: remote.id,
      title: remote.title,
      status: remote.status,
    });
    await this.client.checkin(
      environment,
      lessonId,
      remote.classroomId ?? undefined,
    );
    if (remote.presentationId) {
      const presentation = await this.client.fetchPresentation(
        environment,
        lessonId,
        remote.presentationId,
      );
      new LessonStateMachine(session, this.clock).apply({
        type: 'presentation.loaded',
        lessonId,
        occurredAt: this.clock.now(),
        presentation,
      });
    }
    this.#environments.set(lessonId, environment);
    this.client.connectLesson(environment, lessonId, (message) =>
      this.handleMessage(lessonId, message),
    );
  }

  async submitAnswer(input: AnswerInput): Promise<SubmissionResult> {
    const problem = this.#problems.getProblem(input.problemId);
    const validation = this.#problems.validateAnswer(input);
    if (!validation.valid || !validation.normalizedAnswer) {
      throw new YuketangError({
        code: ErrorCode.InvalidArgument,
        message: validation.issues.join('; '),
      });
    }
    const environment = this.#environments.get(problem.lessonId);
    if (!environment) {
      throw new YuketangError({
        code: ErrorCode.NotAuthenticated,
        message: 'Lesson is not connected.',
      });
    }
    const now = this.clock.now();
    const plan = planSubmission({
      problem,
      answer: validation.normalizedAnswer,
      now,
      startTime: problem.unlockedAt,
      endTime: problem.deadlineAt,
      ...(input.forceRetry === undefined
        ? {}
        : { forceRetry: input.forceRetry }),
    });
    await this.client.submit(environment, problem.lessonId, plan);
    this.repository
      .getSession(problem.lessonId)
      ?.answerProblem(problem.id, validation.normalizedAnswer);
    return {
      problemId: problem.id,
      status: 'submitted',
      submittedAt: new Date(now).toISOString(),
    };
  }

  close(): void {
    this.client.close();
  }

  private handleMessage(lessonId: string, value: unknown): void {
    const message = record(value);
    const session = this.repository.getSession(lessonId);
    if (!message || !session) return;
    const machine = new LessonStateMachine(session, this.clock);
    if (message.op === 'lessonfinished') {
      machine.apply({
        type: 'lesson.ended',
        lessonId,
        occurredAt: this.clock.now(),
      });
      return;
    }
    if (message.op !== 'unlockproblem') return;
    const unlocked = record(message.problem);
    if (!unlocked) return;
    const problemId = stringId(
      unlocked.problemId ?? unlocked.problem_id ?? unlocked.id,
    );
    const problem = problemId ? session.problems.get(problemId) : undefined;
    if (!problemId || !problem) return;
    const unlockedAt =
      normalizeTimestamp(unlocked.dt ?? unlocked.unlockedAt) ??
      this.clock.now();
    const limitSeconds = numberValue(unlocked.limit) ?? 0;
    machine.apply({
      type: 'problem.unlocked',
      lessonId,
      occurredAt: this.clock.now(),
      problemId,
      presentationId:
        stringId(unlocked.pres ?? unlocked.presentationId) ??
        problem.presentationId,
      slideId:
        stringId(unlocked.slideId ?? unlocked.slide_id) ?? problem.slideId,
      unlockedAt,
      deadlineAt: unlockedAt + limitSeconds * 1000,
    });
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringId(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null;
}

function numberValue(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
