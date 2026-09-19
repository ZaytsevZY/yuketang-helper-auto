import { randomUUID } from 'node:crypto';

import {
  BrowserEnvironment,
  CliRpcMethod,
  ErrorCode,
  YuketangError,
  isBrowserEnvironment,
  type AnswerInput,
  type BrowserState,
  type ClassroomSimulationAction,
  type CliRpcMethod as CliRpcMethodValue,
  type ConnectAiProfileInput,
  type GenerateAnswerProposalInput,
  type JsonValue,
  type NetworkSnapshot,
  type Presentation,
  type Slide,
  type TranslateTextInput,
  type UpdateAiProfileSelectionInput,
  type YuketangFacade,
} from '@ykt/contracts';

import type { DesktopCliHandler } from './cli-server.js';

const SIMULATION_ACTIONS = [
  'reset',
  'show-slide',
  'publish-courseware',
  'publish-problem-object',
  'publish-problem-scalar',
  'finish-lesson',
] as const satisfies readonly ClassroomSimulationAction[];

/**
 * Capabilities that only exist while the request is served by the running
 * desktop process (embedded browser, network lab, local file dialogs).
 * The same RPC handler is exercised in tests without them, so every method
 * backed by these controls degrades to NOT_IMPLEMENTED when they are absent.
 */
export interface CliDesktopControls {
  getBrowserState(): Promise<BrowserState>;
  selectBrowserEnvironment(environment: BrowserEnvironment): Promise<void>;
  navigateBrowser(url: string): Promise<void>;
  browserBack(): void;
  browserForward(): void;
  browserReload(): void;
  browserHome(): Promise<void>;
  browserNewTab(): Promise<void>;
  activateBrowserTab(tabId: string): void;
  closeBrowserTab(tabId: string): Promise<void>;
  captureCurrentPage(): Promise<string>;
  setPanels(input: {
    assistantCollapsed?: boolean;
    networkLabCollapsed?: boolean;
  }): void;
  getNetworkSnapshot(): Promise<NetworkSnapshot>;
  setNetworkPaused(paused: boolean): void;
  setDeepCapture(enabled: boolean): Promise<void>;
  clearNetworkEntries(): void;
  exportNetworkFixture(filePath: string): Promise<{ filePath: string }>;
  downloadSlideToFile(input: {
    imageUrl: string;
    suggestedName: string;
    filePath: string;
  }): Promise<{ filePath: string }>;
  exportPresentationPdfToFile(input: {
    lessonId: string;
    presentationId: string;
    filePath: string;
  }): Promise<{ filePath: string }>;
  openSourceModule(id: string): Promise<void>;
}

export interface DesktopCliContext {
  readonly facade: YuketangFacade;
  openLesson(
    environment: BrowserEnvironment,
    lessonId: string,
    status: 'upcoming' | 'active' | 'ended' | undefined,
  ): Promise<void>;
  prepareImage(imageUrl: string): Promise<string>;
  readonly desktop?: CliDesktopControls;
}

export function createDesktopCliHandler(
  context: DesktopCliContext,
): DesktopCliHandler {
  return async (method, params) => dispatch(context, method, params);
}

