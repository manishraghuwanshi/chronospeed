import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { env } from "@/config/env";
import { registerAction, signInAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/lib/auth/form-state";
import { generateSessionToken, hashSessionToken, sessionExpiresAt } from "@/lib/auth/tokens";
import { customerSessions, customers } from "@/lib/db/schema/customer";
import { testCookieJar } from "@/tests/stubs/next-headers";
import { isRedirectSignal } from "@/tests/stubs/next-navigation";

import { DEFAULT_CUSTOMER_PASSWORD, formDataOf, resetCookieJar, testCustomer } from "./helpers/auth";
import { clearTestData, createTestDatabase, type TestDatabase } from "./helpers/db";
import { expireSessionsFor, revokeSessionsFor } from "./helpers/session";

/**
 * The session lifecycle: what resolves a customer, and what must not.
 *
 * Every case drives the application's own entry points — the Server Actions and the
 * `getCurrentCustomer` / `requireCustomer` helpers — because the failure mode worth
 * guarding against is an authorization rule that only holds on one code path.
 */

async function registerAndStaySignedIn(): Promise<string> {
  try {
    await registerAction(
      INITIAL_AUTH_FORM_STATE,
      formDataOf({
        firstName: testCustomer.firstName,
        lastName: testCustomer.lastName,
        email: testCustomer.email,
        password: DEFAULT_CUSTOMER_PASSWORD,
      }),
    );
  } catch (error) {
    if (!isRedirectSignal(error)) {
      throw error;
    }
  }

  return testCookieJar.value(env.SESSION_COOKIE_NAME)!;
}

async function loadSessionModule() {
  return import("@/lib/auth/session");
}

describe("auth: session lifecycle", () => {
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

  it("resolves the signed-in customer from the session cookie", async () => {
    await registerAndStaySignedIn();

    const { getCurrentCustomer } = await loadSessionModule();
    const customer = await getCurrentCustomer();

    expect(customer).not.toBeNull();
    expect(customer!.email).toBe(testCustomer.email);
    // The projection that reaches a component must not carry credential material.
    expect(Object.keys(customer!)).not.toContain("passwordHash");
    expect(JSON.stringify(customer)).not.toContain("passwordHash");
  });

  it("returns no customer for an unauthenticated request", async () => {
    const { getCurrentCustomer, requireCustomer } = await loadSessionModule();

    expect(await getCurrentCustomer()).toBeNull();
    await expect(requireCustomer()).rejects.toThrow();
  });

  it("returns no customer for a forged or unknown token", async () => {
    testCookieJar.seed(env.SESSION_COOKIE_NAME, generateSessionToken());

    const { getCurrentCustomer } = await loadSessionModule();

    expect(await getCurrentCustomer()).toBeNull();
  });

  it("rejects an expired session but leaves the row in place", async () => {
    await registerAndStaySignedIn();

    const account = await handle.db.select().from(customers).limit(1);
    await expireSessionsFor(handle, account[0]!.id);

    const { getCurrentCustomer } = await loadSessionModule();

    expect(await getCurrentCustomer()).toBeNull();
    // Resolution is a read; removing the stale cookie is a write and is left to a
    // Server Action, because rendering must not mutate.
    expect(await handle.db.select().from(customerSessions)).toHaveLength(1);
  });

  it("rejects a revoked session", async () => {
    await registerAndStaySignedIn();

    const account = await handle.db.select().from(customers).limit(1);
    await revokeSessionsFor(handle, account[0]!.id);

    const { getCurrentCustomer } = await loadSessionModule();

    expect(await getCurrentCustomer()).toBeNull();
  });

  it("rejects a session belonging to a deactivated customer", async () => {
    await registerAndStaySignedIn();

    await handle.db.update(customers).set({ isActive: false });

    const { getCurrentCustomer } = await loadSessionModule();

    expect(await getCurrentCustomer()).toBeNull();
  });

  it("does not resolve a phantom session row the browser was never given", async () => {
    await registerAndStaySignedIn();

    const account = await handle.db.select().from(customers).limit(1);
    await handle.db.insert(customerSessions).values({
      customerId: account[0]!.id,
      tokenHash: hashSessionToken("a-token-nobody-was-issued"),
      expiresAt: sessionExpiresAt(30),
    });

    const { getCurrentCustomer } = await loadSessionModule();
    const customer = await getCurrentCustomer();

    // The cookie the browser actually holds still works; the phantom row is inert.
    expect(customer).not.toBeNull();
    expect(customer!.email).toBe(testCustomer.email);
  });

  it("keeps separate sessions independently revocable", async () => {
    await registerAndStaySignedIn();
    const firstToken = testCookieJar.value(env.SESSION_COOKIE_NAME)!;

    // A second sign-in on another device: new cookie, new row.
    try {
      await signInAction(
        INITIAL_AUTH_FORM_STATE,
        formDataOf({ email: testCustomer.email, password: DEFAULT_CUSTOMER_PASSWORD }),
      );
    } catch (error) {
      if (!isRedirectSignal(error)) {
        throw error;
      }
    }

    const secondToken = testCookieJar.value(env.SESSION_COOKIE_NAME)!;

    expect(secondToken).not.toBe(firstToken);
    expect(await handle.db.select().from(customerSessions)).toHaveLength(2);

    // Revoking the first device must not sign out the second.
    await handle.db
      .update(customerSessions)
      .set({ revokedAt: new Date() })
      .where(eq(customerSessions.tokenHash, hashSessionToken(firstToken)));

    const { getCurrentCustomer } = await loadSessionModule();

    expect(await getCurrentCustomer()).not.toBeNull();
  });
});
