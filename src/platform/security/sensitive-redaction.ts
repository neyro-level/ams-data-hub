import "server-only";

export const REDACTED_VALUE = "[REDACTED]";
export const REDACTED_URL = "[REDACTED_URL]";

const sensitiveValues = new Set<string>();
const URL_PATTERN = /https?:\/\/[^\s"'<>\])}]+/giu;
const SENSITIVE_KEY_PATTERN = /(?:password|passwd|secret|token|authorization|cookie|api[_-]?key|credential|connection[_-]?string|database[_-]?url)/iu;
const SENSITIVE_URL_KEY_PATTERN = /(?:(?:feed|source|remote|endpoint).*url|url.*(?:feed|source|remote|endpoint))/iu;

export function rememberSensitiveValue(value: string): void {
  if (value.length > 0) sensitiveValues.add(value);
}

export function redactSensitiveText(value: string): string {
  let redacted = value.replace(URL_PATTERN, REDACTED_URL);
  const registered = [...sensitiveValues].sort((left, right) => right.length - left.length);
  for (const sensitiveValue of registered) {
    redacted = redacted.split(sensitiveValue).join(REDACTED_VALUE);
  }
  return redacted;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key) || SENSITIVE_URL_KEY_PATTERN.test(key);
}

function sanitizeError(error: Error, seen: WeakSet<object>): Record<string, unknown> {
  return {
    type: error.name,
    message: redactSensitiveText(error.message),
    stack: error.stack ? redactSensitiveText(error.stack) : undefined,
    cause: error.cause === undefined ? undefined : sanitizeLogValueInternal(error.cause, undefined, seen),
  };
}

function sanitizeLogValueInternal(value: unknown, key: string | undefined, seen: WeakSet<object>): unknown {
  if (key && isSensitiveKey(key)) return REDACTED_VALUE;
  if (typeof value === "string") return redactSensitiveText(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return REDACTED_URL;
  if (value instanceof Error) return sanitizeError(value, seen);
  if (seen.has(value)) return "[Circular]";

  seen.add(value);
  if (Array.isArray(value)) {
    const sanitized = value.map((item) => sanitizeLogValueInternal(item, undefined, seen));
    seen.delete(value);
    return sanitized;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    seen.delete(value);
    return REDACTED_VALUE;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    sanitized[entryKey] = sanitizeLogValueInternal(entryValue, entryKey, seen);
  }
  seen.delete(value);
  return sanitized;
}

export function sanitizeLogValue(value: unknown): unknown {
  return sanitizeLogValueInternal(value, undefined, new WeakSet());
}

export function redactFeedUrlForUi(value: string | URL): typeof REDACTED_URL {
  void value;
  return REDACTED_URL;
}
