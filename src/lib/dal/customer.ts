import "server-only";

import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { isUniqueViolation } from "@/lib/db/errors";
import { customers, customerSessions } from "@/lib/db/schema/customer";
import { ConflictError, DatabaseError } from "@/lib/errors";
import type { PublicCustomer } from "@/lib/types/customer";

/**
 * Data Access Layer — customer identity.
 *
 * The **only** module that builds queries against `customers` /
 * `customer_sessions`. Server Actions, pages and components call these functions;
 * they never import Drizzle or these tables. That keeps two invariants enforceable
 * by reading one file:
 *
 * 1. `passwordHash` and `tokenHash` never leave here inside a value a caller could
 *    serialise to a browser. Functions that must return credential material say so
 *    in their name and type, and are only called from `lib/auth`.
 * 2. Identity is always derived from a database row keyed by something the server
 *    resolved (a session digest, or an email the server normalized) — never from an
 *    id, email or role supplied by the browser.
 *
 * Every query is parameterized through Drizzle; no SQL string is assembled from
 * input (`docs/security-plan.md` T-9).
 */

/** Column projection for anything that may be shown to the browser. */
const PUBLIC_COLUMNS = {
  id: customers.id,
  email: customers.email,
  firstName: customers.firstName,
  lastName: customers.lastName,
  emailVerifiedAt: customers.emailVerifiedAt,
} as const;

interface PublicCustomerRow {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly emailVerifiedAt: Date | null;
}

/**
 * Project a row onto the only customer shape the browser may see. `passwordHash` is
 * not part of `PublicCustomer`, so it cannot be leaked by spreading a row.
 */
export function toPublicCustomer(row: PublicCustomerRow): PublicCustomer {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    emailVerified: row.emailVerifiedAt !== null,
  };
}

export interface NewCustomer {
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
}

/**
 * Insert a customer and return its browser-safe projection.
 *
 * A duplicate email is mapped to `ConflictError` rather than surfacing the driver's
 * `23505`, so the caller can react to a known, expected case without a stack trace
 * or a SQL fragment reaching a response. That check is not what makes duplicate
 * identity impossible — the UNIQUE index is; this only reports it.
 */
export async function insertCustomer(input: NewCustomer): Promise<PublicCustomer> {
  try {
    const [row] = await db
      .insert(customers)
      .values({
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
      })
      .returning(PUBLIC_COLUMNS);

    if (!row) {
      throw new DatabaseError();
    }

    return toPublicCustomer(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("An account with that email address already exists.", {
        cause: error,
      });
    }

    if (error instanceof ConflictError) {
      throw error;
    }

    throw new DatabaseError({ cause: error });
  }
}

/**
 * Credential material for one email, or `null`. The lookup key is the **server's**
 * normalized email (`lib/validation/auth.ts`), never a raw form value.
 *
 * **Returns `passwordHash`.** Callable only from the sign-in path in `lib/auth`; the
 * result must never be forwarded to a response, a log, or a Client Component.
 */
export interface CustomerCredentials {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly isActive: boolean;
  readonly failedLoginAttempts: number;
  readonly lastFailedLoginAt: Date | null;
  readonly lockedUntil: Date | null;
}

