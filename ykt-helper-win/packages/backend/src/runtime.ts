import {
  ErrorCode,
  DefaultAppSettings,
  YuketangError,
  type AiProfileView,
  type AnswerInput,
  type AnswerProposal,
  type AppLogEntry,
  type AppSettings,
  type BrowserEnvironment,
  type ClassroomNotice,
  type ClassroomSimulationAction,
  type ClassroomSimulationState,
  type ConnectAiProfileInput,
  type GenerateAnswerProposalInput,
  type GeneratedTextResult,
  type Lesson,
  type LessonEvent,
  type Presentation,
  type ProblemContext,
  type RecognizeSlideInput,
  type RuntimeStatus,
  type SubmissionResult,
  type TranslateTextInput,
  type UpdateAiProfileSelectionInput,
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
  MemorySecretStore,
  type AppDataStore,
  type KeyValueStore,
  type ResourceCache,
  type SecretStore,
} from '@ykt/storage';

import {
  InMemoryLessonRepository,
  type LessonRepository,
} from './repositories/lesson-repository.js';
import {
  ActiveLessonService,
  isClassroomSimulationLesson,
} from './services/active-lesson-service.js';
import { AiService } from './services/ai-service.js';
import { ProblemService } from './services/problem-service.js';
import { OpenAiCompatibleProvider } from './llm/openai-compatible-provider.js';
import type { AiProviderPlugin } from './llm/provider.js';
import { systemClock } from './workflows/lesson-state-machine.js';

const VERSION = '2.0.0';

class BaselineFacade implements YuketangFacade {
  constructor(
    private readonly status: () => RuntimeStatus,
    private readonly routing: RoutingService,
    private readonly lessons: LessonRepository,
    private readonly problems: ProblemService,
    private readonly activeLessons: ActiveLessonService | undefined,
    private readonly storage: AppDataStore,
    private readonly ai: AiService,
  ) {}

  async getStatus(): Promise<RuntimeStatus> {
    return this.status();
  }

  async getSettings(): Promise<AppSettings> {
    return this.storage.getSettings();
  }

