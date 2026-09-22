/**
 * Server-side logger.
 *
 * Minimal and dependency-free on purpose — Phase 1 establishes a single place to
 * log instead of scattered `console.*` calls, so Phase 13 can swap in a real
 * transport without touching call sites.
 *
 * `import "server-only"` prevents this (and anything importing it) from ending up
 * in a browser bundle. Log records are structured and redacted: secrets, tokens,
 * cookies and connection strings are dropped before they can reach a log sink.
 */

import "server-only";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Read directly from `process.env` (rather than `@/config/env`) so that logging
 * never throws and never creates an import cycle with the env module.
 */
const minimumWeight: number =
  process.env.NODE_ENV === "production"
    ? LEVEL_WEIGHT.warn
    : process.env.LOG_LEVEL && process.env.LOG_LEVEL in LEVEL_WEIGHT
      ? LEVEL_WEIGHT[process.env.LOG_LEVEL as LogLevel]
      : LEVEL_WEIGHT.debug;

/** Keys whose values are never logged, matched case-insensitively. */
const REDACTED_KEY_PATTERN =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|session|database_url|salt|hash/i;

const MAX_DEPTH = 4;

function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return "[truncated]";
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Error) {
    // Message only: an error `message` may include SQL or a connection string.
    return { name: value.name, message: value.message };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => redact(entry, depth + 1));
  }

  const result: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = REDACTED_KEY_PATTERN.test(key) ? "[redacted]" : redact(entry, depth + 1);
  }

  return result;
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_WEIGHT[level] < minimumWeight) {
    return;
  }

  const record = {
    level,
    message,
    time: new Date().toISOString(),
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };

  const serialized = JSON.stringify(record);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  if (level === "warn") {
    console.warn(serialized);
    return;
  }

  console.log(serialized);
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    log("debug", message, context);
  },
  info(message: string, context?: Record<string, unknown>): void {
    log("info", message, context);
  },
  warn(message: string, context?: Record<string, unknown>): void {
    log("warn", message, context);
  },
  error(message: string, context?: Record<string, unknown>): void {
    log("error", message, context);
  },
};