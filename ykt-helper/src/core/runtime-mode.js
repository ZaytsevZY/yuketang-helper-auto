// src/core/runtime-mode.js

export function isMobileReminderPath(pathname = '') {
  return /^\/m\/v2(?:\/|$)/.test(String(pathname));
}

/** Mobile /m/v2 only monitors classroom events; it never starts auto-answer. */
export function getRuntimeMode(pathname = '') {
  return isMobileReminderPath(pathname) ? 'mobile-reminder' : 'desktop';
}

/** Root URLs are redirect entry points, not a full desktop runtime yet. */
export function shouldStartDesktopRuntime(pathname = '') {
  const normalizedPath = String(pathname);
  return normalizedPath !== '/' && normalizedPath !== ''
    && getRuntimeMode(normalizedPath) === 'desktop';
}
