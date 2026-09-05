import { isPublishReminderEnabled } from '../core/publish-events.js';

/**
 * Shares the short de-duplication window used by every realtime reminder.
 * Different event kinds have their own dedupe keys, so a new question cannot
 * suppress a courseware notification (or the other way around).
 */
export function createEventReminder({
  notify,
  isEnabled = () => true,
  now = () => Date.now(),
  dedupeMs = 60_000,
} = {}) {
  const seenUntil = new Map();

  function prune(time) {
    for (const [key, expiresAt] of seenUntil) {
      if (expiresAt <= time) seenUntil.delete(key);
    }
  }

  return {
    handle(event, config) {
      if (!event || !event.dedupeKey || !isEnabled(event, config)) return false;

      const time = now();
      prune(time);
      if (seenUntil.has(event.dedupeKey)) return false;

      seenUntil.set(event.dedupeKey, time + dedupeMs);
      notify?.(event);
      return true;
    },
  };
}

export function createPublishReminder(options = {}) {
  return createEventReminder({
    ...options,
    isEnabled: options.isEnabled || isPublishReminderEnabled,
  });
}
