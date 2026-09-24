import "server-only";

import { env } from "@/config/env";

/**
 * Minimal in-process, fixed-window rate limiting for the authentication Server
 * Actions.
 *
 * Scope and honesty about it: this state lives in the memory of a single Node
 * process. It stops the realistic Phase 2 abuse cases — a script hammering
 * `signIn`/`register` from one address — and it is the *second* line of defence
 * after the account-scoped throttle in `./login-throttle.ts`, which is persisted on
 * the customer row and therefore already correct across instances. It is **not** a
 * distributed limiter: behind several instances the effective budget multiplies by
 * the instance count, and a restart clears it. A shared store (Redis/Upstash) is an
 * explicit Phase 13 item (`docs/security-plan.md` §16 S-3, `docs/phase-roadmap.md`
 * §16); this module exists so the endpoints are not unprotected in the meantime and
 * so the Phase 13 swap has one seam.
 *
 * A caller is identified by its client IP, supplied by the Server Action from the
 * request headers. A missing IP is treated as one shared bucket rather than "no
 * limit", so an unidentifiable client can never bypass the limiter.
 */

interface Bucket {
  count: number;
  windowStartedAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Bound the map so a flood of distinct IPs cannot grow memory without limit. Older
 * insertions are evicted first (Map preserves insertion order), and an entry is
 * only ever reused within its own window, so eviction can never hand a caller a
 * stale allowance.
 */
const MAX_TRACKED_CLIENTS = 10_000;

export interface RateLimitRule {
  /** Stable name; the bucket key is `<name>:<clientKey>` so rules cannot collide. */
  readonly name: string;
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Requests permitted per client per window. */
  readonly limit: number;
}

export type RateLimitResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

/**
 * Record one attempt and decide whether it is allowed.
 *
 * Fixed window: the first attempt in a window starts it and all attempts until it
 * expires share one counter. Simpler than a sliding log and adequate for a login
 * form, where the neighbouring control is the persistent account lockout.
 *
 * `now` and `enabled` are injectable so the behaviour is testable without waiting on a
 * clock and without mutating the process environment. Both default to the live values,
 * read lazily at call time, so importing this module never forces env validation during
 * `next build`.
 */
export function consumeRateLimit(
  rule: RateLimitRule,
  clientKey: string,
  now = Date.now(),
  enabled = env.AUTH_RATE_LIMIT_ENABLED,
): RateLimitResult {
  if (!enabled) {
    return { allowed: true };
  }

  const key = `${rule.name}:${clientKey || "unknown"}`;
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStartedAt >= rule.windowMs) {
    if (buckets.size >= MAX_TRACKED_CLIENTS) {
      const oldest = buckets.keys().next();

      if (!oldest.done) {
        buckets.delete(oldest.value);
      }
    }

    buckets.set(key, { count: 1, windowStartedAt: now });

    return { allowed: true };
  }

  if (existing.count >= rule.limit) {
    const retryAfterMs = existing.windowStartedAt + rule.windowMs - now;

    return {
      allowed: false,
      // At least 1, so a caller never reports a zero-second wait.
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  existing.count += 1;

  return { allowed: true };
}

/** Sign-in attempts are credential stuffing, so the window is deliberately tight. */
export const signInRule: RateLimitRule = {
  name: "auth.sign_in",
  windowMs: 15 * 60 * 1000,
  limit: 20,
};

/** Registration is heavier (Argon2 + a write), so it is capped lower. */
export const registerRule: RateLimitRule = {
  name: "auth.register",
  windowMs: 60 * 60 * 1000,
  limit: 10,
};

/** Clears all windows. Test-only: keeps cases independent without waiting. */
export function resetRateLimits(): void {
  buckets.clear();
}