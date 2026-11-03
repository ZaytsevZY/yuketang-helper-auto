import type { JsonValue } from '@ykt/contracts';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /authorization|cookie|token|secret|api[-_]?key|password|session|set-auth/i;

export function assertSafeSettingKeys(value: object): void {
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new Error(`Sensitive setting ${key} must use SecretStore.`);
    }
    if (child && typeof child === 'object') assertSafeSettingKeys(child);
  }
}

export function redactJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        SENSITIVE_KEY.test(key) ? REDACTED : redactJson(child),
      ]),
    );
  }
  return typeof value === 'string' ? redactText(value) : value;
}

export function redactText(value: string): string {
  return value
    .slice(0, 64 * 1024)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(
      /(["']?(?:token|authorization|cookie|api[-_]?key|password|session|secret|set-auth)["']?\s*[:=]\s*["']?)[^"'\s,;&]+/gi,
      `$1${REDACTED}`,
    );
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, REDACTED);
    }
    return url.toString();
  } catch {
    return redactText(value);
  }
}
