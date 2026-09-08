import type { BrowserEnvironment } from './browser.js';
import type { AiProfileConfig } from './assistant.js';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface AppSettings {
  readonly browserEnvironment: BrowserEnvironment | null;
  readonly notifyProblems: boolean;
  readonly notifyProblemStarts: boolean;
  readonly notifyAssessmentPublishes: boolean;
  readonly notifyCoursewarePublishes: boolean;
  readonly notifyOtherPublishes: boolean;
  readonly notifyLessonFinished: boolean;
  readonly notifyAutoAnswerScheduled: boolean;
  readonly notifyAutoAnswerStarted: boolean;
  readonly notifyAutoAnswerSucceeded: boolean;
  readonly notifyAutoAnswerFailed: boolean;
  readonly notifyNative: boolean;
  readonly notifyPopup: boolean;
  readonly notifySound: boolean;
  readonly notifyPopupDuration: number;
  readonly notifyVolume: number;
  readonly customNotifyAudioSrc: string;
  readonly customNotifyAudioName: string;
  readonly autoJoinEnabled: boolean;
  readonly autoAnswerOnAutoJoin: boolean;
  readonly autoAnswer: boolean;
  readonly autoAnswerDelay: number;
  readonly autoAnswerRandomDelay: number;
  readonly keepScreenAwake: boolean;
  readonly aiAutoAnalyze: boolean;
  readonly aiSlidePickPriority: boolean;
  readonly activeAiProfileId: string;
  readonly aiProfiles: readonly AiProfileConfig[];
  readonly iftex: boolean;
  readonly showAllSlides: boolean;
  readonly maxPresentations: number;
  readonly cacheMaxBytes: number;
  readonly logRetentionDays: number;
  readonly [key: string]: JsonValue;
}

export const DefaultAppSettings: AppSettings = Object.freeze({
  browserEnvironment: null,
  notifyProblems: true,
  notifyProblemStarts: true,
  notifyAssessmentPublishes: true,
  notifyCoursewarePublishes: true,
  notifyOtherPublishes: true,
  notifyLessonFinished: true,
  notifyAutoAnswerScheduled: true,
  notifyAutoAnswerStarted: true,
  notifyAutoAnswerSucceeded: true,
  notifyAutoAnswerFailed: true,
  notifyNative: true,
  notifyPopup: true,
  notifySound: true,
  notifyPopupDuration: 5000,
  notifyVolume: 0.6,
  customNotifyAudioSrc: '',
  customNotifyAudioName: '',
  autoJoinEnabled: false,
  autoAnswerOnAutoJoin: true,
  autoAnswer: false,
  autoAnswerDelay: 3000,
  autoAnswerRandomDelay: 2000,
  keepScreenAwake: false,
  aiAutoAnalyze: false,
  aiSlidePickPriority: true,
  activeAiProfileId: '',
  aiProfiles: [],
  iftex: true,
  showAllSlides: false,
  maxPresentations: 5,
  cacheMaxBytes: 256 * 1024 * 1024,
  logRetentionDays: 14,
});

export interface UserProfile {
  environment: BrowserEnvironment;
  id: string;
  name: string;
  updatedAt: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppLogEntry {
  id: number;
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  details: JsonValue | null;
}

export interface NewAppLogEntry {
  timestamp?: string;
  level: LogLevel;
  scope: string;
  message: string;
  details?: JsonValue;
}
