import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { customers } from "./customer";

/**
 * Cart tables — Phase 4.
 *
 * Chronospeed-owned tables in Chronospeed's own Drizzle lineage (see
 * `drizzle.config.ts`), exactly like `./customer.ts`. `admin-backend` never reads or
 * writes them.
 *
 * ## What a cart is, and what it is not
 *
 * A cart records *intent*, not a hold. Nothing here reserves stock, and no price is
 * stored: `docs/database-plan.md` §4.3 is explicit that "carts never store price", so a
 * cart row can never become a stale copy of a price that a customer then pays. Prices,
 * totals and availability are read from `products` / `inventory` and recomputed on every
 * render and every mutation (`docs/phase-roadmap.md` §7 "Rules").
 *
 * ## One owner, and it is exclusive
 *
 * A cart belongs either to a signed-in customer or to an anonymous browser, never both
 * and never neither. That is enforced by `carts_owner_exclusive_check` rather than by
 * convention, so a bug that wrote both keys, or a row created with neither, fails loudly
 * at the database instead of producing a cart two different people could resolve to.
 *
 * Deviations from the illustrative Phase 0 sketch (§4.3) — all additive, none removing a
 * planned column, and all following the precedent set by `./customer.ts`:
 *
 * - `session_token` becomes **`guest_token_hash`**. Only the SHA-256 digest of the guest
 *   token is stored, never the token itself, so a leaked database row cannot be replayed
 *   as someone else's cart. This mirrors `customer_sessions.token_hash`; the digest is
 *   domain-separated in `lib/cart/tokens.ts`.
 * - `customer_id` is **nullable and UNIQUE** (a customer has at most one cart). Postgres
 *   treats `NULL`s as distinct in a unique index, so many guest carts coexist.
 * - `expires_at` is nullable, with `carts_guest_expiry_check` requiring it **exactly** for
 *   guest carts: an anonymous cart must age out, while a signed-in customer's cart
 *   survives until checkout or account deletion (the FK cascades). A customer cart
 *   therefore cannot be silently discarded by a sweeper, and a guest cart cannot be kept
 *   alive forever by omission.
 * - `cart_items.product_id` carries **no foreign key** to the admin-owned `products`
 *   table. `./customer.ts` states the rule and the reason, and it applies with more force
 *   here: a constraint on `products` would let a Chronospeed migration fail, or block a
 *   write, in the shared catalogue — and `ON DELETE CASCADE` would let an admin deleting a
 *   product silently delete customer rows. The reference is modelled as a value and
 *   validated by the DAL, which already re-reads the product for price and availability.
 *   A product that no longer exists is reported as unavailable, not as a crash.
 */

/**
 * A shopping cart: one per customer, or one per anonymous guest browser.
 *
 * `updated_at` is written on every mutation, including a merge, so a later phase has the
 * signal it needs for an abandoned-cart sweeper (`docs/security-plan.md` §10, S-7).
 */
export const carts = pgTable(
  "carts",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /** The owner when the visitor is signed in. `NULL` for a guest cart. */
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),

    /** SHA-256 digest of the guest cart token. `NULL` for a customer cart. */
    guestTokenHash: text("guest_token_hash"),

    /** Set for guest carts only; see `carts_guest_expiry_check`. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** At most one cart per customer. `NULL`s are distinct, so guests are unaffected. */
    uniqueIndex("carts_customer_id_key").on(table.customerId),

    /** At most one cart per guest token digest. */
    uniqueIndex("carts_guest_token_hash_key").on(table.guestTokenHash),

    /** Supports an expiry sweep of abandoned guest carts. */
    index("carts_expires_at_idx").on(table.expiresAt),

    check(
      "carts_owner_exclusive_check",
      sql`(${table.customerId} IS NULL) <> (${table.guestTokenHash} IS NULL)`,
    ),

    check(
      "carts_guest_expiry_check",
      sql`(${table.customerId} IS NULL) = (${table.expiresAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * A cart line: a product and how many of it the customer intends to buy.
 *
 * The UNIQUE index on `(cart_id, product_id)` is load-bearing rather than tidiness: every
 * write upserts with `ON CONFLICT` against it, which is what makes "add the same product
 * twice" a quantity increase and what makes the guest-cart merge structurally incapable of
 * producing duplicate lines (`docs/phase-roadmap.md` §7).
 *
 * `quantity >= 1` is a database CHECK, not only a Zod rule, so no code path — including a
 * future migration or a hand-run query — can leave a zero-quantity line behind for the UI
 * to filter out.
 */
export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade", onUpdate: "cascade" }),

    /** References `products.id` by value only — deliberately not by constraint. */
    productId: uuid("product_id").notNull(),

    quantity: integer("quantity").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("cart_items_cart_id_product_id_key").on(table.cartId, table.productId),

    index("cart_items_cart_id_idx").on(table.cartId),

    index("cart_items_product_id_idx").on(table.productId),

    check("cart_items_quantity_positive_check", sql`${table.quantity} >= 1`),
  ],
);