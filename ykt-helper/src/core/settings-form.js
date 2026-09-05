// src/core/settings-form.js
import { REMINDER_SETTING_KEYS } from './reminder-preferences.js';

function text(value) {
  return String(value ?? '').trim();
}

/**
 * Validate every value before changing the profile.  This keeps an invalid
 * temperature from partially saving a new API URL, key, or model name.
 */
export function applyProfileForm(profile, fields = {}) {
  if (!profile || typeof profile !== 'object') return { ok: false, field: 'profile' };

  const rawTemperature = text(fields.temperature);
  let temperature = '';
  if (rawTemperature !== '') {
    temperature = Number(rawTemperature);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      return { ok: false, field: 'temperature' };
    }
  }

  const next = {
    name: text(fields.name) || profile.name,
    baseUrl: text(fields.baseUrl) || profile.baseUrl,
    apiKey: text(fields.apiKey),
    model: text(fields.model) || profile.model,
    visionModel: text(fields.visionModel) || profile.visionModel,
    temperature,
  };

  Object.assign(profile, next);
  return { ok: true, profile };
}

/** Refresh every reminder input whenever a settings surface becomes visible. */
export function syncReminderForm(fields = {}, config = {}) {
  for (const key of REMINDER_SETTING_KEYS) {
    const field = fields[key];
    if (field) field.checked = config[key] !== false;
  }
}

export function readReminderForm(fields = {}) {
  return Object.fromEntries(
    REMINDER_SETTING_KEYS.map(key => [key, !!fields[key]?.checked]),
  );
}
