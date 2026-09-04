import type { BrowserEnvironment } from './browser.js';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface AppSettings {
  readonly notifyProblems: boolean;
  readonly autoAnswer: boolean;
  readonly autoAnswerDelay: number;
  readonly autoAnswerRandomDelay: number;
  readonly iftex: boolean;
  readonly showAllSlides: boolean;
  readonly maxPresentations: number;
  readonly cacheMaxBytes: number;
  readonly logRetentionDays: number;
  readonly [key: string]: JsonValue;
}

export const DefaultAppSettings: AppSettings = Object.freeze({
  notifyProblems: true,
  autoAnswer: false,
  autoAnswerDelay: 3000,
  autoAnswerRandomDelay: 2000,
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
