import "server-only";

import { cookies } from "next/headers";

import { env } from "@/config/env";

/**
 * The single place the guest cart cookie is read, written or cleared.
 *
 * A guest cart token is a **bearer credential**: whoever holds the value owns the cart.
 * It is therefore handled with exactly the same cookie policy as the session cookie in
 * `lib/auth/cookies.ts`, and for the same reasons
 * (`docs/security-plan.md` §4, T-2/T-3/T-4):
 *
 * - `httpOnly` — client JavaScript cannot read it, so an XSS bug cannot exfiltrate a
 *   cart; a cart is not much of a prize next to a session, but the attribute costs
 *   nothing and the rule should not have exceptions;
 * - `secure` in production — refused over plain HTTP, where it could be sniffed;
 * - `sameSite: "lax"` — not attached to a cross-site POST, which is the primary CSRF
 *   defence for the cart's Server Actions;
 * - `path: "/"` — one path, so `Path` on the write and the clear cannot mismatch and
 *   leave the browser holding a cookie the application believes it removed.
 *
 * Like `lib/auth/cookies.ts`, no other module may call `cookies().set(...)` for this
 * cookie. Keeping the policy in one file is what makes "same attributes on set and
 * clear" a property of the code rather than a thing to remember.
 */

/** The guest cart cookie never leaves the root path. */
const GUEST_CART_COOKIE_PATH = "/";

function guestCartCookieBase() {
  return {
    httpOnly: true as const,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: GUEST_CART_COOKIE_PATH,
  };
}

/**
 * Read the raw guest cart token from the incoming request, or `null`.
 *
 * Safe to call during rendering: it reads only. `cookies()` is async in Next 16 —
 * synchronous access was removed — so every caller awaits this.
 */
export async function readGuestCartCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(env.GUEST_CART_COOKIE_NAME)?.value;

  return value && value.length > 0 ? value : null;
}

/**
 * Send the guest cart cookie to the browser.
 *
 * Only ever called from a Server Action or Route Handler — Next.js forbids setting a
 * cookie while rendering, which is why a cart read never creates one. The raw token is
 * passed straight to `Set-Cookie`; it is never logged, returned in a payload, or placed
 * in a URL.
 */
export async function setGuestCartCookie(token: string, maxAgeSeconds: number): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(env.GUEST_CART_COOKIE_NAME, token, {
    ...guestCartCookieBase(),
    maxAge: maxAgeSeconds,
  });
}

/**
 * Expire the guest cart cookie. `maxAge: 0` (rather than `delete()`) is used so the
 * attributes on the clearing cookie are byte-for-byte the ones it was set with.
 */
export async function clearGuestCartCookie(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(env.GUEST_CART_COOKIE_NAME, "", {
    ...guestCartCookieBase(),
    maxAge: 0,
  });
}