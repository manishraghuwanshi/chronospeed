import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { env } from "@/config/env";
import { registerAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/lib/auth/form-state";
import { hashSessionToken } from "@/lib/auth/tokens";
import { customerSessions } from "@/lib/db/schema/customer";
import { testCookieJar } from "@/tests/stubs/next-headers";
import { isRedirectSignal } from "@/tests/stubs/next-navigation";

import {
  customerCount,
  DEFAULT_CUSTOMER_PASSWORD,
  findCustomerByEmail,
  formDataOf,
  resetCookieJar,
  seedCustomer,
  testCustomer,
} from "./helpers/auth";
import { clearTestData, createTestDatabase, type TestDatabase } from "./helpers/db";
import { readActiveSessionFor, readSessionsFor } from "./helpers/session";

/**
 * Registration, through the real Server Action.
 *
 * The action is the unit under test rather than the service function, because that is
 * what a browser actually reaches: it covers field parsing, the rate-limit gate, the
 * duplicate mapping and the automatic sign-in that follows.
 */

/** Run the action and capture either its state or its redirect target. */
async function submitRegistration(fields: Record<string, string | undefined>) {
  try {
    const state = await registerAction(INITIAL_AUTH_FORM_STATE, formDataOf(fields));

    return { state, redirect: null as string | null };
  } catch (error) {
    if (isRedirectSignal(error)) {
      return { state: null, redirect: error.destination };
    }

    throw error;
  }
}

const validRegistration = {
  firstName: testCustomer.firstName,
  lastName: testCustomer.lastName,
  email: testCustomer.email,
  password: DEFAULT_CUSTOMER_PASSWORD,
};

describe("auth: registration", () => {
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

  it("creates the account, signs in, and redirects", async () => {
    const { state, redirect } = await submitRegistration(validRegistration);

    expect(state).toBeNull();
    expect(redirect).toBe("/account");

    const stored = await findCustomerByEmail(handle, testCustomer.email);

    expect(stored).not.toBeNull();
    expect(stored!.firstName).toBe(testCustomer.firstName);
    expect(stored!.isActive).toBe(true);
    expect(stored!.emailVerifiedAt).toBeNull();
    expect(stored!.lastLoginAt).toBeInstanceOf(Date);
  });

  it("stores an Argon2id hash and never the password", async () => {
    await submitRegistration(validRegistration);

    const stored = await findCustomerByEmail(handle, testCustomer.email);

    expect(stored!.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(stored!.passwordHash).not.toContain(DEFAULT_CUSTOMER_PASSWORD);
  });

  it("sets a session cookie whose value is stored only as a hash", async () => {
    await submitRegistration(validRegistration);

    const rawToken = testCookieJar.value(env.SESSION_COOKIE_NAME)!;
    const sessions = await handle.db.select().from(customerSessions);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toBe(hashSessionToken(rawToken));
    expect(sessions[0]!.tokenHash).not.toBe(rawToken);
    expect(testCookieJar.options(env.SESSION_COOKIE_NAME)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it("normalizes the email so case cannot create a second identity", async () => {
    await submitRegistration({ ...validRegistration, email: "  ADA@Example.TEST  " });

    const stored = await findCustomerByEmail(handle, testCustomer.email);

    expect(stored).not.toBeNull();
    expect(await customerCount(handle)).toBe(1);
  });

  it("rejects a duplicate address without creating a second account or session", async () => {
    await seedCustomer(handle);
    testCookieJar.reset();

    const { state, redirect } = await submitRegistration(validRegistration);

    expect(redirect).toBeNull();
    expect(state?.status).toBe("error");
    expect(state?.fieldErrors?.email).toBeTruthy();
    expect(await customerCount(handle)).toBe(1);
    expect(await handle.db.select().from(customerSessions)).toHaveLength(0);
    expect(testCookieJar.value(env.SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("rejects an invalid email before touching the database", async () => {
    const { state } = await submitRegistration({ ...validRegistration, email: "not-an-email" });

    expect(state?.status).toBe("error");
    expect(state?.fieldErrors?.email).toBeTruthy();
    expect(await customerCount(handle)).toBe(0);
  });

  it("rejects a short or letter-only password", async () => {
    for (const password of ["short1", "onlyletters", "1234567890"]) {
      const { state } = await submitRegistration({ ...validRegistration, password });

      expect(state?.status, password).toBe("error");
      expect(state?.fieldErrors?.password).toBeTruthy();
    }

    expect(await customerCount(handle)).toBe(0);
  });

  it("rejects an oversized password rather than hashing it", async () => {
    const { state } = await submitRegistration({
      ...validRegistration,
      password: `a1${"x".repeat(500)}`,
    });

    expect(state?.status).toBe("error");
    expect(await customerCount(handle)).toBe(0);
  });

  it("treats missing optional names as absent", async () => {
    const { redirect } = await submitRegistration({
      email: "grace@example.test",
      password: DEFAULT_CUSTOMER_PASSWORD,
    });

    expect(redirect).toBe("/account");

    const stored = await findCustomerByEmail(handle, "grace@example.test");

    expect(stored!.firstName).toBeNull();
    expect(stored!.lastName).toBeNull();
  });

  it("echoes typed values back on failure but never the password", async () => {
    const { state } = await submitRegistration({ ...validRegistration, email: "not-an-email" });

    expect(state?.values?.email).toBe("not-an-email");
    expect(state?.values?.firstName).toBe(testCustomer.firstName);
    expect(JSON.stringify(state)).not.toContain(DEFAULT_CUSTOMER_PASSWORD);
  });

  it("resolves the newly created session for the signed-in customer", async () => {
    await submitRegistration(validRegistration);

    const rawToken = testCookieJar.value(env.SESSION_COOKIE_NAME)!;
    const active = await readActiveSessionFor(handle, rawToken);

    expect(active).not.toBeNull();
    expect(active!.customer.email).toBe(testCustomer.email);
    expect(await readSessionsFor(handle, active!.customer.id)).toHaveLength(1);
  });
});
