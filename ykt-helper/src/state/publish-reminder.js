import { isPublishReminderEnabled } from '../core/publish-events.js';

export function createPublishReminder({ notify, now = () => Date.now(), dedupeMs = 60_000 } = {}) {
  const seenUntil = new Map();

  function prune(time) {
    for (const [key, expiresAt] of seenUntil) {
      if (expiresAt <= time) seenUntil.delete(key);
    }
  }

  return {
    handle(event, config) {
      if (!event || !isPublishReminderEnabled(event, config)) return false;

      const time = now();
      prune(time);
      if (seenUntil.has(event.dedupeKey)) return false;

      seenUntil.set(event.dedupeKey, time + dedupeMs);
      notify?.(event);
      return true;
    },
  };
}
