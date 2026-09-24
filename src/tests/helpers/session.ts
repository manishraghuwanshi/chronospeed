import { and, eq, gt, isNull } from "drizzle-orm";

import { hashSessionToken } from "@/lib/auth/tokens";
import { customerSessions, customers } from "@/lib/db/schema/customer";

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