import {
  ErrorCode,
  YuketangError,
  type AnswerInput,
  type BrowserEnvironment,
  type ClassroomNotice,
  type ClassroomSimulationAction,
  type ClassroomSimulationState,
  type Lesson,
  type Presentation,
  type SubmissionResult,
  type UserProfile,
} from '@ykt/contracts';
import {
  normalizeTimestamp,
  type ActiveLesson,
  type BrowserArchivedPresentationObservation,
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
import { getRealtimeEvent } from './classroom-events.js';

const simulationLessonId = 'local-classroom-simulator';
const noticeDedupeWindow = 60_000;

export function isClassroomSimulationLesson(lessonId: string): boolean {
  return lessonId === simulationLessonId;
}

export class ActiveLessonService {
  readonly #remoteLessons = new Map<string, ActiveLesson>();
  readonly #environments = new Map<string, BrowserEnvironment>();
  readonly #problems: ProblemService;
  readonly #answers = new AnswerService();
  readonly #stopArchivedCollection: () => void;
  readonly #noticeTimes = new Map<string, number>();
  #simulation: ClassroomSimulationState = {
    lessonId: simulationLessonId,
    status: 'upcoming',
    currentSlide: 1,
    publishedProblemIds: [],
    lastEvent: '尚未启动',
  };

  constructor(
    private readonly client: YuketangActiveClient,
    private readonly repository: LessonRepository,
    private readonly storage: AppDataStore,
    private readonly clock: Clock = systemClock,
    private readonly onNotice: (notice: ClassroomNotice) => void = () => {},
  ) {
    this.#problems = new ProblemService(repository, clock, this.#answers);
    this.#stopArchivedCollection = this.client.onArchivedPresentation(
      (observation) => this.applyArchivedPresentation(observation),
    );
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
    return lessons.map(
      ({
        classroomId: _classroomId,
        presentationId: _presentationId,
        ...lesson
      }) => lesson,
    );
  }

  async connectLesson(
    environment: BrowserEnvironment,
    lessonId: string,
  ): Promise<void> {
    const remote =
      this.#remoteLessons.get(lessonId) ??
      this.archivedLessonForBrowserCollection(lessonId);
    if (!remote) {
      throw new YuketangError({
        code: ErrorCode.NotFound,
        message: `Lesson ${lessonId} was not found in the active list.`,
      });
    }
    const knownEnvironment = this.#environments.get(lessonId);
    if (knownEnvironment && knownEnvironment !== environment) {
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

  private archivedLessonForBrowserCollection(
    lessonId: string,
  ): ActiveLesson | null {
    if (!this.client.usesBrowserCollection) return null;
    const lesson = this.repository.getSession(lessonId)?.lesson;
    if (lesson?.status !== 'ended') return null;
    return { ...lesson, classroomId: null, presentationId: null };
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

  getSimulation(): ClassroomSimulationState {
    return { ...this.#simulation };
  }

  async runSimulation(
    action: ClassroomSimulationAction,
  ): Promise<ClassroomSimulationState> {
    if (action === 'reset') {
      await this.resetSimulation();
      return this.getSimulation();
    }
    if (this.#simulation.status !== 'active') await this.resetSimulation();

    if (action === 'show-slide') {
      const nextSlide =
        this.#simulation.currentSlide === 3
          ? 1
          : this.#simulation.currentSlide + 1;
      await this.handleMessage(simulationLessonId, {
        op: 'presentationdisplay',
        presentation: 'simulation-presentation',
        slide: nextSlide,
      });
      this.#simulation = {
        ...this.#simulation,
        currentSlide: nextSlide,
        lastEvent: `教师展示第 ${nextSlide} 页（不触发发布提醒）`,
      };
    } else if (action === 'publish-courseware') {
      await this.handleMessage(simulationLessonId, {
        op: 'publishpresentation',
        presentation: {
          id: 'simulation-presentation',
          title: '本地模拟课件',
        },
      });
      this.#simulation = {
        ...this.#simulation,
        lastEvent: '教师发布课件',
      };
    } else if (
      action === 'publish-problem-object' ||
      action === 'publish-problem-scalar'
    ) {
      const scalar = action === 'publish-problem-scalar';
      const problemId = scalar
        ? 'simulation-problem-scalar'
        : 'simulation-problem-object';
      const slideId = scalar ? 'simulation-slide-3' : 'simulation-slide-2';
      await this.handleMessage(simulationLessonId, {
        op: 'unlockproblem',
        problem: scalar
          ? problemId
          : {
              problemId,
              pres: 'simulation-presentation',
              sid: slideId,
              dt: this.clock.now(),
              limit: 90,
            },
        pres: 'simulation-presentation',
        sid: slideId,
        dt: this.clock.now(),
        limit: 90,
      });
      this.#simulation = {
        ...this.#simulation,
        currentSlide: scalar ? 3 : 2,
        publishedProblemIds: [
          ...new Set([...this.#simulation.publishedProblemIds, problemId]),
        ],
        lastEvent: scalar ? '教师发布标量 ID 题目' : '教师发布对象题目',
      };
    } else if (action === 'finish-lesson') {
      await this.handleMessage(simulationLessonId, { op: 'lessonfinished' });
      this.#simulation = {
        ...this.#simulation,
        status: 'ended',
        lastEvent: '教师结束课堂',
      };
    }
    return this.getSimulation();
  }

  close(): void {
    this.#stopArchivedCollection();
    this.client.close();
  }

  private async applyArchivedPresentation(
    observation: BrowserArchivedPresentationObservation,
  ): Promise<void> {
    this.repository.upsertLesson({
      id: observation.lessonId,
      title: observation.lessonTitle || '已结束课堂',
      status: 'ended',
    });
    this.#environments.set(observation.lessonId, observation.environment);
    await this.applyPresentation(
      observation.environment,
      observation.lessonId,
      observation.presentation,
    );
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
    const event = getRealtimeEvent(message);
    if (!event) return;
    if (event.kind === 'lessonfinished') {
      machine.apply({
        type: 'lesson.ended',
        lessonId,
        occurredAt: this.clock.now(),
      });
      this.emitNotice({
        kind: 'lesson-finished',
        lessonId,
        dedupeKey: `lesson-finished:${lessonId}`,
        title: '课堂已结束',
        detail: session.lesson.title,
        occurredAt: this.clock.now(),
      });
      return;
    }
    if (event.kind === 'timeline') {
      const timeline = Array.isArray(event.timeline) ? event.timeline : [];
      for (const item of timeline) {
        const piece = record(item);
        if (piece?.type === 'problem')
          await this.applyUnlock(machine, lessonId, piece);
      }
      return;
    }
    if (event.kind === 'unlockproblem') {
      await this.applyUnlock(machine, lessonId, event.problem);
      return;
    }
    if (event.kind === 'publish') {
      this.emitNotice({
        ...event.notice,
        lessonId,
        occurredAt: this.clock.now(),
      });
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
    const limitSeconds = numberValue(unlocked.limit);
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
      deadlineAt:
        limitSeconds !== null && limitSeconds > 0
          ? unlockedAt + limitSeconds * 1000
          : null,
    });
    if (result.applied) {
      await this.storage.appendLog({
        level: 'info',
        scope: 'lesson',
        message: '已从官方课堂收集题目事件。',
        details: { lessonId, problemId },
      });
      this.emitNotice({
        kind: 'problem-start',
        lessonId,
        dedupeKey: `problem-start:${lessonId}:${problemId}`,
        title: '习题已发布',
        detail: problem.prompt || '教师开启了一道可作答的习题',
        occurredAt: this.clock.now(),
      });
    }
  }

  private async resetSimulation(): Promise<void> {
    for (const key of this.#noticeTimes.keys()) {
      if (key.includes(simulationLessonId)) this.#noticeTimes.delete(key);
    }
    this.repository.upsertLesson({
      id: simulationLessonId,
      title: '本地课堂模拟',
      status: 'active',
    });
    this.#environments.set(simulationLessonId, 'standard');
    await this.applyPresentation('standard', simulationLessonId, {
      id: 'simulation-presentation',
      lessonId: simulationLessonId,
      title: '本地模拟课件',
      width: 1600,
      height: 900,
      slides: [
        {
          id: 'simulation-slide-1',
          index: 0,
          title: '课堂开始',
          imageUrl: null,
          problem: null,
        },
        {
          id: 'simulation-slide-2',
          index: 1,
          title: '对象题目',
          imageUrl: null,
          problem: {
            id: 'simulation-problem-object',
            lessonId: simulationLessonId,
            presentationId: 'simulation-presentation',
            slideId: 'simulation-slide-2',
            type: 'single-choice',
            prompt: '模拟题：Windows 发行版是否收到了对象题目事件？',
            options: ['是', '否'],
            blanks: [],
            result: null,
          },
        },
        {
          id: 'simulation-slide-3',
          index: 2,
          title: '标量题目',
          imageUrl: null,
          problem: {
            id: 'simulation-problem-scalar',
            lessonId: simulationLessonId,
            presentationId: 'simulation-presentation',
            slideId: 'simulation-slide-3',
            type: 'single-choice',
            prompt: '模拟题：标量 problem ID 是否被正确正规化？',
            options: ['是', '否'],
            blanks: [],
            result: null,
          },
        },
      ],
    });
    this.#simulation = {
      lessonId: simulationLessonId,
      status: 'active',
      currentSlide: 1,
      publishedProblemIds: [],
      lastEvent: '模拟课堂已重置',
    };
  }

  private emitNotice(notice: ClassroomNotice): void {
    const previous = this.#noticeTimes.get(notice.dedupeKey);
    if (
      previous !== undefined &&
      notice.occurredAt - previous < noticeDedupeWindow
    ) {
      return;
    }
    this.#noticeTimes.set(notice.dedupeKey, notice.occurredAt);
    this.onNotice(notice);
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