export async function findCustomerCredentialsByEmail(
  email: string,
): Promise<CustomerCredentials | null> {
  try {
    const [row] = await db
      .select({
        id: customers.id,
        email: customers.email,
        passwordHash: customers.passwordHash,
        isActive: customers.isActive,
        failedLoginAttempts: customers.failedLoginAttempts,
        lastFailedLoginAt: customers.lastFailedLoginAt,
        lockedUntil: customers.lockedUntil,
      })
      .from(customers)
      .where(eq(customers.email, email))
      .limit(1);

    return row ?? null;
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/**
 * Record one failed sign-in and return the resulting throttle state.
 *
 * The new counter and lock deadline are computed by PostgreSQL **inside a single
 * statement**, so two simultaneous failures both register instead of one overwriting
 * the other's stale read. Nothing in the statement is derived from the submitted
 * password, so it needs no parameters beyond the limits.
 */
export async function recordFailedLogin(
  customerId: string,
  options: { readonly maxFailedAttempts: number; readonly lockoutMs: number; readonly now: Date },
): Promise<{ readonly failedLoginAttempts: number; readonly lockedUntil: Date | null }> {
  const { maxFailedAttempts, lockoutMs, now } = options;

  try {
    const reachedThreshold = sql`${customers.failedLoginAttempts} + 1 >= ${maxFailedAttempts}`;

    const [row] = await db
      .update(customers)
      .set({
        failedLoginAttempts: sql`case when ${reachedThreshold} then 0 else ${customers.failedLoginAttempts} + 1 end`,
        lastFailedLoginAt: now,
        lockedUntil: sql`case when ${reachedThreshold} then now() + interval '${sql.raw(String(lockoutMs))} milliseconds' else ${customers.lockedUntil} end`,
        updatedAt: now,
      })
      .where(eq(customers.id, customerId))
      .returning({
        failedLoginAttempts: customers.failedLoginAttempts,
        lockedUntil: customers.lockedUntil,
      });

    return row ?? { failedLoginAttempts: 0, lockedUntil: null };
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/**
 * Clear the throttle state and stamp the sign-in time in one statement, so a
 * successful login never leaves a "one more failure locks it" counter behind.
 */
export async function recordSuccessfulLogin(customerId: string, now: Date): Promise<void> {
  try {
    await db
      .update(customers)
      .set({ lastLoginAt: now, failedLoginAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(customers.id, customerId));
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}
export interface NewSession {
  readonly customerId: string;
  /** SHA-256 digest of the raw token. The raw token is never passed to the DAL. */
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
}

/** Persist a session row. Only the token *hash* is stored, so a leak is not replayable. */
export async function insertSession(input: NewSession): Promise<string> {
  try {
    const [row] = await db
      .insert(customerSessions)
      .values({
        customerId: input.customerId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
      })
      .returning({ id: customerSessions.id });

    if (!row) {
      throw new DatabaseError();
    }

    return row.id;
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

export interface ResolvedSession {
  readonly sessionId: string;
  readonly sessionExpiresAt: Date;
  readonly customer: PublicCustomer;
}

/**
 * Resolve a raw session digest into an authenticated customer, or `null`.
 *
 * The access rules live in the `WHERE` clause rather than in JavaScript, so there is
 * no window in which a revoked, expired or deactivated record could be admitted: a
 * session must be unredeemed, unexpired, and belong to an active customer. `null` is
 * the answer for every rejection — the caller does not need to know why, and a
 * browser must not be able to tell an expired session from a forged one.
 */
export async function findActiveSessionByTokenHash(
  tokenHash: string,
  now: Date,
): Promise<ResolvedSession | null> {
  try {
    const [row] = await db
      .select({
        sessionId: customerSessions.id,
        sessionExpiresAt: customerSessions.expiresAt,
        ...PUBLIC_COLUMNS,
      })
      .from(customerSessions)
      .innerJoin(customers, eq(customerSessions.customerId, customers.id))
      .where(
        and(
          eq(customerSessions.tokenHash, tokenHash),
          isNull(customerSessions.revokedAt),
          gt(customerSessions.expiresAt, now),
          eq(customers.isActive, true),
        ),
      )
      .limit(1);

    if (!row) {
      return null;
    }

    return {
      sessionId: row.sessionId,
      sessionExpiresAt: row.sessionExpiresAt,
      customer: toPublicCustomer(row),
    };
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/**
 * Revoke the session identified by a raw-token digest.
 *
 * Only unredeemed rows are touched, so a repeated logout is a no-op rather than an
 * error. A session that is already gone is not a failure — the caller clears the
 * cookie either way.
 */
export async function revokeSessionByTokenHash(tokenHash: string, now: Date): Promise<void> {
  try {
    await db
      .update(customerSessions)
      .set({ revokedAt: now })
      .where(and(eq(customerSessions.tokenHash, tokenHash), isNull(customerSessions.revokedAt)));
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/**
 * The browser-safe projection of one customer by id.
 *
 * Used after a successful sign-in to pick up the stored display name and
 * verification state, and by the account page. The id always comes from a validated
 * session, never from a request parameter.
 */
export async function findPublicCustomerById(customerId: string): Promise<PublicCustomer | null> {
  try {
    const [row] = await db
      .select(PUBLIC_COLUMNS)
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);

    return row ? toPublicCustomer(row) : null;
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}