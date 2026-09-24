import "server-only";

import { cookies } from "next/headers";

import { env } from "@/config/env";

/**
 * The single place the customer session cookie is read, written or cleared.
 *
 * Centralizing the policy matters more than it looks: `Path` and `SameSite` have to
 * match exactly on the *delete* as on the *set*, or the browser keeps a cookie the
 * application believes it removed. No module outside this file may call
 * `cookies().set(...)` for a session.
 *
 * Policy (`docs/security-plan.md` §3, T-2/T-3):
 * - `httpOnly` — the token is never readable by client JavaScript, so an XSS bug
 *   cannot exfiltrate a session;
 * - `secure` in production — refused over plain HTTP, where it could be sniffed;
 * - `sameSite: "lax"` — the cookie is not attached to a cross-site POST, which is
 *   the primary CSRF defence for a form-based, same-origin application;
 * - `path: "/"` — one path, so there is nothing for a forged sub-path request to
 *   target and nothing to mismatch on clearing.
 *
 * None of this is an `AUTH_SECRET`-signed token: the cookie carries an opaque random
 * value whose hash is the only thing stored (see `auth/tokens.ts`). There is
 * therefore no signing key to configure, leak or rotate.
 */

/** The session cookie never leaves the root path. */
const SESSION_COOKIE_PATH = "/";

function sessionCookieBase() {
  return {
    httpOnly: true as const,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: SESSION_COOKIE_PATH,
  };
}

/**
 * Read the raw session token from the incoming request, or `null`.
 *
 * `cookies()` is async in Next 16 — synchronous access was removed — so every
 * caller awaits this.
 */
export async function readSessionCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(env.SESSION_COOKIE_NAME)?.value;

  return value && value.length > 0 ? value : null;
}

/**
 * Send the session cookie to the browser. Only ever called from a Server Action
 * (next to the response that created the session), because Next.js forbids setting
 * cookies while rendering.
 *
 * The raw token is passed straight through to `Set-Cookie`; it is never logged,
 * returned in a payload, or placed in a URL.
 */
export async function setSessionCookie(token: string, maxAgeSeconds: number): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(env.SESSION_COOKIE_NAME, token, {
    ...sessionCookieBase(),
    maxAge: maxAgeSeconds,
  });
}

/**
 * Expire the session cookie. `maxAge: 0` (rather than `delete()`) is used so the
 * attributes on the clearing cookie are byte-for-byte the ones it was set with.
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(env.SESSION_COOKIE_NAME, "", {
    ...sessionCookieBase(),
    maxAge: 0,
  });
}