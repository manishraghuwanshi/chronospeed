import "server-only";

import { env } from "@/config/env";

/**
 * Phase 4 cart configuration, read from the validated environment
 * (`config/env.ts`).
 *
 * Every value is exposed through a **function**, not a constant, for the same reason
 * `config/auth.ts` does it: Next.js evaluates an imported module while collecting page
 * data during `next build`, and `config/env.ts` validates on first property access. A
 * top-level `env.CART_...` read here would make every production build require database
 * credentials. Reading inside the call keeps env validation where Phase 1 put it — the
 * first request that actually touches a cart.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Guest cart lifetime in **days**, the unit `lib/cart/tokens.ts` takes. */
export function getGuestCartTtlDays(): number {
  return env.CART_GUEST_TTL_DAYS;
}

/** Absolute guest-cart lifetime in milliseconds, used for `carts.expires_at`. */
export function getGuestCartTtlMs(): number {
  return env.CART_GUEST_TTL_DAYS * DAY_MS;
}

/** Cookie `maxAge` in **seconds** (the unit `Set-Cookie` uses). */
export function getGuestCartCookieMaxAgeSeconds(): number {
  return env.CART_GUEST_TTL_DAYS * 24 * 60 * 60;
}

/**
 * The ceiling on one line's quantity, whatever the stock level says.
 *
 * Read through a function so a Server Action prices a line with exactly the same bound
 * the SQL guard applies; a constants module read at import time would instead freeze
 * whatever the build environment happened to hold.
 */
export function getMaxLineQuantity(): number {
  return env.CART_MAX_LINE_QUANTITY;
}