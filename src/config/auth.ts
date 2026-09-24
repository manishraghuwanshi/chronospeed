import "server-only";

import { env } from "@/config/env";
import type { LoginThrottleLimits } from "@/lib/auth/login-throttle";

/**
 * Phase 2 authentication configuration, read from the validated environment
 * (`config/env.ts`).
 *
 * Every value is exposed through a **function**, not a constant. That is not
 * incidental: Next.js evaluates an imported module while collecting page data during
 * `next build`, and `config/env.ts` validates on first property access. A top-level
 * `env.AUTH_…` read here would therefore make every production build require
 * database credentials. Reading inside the call keeps env validation where Phase 1
 * put it — the first request that actually authenticates.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Absolute session lifetime in milliseconds. */
export function getSessionTtlMs(): number {
  return env.AUTH_SESSION_TTL_DAYS * DAY_MS;
}

/** Cookie `maxAge` in **seconds** (the unit `Set-Cookie` uses). */
export function getSessionCookieMaxAgeSeconds(): number {
  return env.AUTH_SESSION_TTL_DAYS * 24 * 60 * 60;
}

/** Per-account throttle thresholds for sign-in. */
export function getLoginThrottleLimits(): LoginThrottleLimits {
  return {
    minIntervalMs: env.AUTH_LOGIN_MIN_INTERVAL_SECONDS * 1000,
    maxFailedAttempts: env.AUTH_LOGIN_MAX_ATTEMPTS,
    lockoutMs: env.AUTH_LOGIN_LOCKOUT_MINUTES * 60 * 1000,
  };
}