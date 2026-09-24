import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getLoginThrottleLimits } from "@/config/auth";
import { signInAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/lib/auth/form-state";
import { applyFailedAttempt, evaluateLoginThrottle, secondsUntil } from "@/lib/auth/login-throttle";
import { hashPassword } from "@/lib/auth/password";
import { customers } from "@/lib/db/schema/customer";
import { testCookieJar } from "@/tests/stubs/next-headers";
import { isRedirectSignal } from "@/tests/stubs/next-navigation";

import { DEFAULT_CUSTOMER_PASSWORD, formDataOf, resetCookieJar, testCustomer } from "./helpers/auth";
import { clearTestData, createTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * Per-account throttle and lockout.
 *
 * The integration cases drive the real Server Action so the `UPDATE ... RETURNING`
 * arithmetic is executed by PostgreSQL rather than asserted against a JavaScript
 * reimplementation of it. The pure-function cases pin the decision rules themselves.
 *
 * The minimum interval is a real wall-clock window (5s by default), so a test that needs
 * several consecutive failures without waiting ages the stored `last_failed_login_at`
 * row forward — the same correction an operator would apply when reconciling a
 * legitimate lockout.
 */

async function attempt(password: string) {
  try {
    const state = await signInAction(
      INITIAL_AUTH_FORM_STATE,
      formDataOf({ email: testCustomer.email, password }),
    );

    return { state, redirect: null as string | null };
  } catch (error) {
    if (isRedirectSignal(error)) {
      return { state: null, redirect: error.destination };
    }

    throw error;
  }
}

async function seedAccount(handle: TestDatabase) {
  const [row] = await handle.db
    .insert(customers)
    .values({
      email: testCustomer.email,
      passwordHash: await hashPassword(DEFAULT_CUSTOMER_PASSWORD),
    })
    .returning();

  return row!;
}

/** Make the previous failure look old enough that the interval has passed. */
async function ageLastFailure(handle: TestDatabase, customerId: string): Promise<void> {
  await handle.db
    .update(customers)
    .set({ lastFailedLoginAt: new Date(Date.now() - 60_000) })
    .where(eq(customers.id, customerId));
}

/** Simulate the whole lockout window elapsing, without waiting it out. */
async function expireLock(handle: TestDatabase, customerId: string): Promise<void> {
  const limits = getLoginThrottleLimits();

  await handle.db
    .update(customers)
    .set({
      lockedUntil: new Date(Date.now() - 1_000),
      // A real lockout implies the failure that tripped it is at least that old.
      lastFailedLoginAt: new Date(Date.now() - limits.lockoutMs),
    })
    .where(eq(customers.id, customerId));
}

async function lockAccount(handle: TestDatabase, customerId: string): Promise<void> {
  const limits = getLoginThrottleLimits();

  for (let i = 0; i < limits.maxFailedAttempts; i += 1) {
    await ageLastFailure(handle, customerId);
    await attempt("WrongPassword123");
  }
}

describe("auth: login throttle", () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await clearTestData(handle);
    resetCookieJar();
  });

  it("locks the account after the configured number of failures and resets the counter", async () => {
    const account = await seedAccount(handle);

    await lockAccount(handle, account.id);

    const [row] = await handle.db.select().from(customers).where(eq(customers.id, account.id));

    expect(row!.lockedUntil).toBeInstanceOf(Date);
    expect(row!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    // The counter restarts at zero when the lock trips, so the next sequence begins
    // clean once the lockout expires.
    expect(row!.failedLoginAttempts).toBe(0);
  });

  it("refuses a locked account even when the password is correct", async () => {
    const account = await seedAccount(handle);

    await lockAccount(handle, account.id);

    const locked = await attempt(DEFAULT_CUSTOMER_PASSWORD);

    expect(locked.redirect).toBeNull();
    expect(locked.state).not.toBeNull();
    expect(testCookieJar.value("cs_customer_session")).toBeUndefined();
  });

  it("allows sign-in again once the lockout has expired", async () => {
    const account = await seedAccount(handle);

    await lockAccount(handle, account.id);
    await expireLock(handle, account.id);

    const afterLock = await attempt(DEFAULT_CUSTOMER_PASSWORD);

    expect(afterLock.redirect).toBe("/account");
    expect(testCookieJar.value("cs_customer_session")).toBeTruthy();
  });

  it("refuses a second attempt inside the minimum interval without advancing the counter", async () => {
    const account = await seedAccount(handle);

    await attempt("WrongPassword123");

    const tooSoon = await attempt("WrongPassword123");

    expect(tooSoon.state?.message).toMatch(/too many/i);

    const [row] = await handle.db.select().from(customers).where(eq(customers.id, account.id));

    // A refused attempt never verified a password, so it must not be counted.
    expect(row!.failedLoginAttempts).toBe(1);
  });
});

describe("auth: login throttle decision logic", () => {
  const limits = { minIntervalMs: 5_000, maxFailedAttempts: 5, lockoutMs: 900_000 };
  const base = { failedLoginAttempts: 0, lastFailedLoginAt: null, lockedUntil: null };

  it("allows the first attempt and one after the interval has passed", () => {
    expect(evaluateLoginThrottle(base, limits)).toEqual({ allowed: true });

    const now = Date.now();

    expect(
      evaluateLoginThrottle(
        { ...base, lastFailedLoginAt: new Date(now - limits.minIntervalMs) },
        limits,
        now,
      ),
    ).toEqual({ allowed: true });
  });

  it("refuses an attempt inside the interval and reports the remaining time", () => {
    const now = Date.now();
    const decision = evaluateLoginThrottle(
      { ...base, lastFailedLoginAt: new Date(now - 1_000) },
      limits,
      now,
    );

    expect(decision).toEqual({ allowed: false, reason: "rate_limited", retryAfterSeconds: 4 });
  });

  it("lets an active lock outrank the interval", () => {
    const now = Date.now();
    const decision = evaluateLoginThrottle(
      { ...base, lastFailedLoginAt: new Date(now - 1_000), lockedUntil: new Date(now + 600_000) },
      limits,
      now,
    );

    expect(decision.allowed).toBe(false);

    if (!decision.allowed) {
      expect(decision.reason).toBe("locked");
      expect(decision.retryAfterSeconds).toBe(600);
    }

    // A lock that already passed no longer refuses anything.
    expect(evaluateLoginThrottle({ ...base, lockedUntil: new Date(now - 1) }, limits, now)).toEqual({
      allowed: true,
    });
  });

  it("counts up to the threshold, then locks and resets", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const first = applyFailedAttempt({ ...base, failedLoginAttempts: 0 }, limits, now);

    expect(first).toEqual({ failedLoginAttempts: 1, lockedUntil: null, locked: false });

    const locking = applyFailedAttempt(
      { ...base, failedLoginAttempts: limits.maxFailedAttempts - 1 },
      limits,
      now,
    );

    expect(locking.locked).toBe(true);
    expect(locking.failedLoginAttempts).toBe(0);
    expect(locking.lockedUntil!.getTime()).toBe(now.getTime() + limits.lockoutMs);
  });

  it("never reports a negative wait", () => {
    const now = Date.now();

    expect(secondsUntil(new Date(now - 5_000), now)).toBe(0);
    expect(secondsUntil(new Date(now), now)).toBe(0);
    expect(secondsUntil(new Date(now + 1), now)).toBe(1);
  });
});