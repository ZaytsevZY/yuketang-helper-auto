import {
  ErrorCode,
  YuketangError,
  type AnswerInput,
  type AppLogEntry,
  type AppSettings,
  type BrowserEnvironment,
  type Lesson,
  type LessonEvent,
  type ProblemContext,
  type RuntimeStatus,
  type SubmissionResult,
  type UserProfile,
  type ValidationResult,
  type YuketangFacade,
} from '@ykt/contracts';
import {
  EmptyRoutingService,
  type RoutingService,
  type YuketangActiveClient,
} from '@ykt/routing';
import {
  MemoryAppDataStore,
  MemoryKeyValueStore,
  type AppDataStore,
  type KeyValueStore,
  type ResourceCache,
} from '@ykt/storage';

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
    private readonly storage: AppDataStore,
  ) {}

  async getStatus(): Promise<RuntimeStatus> {
    return this.status();
  }

  async getSettings(): Promise<AppSettings> {
    return this.storage.getSettings();
  }

  async updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    return this.storage.updateSettings(settings);
  }

  async getUser(environment: BrowserEnvironment): Promise<UserProfile | null> {
    return this.storage.getUser(environment);
  }

  async refreshUser(environment: BrowserEnvironment): Promise<UserProfile> {
    return this.requireActiveClient().refreshUser(environment);
  }

  async listLogs(limit?: number): Promise<readonly AppLogEntry[]> {
    return this.storage.listLogs(limit);
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
  dataStore?: AppDataStore;
  resourceCache?: ResourceCache;
}

export class BackendRuntime {
  readonly facade: YuketangFacade;
  readonly store: KeyValueStore;
  readonly lessons: LessonRepository;
  readonly activeLessons: ActiveLessonService | undefined;
  readonly dataStore: AppDataStore;
  readonly resourceCache: ResourceCache | undefined;
  #running = false;

  constructor(options: BackendRuntimeOptions = {}) {
    this.store = options.store ?? new MemoryKeyValueStore();
    this.dataStore = options.dataStore ?? new MemoryAppDataStore();
    this.resourceCache = options.resourceCache;
    this.lessons = options.lessons ?? new InMemoryLessonRepository();
    this.activeLessons = options.activeClient
      ? new ActiveLessonService(
          options.activeClient,
          this.lessons,
          this.dataStore,
        )
      : undefined;
    this.facade = new BaselineFacade(
      () => this.status(),
      options.routing ?? new EmptyRoutingService(),
      this.lessons,
      new ProblemService(this.lessons),
      this.activeLessons,
      this.dataStore,
    );
  }

  async start(): Promise<void> {
    await this.dataStore.cleanup();
    this.#running = true;
    await this.dataStore.appendLog({
      level: 'info',
      scope: 'runtime',
      message: 'Backend runtime started.',
    });
  }

  async stop(): Promise<void> {
    if (!this.#running) return;
    this.#running = false;
    this.activeLessons?.close();
    await this.dataStore.appendLog({
      level: 'info',
      scope: 'runtime',
      message: 'Backend runtime stopped.',
    });
    this.resourceCache?.close();
    this.dataStore.close();
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
        'storage',
        ...(this.resourceCache ? ['resource-cache'] : []),
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
