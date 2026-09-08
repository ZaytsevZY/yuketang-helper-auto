import type { JsonValue } from './storage.js';

export const DesktopCliPipePath = String.raw`\\.\pipe\yuketang-helper-desktop-v1`;

export const CliRpcMethod = {
  Status: 'status',
  SettingsGet: 'settings.get',
  UserGet: 'user.get',
  LessonList: 'lesson.list',
  LessonConnect: 'lesson.connect',
  PresentationList: 'presentation.list',
  SlideGet: 'slide.get',
  SlideRead: 'slide.read',
  ProblemList: 'problem.list',
  ProblemGet: 'problem.get',
  AiProfileList: 'ai.profile.list',
  AnswerPropose: 'answer.propose',
  AnswerValidate: 'answer.validate',
  AnswerSubmit: 'answer.submit',
  LogsList: 'logs.list',
} as const;

export type CliRpcMethod = (typeof CliRpcMethod)[keyof typeof CliRpcMethod];

export interface CliRpcRequest {
  readonly version: 1;
  readonly id: string;
  readonly method: CliRpcMethod;
  readonly params?: JsonValue;
}

export interface CliRpcError {
  readonly code: string;
  readonly message: string;
  readonly details?: JsonValue;
}

export type CliRpcResponse =
  | {
      readonly version: 1;
      readonly id: string;
      readonly ok: true;
      readonly result: JsonValue;
    }
  | {
      readonly version: 1;
      readonly id: string;
      readonly ok: false;
      readonly error: CliRpcError;
    };