  async updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    return this.withLog(
      'settings',
      '设置已更新。',
      () => this.storage.updateSettings(settings),
      { keys: Object.keys(settings) },
    );
  }

  async resetSettings(): Promise<AppSettings> {
    return this.withLog(
      'settings',
      '设置已恢复默认值。',
      async () => {
        await this.ai.resetProfiles();
        return this.storage.updateSettings(DefaultAppSettings);
      },
      { keys: Object.keys(DefaultAppSettings) },
    );
  }

  async listAiProfiles(): Promise<readonly AiProfileView[]> {
    return this.ai.listProfiles();
  }

  async connectAiProfile(
    input: ConnectAiProfileInput,
  ): Promise<readonly AiProfileView[]> {
    return this.withLog(
      'ai-profile',
      'AI 服务已连接并发现模型。',
      () => this.ai.connectProfile(input),
      { baseUrl: input.baseUrl },
    );
  }

  async refreshAiProfile(id: string): Promise<readonly AiProfileView[]> {
    return this.withLog(
      'ai-profile',
      'AI Profile 模型已刷新。',
      () => this.ai.refreshProfile(id),
      { profileId: id },
    );
  }

  async updateAiProfileSelection(
    input: UpdateAiProfileSelectionInput,
  ): Promise<readonly AiProfileView[]> {
    return this.withLog(
      'ai-profile',
      'AI Profile 模型选择已更新。',
      () => this.ai.updateSelection(input),
      { profileId: input.id },
    );
  }

  async deleteAiProfile(id: string): Promise<readonly AiProfileView[]> {
    return this.withLog(
      'ai-profile',
      'AI Profile 已删除。',
      () => this.ai.deleteProfile(id),
      { profileId: id },
    );
  }

  async selectAiProfile(id: string): Promise<readonly AiProfileView[]> {
    return this.withLog(
      'ai-profile',
      '默认 AI Profile 已切换。',
      () => this.ai.selectProfile(id),
      { profileId: id },
    );
  }

  async getClassroomSimulation(): Promise<ClassroomSimulationState> {
    return this.requireActiveClient().getSimulation();
  }

  async runClassroomSimulation(
    action: ClassroomSimulationAction,
  ): Promise<ClassroomSimulationState> {
    return this.withLog(
      'classroom-simulator',
      '课堂模拟事件已发送。',
      () => this.requireActiveClient().runSimulation(action),
      { action },
    );
  }

  async generateAnswerProposal(
    input: GenerateAnswerProposalInput,
  ): Promise<AnswerProposal> {
    const proposal = await this.ai.generateProposal(input);
    await this.storage.appendLog({
      level: proposal.status === 'ready' ? 'info' : 'warn',
      scope: 'ai',
      message:
        proposal.status === 'ready'
          ? 'AI 答案建议已生成。'
          : 'AI 答案建议生成失败。',
      details: {
        problemId: input.problemId ?? input.contextId ?? '',
        proposalId: proposal.id,
        sessionId: proposal.sessionId,
        retry: input.retry === true,
        ...(proposal.failureReason
          ? { failureReason: proposal.failureReason }
          : {}),
      },
    });
    return proposal;
  }

  async recognizeSlide(
    input: RecognizeSlideInput,
  ): Promise<GeneratedTextResult> {
    return this.withLog(
      'ocr',
      '课件文字已识别。',
      () => this.ai.recognizeSlide(input),
      { source: 'courseware-image' },
    );
  }

  async translateText(input: TranslateTextInput): Promise<GeneratedTextResult> {
    return this.withLog(
      'translation',
      '课件文字已翻译。',
      () => this.ai.translateText(input),
      { targetLanguage: input.targetLanguage },
    );
  }

  async getUser(environment: BrowserEnvironment): Promise<UserProfile | null> {
    return this.storage.getUser(environment);
  }

  async refreshUser(environment: BrowserEnvironment): Promise<UserProfile> {
    return this.withLog(
      'user',
      '用户信息已刷新。',
      () => this.requireActiveClient().refreshUser(environment),
      { environment },
    );
  }

  async listLogs(limit?: number): Promise<readonly AppLogEntry[]> {
    return this.storage.listLogs(limit);
  }

  async listLessons(): Promise<readonly Lesson[]> {
    return this.lessons
      .listLessons()
      .filter((lesson) => !isClassroomSimulationLesson(lesson.id));
  }

  async refreshLessons(
    environment: BrowserEnvironment,
  ): Promise<readonly Lesson[]> {
    return this.withLog(
      'lesson',
      '课堂列表已刷新。',
      () => this.requireActiveClient().refreshLessons(environment),
      { environment },
    );
  }

  async connectLesson(
    environment: BrowserEnvironment,
    id: string,
  ): Promise<BrowserEnvironment> {
    return this.withLog(
      'lesson',
      '已开始收集官方课堂数据。',
      () => this.requireActiveClient().connectLesson(environment, id),
      { environment, lessonId: id },
    );
  }

  async listPresentations(lessonId: string): Promise<readonly Presentation[]> {
    return [
      ...(this.lessons.getSession(lessonId)?.presentations.values() ?? []),
    ];
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
    return this.withLog(
      'answer',
      '答案已校验。',
      async () => this.problems.validateAnswer(input),
      {
        problemId: input.problemId,
        ...(input.confirmedBy ? { confirmedBy: input.confirmedBy } : {}),
      },
    );
  }

  async submitAnswer(input: AnswerInput): Promise<SubmissionResult> {
    const settings = await this.storage.getSettings();
    if (
      input.confirmedBy === 'agent' &&
      (!settings.llmAutoGenerate || !settings.llmManagedSubmit)
    ) {
      throw new YuketangError({
        code: ErrorCode.PermissionDenied,
        message: 'LLM 托管提交未开启，请在题目页核对后手动提交。',
      });
    }
    if (this.activeLessons) {
      return this.withLog(
        'answer',
        input.confirmedBy === 'agent' ? 'Agent 答案已提交。' : '答案已提交。',
        async () => {
          if (input.confirmedBy && !input.proposalId) {
            throw new Error('确认主体只能用于关联的 AI 建议。');
          }
          const proposal = input.proposalId
            ? await this.ai.getProposal(input.proposalId)
            : null;
          if (input.proposalId && !proposal) {
            throw new Error('关联的 AI 建议不存在。');
          }
          if (proposal && proposal.problemId !== input.problemId) {
            throw new Error('AI 建议与当前题目不匹配。');
          }
          if (proposal && proposal.status !== 'ready') {
            throw new Error('失败的 AI 建议不能用于提交。');
          }
          if (proposal && !input.confirmedBy) {
            throw new Error('采用 AI 建议提交时必须明确确认主体。');
          }
          const result = await this.activeLessons!.submitAnswer(input);
          if (!proposal || result.status !== 'submitted') return result;
          const submittedAnswer = this.problems.validateAnswer({
            ...input,
            forceRetry: true,
          }).normalizedAnswer;
          if (!submittedAnswer) return result;
          return {
            ...result,
            proposalOutcome: await this.ai.recordOutcome(
              proposal,
              input,
              submittedAnswer,
              result.submittedAt,
            ),
          };
        },
        {
          problemId: input.problemId,
          ...(input.proposalId ? { proposalId: input.proposalId } : {}),
          ...(input.confirmedBy ? { confirmedBy: input.confirmedBy } : {}),
        },
      );
    }
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

  private async withLog<T>(
    scope: string,
    message: string,
    action: () => Promise<T>,
    details: Record<string, string | readonly string[]>,
  ): Promise<T> {
    try {
      const result = await action();
      await this.storage.appendLog({ level: 'info', scope, message, details });
      return result;
    } catch (error) {
      await this.storage.appendLog({
        level: 'error',
        scope,
        message: `${message.slice(0, -1)}失败。`,
        details: {
          ...details,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      throw error;
    }
  }
}

export interface BackendRuntimeOptions {
  routing?: RoutingService;
  store?: KeyValueStore;
  lessons?: LessonRepository;
  activeClient?: YuketangActiveClient;
  dataStore?: AppDataStore;
  resourceCache?: ResourceCache;
  secretStore?: SecretStore;
  fetcher?: typeof fetch;
  aiProviders?: readonly AiProviderPlugin[];
  onClassroomNotice?: (notice: ClassroomNotice) => void;
}

export class BackendRuntime {
  readonly facade: YuketangFacade;
  readonly store: KeyValueStore;
  readonly lessons: LessonRepository;
  readonly activeLessons: ActiveLessonService | undefined;
  readonly dataStore: AppDataStore;
  readonly resourceCache: ResourceCache | undefined;
  readonly secretStore: SecretStore;
  #running = false;

  constructor(options: BackendRuntimeOptions = {}) {
    this.store = options.store ?? new MemoryKeyValueStore();
    this.dataStore = options.dataStore ?? new MemoryAppDataStore();
    this.resourceCache = options.resourceCache;
    this.secretStore = options.secretStore ?? new MemorySecretStore();
    this.lessons = options.lessons ?? new InMemoryLessonRepository();
    this.activeLessons = options.activeClient
      ? new ActiveLessonService(
          options.activeClient,
          this.lessons,
          this.dataStore,
          systemClock,
          options.onClassroomNotice,
        )
      : undefined;
    const problems = new ProblemService(this.lessons);
    const ai = new AiService(this.dataStore, this.secretStore, problems, [
      ...(options.aiProviders ?? []),
      new OpenAiCompatibleProvider(options.fetcher),
    ]);
    this.facade = new BaselineFacade(
      () => this.status(),
      options.routing ?? new EmptyRoutingService(),
      this.lessons,
      problems,
      this.activeLessons,
      this.dataStore,
      ai,
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
        'ai-profiles',
        'ai-proposals',
        'ocr',
        'translation',
        'classroom-notices',
        ...(this.resourceCache ? ['resource-cache'] : []),
        ...(this.activeLessons
          ? [
              'active-client',
              'lesson-websocket',
              'answer-submission',
              'classroom-simulator',
            ]
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
