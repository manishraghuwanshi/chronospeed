import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque customer session tokens.
 *
 * The token is 32 random bytes (256 bits) rendered as hex — the same construction
 * `admin-backend` uses for its refresh token. The important property is the split
 * between the **raw** token and its **hash**:
 *
 * - the raw token is sent to the browser exactly once, inside the session cookie;
 * - only the SHA-256 hash is written to `customer_sessions.token_hash`, so a
 *   database leak cannot be replayed as a login;
 * - the raw token is never logged, never returned in a payload, and never placed
 *   in a URL.
 *
 * SHA-256 (not Argon2) is correct here: the input is 256 bits of uniform entropy,
 * so there is nothing to brute-force and verification must stay cheap.
 */

/** 32 random bytes as hex — 64 characters, 256 bits of entropy. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/** The value stored in the database. Never send this to a client. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Absolute session expiry.
 *
 * `days` is passed in (rather than read from `env` here) so this module stays a
 * pure, testable function and has no configuration dependency.
 */
export function sessionExpiresAt(days: number, now = Date.now()): Date {
  return new Date(now + days * 24 * 60 * 60 * 1000);
}