async function dispatch(
  context: DesktopCliContext,
  method: CliRpcMethodValue,
  params: JsonValue | undefined,
): Promise<unknown> {
  const facade = context.facade;
  const desktop = () => requireDesktop(context, method);

  switch (method) {
    case CliRpcMethod.Status:
      return facade.getStatus();
    case CliRpcMethod.SettingsGet:
      return facade.getSettings();
    case CliRpcMethod.SettingsUpdate: {
      const patch = record(params);
      if (Object.keys(patch).length === 0) {
        throw invalid('Settings patch must not be empty.');
      }
      return facade.updateSettings(patch);
    }
    case CliRpcMethod.SettingsReset:
      return facade.resetSettings();
    case CliRpcMethod.AiProfileList:
      return facade.listAiProfiles();
    case CliRpcMethod.AiProfileConnect: {
      const input = record(params);
      const baseUrl = stringValue(input.baseUrl, 'base url');
      const apiKey = stringValue(input.apiKey, 'api key');
      const providerId = optionalString(input.providerId);
      const payload: ConnectAiProfileInput = {
        baseUrl,
        apiKey,
        ...(providerId ? { providerId } : {}),
      };
      return facade.connectAiProfile(payload);
    }
    case CliRpcMethod.AiProfileRefresh:
      return facade.refreshAiProfile(
        stringValue(record(params).id, 'profile id'),
      );
    case CliRpcMethod.AiProfileDelete:
      return facade.deleteAiProfile(
        stringValue(record(params).id, 'profile id'),
      );
    case CliRpcMethod.AiProfileSelect:
      return facade.selectAiProfile(
        stringValue(record(params).id, 'profile id'),
      );
    case CliRpcMethod.AiProfileUpdateSelection:
      return facade.updateAiProfileSelection(
        profileSelectionInput(record(params)),
      );
    case CliRpcMethod.AiTranslate:
      return facade.translateText(translateInput(record(params)));
    case CliRpcMethod.DebugSimulate: {
      const action = stringValue(record(params).action, 'simulation action');
      if (!SIMULATION_ACTIONS.includes(action as ClassroomSimulationAction)) {
        throw invalid(`Unsupported simulation action: ${action}`);
      }
      return facade.runClassroomSimulation(action as ClassroomSimulationAction);
    }
    case CliRpcMethod.DebugGetSimulation:
      return facade.getClassroomSimulation();
    case CliRpcMethod.UserGet:
    case CliRpcMethod.AssignmentList:
    case CliRpcMethod.LessonList:
    case CliRpcMethod.LessonConnect:
    case CliRpcMethod.PresentationList:
    case CliRpcMethod.PresentationExport:
    case CliRpcMethod.SlideGet:
    case CliRpcMethod.SlideRead:
    case CliRpcMethod.SlideDownload:
    case CliRpcMethod.ProblemList:
    case CliRpcMethod.ProblemGet:
    case CliRpcMethod.AiAsk:
    case CliRpcMethod.AnswerPropose:
    case CliRpcMethod.AnswerValidate:
    case CliRpcMethod.AnswerSubmit:
    case CliRpcMethod.LogsList:
    case CliRpcMethod.BrowserState:
    case CliRpcMethod.BrowserSelectEnvironment:
    case CliRpcMethod.BrowserNavigate:
    case CliRpcMethod.BrowserBack:
    case CliRpcMethod.BrowserForward:
    case CliRpcMethod.BrowserReload:
    case CliRpcMethod.BrowserHome:
    case CliRpcMethod.BrowserNewTab:
    case CliRpcMethod.BrowserActivateTab:
    case CliRpcMethod.BrowserCloseTab:
    case CliRpcMethod.LayoutSetPanels:
    case CliRpcMethod.NetworkSnapshot:
    case CliRpcMethod.NetworkSetPaused:
    case CliRpcMethod.NetworkSetDeepCapture:
    case CliRpcMethod.NetworkClear:
    case CliRpcMethod.NetworkExport:
    case CliRpcMethod.SourceOpenModule:
      break;
    default:
      throw invalid(`Unsupported CLI method: ${method}`);
  }

  const input = params === undefined ? {} : record(params);
  switch (method) {
    case CliRpcMethod.UserGet: {
      const environment = environmentValue(input.environment);
      return input.refresh === true
        ? facade.refreshUser(environment)
        : facade.getUser(environment);
    }
    case CliRpcMethod.AssignmentList:
      return facade.listAssignments(
        environmentValue(input.environment ?? 'pro'),
      );
    case CliRpcMethod.LessonList:
      return listLessons(context, input);
    case CliRpcMethod.LessonConnect: {
      const environment = environmentValue(input.environment);
      const lessonId = stringValue(input.id, 'lesson id');
      const connectedEnvironment = await facade.connectLesson(
        environment,
        lessonId,
      );
      const lesson = (await facade.listLessons()).find(
        (item) => item.id === lessonId,
      );
      await context.openLesson(connectedEnvironment, lessonId, lesson?.status);
      return { ...lesson, id: lessonId, environment: connectedEnvironment };
    }
    case CliRpcMethod.PresentationList:
      return facade.listPresentations(stringValue(input.lessonId, 'lesson id'));
    case CliRpcMethod.PresentationExport: {
      const controls = desktop();
      const lessonId = stringValue(input.lessonId, 'lesson id');
      const presentationId = stringValue(
        input.presentationId,
        'presentation id',
      );
      const filePath = stringValue(input.filePath, 'output path');
      const presentations = await facade.listPresentations(lessonId);
      if (!presentations.some((item) => item.id === presentationId)) {
        throw new YuketangError({
          code: ErrorCode.NotFound,
          message: `Presentation ${presentationId} was not found in lesson ${lessonId}.`,
        });
      }
      return controls.exportPresentationPdfToFile({
        lessonId,
        presentationId,
        filePath,
      });
    }
    case CliRpcMethod.SlideGet:
    case CliRpcMethod.SlideRead:
    case CliRpcMethod.SlideDownload:
      return handleSlide(context, method, input, desktop);
    case CliRpcMethod.ProblemList:
      return facade.listProblems(stringValue(input.lessonId, 'lesson id'));
    case CliRpcMethod.ProblemGet:
      return facade.getProblem(stringValue(input.id, 'problem id'));
    case CliRpcMethod.AiAsk:
      return askAi(context, input, desktop);
    case CliRpcMethod.AnswerPropose: {
      const problemId = stringValue(input.problemId, 'problem id');
      const problem = await facade.getProblem(problemId);
      const presentations = await facade.listPresentations(problem.lessonId);
      const slide = presentations
        .flatMap((presentation) => presentation.slides)
        .find((item) => item.id === problem.slideId);
      const imageUrls = slide?.imageUrl
        ? [await context.prepareImage(slide.imageUrl)]
        : [];
      const customPrompt = optionalString(input.customPrompt);
      return facade.generateAnswerProposal({
        problemId,
        imageUrls,
        ...(customPrompt ? { customPrompt } : {}),
      });
    }
    case CliRpcMethod.AnswerValidate:
      return facade.validateAnswer(answerInput(input));
    case CliRpcMethod.AnswerSubmit: {
      if (input.commit !== true) {
        throw invalid(
          'Answer submission requires explicit commit confirmation.',
        );
      }
      return facade.submitAnswer(answerInput(input));
    }
    case CliRpcMethod.LogsList: {
      const limit = input.limit === undefined ? undefined : Number(input.limit);
      if (limit !== undefined && !Number.isFinite(limit)) {
        throw invalid('Invalid log limit.');
      }
      return facade.listLogs(limit);
    }
    case CliRpcMethod.BrowserState:
      return desktop().getBrowserState();
    case CliRpcMethod.BrowserSelectEnvironment:
      return desktop().selectBrowserEnvironment(
        environmentValue(input.environment),
      );
    case CliRpcMethod.BrowserNavigate:
      return desktop().navigateBrowser(stringValue(input.url, 'url'));
    case CliRpcMethod.BrowserBack:
      desktop().browserBack();
      return null;
    case CliRpcMethod.BrowserForward:
      desktop().browserForward();
      return null;
    case CliRpcMethod.BrowserReload:
      desktop().browserReload();
      return null;
    case CliRpcMethod.BrowserHome:
      return desktop().browserHome();
    case CliRpcMethod.BrowserNewTab:
      return desktop().browserNewTab();
    case CliRpcMethod.BrowserActivateTab:
      desktop().activateBrowserTab(stringValue(input.id, 'tab id'));
      return null;
    case CliRpcMethod.BrowserCloseTab:
      return desktop().closeBrowserTab(stringValue(input.id, 'tab id'));
    case CliRpcMethod.LayoutSetPanels: {
      const controls = desktop();
      const assistantCollapsed = optionalBoolean(input.assistantCollapsed);
      const networkLabCollapsed = optionalBoolean(input.networkLabCollapsed);
      if (
        assistantCollapsed === undefined &&
        networkLabCollapsed === undefined
      ) {
        throw invalid(
          'Provide at least one of assistantCollapsed or networkLabCollapsed.',
        );
      }
      controls.setPanels({
        ...(assistantCollapsed !== undefined ? { assistantCollapsed } : {}),
        ...(networkLabCollapsed !== undefined ? { networkLabCollapsed } : {}),
      });
      return controls.getBrowserState();
    }
    case CliRpcMethod.NetworkSnapshot:
      return desktop().getNetworkSnapshot();
    case CliRpcMethod.NetworkSetPaused:
      desktop().setNetworkPaused(booleanValue(input.paused, 'paused'));
      return null;
    case CliRpcMethod.NetworkSetDeepCapture:
      await desktop().setDeepCapture(booleanValue(input.enabled, 'enabled'));
      return null;
    case CliRpcMethod.NetworkClear:
      desktop().clearNetworkEntries();
      return null;
    case CliRpcMethod.NetworkExport:
      return desktop().exportNetworkFixture(
        stringValue(input.filePath, 'output path'),
      );
    case CliRpcMethod.SourceOpenModule: {
      const id = stringValue(input.id, 'source module id');
      await desktop().openSourceModule(id);
      return null;
    }
    default:
      throw invalid(`Unsupported CLI method: ${method}`);
  }
}

