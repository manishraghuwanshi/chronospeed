/**
 * Test environment bootstrap.
 *
 * `src/config/env.ts` parses `process.env` on the **first property access** and caches
 * a frozen snapshot, so this must run before any application module reads a
 * configuration value. Vitest does that through `src/tests/setup.ts`, a `setupFile`
 * that executes before the test file's own imports.
 *
 * Guarantees:
 *
 * 1. `NODE_ENV=test`, `LOG_LEVEL=error` — logging is limited to failures, so a passing
 *    run stays readable.
 * 2. `DATABASE_URL` is a syntactically valid but **inert** loopback URL. Validation
 *    passes and nothing connects to it: the harness installs a PGlite client before
 *    the first query, and the lazy client in `src/lib/db/client.ts` is never created.
 *    An accidental real connection would fail instantly rather than reach Neon.
 * 3. Rate limiting is disabled **for tests only**. It is an in-process, per-IP limiter
 *    and the whole suite shares one process, so leaving it on would make unrelated
 *    cases fail after enough submissions. The account-scoped throttle is *not*
 *    disabled and is covered directly by its own tests.
 */

const BASE_ENV: Record<string, string> = {
  NODE_ENV: "test",
  LOG_LEVEL: "error",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  AUTH_RATE_LIMIT_ENABLED: "false",
};

/** Inert, well-formed connection string used only to satisfy env validation. */
export const TEST_DATABASE_URL =
  "postgresql://pglite:pglite@127.0.0.1:1/pglite_inert?sslmode=disable";

/**
 * Install the test environment. Idempotent, so it is safe to call again from a test
 * that needs to adjust the configuration.
 */
export function ensureTestEnv(overrides: Record<string, string> = {}): void {
  // Real credentials must never leak into an automated run from a developer's
  // `.env.local`, so anything the harness does not set explicitly is removed.
  delete process.env.DATABASE_MAX_CONNECTIONS;
  delete process.env.SESSION_COOKIE_NAME;
  delete process.env.AUTH_SESSION_TTL_DAYS;
  delete process.env.AUTH_LOGIN_MAX_ATTEMPTS;
  delete process.env.AUTH_LOGIN_LOCKOUT_MINUTES;
  delete process.env.AUTH_LOGIN_MIN_INTERVAL_SECONDS;

  Object.assign(process.env, BASE_ENV, { DATABASE_URL: TEST_DATABASE_URL }, overrides);
}