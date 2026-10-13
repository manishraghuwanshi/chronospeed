import "server-only";

import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { db, type Database, type DatabaseTransaction } from "@/lib/db/client";
import { brands, inventory, productImages, products } from "@/lib/db/schema/catalog";
import { cartItems, carts } from "@/lib/db/schema/cart";
import { DatabaseError } from "@/lib/errors";
import { getStorageObjectUrl } from "@/lib/storage/urls";
import { multiplyAmount, type CartLine } from "@/lib/types/cart";

/**
 * Data Access Layer — cart (read/write).
 *
 * The **only** module that builds queries against `carts` / `cart_items`. Server
 * Actions, the cart service and pages call these functions; they never import Drizzle or
 * the schema. Catalogue tables are still read-only here — this module joins them and never
 * writes them (`docs/architecture.md` §4.4).
 *
 * ## The two rules that make a cart safe
 *
 * 1. **Ownership is resolved before a query is built.** Every function that touches a
 *    cart takes a `cartId` the caller obtained from `findCartForCustomer` /
 *    `findCartForGuestToken`. No function accepts a customer id, an email or a
 *    browser-supplied cart id, so there is no parameter an attacker could substitute to
 *    reach someone else's cart (`docs/security-plan.md` T-7). A function that takes an
 *    `itemId` additionally constrains it by the same `cartId`, so a line id from another
 *    cart simply matches nothing.
 * 2. **Quantity is capped in the statement, not in JavaScript.** Each write is one
 *    `INSERT ... ON CONFLICT DO UPDATE` whose value is
 *    `LEAST(<requested>, <per-line ceiling>, <live availability>)`. A read-then-write would
 *    leave a window in which stock changed between the check and the update; here the
 *    database evaluates availability and writes in the same statement, and the returned row
 *    is the authority on what was actually applied.
 *
 * ## Why the quantity is clamped rather than rejected
 *
 * Adding more than is in stock is a normal thing to do — a customer picks a quantity, the
 * last one sells, and the honest answer is "we put as many as we could in your cart". The
 * write clamps and reports the resulting quantity, and the caller compares it with what was
 * asked for to decide what to tell the customer. A hard rejection would have to guess
 * whether the request was abuse or bad luck.
 *
 * ## Prices
 *
 * No price is written anywhere in this file. `listCartLines` joins the live `products` and
 * `inventory` rows at read time, which is what makes a stale cart unable to bypass a price
 * change (`docs/database-plan.md` §4.3).
 */

/** A cart as the DAL resolves it: an id plus the ownership mode it was found by. */
export interface ResolvedCart {
  readonly id: string;
  readonly customerId: string | null;
}

const CART_COLUMNS = {
  id: carts.id,
  customerId: carts.customerId,
} as const;

/**
 * The quantity a write is allowed to store, expressed once as SQL so every write clamps
 * identically.
 *
 * The correlated subquery is intentional: it asks for availability **at the moment of the
 * write**, inside the same statement, rather than accepting a number the application read a
 * moment earlier. A product with no `inventory` row yields `NULL`, which `COALESCE` turns
 * into `0` — the same "no row means out of stock" rule `lib/dal/catalog.ts` applies to
 * listings.
 */
function capacityExpression(productId: string | SQL, maxLineQuantity: number) {
  return sql`GREATEST(
    0,
    LEAST(
      CAST(${maxLineQuantity} AS integer),
      CAST(
        COALESCE(
          (
            SELECT ${inventory.quantity} - ${inventory.reservedQuantity}
            FROM ${inventory}
            WHERE ${inventory.productId} = ${productId}
            LIMIT 1
          ),
          0
        ) AS integer
      )
    )
  )`;
}

// ---------------------------------------------------------------------------
// Cart resolution and creation
// ---------------------------------------------------------------------------

/**
 * The signed-in customer's cart, or `null` when they do not have one yet.
 *
 * A read, so it never creates a row: simply opening a page must not write to the
 * database, and a customer who has never added anything should have no cart at all.
 */