async function listLessons(
  context: DesktopCliContext,
  input: Record<string, JsonValue>,
): Promise<unknown> {
  const facade = context.facade;
  if (input.refresh !== true) {
    return {
      lessons: (await facade.listLessons()).map((lesson) => ({
        ...lesson,
        environment: null,
      })),
      errors: [],
    };
  }
  const environments = environmentList(input.environment);
  const lessons: unknown[] = [];
  const errors: unknown[] = [];
  for (const environment of environments) {
    try {
      const refreshed = await facade.refreshLessons(environment);
      lessons.push(...refreshed.map((lesson) => ({ ...lesson, environment })));
    } catch (error: unknown) {
      errors.push({
        environment,
        message: error instanceof Error ? error.message : '课堂刷新失败。',
      });
    }
  }
  return { lessons, errors };
}

async function handleSlide(
  context: DesktopCliContext,
  method: CliRpcMethodValue,
  input: Record<string, JsonValue>,
  desktop: () => CliDesktopControls,
): Promise<unknown> {
  const found = await findSlide(
    context.facade,
    stringValue(input.lessonId, 'lesson id'),
    stringValue(input.slideId, 'slide id'),
    optionalString(input.presentationId),
  );
  if (method === CliRpcMethod.SlideGet) return found;
  if (method === CliRpcMethod.SlideRead) {
    if (!found.slide.imageUrl) {
      throw new YuketangError({
        code: ErrorCode.NotFound,
        message: `Slide ${found.slide.id} does not have an image.`,
      });
    }
    const recognized = await context.facade.recognizeSlide({
      imageUrl: await context.prepareImage(found.slide.imageUrl),
    });
    return { ...found, recognized };
  }
  if (!found.slide.imageUrl) {
    throw new YuketangError({
      code: ErrorCode.NotFound,
      message: `Slide ${found.slide.id} does not have an image to download.`,
    });
  }
  return desktop().downloadSlideToFile({
    imageUrl: found.slide.imageUrl,
    suggestedName: `${found.presentationTitle}-${found.slide.index + 1}`,
    filePath: stringValue(input.filePath, 'output path'),
  });
}

