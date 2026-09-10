import {
  BrowserEnvironment,
  CliRpcMethod,
  ErrorCode,
  YuketangError,
  isBrowserEnvironment,
  type AnswerInput,
  type CliRpcMethod as CliRpcMethodValue,
  type JsonValue,
  type Presentation,
  type Slide,
  type YuketangFacade,
} from '@ykt/contracts';

import type { DesktopCliHandler } from './cli-server.js';

export interface DesktopCliContext {
  readonly facade: YuketangFacade;
  openLesson(
    environment: BrowserEnvironment,
    lessonId: string,
    status: 'upcoming' | 'active' | 'ended' | undefined,
  ): Promise<void>;
  prepareImage(imageUrl: string): Promise<string>;
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
  if (method === CliRpcMethod.Status) return facade.getStatus();
  if (method === CliRpcMethod.SettingsGet) return facade.getSettings();
  if (method === CliRpcMethod.AiProfileList) return facade.listAiProfiles();

  const input = record(params);
  if (method === CliRpcMethod.UserGet) {
    const environment = environmentValue(input.environment);
    return input.refresh === true
      ? facade.refreshUser(environment)
      : facade.getUser(environment);
  }
  if (method === CliRpcMethod.LessonList) {
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
        lessons.push(
          ...refreshed.map((lesson) => ({ ...lesson, environment })),
        );
      } catch (error: unknown) {
        errors.push({
          environment,
          message: error instanceof Error ? error.message : '课堂刷新失败。',
        });
      }
    }
    return { lessons, errors };
  }
  if (method === CliRpcMethod.LessonConnect) {
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
  if (method === CliRpcMethod.PresentationList) {
    return facade.listPresentations(stringValue(input.lessonId, 'lesson id'));
  }
  if (method === CliRpcMethod.SlideGet || method === CliRpcMethod.SlideRead) {
    const found = await findSlide(
      facade,
      stringValue(input.lessonId, 'lesson id'),
      stringValue(input.slideId, 'slide id'),
      optionalString(input.presentationId),
    );
    if (method === CliRpcMethod.SlideGet) return found;
    if (!found.slide.imageUrl) {
      throw new YuketangError({
        code: ErrorCode.NotFound,
        message: `Slide ${found.slide.id} does not have an image.`,
      });
    }
    const recognized = await facade.recognizeSlide({
      imageUrl: await context.prepareImage(found.slide.imageUrl),
    });
    return { ...found, recognized };
  }
  if (method === CliRpcMethod.ProblemList) {
    return facade.listProblems(stringValue(input.lessonId, 'lesson id'));
  }
  if (method === CliRpcMethod.ProblemGet) {
    return facade.getProblem(stringValue(input.id, 'problem id'));
  }
  if (method === CliRpcMethod.AnswerPropose) {
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
  if (method === CliRpcMethod.AnswerValidate) {
    return facade.validateAnswer(answerInput(input));
  }
  if (method === CliRpcMethod.AnswerSubmit) {
    if (input.commit !== true) {
      throw invalid('Answer submission requires explicit commit confirmation.');
    }
    return facade.submitAnswer(answerInput(input));
  }
  if (method === CliRpcMethod.LogsList) {
    const limit = input.limit === undefined ? undefined : Number(input.limit);
    if (limit !== undefined && !Number.isFinite(limit)) {
      throw invalid('Invalid log limit.');
    }
    return facade.listLogs(limit);
  }
  throw invalid(`Unsupported CLI method: ${method}`);
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
