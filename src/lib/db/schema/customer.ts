import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Customer-owned tables — Phase 2.
 *
 * Ownership is the opposite of `./catalog.ts`: these tables are **created and owned
 * by Chronospeed** (its own Drizzle migration lineage in `chronospeed/drizzle/`),
 * and `admin-backend` neither reads nor writes them. Customer identity is
 * deliberately separate from `admin_users` so the two security domains can never be
 * confused (`docs/database-plan.md` §4.1).
 *
 * Deviations from the illustrative Phase 0 sketch (§4.1) — all additive, none
 * removing a planned column:
 * - tables are `customers` / `customer_sessions`, not `users` / `user_sessions`,
 *   so nothing named `user` can be mistaken for an admin user in a shared database;
 * - `token_hash` is `text` (a SHA-256 hex digest) with a UNIQUE index, matching the
 *   proven `admin-backend` refresh-session shape rather than a bounded `varchar`;
 * - `last_failed_login_at` and `last_login_at` are added so the account-scoped
 *   throttle can enforce a minimum interval between failures (the sketch listed only
 *   `failed_login_attempts` and `locked_until`);
 * - no foreign keys point at any admin-owned table. Later phases that need to
 *   reference `products` / `inventory` model it through columns, not constraints, so
 *   a Chronospeed migration can never fail on, or block a write to, the shared
 *   catalog.
 *
 * `password_reset_tokens` / `email_verification_tokens` are **not** created: email
 * verification and reset are explicitly out of Phase 2 scope, and creating tables
 * with no writer would add attack surface for no benefit.
 */

/**
 * A customer account.
 *
 * `email` is stored **lower-cased and trimmed** and carries a UNIQUE index, so
 * `User@example.com` and `user@example.com` cannot become two identities. The
 * CHECK constraint below re-asserts that invariant in the database, so a future
 * caller that forgets to normalize fails loudly instead of creating a duplicate
 * identity through a different code path.
 *
 * `password_hash` holds an Argon2id digest and is never selected by a public DAL
 * function.
 */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    email: varchar("email", { length: 255 }).notNull(),

    passwordHash: varchar("password_hash", { length: 255 }).notNull(),

    firstName: varchar("first_name", { length: 80 }),

    lastName: varchar("last_name", { length: 80 }),

    phone: varchar("phone", { length: 20 }),

    /** Null until a future phase verifies the address (no verifier exists yet). */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),

    isActive: boolean("is_active").notNull().default(true),

    /** Consecutive failed logins since the last success. Reset to 0 on success. */
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),

    /** When the last failed login happened; drives the minimum-interval throttle. */
    lastFailedLoginAt: timestamp("last_failed_login_at", { withTimezone: true }),

    /** While in the future, sign-in is refused without verifying the password. */
    lockedUntil: timestamp("locked_until", { withTimezone: true }),

    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("customers_email_key").on(table.email),
    check(
      "customers_failed_login_attempts_non_negative_check",
      sql`${table.failedLoginAttempts} >= 0`,
    ),
    check("customers_email_lowercase_check", sql`${table.email} = lower(${table.email})`),
  ],
);

/**
 * A server-side customer session.
 *
 * Only `hashSessionToken(raw)` is stored: a leaked database row cannot be replayed
 * as a cookie. `revokedAt` supports logout and (later) sign-out-everywhere;
 * `expiresAt` is enforced on every resolution, so an expired row is never
 * accepted even if it has not been swept yet.
 *
 * One row per login, so sessions stay individually revocable per device. There is
 * deliberately no refresh-token rotation: the token is opaque, high-entropy and
 * short-lived on a sliding refresh at resolution time, which is what Phase 0 asks
 * for — it explicitly cautions against inventing authentication complexity.
 */
export const customerSessions = pgTable(
  "customer_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade", onUpdate: "cascade" }),

    /** SHA-256 hex digest of the raw cookie value. Never the raw token. */
    tokenHash: text("token_hash").notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    /** Bounded, for the session-listing UI a later phase may add. */
    userAgent: text("user_agent"),

    ipAddress: varchar("ip_address", { length: 64 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("customer_sessions_token_hash_idx").on(table.tokenHash),
    index("customer_sessions_customer_id_idx").on(table.customerId),
    index("customer_sessions_expires_at_idx").on(table.expiresAt),
  ],
);