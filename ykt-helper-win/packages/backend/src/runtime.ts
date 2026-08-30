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

const VERSION = '0.1.0';

class BaselineFacade implements YuketangFacade {
  constructor(
    private readonly status: () => RuntimeStatus,
    private readonly routing: RoutingService,
  ) {}

  async getStatus(): Promise<RuntimeStatus> {
    return this.status();
  }

  async listLessons(): Promise<readonly Lesson[]> {
    return [];
  }

  watchLesson(id: string): AsyncIterable<LessonEvent> {
    return this.routing.events(id);
  }

  async getProblem(id: string): Promise<ProblemContext> {
    throw new YuketangError({
      code: ErrorCode.NotFound,
      message: `Problem ${id} is not available in the M0 runtime.`,
    });
  }

  async validateAnswer(input: AnswerInput): Promise<ValidationResult> {
    return {
      valid: input.problemId.length > 0 && input.answer.length > 0,
      issues:
        input.problemId.length > 0 && input.answer.length > 0
          ? []
          : ['problemId and answer are required'],
    };
  }

  async submitAnswer(_input: AnswerInput): Promise<SubmissionResult> {
    throw new YuketangError({
      code: ErrorCode.NotImplemented,
      message: 'Answer submission is not available in M0.',
    });
  }
}

export interface BackendRuntimeOptions {
  routing?: RoutingService;
  store?: KeyValueStore;
}

export class BackendRuntime {
  readonly facade: YuketangFacade;
  readonly store: KeyValueStore;
  #running = false;

  constructor(options: BackendRuntimeOptions = {}) {
    this.store = options.store ?? new MemoryKeyValueStore();
    this.facade = new BaselineFacade(
      () => this.status(),
      options.routing ?? new EmptyRoutingService(),
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
      capabilities: ['status'],
    };
  }
}

export function createBackendRuntime(
  options?: BackendRuntimeOptions,
): BackendRuntime {
  return new BackendRuntime(options);
}
