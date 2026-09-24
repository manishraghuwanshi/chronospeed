import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { env } from "@/config/env";
import { signInAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/lib/auth/form-state";
import { hashPassword } from "@/lib/auth/password";
import { customerSessions, customers } from "@/lib/db/schema/customer";
import { testCookieJar } from "@/tests/stubs/next-headers";
import { isRedirectSignal } from "@/tests/stubs/next-navigation";

import {
  DEFAULT_CUSTOMER_PASSWORD,
  findCustomerByEmail,
  formDataOf,
  resetCookieJar,
  testCustomer,
} from "./helpers/auth";
import { clearTestData, createTestDatabase, type TestDatabase } from "./helpers/db";
import { readActiveSessionFor } from "./helpers/session";

/**
 * Sign-in, through the real Server Action.
 *
 * The central property under test is **indistinguishability**: an unknown address, a
 * disabled account and a wrong password must be impossible to tell apart from the
 * response, or the login form becomes an account-enumeration oracle.
 */

async function submitSignIn(fields: Record<string, string | undefined>) {
  try {
    const state = await signInAction(INITIAL_AUTH_FORM_STATE, formDataOf(fields));

    return { state, redirect: null as string | null };
  } catch (error) {
    if (isRedirectSignal(error)) {
      return { state: null, redirect: error.destination };
    }

    throw error;
  }
}

/** Insert an account with a real Argon2 hash, so sign-in can succeed. */
async function seedAccount(
  handle: TestDatabase,
  overrides: { email?: string; password?: string; isActive?: boolean } = {},
) {
  const [row] = await handle.db
    .insert(customers)
    .values({
      email: overrides.email ?? testCustomer.email,
      passwordHash: await hashPassword(overrides.password ?? DEFAULT_CUSTOMER_PASSWORD),
      firstName: testCustomer.firstName,
      isActive: overrides.isActive ?? true,
    })
    .returning();

  return row!;
}

async function throttleStateOf(handle: TestDatabase, customerId: string) {
  const [row] = await handle.db
    .select({
      failedLoginAttempts: customers.failedLoginAttempts,
      lastFailedLoginAt: customers.lastFailedLoginAt,
      lockedUntil: customers.lockedUntil,
      lastLoginAt: customers.lastLoginAt,
    })
    .from(customers)
    .where(eq(customers.id, customerId));

  return row!;
}

describe("auth: sign in", () => {
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

  it("signs in with correct credentials and issues a hashed session", async () => {
    const account = await seedAccount(handle);

    const { state, redirect } = await submitSignIn({
      email: testCustomer.email,
      password: DEFAULT_CUSTOMER_PASSWORD,
    });

    expect(state).toBeNull();
    expect(redirect).toBe("/account");

    const rawToken = testCookieJar.value(env.SESSION_COOKIE_NAME)!;
    const active = await readActiveSessionFor(handle, rawToken);

    expect(active).not.toBeNull();
    expect(active!.customer.id).toBe(account.id);

    const sessions = await handle.db.select().from(customerSessions);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).not.toBe(rawToken);
  });

  it("accepts an email in any case", async () => {
    await seedAccount(handle);

    const { redirect } = await submitSignIn({
      email: "  ADA@Example.TEST ",
      password: DEFAULT_CUSTOMER_PASSWORD,
    });

    expect(redirect).toBe("/account");
  });

  it("clears the throttle state and stamps the sign-in on success", async () => {
    const account = await seedAccount(handle);

    await handle.db
      .update(customers)
      .set({ failedLoginAttempts: 2, lockedUntil: null })
      .where(eq(customers.id, account.id));

    await submitSignIn({ email: testCustomer.email, password: DEFAULT_CUSTOMER_PASSWORD });

    const state = await throttleStateOf(handle, account.id);

    expect(state.failedLoginAttempts).toBe(0);
    expect(state.lockedUntil).toBeNull();
    expect(state.lastLoginAt).toBeInstanceOf(Date);
  });

  it("returns the same message for an unknown address and a wrong password", async () => {
    await seedAccount(handle);

    const unknown = await submitSignIn({
      email: "nobody@example.test",
      password: DEFAULT_CUSTOMER_PASSWORD,
    });
    const wrong = await submitSignIn({
      email: testCustomer.email,
      password: "WrongPassword123",
    });

    expect(unknown.state?.status).toBe("error");
    expect(wrong.state?.status).toBe("error");
    expect(unknown.state?.message).toBe(wrong.state?.message);
    // The failure must not name the field that was wrong — that would reveal whether
    // the address exists.
    expect(unknown.state?.fieldErrors).toBeUndefined();
    expect(wrong.state?.fieldErrors).toBeUndefined();
  });

  it("does not reveal a disabled account", async () => {
    await seedAccount(handle, { isActive: false });

    const disabled = await submitSignIn({
      email: testCustomer.email,
      password: DEFAULT_CUSTOMER_PASSWORD,
    });
    const unknown = await submitSignIn({
      email: "nobody@example.test",
      password: DEFAULT_CUSTOMER_PASSWORD,
    });

    expect(disabled.state?.message).toBe(unknown.state?.message);
    expect(testCookieJar.value(env.SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("does not issue a session for a failed attempt", async () => {
    await seedAccount(handle);

    await submitSignIn({ email: testCustomer.email, password: "WrongPassword123" });

    expect(await handle.db.select().from(customerSessions)).toHaveLength(0);
    expect(testCookieJar.value(env.SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("counts a failed attempt on the account", async () => {
    const account = await seedAccount(handle);

    await submitSignIn({ email: testCustomer.email, password: "WrongPassword123" });

    const state = await throttleStateOf(handle, account.id);

    expect(state.failedLoginAttempts).toBe(1);
    expect(state.lastFailedLoginAt).toBeInstanceOf(Date);
    expect(state.lockedUntil).toBeNull();
  });

  it("writes no throttle state for an address that does not exist", async () => {
    await submitSignIn({ email: "nobody@example.test", password: "WrongPassword123" });

    // An unknown address has no row, and must not create one or let an attacker
    // influence a real account.
    expect(await findCustomerByEmail(handle, "nobody@example.test")).toBeNull();
  });

  it("rejects a malformed body without touching the database", async () => {
    const account = await seedAccount(handle);

    const malformed = await submitSignIn({ email: "not-an-email", password: "" });

    expect(malformed.state?.status).toBe("error");
    expect(malformed.state?.fieldErrors?.email).toBeTruthy();
    expect(malformed.state?.fieldErrors?.password).toBeTruthy();

    const state = await throttleStateOf(handle, account.id);

    expect(state.failedLoginAttempts).toBe(0);
    expect(await handle.db.select().from(customerSessions)).toHaveLength(0);
  });
});
