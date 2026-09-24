import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { env } from "@/config/env";
import { registerAction, signOutAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/lib/auth/form-state";
import { hashSessionToken } from "@/lib/auth/tokens";
import { customerSessions } from "@/lib/db/schema/customer";
import { testCookieJar } from "@/tests/stubs/next-headers";
import { isRedirectSignal } from "@/tests/stubs/next-navigation";

import { DEFAULT_CUSTOMER_PASSWORD, formDataOf, resetCookieJar, testCustomer } from "./helpers/auth";
import { clearTestData, createTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * Sign-out.
 *
 * Two things must both happen and must happen in the right order: the session row is
 * revoked in the database, and the cookie is cleared. If revocation came second, a
 * failure would leave the browser "signed out" while a live session remained usable.
 */

async function registerAndStaySignedIn(): Promise<string> {
  try {
    await registerAction(
      INITIAL_AUTH_FORM_STATE,
      formDataOf({
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

describe("auth: sign out", () => {
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

  it("revokes the session row and clears the cookie", async () => {
    const rawToken = await registerAndStaySignedIn();

    let redirect: string | null = null;

    try {
      await signOutAction();
    } catch (error) {
      if (isRedirectSignal(error)) {
        redirect = error.destination;
      } else {
        throw error;
      }
    }

    expect(redirect).toBe("/");

    const [row] = await handle.db
      .select()
      .from(customerSessions)
      .where(eq(customerSessions.tokenHash, hashSessionToken(rawToken)));

    expect(row!.revokedAt).toBeInstanceOf(Date);
    // Cleared with maxAge 0, and with the same attributes it was set with.
    expect(testCookieJar.value(env.SESSION_COOKIE_NAME)).toBe("");
    expect(testCookieJar.options(env.SESSION_COOKIE_NAME)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  });

  it("resolves no customer after signing out", async () => {
    await registerAndStaySignedIn();

    try {
      await signOutAction();
    } catch {
      // The redirect signal is expected.
    }

    const { getCurrentCustomer } = await import("@/lib/auth/session");

    expect(await getCurrentCustomer()).toBeNull();
  });

  it("is a no-op when nobody is signed in", async () => {
    let redirect: string | null = null;

    try {
      await signOutAction();
    } catch (error) {
      if (isRedirectSignal(error)) {
        redirect = error.destination;
      } else {
        throw error;
      }
    }

    expect(redirect).toBe("/");
    expect(await handle.db.select().from(customerSessions)).toHaveLength(0);
  });

  it("does not revoke a different customer's session", async () => {
    await registerAndStaySignedIn();
    const rawToken = testCookieJar.value(env.SESSION_COOKIE_NAME)!;

    const [row] = await handle.db
      .select()
      .from(customerSessions)
      .where(eq(customerSessions.tokenHash, hashSessionToken(rawToken)));

    // A different token that is not the one in the cookie.
    const otherHash = hashSessionToken("someone-elses-token");
    await handle.db.insert(customerSessions).values({
      customerId: row!.customerId,
      tokenHash: otherHash,
      expiresAt: row!.expiresAt,
    });

    try {
      await signOutAction();
    } catch {
      // Expected redirect signal.
    }

    const [other] = await handle.db
      .select()
      .from(customerSessions)
      .where(eq(customerSessions.tokenHash, otherHash));

    // Sign-out revokes exactly the session it was given.
    expect(other!.revokedAt).toBeNull();
  });
});