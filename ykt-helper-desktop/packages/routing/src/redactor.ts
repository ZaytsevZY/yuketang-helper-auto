const REDACTED = '[REDACTED]';
const MAX_TEXT_LENGTH = 64 * 1024;
const SENSITIVE_KEY =
  /authorization|cookie|token|secret|api[-_]?key|password|session|set-auth/i;
const SENSITIVE_QUERY_KEY =
  /token|authorization|api[-_]?key|password|session|secret|^(code|state|ticket)$/i;

export function sanitizeHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : sanitizeText(value),
    ]),
  );
}

export function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, REDACTED);
    }
    return url.toString();
  } catch {
    return sanitizeText(value);
  }
}

export function sanitizeText(value: string): string {
  const candidate = value.slice(0, MAX_TEXT_LENGTH * 2);
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object') {
      return truncate(JSON.stringify(sanitizeUnknown(parsed)));
    }
  } catch {
    // Continue with text redaction.
  }
  return truncate(
    candidate
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
      .replace(
        /(["']?(?:token|authorization|cookie|api[-_]?key|password|session|secret|set-auth)["']?\s*[:=]\s*["']?)[^"'\s,;&]+/gi,
        `$1${REDACTED}`,
      ),
  );
}

export function sanitizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeUnknown);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        SENSITIVE_KEY.test(key) ? REDACTED : sanitizeUnknown(child),
      ]),
    );
  }
  return typeof value === 'string' ? sanitizeText(value) : value;
}

function truncate(value: string): string {
  if (value.length <= MAX_TEXT_LENGTH) return value;
  return `${value.slice(0, MAX_TEXT_LENGTH)}\n[TRUNCATED]`;
}
