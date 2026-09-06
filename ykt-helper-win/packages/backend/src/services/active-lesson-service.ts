import {
  ErrorCode,
  YuketangError,
  type AnswerInput,
  type BrowserEnvironment,
  type Lesson,
  type Presentation,
  type SubmissionResult,
  type UserProfile,
} from '@ykt/contracts';
import {
  normalizeTimestamp,
  type ActiveLesson,
  type YuketangActiveClient,
} from '@ykt/routing';
import type { AppDataStore } from '@ykt/storage';

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
    private readonly storage: AppDataStore,
    private readonly clock: Clock = systemClock,
  ) {
    this.#problems = new ProblemService(repository, clock, this.#answers);
  }

  async refreshUser(environment: BrowserEnvironment): Promise<UserProfile> {
    const activeUser = await this.client.getUser(environment);
    const user: UserProfile = {
      environment,
      id: activeUser.id,
      name: activeUser.name,
      updatedAt: new Date(this.clock.now()).toISOString(),
    };
    await this.storage.saveUser(user);
    return user;
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
    this.repository.upsertLesson({
      id: remote.id,
      title: remote.title,
      status: remote.status,
    });
    if (!this.client.usesBrowserCollection) {
      await this.client.checkin(
        environment,
        lessonId,
        remote.classroomId ?? undefined,
      );
    }
    if (!this.client.usesBrowserCollection && remote.presentationId) {
      const presentation = await this.client.fetchPresentation(
        environment,
        lessonId,
        remote.presentationId,
      );
      await this.applyPresentation(environment, lessonId, presentation);
    }
    this.#environments.set(lessonId, environment);
    this.client.connectLesson(
      environment,
      lessonId,
      (message) => this.handleMessage(lessonId, message),
      remote.presentationId,
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

  private async handleMessage(lessonId: string, value: unknown): Promise<void> {
    const message = record(value);
    const session = this.repository.getSession(lessonId);
    if (!message || !session) return;
    const machine = new LessonStateMachine(session, this.clock);
    if (message.op === 'collectionerror') {
      await this.storage.appendLog({
        level: 'error',
        scope: 'lesson',
        message: '官方课堂数据解析失败。',
        details: {
          lessonId,
          error: String(message.error ?? '未知错误'),
        },
      });
      return;
    }
    if (message.op === 'presentationloaded') {
      const presentation = message.presentation as Presentation | undefined;
      const environment = this.#environments.get(lessonId);
      if (environment && presentation?.lessonId === lessonId) {
        await this.applyPresentation(environment, lessonId, presentation);
      }
      return;
    }
    if (message.op === 'lessonfinished') {
      machine.apply({
        type: 'lesson.ended',
        lessonId,
        occurredAt: this.clock.now(),
      });
      return;
    }
    if (message.op === 'fetchtimeline') {
      const timeline = Array.isArray(message.timeline) ? message.timeline : [];
      for (const item of timeline) {
        const piece = record(item);
        if (piece?.type === 'problem')
          await this.applyUnlock(machine, lessonId, piece);
      }
      return;
    }
    if (message.op === 'unlockproblem') {
      const unlocked = record(message.problem);
      if (unlocked) await this.applyUnlock(machine, lessonId, unlocked);
    }
  }

  private async applyPresentation(
    environment: BrowserEnvironment,
    lessonId: string,
    presentation: Presentation,
  ): Promise<void> {
    const session = this.repository.getSession(lessonId);
    if (!session) return;
    new LessonStateMachine(session, this.clock).apply({
      type: 'presentation.loaded',
      lessonId,
      occurredAt: this.clock.now(),
      presentation,
    });
    await this.storage.putDocument({
      key: `${environment}:presentation:${presentation.id}`,
      kind: 'presentation',
      value: JSON.parse(JSON.stringify(presentation)),
      updatedAt: new Date(this.clock.now()).toISOString(),
      expiresAt: new Date(
        this.clock.now() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });
    await this.storage.appendLog({
      level: 'info',
      scope: 'lesson',
      message: '已从官方页面收集课件。',
      details: {
        lessonId,
        presentationId: presentation.id,
        slideCount: presentation.slides.length,
      },
    });
  }

  private async applyUnlock(
    machine: LessonStateMachine,
    lessonId: string,
    unlocked: Record<string, unknown>,
  ): Promise<void> {
    const problemId = stringId(
      unlocked.problemId ?? unlocked.problem_id ?? unlocked.prob ?? unlocked.id,
    );
    const problem = problemId
      ? machine.session.problems.get(problemId)
      : undefined;
    if (!problemId || !problem) return;
    const unlockedAt =
      normalizeTimestamp(unlocked.dt ?? unlocked.unlockedAt) ??
      this.clock.now();
    const limitSeconds = numberValue(unlocked.limit) ?? 0;
    const result = machine.apply({
      type: 'problem.unlocked',
      lessonId,
      occurredAt: this.clock.now(),
      problemId,
      presentationId:
        stringId(unlocked.pres ?? unlocked.presentationId) ??
        problem.presentationId,
      slideId:
        stringId(unlocked.slideId ?? unlocked.slide_id ?? unlocked.sid) ??
        problem.slideId,
      unlockedAt,
      deadlineAt: unlockedAt + limitSeconds * 1000,
    });
    if (result.applied) {
      await this.storage.appendLog({
        level: 'info',
        scope: 'lesson',
        message: '已从官方课堂收集题目事件。',
        details: { lessonId, problemId },
      });
    }
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