async function askAi(
  context: DesktopCliContext,
  input: Record<string, JsonValue>,
  desktop: () => CliDesktopControls,
): Promise<unknown> {
  const facade = context.facade;
  const customPrompt = stringValue(input.prompt, 'prompt');
  const problemId = optionalString(input.problemId);
  const contextId = optionalString(input.contextId);
  const sessionId = optionalString(input.sessionId);
  const explicitImages = stringArray(input.images);
  const captureCurrentPage = input.captureCurrentPage === true;

  let imageUrls: string[] = [];
  let imageSource: GenerateAnswerProposalInput['imageSource'] | undefined;
  if (explicitImages.length > 0) {
    imageUrls = await Promise.all(
      explicitImages.map((url) => context.prepareImage(url)),
    );
    imageSource = 'slide';
  } else if (problemId) {
    const problem = await facade.getProblem(problemId);
    const presentations = await facade.listPresentations(problem.lessonId);
    const slide = presentations
      .flatMap((presentation) => presentation.slides)
      .find((item) => item.id === problem.slideId);
    if (slide?.imageUrl) {
      imageUrls = [await context.prepareImage(slide.imageUrl)];
      imageSource = 'slide';
    }
  }
  if (imageUrls.length === 0 && captureCurrentPage) {
    imageUrls = [await desktop().captureCurrentPage()];
    imageSource = 'browser-page';
  }

  return facade.generateAnswerProposal({
    ...(problemId
      ? { problemId }
      : { contextId: contextId ?? `cli:${randomUUID()}` }),
    ...(imageUrls.length ? { imageUrls } : {}),
    ...(imageSource ? { imageSource } : {}),
    customPrompt,
    ...(sessionId ? { sessionId } : {}),
    ...(input.retry === true ? { retry: true } : {}),
  });
}

