import {
  ErrorCode,
  YuketangError,
  type AnswerInput,
  type BrowserEnvironment,
  type Lesson,
  type LessonEvent,
  type ProblemContext,
  type RuntimeStatus,
  type SubmissionResult,
  type ValidationResult,
  type YuketangFacade,
} from '@ykt/contracts';
import {
  EmptyRoutingService,
  type RoutingService,
  type YuketangActiveClient,
} from '@ykt/routing';
import { MemoryKeyValueStore, type KeyValueStore } from '@ykt/storage';

import {
  InMemoryLessonRepository,
  type LessonRepository,
} from './repositories/lesson-repository.js';
import { ActiveLessonService } from './services/active-lesson-service.js';
import { ProblemService } from './services/problem-service.js';

const VERSION = '0.1.0';

class BaselineFacade implements YuketangFacade {
  constructor(
    private readonly status: () => RuntimeStatus,
    private readonly routing: RoutingService,
    private readonly lessons: LessonRepository,
    private readonly problems: ProblemService,
    private readonly activeLessons: ActiveLessonService | undefined,
  ) {}

  async getStatus(): Promise<RuntimeStatus> {
    return this.status();
  }

  async listLessons(): Promise<readonly Lesson[]> {
    return this.lessons.listLessons();
  }

  async refreshLessons(
    environment: BrowserEnvironment,
  ): Promise<readonly Lesson[]> {
    return this.requireActiveClient().refreshLessons(environment);
  }

  async connectLesson(
    environment: BrowserEnvironment,
    id: string,
  ): Promise<void> {
    await this.requireActiveClient().connectLesson(environment, id);
  }

  async listProblems(lessonId: string): Promise<readonly ProblemContext[]> {
    return this.problems.listProblems(lessonId);
  }

  watchLesson(id: string): AsyncIterable<LessonEvent> {
    return this.routing.events(id);
  }

  async getProblem(id: string): Promise<ProblemContext> {
    return this.problems.getProblem(id);
  }

  async validateAnswer(input: AnswerInput): Promise<ValidationResult> {
    return this.problems.validateAnswer(input);
  }

  async submitAnswer(input: AnswerInput): Promise<SubmissionResult> {
    if (this.activeLessons) return this.activeLessons.submitAnswer(input);
    throw new YuketangError({
      code: ErrorCode.NotImplemented,
      message: 'Answer submission requires the M4 active network client.',
    });
  }

  private requireActiveClient(): ActiveLessonService {
    if (this.activeLessons) return this.activeLessons;
    throw new YuketangError({
      code: ErrorCode.NotImplemented,
      message: 'The active network client is not configured.',
    });
  }
}

export interface BackendRuntimeOptions {
  routing?: RoutingService;
  store?: KeyValueStore;
  lessons?: LessonRepository;
  activeClient?: YuketangActiveClient;
}

export class BackendRuntime {
  readonly facade: YuketangFacade;
  readonly store: KeyValueStore;
  readonly lessons: LessonRepository;
  readonly activeLessons: ActiveLessonService | undefined;
  #running = false;

  constructor(options: BackendRuntimeOptions = {}) {
    this.store = options.store ?? new MemoryKeyValueStore();
    this.lessons = options.lessons ?? new InMemoryLessonRepository();
    this.activeLessons = options.activeClient
      ? new ActiveLessonService(options.activeClient, this.lessons)
      : undefined;
    this.facade = new BaselineFacade(
      () => this.status(),
      options.routing ?? new EmptyRoutingService(),
      this.lessons,
      new ProblemService(this.lessons),
      this.activeLessons,
    );
  }

  async start(): Promise<void> {
    this.#running = true;
  }

  async stop(): Promise<void> {
    this.activeLessons?.close();
    this.#running = false;
  }

  private status(): RuntimeStatus {
    return {
      state: this.#running ? 'running' : 'stopped',
      version: VERSION,
      capabilities: [
        'status',
        'lessons',
        'problems',
        'answer-validation',
        'fixture-replay',
        ...(this.activeLessons
          ? ['active-client', 'lesson-websocket', 'answer-submission']
          : []),
      ],
    };
  }
}

export function createBackendRuntime(
  options?: BackendRuntimeOptions,
): BackendRuntime {
  return new BackendRuntime(options);
}
