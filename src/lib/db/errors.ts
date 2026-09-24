import "server-only";

/**
 * Database error classification.
 *
 * The DAL must translate a specific, expected database failure — a duplicate email
 * hitting the UNIQUE index — into a safe, specific application error, while every
 * other driver failure stays a generic 500. Recognizing it by SQLSTATE (rather than
 * by matching a driver message) is what keeps that decision stable across drivers:
 * `postgres-js` against Neon and PGlite in tests both report `23505`.
 *
 * Drizzle 0.45 wraps query failures, so the original `PostgresError` may sit one or
 * more `cause` links down. The check therefore walks the chain a bounded distance
 * instead of reading only the top-level error.
 */

const MAX_CAUSE_DEPTH = 5;

/** PostgreSQL SQLSTATE for `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/** True when the failure is (or wraps) a PostgreSQL UNIQUE constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth += 1) {
    if (hasCode(current, UNIQUE_VIOLATION)) {
      return true;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return false;
}