import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { env } from "@/config/env";
import { readSessionCookie } from "@/lib/auth/cookies";
import { generateSessionToken } from "@/lib/auth/tokens";
import { testCookieJar } from "@/tests/stubs/next-headers";

/**
 * The session cookie contract, asserted through the real modules.
 *
 * This suite exists because the cookie attributes are the only thing standing between a
 * session token and client JavaScript, and because a mismatch between the attributes on
 * `set` and on `clear` would leave a cookie the application believes it removed.
 *
 * `next/headers` is a test stub that records the options each write was called with, so
 * the assertions are about the *policy*, not just the value.
 */

describe("auth: session cookie", () => {
  beforeAll(() => {
    delete process.env.SESSION_COOKIE_NAME;
  });

  beforeEach(() => {
    testCookieJar.reset();
  });

  afterAll(() => {
    testCookieJar.reset();
  });

  it("sets HttpOnly, SameSite=Lax, Path=/ and is not Secure outside production", async () => {
    const { setSessionCookie } = await import("@/lib/auth/cookies");
    const token = generateSessionToken();

    await setSessionCookie(token, 3600);

    const options = testCookieJar.options(env.SESSION_COOKIE_NAME);

    expect(testCookieJar.value(env.SESSION_COOKIE_NAME)).toBe(token);
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    });
    // A Secure cookie on plain-http localhost is silently dropped by browsers, so it
    // must be conditional on production rather than always on.
    expect(options?.secure).toBe(false);
  });

  it("reads the cookie the application just wrote", async () => {
    const { setSessionCookie } = await import("@/lib/auth/cookies");
    const token = generateSessionToken();

    await setSessionCookie(token, 3600);

    expect(await readSessionCookie()).toBe(token);
  });

  it("reports no session when the cookie is absent or empty", async () => {
    expect(await readSessionCookie()).toBeNull();

    testCookieJar.seed(env.SESSION_COOKIE_NAME, "");

    expect(await readSessionCookie()).toBeNull();
  });

  it("clears with maxAge 0 and the same attributes it was set with", async () => {
    const { clearSessionCookie, setSessionCookie } = await import("@/lib/auth/cookies");

    await setSessionCookie(generateSessionToken(), 3600);
    const setOptions = testCookieJar.options(env.SESSION_COOKIE_NAME);

    await clearSessionCookie();
    const clearOptions = testCookieJar.options(env.SESSION_COOKIE_NAME);

    expect(testCookieJar.value(env.SESSION_COOKIE_NAME)).toBe("");
    expect(clearOptions).toMatchObject({ ...setOptions, maxAge: 0 });
    expect(await readSessionCookie()).toBeNull();
  });
});