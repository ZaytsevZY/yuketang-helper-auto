import type { BrowserEnvironment } from './browser.js';

/** Browser-observed stages, not a synthetic percentage or a connectivity test. */
export interface LessonCollectionStatus {
  readonly lessonId: string;
  readonly environment: BrowserEnvironment;
  readonly phase:
    | 'waiting'
    | 'requesting'
    | 'receiving'
    | 'parsing'
    | 'ready'
    | 'network-error'
    | 'response-error'
    | 'format-error';
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly receivedBytes: number;
  readonly slideCount: number;
  readonly problemCount: number;
  readonly detail: string;
}