function requireDesktop(
  context: DesktopCliContext,
  method: CliRpcMethodValue,
): CliDesktopControls {
  if (!context.desktop) {
    throw new YuketangError({
      code: ErrorCode.NotImplemented,
      message: `Method ${method} requires the running desktop app with desktop capabilities.`,
    });
  }
  return context.desktop;
}

async function findSlide(
  facade: YuketangFacade,
  lessonId: string,
  slideId: string,
  presentationId: string | undefined,
): Promise<{
  lessonId: string;
  presentationId: string;
  presentationTitle: string;
  slide: Slide;
}> {
  const presentations = await facade.listPresentations(lessonId);
  const matches = presentations.flatMap((presentation) =>
    presentationId && presentation.id !== presentationId
      ? []
      : slideMatches(presentation, slideId),
  );
  if (matches.length === 0) {
    throw new YuketangError({
      code: ErrorCode.NotFound,
      message: `Slide ${slideId} was not found in lesson ${lessonId}.`,
    });
  }
  if (matches.length > 1) {
    throw new YuketangError({
      code: ErrorCode.Conflict,
      message: 'Slide id is ambiguous; provide --presentation.',
    });
  }
  return matches[0]!;
}

function slideMatches(
  presentation: Presentation,
  slideId: string,
): readonly {
  lessonId: string;
  presentationId: string;
  presentationTitle: string;
  slide: Slide;
}[] {
  const slide = presentation.slides.find((item) => item.id === slideId);
  return slide
    ? [
        {
          lessonId: presentation.lessonId,
          presentationId: presentation.id,
          presentationTitle: presentation.title,
          slide,
        },
      ]
    : [];
}

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('CLI request parameters must be an object.');
  }
  return value as Record<string, JsonValue>;
}

function stringValue(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalid(`Invalid ${label}.`);
  }
  return value;
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function booleanValue(value: JsonValue | undefined, label: string): boolean {
  if (typeof value !== 'boolean') throw invalid(`Invalid ${label}.`);
  return value;
}

function optionalBoolean(value: JsonValue | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw invalid('Invalid boolean flag.');
  return value;
}

function stringArray(value: JsonValue | undefined): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw invalid('Expected an array of URL strings.');
  }
  return value as string[];
}

function environmentValue(value: JsonValue | undefined): BrowserEnvironment {
  if (!isBrowserEnvironment(value)) throw invalid('Invalid environment.');
  return value;
}

function environmentList(
  value: JsonValue | undefined,
): readonly BrowserEnvironment[] {
  if (value === 'all' || value === undefined) {
    return [
      BrowserEnvironment.Standard,
      BrowserEnvironment.Pro,
      BrowserEnvironment.Changjiang,
    ];
  }
  return [environmentValue(value)];
}

function profileSelectionInput(
  value: Record<string, JsonValue>,
): UpdateAiProfileSelectionInput {
  const temperature = value.temperature;
  if (
    typeof value.id !== 'string' ||
    typeof value.model !== 'string' ||
    typeof value.visionModel !== 'string' ||
    typeof value.ocrModel !== 'string' ||
    typeof value.translationModel !== 'string' ||
    (temperature !== null && typeof temperature !== 'number')
  ) {
    throw invalid('Invalid AI model selection.');
  }
  return {
    id: value.id,
    model: value.model,
    visionModel: value.visionModel,
    ocrModel: value.ocrModel,
    translationModel: value.translationModel,
    temperature: temperature as number | null,
  };
}

function translateInput(value: Record<string, JsonValue>): TranslateTextInput {
  const text = stringValue(value.text, 'text');
  const targetLanguage = stringValue(value.targetLanguage, 'target language');
  return { text, targetLanguage };
}

function answerInput(value: Record<string, JsonValue>): AnswerInput {
  const problemId = stringValue(value.problemId, 'problem id');
  if (value.answer === undefined || value.answer === null) {
    throw invalid('Answer is required.');
  }
  const idempotencyKey = optionalString(value.idempotencyKey);
  const proposalId = optionalString(value.proposalId);
  return {
    problemId,
    answer: value.answer as AnswerInput['answer'],
    ...(typeof value.forceRetry === 'boolean'
      ? { forceRetry: value.forceRetry }
      : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(proposalId ? { proposalId } : {}),
    ...(value.confirmedBy === 'user' || value.confirmedBy === 'agent'
      ? { confirmedBy: value.confirmedBy }
      : {}),
  };
}

function invalid(message: string): YuketangError {
  return new YuketangError({ code: ErrorCode.InvalidArgument, message });
}
