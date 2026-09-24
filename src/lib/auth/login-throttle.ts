/**
 * Per-account login throttling.
 *
 * Two controls, both scoped to a single customer account rather than to an IP or a
 * process, mirroring the proven `admin-backend/src/lib/auth/login-throttle.ts`:
 *
 * 1. a minimum interval between consecutive failed attempts;
 * 2. a temporary lockout after N consecutive failures.
 *
 * Account-scoped state is the point: the in-memory limiter in `./rate-limit.ts`
 * caps a client's request rate, but it cannot slow a distributed credential-stuffing
 * attempt spread over many addresses against one known mailbox. The state persisted
 * on `customers` survives a restart and is shared by every server instance.
 *
 * The pure functions live here so the decision and the counter arithmetic can be
 * tested without HTTP or a database. The limits themselves are configuration
 * (`AUTH_LOGIN_*` in `config/env.ts`), so they are passed in rather than hard-coded.
 */

/** The stored throttle state a login decision is made from. */
export interface LoginThrottleState {
  readonly failedLoginAttempts: number;
  readonly lastFailedLoginAt: Date | null;
  readonly lockedUntil: Date | null;
}

export type LoginThrottleDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "locked" | "rate_limited";
      readonly retryAfterSeconds: number;
    };

export interface LoginThrottleLimits {
  /** Least time allowed between two failed attempts for the same account. */
  readonly minIntervalMs: number;
  /** Consecutive failures that trip the lockout. */
  readonly maxFailedAttempts: number;
  /** How long the account stays locked once the threshold is reached. */
  readonly lockoutMs: number;
}

/** Whole seconds until `at`, never negative. Used for the audit record and messaging. */
export function secondsUntil(at: Date, now = Date.now()): number {
  return Math.max(0, Math.ceil((at.getTime() - now) / 1000));
}

/**
 * Decide whether an attempt may proceed, checked **before** the password is
 * verified so a throttled account never pays for an Argon2 verification.
 *
 * Order matters: an active lock outranks the interval, so a locked account always
 * reports the same remaining time instead of a stream of short waits.
 */
export function evaluateLoginThrottle(
  state: LoginThrottleState,
  limits: LoginThrottleLimits,
  now = Date.now(),
): LoginThrottleDecision {
  if (state.lockedUntil && state.lockedUntil.getTime() > now) {
    return {
      allowed: false,
      reason: "locked",
      retryAfterSeconds: secondsUntil(state.lockedUntil, now),
    };
  }

  if (state.lastFailedLoginAt) {
    const retryAt = state.lastFailedLoginAt.getTime() + limits.minIntervalMs;

    if (retryAt > now) {
      return {
        allowed: false,
        reason: "rate_limited",
        // At least 1, so a caller never reports a misleading zero-second wait.
        retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)),
      };
    }
  }

  return { allowed: true };
}

export interface LoginFailureOutcome {
  /**
   * The counter to store after this failure. It resets to 0 when the threshold is
   * crossed, so the attempt that trips the lock starts the next sequence from a
   * clean slate once the lockout expires.
   */
  readonly failedLoginAttempts: number;
  /** The lock deadline to store, or `null` when this failure did not lock. */
  readonly lockedUntil: Date | null;
  /** True when this failure is the one that reached the threshold. */
  readonly locked: boolean;
}

/**
 * The state that results from recording one failed password.
 *
 * The database applies the same arithmetic in a single `UPDATE ... RETURNING`, so a
 * losing concurrent failure cannot read a stale counter; this function is the
 * referral definition that statement is asserted against.
 */
export function applyFailedAttempt(
  state: LoginThrottleState,
  limits: LoginThrottleLimits,
  now: Date,
): LoginFailureOutcome {
  const attempts = state.failedLoginAttempts + 1;

  if (attempts >= limits.maxFailedAttempts) {
    return {
      failedLoginAttempts: 0,
      lockedUntil: new Date(now.getTime() + limits.lockoutMs),
      locked: true,
    };
  }

  return {
    failedLoginAttempts: attempts,
    lockedUntil: state.lockedUntil,
    locked: false,
  };
}