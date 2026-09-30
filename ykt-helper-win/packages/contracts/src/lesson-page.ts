import { BrowserTargets, type BrowserEnvironment } from './browser.js';

/** IDs remain strings: classroom lesson IDs exceed Number.MAX_SAFE_INTEGER. */
export function parseLessonPage(value: string | undefined): {
  environment: BrowserEnvironment;
  lessonId: string;
  archived: boolean;
} | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const environment = BrowserTargets.find(
      (target) => new URL(target.startUrl).hostname === url.hostname,
    )?.id;
    if (!environment) return null;
    const report = /^\/v2\/web\/student-lesson-report\/\d+\/(\d+)(?:\/|$)/.exec(
      url.pathname,
    );
    const archive = /^\/m\/v2\/lesson\/student\/(\d+)(?:\/|$)/.exec(
      url.pathname,
    );
    const live = /^\/lesson\/fullscreen\/v3\/(\d+)(?:\/|$)/.exec(url.pathname);
    const lessonId = report?.[1] ?? archive?.[1] ?? live?.[1];
    return lessonId
      ? { environment, lessonId, archived: Boolean(report || archive) }
      : null;
  } catch {
    return null;
  }
}
