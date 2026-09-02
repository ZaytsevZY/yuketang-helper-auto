import {
  ErrorCode,
  YuketangError,
  type AnswerInput,
  type Lesson,
  type LessonEvent,
  type ProblemContext,
  type RuntimeStatus,
  type SubmissionResult,
  type ValidationResult,
  type YuketangFacade,
} from '@ykt/contracts';
import { EmptyRoutingService, type RoutingService } from '@ykt/routing';
import { MemoryKeyValueStore, type KeyValueStore } from '@ykt/storage';

import {
  InMemoryLessonRepository,
  type LessonRepository,
} from './repositories/lesson-repository.js';
import { ProblemService } from './services/problem-service.js';

const VERSION = '0.1.0';

class BaselineFacade implements YuketangFacade {
  constructor(
    private readonly status: () => RuntimeStatus,
    private readonly routing: RoutingService,
    private readonly lessons: LessonRepository,
    private readonly problems: ProblemService,
  ) {}

  async getStatus(): Promise<RuntimeStatus> {
    return this.status();
  }

  async listLessons(): Promise<readonly Lesson[]> {
    return this.lessons.listLessons();
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

  async submitAnswer(_input: AnswerInput): Promise<SubmissionResult> {
    throw new YuketangError({
      code: ErrorCode.NotImplemented,
      message: 'Answer submission requires the M4 active network client.',
    });
  }
}

export interface BackendRuntimeOptions {
  routing?: RoutingService;
  store?: KeyValueStore;
  lessons?: LessonRepository;
}

export class BackendRuntime {
  readonly facade: YuketangFacade;
  readonly store: KeyValueStore;
  readonly lessons: LessonRepository;
  #running = false;

  constructor(options: BackendRuntimeOptions = {}) {
    this.store = options.store ?? new MemoryKeyValueStore();
    this.lessons = options.lessons ?? new InMemoryLessonRepository();
    this.facade = new BaselineFacade(
      () => this.status(),
      options.routing ?? new EmptyRoutingService(),
      this.lessons,
      new ProblemService(this.lessons),
    );
  }

  async start(): Promise<void> {
    this.#running = true;
  }

  async stop(): Promise<void> {
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
      ],
    };
  }
}

export function createBackendRuntime(
  options?: BackendRuntimeOptions,
): BackendRuntime {
  return new BackendRuntime(options);
}
