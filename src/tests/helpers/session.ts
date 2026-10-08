import { and, eq, gt, isNull } from "drizzle-orm";

import { env } from "@/config/env";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/tokens";
import { customerSessions, customers } from "@/lib/db/schema/customer";
import { testCookieJar } from "@/tests/stubs/next-headers";

import type { TestDatabase } from "./db";

/**
 * Direct, un-projected reads of session state for assertions.
 *
 * Going around the DAL is deliberate: a test that asked the DAL "is this session
 * valid?" could pass while the DAL itself was wrong. The access rules are re-stated
 * here in SQL so the assertion is about what is in the database.
 */

/** Every session row for a customer, regardless of state. */
export async function readSessionsFor(handle: TestDatabase, customerId: string) {
  return handle.db
    .select()
    .from(customerSessions)
    .where(eq(customerSessions.customerId, customerId));
}

/**
 * The active session for a raw cookie value, resolved with the same conditions the DAL
 * applies (unrevoked, unexpired, active customer). Returns `null` for any rejection.
 */
export async function readActiveSessionFor(handle: TestDatabase, rawToken: string) {
  const [row] = await handle.db
    .select({
      sessionId: customerSessions.id,
      email: customers.email,
      customerId: customers.id,
    })
    .from(customerSessions)
    .innerJoin(customers, eq(customerSessions.customerId, customers.id))
    .where(
      and(
        eq(customerSessions.tokenHash, hashSessionToken(rawToken)),
        isNull(customerSessions.revokedAt),
        gt(customerSessions.expiresAt, new Date()),
        eq(customers.isActive, true),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return { sessionId: row.sessionId, customer: { id: row.customerId, email: row.email } };
}

/** Force a session to look expired, without waiting for the real TTL. */
export async function expireSessionsFor(handle: TestDatabase, customerId: string): Promise<void> {
  await handle.db
    .update(customerSessions)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(customerSessions.customerId, customerId));
}

/** Revoke every session for a customer, simulating a concurrent "sign out everywhere". */
export async function revokeSessionsFor(handle: TestDatabase, customerId: string): Promise<void> {
  await handle.db
    .update(customerSessions)
    .set({ revokedAt: new Date() })
    .where(eq(customerSessions.customerId, customerId));
}

/**
 * Issue a working session for a customer **without** going through the sign-in action.
 *
 * Used by the cart suites, which need an authenticated visitor to exist but are not testing
 * authentication — driving the real sign-in would add an Argon2 hash and a throttle to every one
 * of them for no assertion. The raw token is returned so the caller can put it in the stub
 * cookie jar exactly as the browser would have received it.
 */
export async function seedSessionFor(
  handle: TestDatabase,
  customerId: string,
  options: { readonly expiresAt?: Date } = {},
): Promise<string> {
  const rawToken = generateSessionToken();

  await handle.db.insert(customerSessions).values({
    customerId,
    tokenHash: hashSessionToken(rawToken),
    expiresAt: options.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  return rawToken;
}

/**
 * Sign a customer in as far as the application is concerned, by seeding a session and the
 * session cookie together.
 */
export async function signInAs(
  handle: TestDatabase,
  customerId: string,
  options: { readonly expiresAt?: Date } = {},
): Promise<string> {
  const rawToken = await seedSessionFor(handle, customerId, options);

  testCookieJar.seed(env.SESSION_COOKIE_NAME, rawToken);

  return rawToken;
}