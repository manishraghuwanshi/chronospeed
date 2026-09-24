import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { consumeRateLimit, registerRule, resetRateLimits, signInRule } from "@/lib/auth/rate-limit";

/**
 * The in-process limiter's arithmetic.
 *
 * These cases disable rate limiting in the shared environment (`src/tests/setup.ts`
 * does, so the rest of the suite is not throttled), then re-enable it explicitly for
 * the duration of each case. That keeps the behaviour under test isolated to this file
 * instead of leaking into unrelated ones.
 *
 * The limiter is deliberately single-instance. These tests document its real
 * behaviour — including the fixed-window reset — rather than asserting properties it
 * does not have; the distributed limitation is recorded in the module and in the
 * Phase 2 report.
 */

const CLIENT = "203.0.113.7";

describe("auth: rate limiting", () => {
  beforeEach(() => {
    process.env.AUTH_RATE_LIMIT_ENABLED = "true";
    resetRateLimits();
  });

  afterEach(() => {
    process.env.AUTH_RATE_LIMIT_ENABLED = "false";
    resetRateLimits();
  });

  it("allows requests up to the limit and refuses the next one", () => {
    const rule = { name: "test.window", windowMs: 60_000, limit: 3 };
    const now = 1_000_000;

    expect(consumeRateLimit(rule, CLIENT, now)).toEqual({ allowed: true });
    expect(consumeRateLimit(rule, CLIENT, now)).toEqual({ allowed: true });
    expect(consumeRateLimit(rule, CLIENT, now)).toEqual({ allowed: true });

    const refused = consumeRateLimit(rule, CLIENT, now);

    expect(refused.allowed).toBe(false);

    if (!refused.allowed) {
      expect(refused.retryAfterSeconds).toBe(60);
    }
  });

  it("starts a fresh window once the current one expires", () => {
    const rule = { name: "test.reset", windowMs: 60_000, limit: 1 };

    expect(consumeRateLimit(rule, CLIENT, 1_000_000)).toEqual({ allowed: true });
    expect(consumeRateLimit(rule, CLIENT, 1_000_001).allowed).toBe(false);
    // Exactly at the boundary the window is over, so the caller is allowed again.
    expect(consumeRateLimit(rule, CLIENT, 1_060_000)).toEqual({ allowed: true });
  });

  it("keys separate clients independently", () => {
    const rule = { name: "test.clients", windowMs: 60_000, limit: 1 };

    expect(consumeRateLimit(rule, "198.51.100.1", 1_000_000).allowed).toBe(true);
    expect(consumeRateLimit(rule, "198.51.100.2", 1_000_000).allowed).toBe(true);
    expect(consumeRateLimit(rule, "198.51.100.1", 1_000_000).allowed).toBe(false);
  });

  it("keys separate rules independently", () => {
    expect(consumeRateLimit(signInRule, CLIENT, 1_000_000).allowed).toBe(true);
    expect(consumeRateLimit(registerRule, CLIENT, 1_000_000).allowed).toBe(true);

    // Exhaust the sign-in budget only.
    for (let i = 0; i < signInRule.limit; i += 1) {
      consumeRateLimit(signInRule, CLIENT, 1_000_000);
    }

    expect(consumeRateLimit(signInRule, CLIENT, 1_000_000).allowed).toBe(false);
    expect(consumeRateLimit(registerRule, CLIENT, 1_000_000).allowed).toBe(true);
  });

  it("treats an unknown client as one shared bucket rather than as unlimited", () => {
    const rule = { name: "test.unknown", windowMs: 60_000, limit: 1 };

    expect(consumeRateLimit(rule, "", 1_000_000).allowed).toBe(true);
    expect(consumeRateLimit(rule, "", 1_000_000).allowed).toBe(false);
  });

  it("never reports a zero-second wait", () => {
    const rule = { name: "test.retry", windowMs: 60_000, limit: 1 };

    consumeRateLimit(rule, CLIENT, 1_000_000);

    const refused = consumeRateLimit(rule, CLIENT, 1_000_000);

    expect(refused.allowed).toBe(false);

    if (!refused.allowed) {
      expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
  });

  it("evicts the oldest bucket rather than growing without bound", () => {
    const rule = { name: "test.eviction", windowMs: 60_000, limit: 1 };
    const overflow = 10_000 + 5;

    for (let i = 0; i < overflow; i += 1) {
      consumeRateLimit(rule, `client-${i}`, 1_000_000);
    }

    // The most recent client is still tracked; an evicted one starts a fresh window
    // rather than inheriting someone else's allowance.
    expect(consumeRateLimit(rule, `client-${overflow - 1}`, 1_000_000).allowed).toBe(false);
    expect(consumeRateLimit(rule, "client-0", 1_000_000).allowed).toBe(true);
  });

  it("is bypassed entirely when the configuration flag is off", () => {
    const rule = { name: "test.disabled", windowMs: 60_000, limit: 1 };

    for (let i = 0; i < 5; i += 1) {
      // `enabled = false` is exactly what the Server Actions pass when
      // `AUTH_RATE_LIMIT_ENABLED=false`; no bucket may be created in that state.
      expect(consumeRateLimit(rule, CLIENT, 1_000_000, false).allowed).toBe(true);
    }

    // And the same rule, enforced, still refuses — proving the bypass is the flag and
    // not an accidentally empty window.
    expect(consumeRateLimit(rule, CLIENT, 1_000_000, true).allowed).toBe(true);
    expect(consumeRateLimit(rule, CLIENT, 1_000_000, true).allowed).toBe(false);
  });
});