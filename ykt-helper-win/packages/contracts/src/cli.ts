import type { JsonValue } from './storage.js';

const windowsCliPipePath = String.raw`\\.\pipe\yuketang-helper-desktop-v1`;
const unixUserSuffix =
  typeof process !== 'undefined' && typeof process.getuid === 'function'
    ? `-${process.getuid()}`
    : '';

export const DesktopCliPipePath =
  typeof process !== 'undefined' && process.platform === 'win32'
    ? windowsCliPipePath
    : `/tmp/yuketang-helper-desktop-v1${unixUserSuffix}.sock`;

export const CliRpcMethod = {
  Status: 'status',
  SettingsGet: 'settings.get',
  SettingsUpdate: 'settings.update',
  SettingsReset: 'settings.reset',
  UserGet: 'user.get',
  LessonList: 'lesson.list',
  LessonConnect: 'lesson.connect',
  PresentationList: 'presentation.list',
  PresentationExport: 'presentation.export',
  SlideGet: 'slide.get',
  SlideRead: 'slide.read',
  SlideDownload: 'slide.download',
  ProblemList: 'problem.list',
  ProblemGet: 'problem.get',
  AiProfileList: 'ai.profile.list',
  AiProfileConnect: 'ai.profile.connect',
  AiProfileRefresh: 'ai.profile.refresh',
  AiProfileUpdateSelection: 'ai.profile.update-selection',
  AiProfileDelete: 'ai.profile.delete',
  AiProfileSelect: 'ai.profile.select',
  AiAsk: 'ai.ask',
  AiTranslate: 'ai.translate',
  AnswerPropose: 'answer.propose',
  AnswerValidate: 'answer.validate',
  AnswerSubmit: 'answer.submit',
  DebugSimulate: 'debug.simulate',
  DebugGetSimulation: 'debug.get-simulation',
  SourceOpenModule: 'source.open-module',
  BrowserState: 'browser.state',
  BrowserSelectEnvironment: 'browser.select-environment',
  BrowserNavigate: 'browser.navigate',
  BrowserBack: 'browser.back',
  BrowserForward: 'browser.forward',
  BrowserReload: 'browser.reload',
  BrowserHome: 'browser.home',
  BrowserNewTab: 'browser.new-tab',
  BrowserActivateTab: 'browser.activate-tab',
  BrowserCloseTab: 'browser.close-tab',
  LayoutSetPanels: 'layout.set-panels',
  NetworkSnapshot: 'network.snapshot',
  NetworkSetPaused: 'network.set-paused',
  NetworkSetDeepCapture: 'network.set-deep-capture',
  NetworkClear: 'network.clear',
  NetworkExport: 'network.export',
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