export async function findCartForCustomer(customerId: string): Promise<ResolvedCart | null> {
  try {
    const [row] = await db
      .select(CART_COLUMNS)
      .from(carts)
      .where(eq(carts.customerId, customerId))
      .limit(1);

    return row ?? null;
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/**
 * The anonymous cart for a guest token **digest**, or `null`.
 *
 * An expired row is not returned. The rule lives in the `WHERE` clause rather than in
 * JavaScript so there is no window in which an expired cart could be resolved, and a stale
 * cookie value cannot revive an abandoned cart — the row is never found again, and the
 * caller creates a fresh guest cart if the visitor adds something new.
 */
export async function findCartForGuestToken(
  guestTokenHash: string,
  now: Date,
): Promise<ResolvedCart | null> {
  try {
    const [row] = await db
      .select(CART_COLUMNS)
      .from(carts)
      .where(and(eq(carts.guestTokenHash, guestTokenHash), sql`${carts.expiresAt} > ${now}`))
      .limit(1);

    return row ?? null;
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/**
 * The customer's cart, created if it does not exist.
 *
 * The upsert keys on `carts_customer_id_key`, so two concurrent requests from the same
 * customer cannot create two carts: the second one updates the row the first inserted and
 * returns it. `set` writes `customerId` back to its own (unchanged) value purely because
 * `ON CONFLICT DO UPDATE` requires a non-empty assignment list; it makes the statement a
 * no-op write rather than a second insert.
 */
export async function findOrCreateCartForCustomer(customerId: string): Promise<ResolvedCart> {
  try {
    const [row] = await db
      .insert(carts)
      .values({ customerId })
      .onConflictDoUpdate({
        target: carts.customerId,
        set: { customerId: sql`${carts.customerId}` },
      })
      .returning(CART_COLUMNS);

    if (!row) {
      throw new DatabaseError();
    }

    return row;
  } catch (error) {
    if (error instanceof DatabaseError) {
      throw error;
    }

    throw new DatabaseError({ cause: error });
  }
}

/**
 * Re-own an existing guest cart for a customer who has none, inside a transaction.
 *
 * ## Why this is not a single `UPDATE`
 *
 * A cart can only be adopted if every line in it is still buyable. Adopting blindly would carry
 * a withdrawn product into the customer's cart, where the cart page would then show an item
 * that can never be checked out — the exact outcome the merge policy forbids. So the lines are
 * filtered first, and a cart whose lines are *all* unbuyable is retired rather than adopted.
 *
 * Both the filter and the update run in **one transaction**, so the cart cannot be mutated
 * between the check and the re-owning. The `WHERE ... customer_id IS NULL` guard makes the
 * statement safe to retry: once adopted, it matches nothing.
 *
 * Returns `null` when the cart could not be adopted — already taken, or deleted underneath —
 * and the caller then falls back to the merge path or simply clears the stale cookie.
 */
export async function adoptGuestCartForCustomer(
  guestTokenHash: string,
  customerId: string,
  maxLineQuantity: number,
): Promise<ResolvedCart | null> {
  try {
    return await db.transaction(async (tx) => {
      const guestCart = await tx
        .select({ id: carts.id })
        .from(carts)
        .where(and(eq(carts.guestTokenHash, guestTokenHash), isNull(carts.customerId)))
        .limit(1);

      const cartId = guestCart[0]?.id;

      if (!cartId) {
        return null;
      }

      const lines = await tx
        .select({ productId: cartItems.productId })
        .from(cartItems)
        .where(eq(cartItems.cartId, cartId));

      if (lines.length > 0) {
        // One query decides which lines survive; a withdrawn product is deleted rather than
        // carried across, and the same availability clamp the merge applies is applied here.
        const purchasable = new Set(
          (
            await tx
              .select({ id: products.id })
              .from(products)
              .innerJoin(brands, eq(brands.id, products.brandId))
              .where(
                and(
                  inArray(
                    products.id,
                    lines.map((line) => line.productId),
                  ),
                  eq(products.isActive, true),
                  eq(brands.isActive, true),
                ),
              )
          ).map((row) => row.id),
        );

        const unwanted = lines
          .filter((line) => !purchasable.has(line.productId))
          .map((line) => line.productId);

        if (unwanted.length > 0) {
          await tx
            .delete(cartItems)
            .where(and(eq(cartItems.cartId, cartId), inArray(cartItems.productId, unwanted)));
        }

        for (const line of lines.filter((entry) => purchasable.has(entry.productId))) {
          const available = await availableQuantityWithin(tx, line.productId, maxLineQuantity);

          await tx
            .update(cartItems)
            .set({ quantity: sql`LEAST(CAST(${available} AS integer), ${cartItems.quantity})`, updatedAt: sql`now()` })
            .where(
              and(
                eq(cartItems.cartId, cartId),
                eq(cartItems.productId, line.productId),
                sql`${available} > 0`,
              ),
            );
        }

        // Anything that fell to zero availability is no longer a line worth keeping.
        await tx
          .delete(cartItems)
          .where(and(eq(cartItems.cartId, cartId), sql`${cartItems.quantity} < 1`));
      }

      // Ownership moves in the same statement that clears the guest digest and the expiry,
      // because the CHECK constraints allow only one of the two ownership shapes to exist.
      const adopted = await tx
        .update(carts)
        .set({ customerId, guestTokenHash: null, expiresAt: null, updatedAt: sql`now()` })
        .where(and(eq(carts.id, cartId), isNull(carts.customerId)))
        .returning(CART_COLUMNS);

      return adopted[0] ?? null;
    });
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/**
 * The anonymous cart for a guest token digest, created if it does not exist.
 *
 * The CHECK constraints make it impossible for this insert to produce a row that is both a
 * guest cart and a customer cart, or a guest cart without an expiry.
 *
 * An **expired** cart is deliberately not revived: `findCartForGuestToken` refuses it
 * already, and the upsert below would otherwise conflict on the digest and silently extend
 * the life of a cart the server had expired. Reviving it would make expiry meaningless, so
 * the caller is expected to clear a cookie that resolves to nothing and then call this.
 */
export async function findOrCreateCartForGuestToken(
  guestTokenHash: string,
  expiresAt: Date,
): Promise<ResolvedCart> {
  try {
    const [row] = await db
      .insert(carts)
      .values({ guestTokenHash, expiresAt })
      .onConflictDoUpdate({
        target: carts.guestTokenHash,
        set: { expiresAt: sql`${carts.expiresAt}` },
      })
      .returning(CART_COLUMNS);

    if (!row) {
      throw new DatabaseError();
    }

    return row;
  } catch (error) {
    if (error instanceof DatabaseError) {
      throw error;
    }

    throw new DatabaseError({ cause: error });
  }
}

/** Delete a cart and, by cascade, its lines. Used to retire a merged guest cart. */
export async function deleteCart(cartId: string): Promise<void> {
  try {
    await db.delete(carts).where(eq(carts.id, cartId));
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/** Refresh a guest cart's expiry, so an active visitor's cart does not age out. */
export async function touchGuestCartExpiry(cartId: string, expiresAt: Date): Promise<void> {
  try {
    await db
      .update(carts)
      .set({ expiresAt, updatedAt: sql`now()` })
      .where(eq(carts.id, cartId));
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/** Mark a cart as changed, so `updated_at` stays meaningful for a later sweeper. */
export async function touchCart(cartId: string): Promise<void> {
  try {
    await db
      .update(carts)
      .set({ updatedAt: sql`now()` })
      .where(eq(carts.id, cartId));
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

// ---------------------------------------------------------------------------
// Item mutation
// ---------------------------------------------------------------------------

/**
 * A write result that reports what the database actually stored.
 *
 * `quantity` is the authoritative value after clamping, so the caller can compare it with
 * the requested amount rather than assuming the request was honoured.
 */
export interface ItemWriteResult {
  readonly itemId: string;
  readonly productId: string;
  readonly quantity: number;
}

/**
 * Set a line to exactly `quantity`, clamped to the per-line ceiling and to availability.
 *
 * **Replace semantics** — this is the primitive the merge uses, where the target quantity is
 * already known (the sum of the two carts) and must be stored as such. It is deliberately not
 * the primitive "Add to bag" uses; incrementing is a different operation with different
 * semantics, and mixing the two is how a merge starts adding one customer's quantity to another
 * customer's cart instead of summing two carts that both belong to the same person.
 *
 * `setWhere: target > 0` and the availability guard exist because
 * `cart_items_quantity_positive_check` rejects a zero quantity: a product with no stock must
 * produce no row rather than a constraint violation. Nothing is written and `null` is returned,
 * which the caller reports as "not available".
 */
export async function upsertCartItemQuantity(
  cartId: string,
  productId: string,
  quantity: number,
  maxLineQuantity: number,
): Promise<ItemWriteResult | null> {
  return upsertQuantityWith(db, cartId, productId, quantity, maxLineQuantity);
}

/** Either the pooled client or an open transaction, so one helper serves both. */
type CartExecutor = Database | DatabaseTransaction;

/** The body of `upsertCartItemQuantity`, parameterised by executor so it can run in a tx. */
async function upsertQuantityWith(
  executor: CartExecutor,
  cartId: string,
  productId: string,
  quantity: number,
  maxLineQuantity: number,
): Promise<ItemWriteResult | null> {
  try {
    // Guard the zero case **before** the statement, because the two branches fail differently:
    // the update branch is skipped by `setWhere`, but the insert branch would try to write
    // `quantity = 0` and be rejected by `cart_items_quantity_positive_check` — turning an
    // ordinary "out of stock" into a constraint violation and a 500. This read is not the
    // authority; the live `LEAST(...)` below still clamps the value written, so stock falling
    // between the two reads cannot produce an over-large line.
    if ((await availableQuantityWithin(executor, productId, maxLineQuantity)) <= 0) {
      return null;
    }

    const capacity = capacityExpression(productId, maxLineQuantity);

    // Replace semantics: the line is **set** to `quantity`, clamped to availability and to the
    // per-line ceiling. That is what the merge needs — it computes an explicit target (the sum
    // of the two carts) and stores it. An *increment* is a different operation with different
    // semantics and lives in `addCartItemQuantity`.
    const target = sql`LEAST(CAST(${capacity} AS integer), CAST(${quantity} AS integer))`;

    const [row] = await executor
      .insert(cartItems)
      .values({ cartId, productId, quantity: target })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.productId],
        set: { quantity: target, updatedAt: sql`now()` },
        setWhere: sql`${target} > 0`,
      })
      .returning({
        itemId: cartItems.id,
        productId: cartItems.productId,
        quantity: cartItems.quantity,
      });

    return row ?? null;
  } catch (error) {
    if (error instanceof DatabaseError) {
      throw error;
    }

    throw new DatabaseError({ cause: error });
  }
}

/**
 * Add `quantity` to whatever the cart already holds, clamped to ceiling and availability.
 *
 * This is the primitive an "Add to cart" button uses, and its semantics are *increment*, not
 * *replace*: adding one more of something already in the cart must leave two, which is why
 * the merge cannot be built on this function and why `upsertCartItemQuantity` exists
 * separately.
 *
 * ## Why this is not one upsert
 *
 * A single `INSERT ... ON CONFLICT DO UPDATE` cannot express the increment correctly. The
 * insert branch would have to store the clamped *addend*, but a `0` addend then violates the
 * positive-quantity CHECK — and if `targetWhere` suppressed it the statement would silently
 * write nothing while still reporting success. The update branch, for its part, cannot tell
 * "the cart already held `n`" from "the cart is new".
 *
 * The two branches therefore run as two statements inside **one transaction**. The update is
 * tried first, so an existing line is incremented without ever passing through the insert
 * path; only when it matches nothing does the insert create the line, and the insert's clamp
 * *is* the capacity check because there is no existing quantity to add to. Inside a
 * transaction the pair behaves as one operation: if either fails, both roll back, and two
 * concurrent adds cannot interleave into a lost update the way a read-modify-write would.
 */
export async function addCartItemQuantity(
  cartId: string,
  productId: string,
  quantity: number,
  maxLineQuantity: number,
): Promise<ItemWriteResult | null> {
  try {
    return await db.transaction(async (tx) => {
      const capacity = capacityExpression(productId, maxLineQuantity);
      const incremented = sql`GREATEST(0, LEAST(CAST(${capacity} AS integer), ${cartItems.quantity} + CAST(${quantity} AS integer)))`;

      const updated = await tx
        .update(cartItems)
        .set({ quantity: sql`${incremented}`, updatedAt: sql`now()` })
        .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)))
        .returning({
          itemId: cartItems.id,
          productId: cartItems.productId,
          quantity: cartItems.quantity,
        });

      if (updated[0]) {
        return updated[0];
      }

      // No line yet: read availability **inside this transaction**, so the number used to
      // build the new line is consistent with the write that follows. This is not the
      // authority — the clamped value in the statement below and the positive-quantity CHECK
      // are — it is the guard that keeps a zero out of a CHECK the database would reject.
      const available = await availableQuantityWithin(tx, productId, maxLineQuantity);

      if (available <= 0) {
        return null;
      }

      const insertedValue = sql`LEAST(CAST(${available} AS integer), CAST(${quantity} AS integer))`;

      const [row] = await tx
        .insert(cartItems)
        .values({ cartId, productId, quantity: insertedValue })
        .returning({
          itemId: cartItems.id,
          productId: cartItems.productId,
          quantity: cartItems.quantity,
        });

      return row ?? null;
    });
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/** The availability of one product, capped at the per-line ceiling, or `0`. */
async function availableQuantityWithin(
  executor: CartExecutor,
  productId: string,
  maxLineQuantity: number,
): Promise<number> {
  const [row] = await executor
    .select({
      available: sql<number>`GREATEST(0, ${inventory.quantity} - ${inventory.reservedQuantity})`,
    })
    .from(inventory)
    .where(eq(inventory.productId, productId))
    .limit(1);

  const available = Number(row?.available ?? 0);

  return Math.max(0, Math.min(available, maxLineQuantity));
}

/**
 * Set a line's quantity **only if the line belongs to `cartId`**.
 *
 * The `cartId` in the `WHERE` clause is the ownership check, not a convenience: `itemId`
 * arrives from a form, so a value taken from another cart has to match nothing. Returns
 * `false` when no row matched — including when the product has since gone out of stock and
 * the clamped value is `0` — and the caller reports it as unavailable-or-gone rather than
 * distinguishing the two, so the response cannot be used to probe another cart.
 *
 * The requested `quantity` is clamped to the **live** availability read in the same statement,
 * so a customer cannot raise a line above what is actually in stock even by editing the form.
 */
export async function updateCartItemQuantityForCart(
  cartId: string,
  itemId: string,
  quantity: number,
  maxLineQuantity: number,
): Promise<boolean> {
  try {
    const capacity = capacityExpression(sql`${cartItems.productId}`, maxLineQuantity);

    // The requested quantity is clamped to live availability, and the same expression both
    // filters the row (`> 0`) and sets it — so a line can never be written with a zero quantity
    // and the `WHERE` can never disagree with what is stored.
    const target = sql`LEAST(CAST(${capacity} AS integer), CAST(${quantity} AS integer))`;

    const rows = await db
      .update(cartItems)
      .set({ quantity: target, updatedAt: sql`now()` })
      .where(
        and(
          eq(cartItems.id, itemId),
          eq(cartItems.cartId, cartId),
          sql`${target} > 0`,
        ),
      )
      .returning({ id: cartItems.id });

    return rows.length > 0;
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/** Remove one line, scoped to the caller's cart. `false` when nothing matched. */
export async function removeCartItemForCart(cartId: string, itemId: string): Promise<boolean> {
  try {
    const rows = await db
      .delete(cartItems)
      .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)))
      .returning({ id: cartItems.id });

    return rows.length > 0;
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/** Remove every line in a cart. Lines only — the cart row is kept so it stays addressable. */
export async function clearCartItems(cartId: string): Promise<void> {
  try {
    await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

// ---------------------------------------------------------------------------
// Priced read
// ---------------------------------------------------------------------------

/**
 * Columns the priced read joins from the catalogue.
 *
 * A `LEFT JOIN` on both `products` and `inventory` is deliberate: a line whose product has
 * been unpublished, or whose `inventory` row is missing, must still be returned so the cart
 * page can say what happened to it. An inner join would make the line disappear from the
 * customer's own cart, which reads as data loss.
 */
const LINE_COLUMNS = {
  itemId: cartItems.id,
  productId: cartItems.productId,
  quantity: cartItems.quantity,
  productSlug: products.slug,
  productName: products.name,
  price: products.price,
  compareAtPrice: products.compareAtPrice,
  productCurrency: products.currency,
  isActive: products.isActive,
  brandName: brands.name,
  brandIsActive: brands.isActive,
  thumbnailStorageKey: productImages.storageKey,
  quantityOnHand: inventory.quantity,
  reservedQuantity: inventory.reservedQuantity,
} as const;

interface LineRow {
  readonly itemId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly productSlug: string | null;
  readonly productName: string | null;
  readonly price: number | null;
  readonly compareAtPrice: number | null;
  readonly productCurrency: string | null;
  readonly isActive: boolean | null;
  readonly brandName: string | null;
  readonly brandIsActive: boolean | null;
  readonly thumbnailStorageKey: string | null;
  readonly quantityOnHand: number | null;
  readonly reservedQuantity: number | null;
}

/**
 * Every line in a cart, priced from the **live** catalogue.
 *
 * Three guarantees this function provides:
 *
 * - **Price is never read from the cart.** `unitPrice` and `compareAtPrice` come from the
 *   current `products` row, so a cart cannot hold a stale price
 *   (`docs/database-plan.md` §4.3).
 * - **Availability is computed, never stored** — `quantity - reserved_quantity`, floored at
 *   zero, exactly as `lib/dal/catalog.ts` defines it.
 * - **A deleted or unpublished product is reported, not hidden.** Such a line comes back
 *   with `isAvailable: false` and contributes `0` to the subtotal, so the customer is told
 *   the truth instead of silently losing a row.
 *
 * The thumbnail join is constrained to the primary image in the **join condition** rather
 * than in a `WHERE` clause, because a condition in `WHERE` would turn the `LEFT JOIN` into an
 * inner join and drop every product that has no primary image.
 */
export async function listCartLines(cartId: string): Promise<CartLine[]> {
  try {
    const rows: LineRow[] = await db
      .select(LINE_COLUMNS)
      .from(cartItems)
      .leftJoin(products, eq(products.id, cartItems.productId))
      .leftJoin(brands, eq(brands.id, products.brandId))
      .leftJoin(inventory, eq(inventory.productId, cartItems.productId))
      .leftJoin(
        productImages,
        and(eq(productImages.productId, cartItems.productId), eq(productImages.isPrimary, true)),
      )
      .where(eq(cartItems.cartId, cartId))
      .orderBy(asc(cartItems.createdAt), asc(cartItems.id));

    return await Promise.all(rows.map(toCartLine));
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/**
 * Project one joined row onto a `CartLine`.
 *
 * A product counts as available only when it still exists, is active, **and** its brand is
 * active — the same visibility rule every catalogue query applies. That is what stops a
 * withdrawn product from remaining purchasable through a cart that was filled while it was
 * still listed.
 */
async function toCartLine(row: LineRow): Promise<CartLine> {
  const exists = row.productSlug !== null && row.productName !== null && row.price !== null;
  const isAvailable = exists && row.isActive === true && row.brandIsActive === true;

  const availableQuantity = Math.max(0, (row.quantityOnHand ?? 0) - (row.reservedQuantity ?? 0));

  const unitPrice = row.price ?? 0;

  return {
    itemId: row.itemId,
    productId: row.productId,
    productSlug: row.productSlug ?? "",
    name: row.productName ?? "Unavailable product",
    brandName: row.brandName ?? "",
    thumbnailUrl: await getStorageObjectUrl(row.thumbnailStorageKey),
    unitPrice,
    compareAtPrice: row.compareAtPrice,
    currency: row.productCurrency ?? "INR",
    quantity: row.quantity,
    availableQuantity,
    // An unavailable product contributes nothing: the subtotal must never include a price
    // the customer cannot actually pay.
    lineTotal: isAvailable ? multiplyAmount(unitPrice, row.quantity) : 0,
    isAvailable,
    exceedsStock: isAvailable && row.quantity > availableQuantity,
  };
}

/**
 * The two numbers a header badge shows, without pricing anything.
 *
 * A badge appears on every page, so it gets its own cheap aggregate instead of being derived
 * from a full priced read that would join the catalogue and sign image URLs purely to count.
 */
export async function countCartItems(
  cartId: string,
): Promise<{ itemCount: number; totalQuantity: number }> {
  try {
    const [row] = await db
      .select({
        itemCount: sql<number>`COUNT(*)`,
        totalQuantity: sql<number>`COALESCE(SUM(${cartItems.quantity}), 0)`,
      })
      .from(cartItems)
      .where(eq(cartItems.cartId, cartId));

    return {
      itemCount: Number(row?.itemCount ?? 0),
      totalQuantity: Number(row?.totalQuantity ?? 0),
    };
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/**
 * Whether a product id refers to something a customer may currently buy.
 *
 * Checked before a line is created so "add to cart" for an unpublished product is refused
 * with a clear message, rather than creating a line the priced read would immediately report
 * as unavailable. It deliberately does not look at `inventory`: being out of stock is a
 * quantity problem, and a fully out-of-stock product is still a real product.
 */
export async function isProductPurchasable(productId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: products.id })
      .from(products)
      .innerJoin(brands, eq(brands.id, products.brandId))
      .where(
        and(eq(products.id, productId), eq(products.isActive, true), eq(brands.isActive, true)),
      )
      .limit(1);

    return row !== undefined;
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/**
 * Merge a guest cart into a customer's cart, atomically.
 *
 * ## The policy, in order
 *
 * 1. **Sum shared products.** A product in both carts ends up as the sum of the two
 *    quantities, so nothing the customer chose is silently discarded.
 * 2. **Cap at availability**, never above the per-line ceiling. The cap happens in SQL at the
 *    moment of the write, for both the new and the existing line.
 * 3. **Keep guest-only items** that are still purchasable, subject to the same cap.
 * 4. **Never overwrite the customer's cart.** Existing lines are only ever changed toward
 *    availability; the merge never replaces a customer quantity with a guest one and never
 *    deletes a line the customer already had.
 * 5. **Retire the guest cart**, which cascades to its items.
 *
 * ## Why it is safe to retry
 *
 * The guest cart is deleted inside the same transaction that reads it, so a second attempt
 * finds no guest cart and returns `merged: false`. There is no window in which the same guest
 * lines could be applied twice, which is what makes a duplicated sign-in POST harmless.
 *
 * ## What it deliberately does not touch
 *
 * No catalogue write of any kind, and no `inventory` adjustment: a cart is intent, not a hold
 * (`docs/database-plan.md` §6). The whole operation is one transaction, so a failure part-way
 * rolls back completely rather than leaving two half-combined carts.
 */
export async function mergeGuestCartIntoCustomer(
  guestCartId: string,
  customerCartId: string,
  maxLineQuantity: number,
): Promise<{ merged: boolean; movedLines: number }> {
  try {
    return await db.transaction(async (tx) => {
      const guestLines = await tx
        .select({ productId: cartItems.productId, quantity: cartItems.quantity })
        .from(cartItems)
        .where(eq(cartItems.cartId, guestCartId))
        .orderBy(asc(cartItems.createdAt), asc(cartItems.id));

      // The customer's cart may already hold products the guest cart also holds; those are
      // summed, everything else is added.
      const customerLines = new Map(
        (
          await tx
            .select({ productId: cartItems.productId, quantity: cartItems.quantity })
            .from(cartItems)
            .where(eq(cartItems.cartId, customerCartId))
        ).map((line) => [line.productId, line.quantity]),
      );

      let movedLines = 0;

      if (guestLines.length > 0) {
        const purchasable = new Set(
          (
            await tx
              .select({ id: products.id })
              .from(products)
              .innerJoin(brands, eq(brands.id, products.brandId))
              .where(
                and(
                  inArray(
                    products.id,
                    guestLines.map((line) => line.productId),
                  ),
                  eq(products.isActive, true),
                  eq(brands.isActive, true),
                ),
              )
          ).map((row) => row.id),
        );

        for (const line of guestLines) {
          // A withdrawn product is dropped rather than carried into a customer's cart, where
          // it could never be bought. The customer is not told here — the merge runs during a
          // redirect, and the cart page is where an unavailable line gets explained.
          if (!purchasable.has(line.productId)) {
            continue;
          }

          const existing = customerLines.get(line.productId) ?? 0;

          if (existing > 0) {
            // Shared product: the target is the **sum** of the two quantities, and the statement
            // clamps it to availability. `upsertQuantityWith` replaces rather than increments,
            // which is what makes this correct — the customer's own quantity is honoured and the
            // guest's is added to it exactly once.
            await upsertQuantityWith(
              tx,
              customerCartId,
              line.productId,
              Math.min(existing + line.quantity, maxLineQuantity),
              maxLineQuantity,
            );
          } else {
            // Guest-only product: capped here so a row is never built with a zero quantity,
            // which `cart_items_quantity_positive_check` would reject.
            const available = await availableQuantityWithin(tx, line.productId, maxLineQuantity);

            if (available <= 0) {
              continue;
            }

            await tx
              .insert(cartItems)
              .values({
                cartId: customerCartId,
                productId: line.productId,
                quantity: sql`LEAST(CAST(${available} AS integer), CAST(${line.quantity} AS integer))`,
              })
              .onConflictDoUpdate({
                target: [cartItems.cartId, cartItems.productId],
                set: {
                  // Guarded by the availability read directly above and by the
                  // positive-quantity CHECK, which turns any residual race into a rollback
                  // rather than a silently lost item.
                  quantity: sql`LEAST(CAST(${available} AS integer), CAST(${line.quantity} AS integer))`,
                  updatedAt: sql`now()`,
                },
              });
          }

          movedLines += 1;
        }
      }

      // Retire the guest cart inside the transaction: its items cascade away, and its token
      // digest is gone before this function returns, so the cookie is already inert.
      await tx.delete(carts).where(eq(carts.id, guestCartId));

      await tx
        .update(carts)
        .set({ updatedAt: sql`now()` })
        .where(eq(carts.id, customerCartId));

      return { merged: true, movedLines };
    });
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}