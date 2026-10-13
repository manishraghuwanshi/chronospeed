import "server-only";

import { cache } from "react";

import { getGuestCartCookieMaxAgeSeconds, getGuestCartTtlDays, getMaxLineQuantity } from "@/config/cart";
import { getCurrentCustomer } from "@/lib/auth/session";
import { clearGuestCartCookie, readGuestCartCookie, setGuestCartCookie } from "@/lib/cart/cookies";
import { generateGuestCartToken, guestCartExpiresAt, hashGuestCartToken } from "@/lib/cart/tokens";
import {
  addCartItemQuantity,
  clearCartItems,
  countCartItems,
  findCartForCustomer,
  findCartForGuestToken,
  findOrCreateCartForCustomer,
  findOrCreateCartForGuestToken,
  isProductPurchasable,
  listCartLines,
  removeCartItemForCart,
  touchCart,
  touchGuestCartExpiry,
  updateCartItemQuantityForCart,
} from "@/lib/dal/cart";
import { logger } from "@/lib/logger";
import {
  EMPTY_CART_COUNT,
  EMPTY_CART_SUMMARY,
  sumAmounts,
  type CartCount,
  type CartLine,
  type CartSummary,
} from "@/lib/types/cart";

import type { ResolvedCart } from "@/lib/dal/cart";

/**
 * Cart service — the only place cart **ownership** is resolved.
 *
 * Every read and mutation in the application goes through here, so there is exactly one
 * implementation of the question "whose cart is this?" and no Server Action can invent its
 * own answer. Two identities are possible and they are never mixed:
 *
 * - a signed-in customer, resolved from the server-side session (`getCurrentCustomer`) —
 *   never from a form field, a URL or a client-supplied id;
 * - an anonymous guest, resolved from the `HttpOnly` guest cart cookie by **digest**.
 *
 * ## Reads never write
 *
 * `resolveCart` is a pure read. Opening a page must not create a cart row or set a cookie —
 * Next.js forbids setting cookies while rendering, and a visitor who has added nothing should
 * have no cart at all. Only `requireCartForMutation` may create a cart, and it is only called
 * from a Server Action.
 *
 * ## Which cart does a customer see?
 *
 * A signed-in customer's guest cookie is ignored entirely. If a guest cart exists it is
 * merged at sign-in (`lib/cart/merge.ts`), so by the time a page renders there is nothing
 * left to reconcile. Ignoring rather than merging on read keeps the read path free of writes
 * and means a stale guest cookie can never inject items into a customer's cart
 * (`docs/security-plan.md` §5).
 */

/** The result of an operation that writes to a cart, as the UI needs to report it. */
export type CartMutationOutcome =
  | { readonly status: "applied"; readonly quantity: number }
  | { readonly status: "clamped"; readonly quantity: number; readonly requested: number }
  | { readonly status: "unavailable" }
  | { readonly status: "not_found" };

/**
 * The current visitor's cart, or `null`. **Read-only** — never creates a cart or a cookie.
 *
 * `cache()`d so the header badge, the cart page and any guard in the same render pass share
 * one resolution. It is a per-request cache, so it cannot leak one visitor's cart into
 * another request.
 */
export const resolveCart = cache(async (): Promise<ResolvedCart | null> => {
  // The cookie reads stay **outside** the `try`, for the same reason `getCurrentCustomer`
  // keeps its own read out of its `catch`: `cookies()` throws Next's dynamic-usage signal
  // while a route is being generated statically. Catching that signal would not merely log a
  // false failure — it would turn "this page cannot be static" into "this visitor has an empty
  // cart", i.e. an empty cart that a static shell could then serve to everyone. Letting it
  // propagate is what makes the route dynamic, which is the correct answer.
  const customer = await getCurrentCustomer();
  const guestToken = customer ? null : await readGuestCartCookie();

  try {
    if (customer) {
      return await findCartForCustomer(customer.id);
    }

    if (!guestToken) {
      return null;
    }

    return await findCartForGuestToken(hashGuestCartToken(guestToken), new Date());
  } catch (error) {
    // What remains in scope here is a database read. A cart is not worth failing a page for:
    // the failure is logged and the visitor is shown an empty cart, which is the safe
    // direction — never "someone else's cart".
    logger.error("cart.resolve.failed", { error });

    return null;
  }
});

/**
 * The current visitor's cart, creating one if necessary. **Mutations only.**
 *
 * A guest gets a cookie here and nowhere else, because this is the only path allowed to set
 * one. Two details are deliberate:
 *
 * 1. A guest cookie that resolves to **nothing** (expired row, or a token invented by a
 *    client) is replaced rather than trusted, so an unguessable-but-stale value cannot be
 *    used to probe the cart table and the visitor simply gets a fresh cart.
 * 2. The just-created cookie value is written to the response before the row is read back, so
 *    a failure after the insert still leaves the browser holding a token that will work on
 *    the retry.
 */
export async function requireCartForMutation(): Promise<ResolvedCart> {
  const customer = await getCurrentCustomer();

  if (customer) {
    return await findOrCreateCartForCustomer(customer.id);
  }

  const now = new Date();
  const existingToken = await readGuestCartCookie();

  if (existingToken) {
    const existing = await findCartForGuestToken(hashGuestCartToken(existingToken), now);

    if (existing) {
      // An active guest's cart is kept alive by their activity rather than by the age of
      // their first visit.
      await touchGuestCartExpiry(existing.id, guestCartExpiresAt(getGuestCartTtlDays(), now.getTime()));

      return existing;
    }
  }

  const token = generateGuestCartToken();

  await setGuestCartCookie(token, getGuestCartCookieMaxAgeSeconds());

  return await findOrCreateCartForGuestToken(
    hashGuestCartToken(token),
    guestCartExpiresAt(getGuestCartTtlDays(), now.getTime()),
  );
}

/**
 * Remove a guest cart cookie the server can no longer honour.
 *
 * Called when a token resolves to nothing, so the browser stops sending a dead value on every
 * subsequent request.
 */
export async function discardGuestCartCookie(): Promise<void> {
  await clearGuestCartCookie();
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Summarise a set of priced lines.
 *
 * Pure and exported so the arithmetic is testable without a database — the totals are the one
 * piece of cart logic where a subtle error is both easy to make and expensive
 * (`docs/database-plan.md` §9: integer aggregation, no floating point).
 *
 * `itemCount` and `totalQuantity` answer different questions and both are kept: a badge wants
 * units ("3 items" for two watches and a strap set), while the cart page wants lines.
 * Unavailable lines are counted but contribute nothing to the subtotal, matching the priced
 * read.
 */
export function summariseLines(lines: readonly CartLine[]): CartSummary {
  if (lines.length === 0) {
    return EMPTY_CART_SUMMARY;
  }

  return {
    lines,
    itemCount: lines.length,
    totalQuantity: sumAmounts(lines.map((line) => line.quantity)),
    subtotal: sumAmounts(lines.map((line) => line.lineTotal)),
    currency: lines[0]?.currency ?? "INR",
    hasUnavailableLines: lines.some((line) => !line.isAvailable),
    isEmpty: false,
  };
}

/** The current visitor's cart, priced and summarised. Empty when they have no cart. */
export async function getCartSummary(): Promise<CartSummary> {
  const cart = await resolveCart();

  if (!cart) {
    return EMPTY_CART_SUMMARY;
  }

  try {
    return summariseLines(await listCartLines(cart.id));
  } catch (error) {
    logger.error("cart.summary.failed", { error });

    return EMPTY_CART_SUMMARY;
  }
}

/** Just the badge numbers. Cheaper than a priced read, and degrades to zero on failure. */
export async function getCartCount(): Promise<CartCount> {
  const cart = await resolveCart();

  if (!cart) {
    return EMPTY_CART_COUNT;
  }

  try {
    return await countCartItems(cart.id);
  } catch (error) {
    logger.error("cart.count.failed", { error });

    return EMPTY_CART_COUNT;
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Turn a write result into an outcome the UI can report truthfully.
 *
 * The distinction that matters is `applied` versus `clamped`: the customer asked for a number
 * and either got it or got less, and the message differs. A `null` result means the product
 * had no availability at all, which is `unavailable` rather than an error — nothing is broken,
 * the shop is simply out of stock.
 */
function outcomeForWritten(
  written: { readonly quantity: number } | null,
  requested: number,
): CartMutationOutcome {
  if (!written) {
    return { status: "unavailable" };
  }

  return written.quantity >= requested
    ? { status: "applied", quantity: written.quantity }
    : { status: "clamped", quantity: written.quantity, requested };
}

/**
 * Add a product to the current visitor's cart.
 *
 * The product is checked for **purchasability** first — published, with an active brand — so
 * an unpublished product is refused with a clear reason instead of creating a line the cart
 * page would immediately flag. Stock is not checked here: the DAL's clamped write is the
 * authority on how many actually fit, and a customer adding the last one is not an error.
 */
export async function addProductToCart(
  productId: string,
  quantity: number,
): Promise<CartMutationOutcome> {
  if (!(await isProductPurchasable(productId))) {
    return { status: "unavailable" };
  }

  const cart = await requireCartForMutation();

  const written = await addCartItemQuantity(cart.id, productId, quantity, getMaxLineQuantity());

  await touchCart(cart.id);

  return outcomeForWritten(written, quantity);
}

/**
 * Set one line's quantity explicitly.
 *
 * `itemId` is scoped to the caller's cart inside the DAL, so a line id taken from someone
 * else's cart matches nothing and is reported as `not_found` — the same answer as a line that
 * has since been removed, which is what keeps the response from confirming that another cart
 * exists (`docs/security-plan.md` §12).
 */
export async function updateCartLineQuantity(
  itemId: string,
  quantity: number,
): Promise<CartMutationOutcome> {
  const cart = await resolveCart();

  if (!cart) {
    return { status: "not_found" };
  }

  const updated = await updateCartItemQuantityForCart(
    cart.id,
    itemId,
    quantity,
    getMaxLineQuantity(),
  );

  if (!updated) {
    return { status: "unavailable" };
  }

  await touchCart(cart.id);

  return { status: "applied", quantity };
}

/** Remove one line from the current visitor's cart. */
export async function removeCartLine(itemId: string): Promise<CartMutationOutcome> {
  const cart = await resolveCart();

  if (!cart) {
    return { status: "not_found" };
  }

  const removed = await removeCartItemForCart(cart.id, itemId);

  if (!removed) {
    return { status: "not_found" };
  }

  await touchCart(cart.id);

  return { status: "applied", quantity: 0 };
}

/**
 * Empty the current visitor's cart.
 *
 * The cart row is kept and only its lines are deleted. Removing the row would leave a
 * signed-in customer's next add racing the unique index, and would orphan a guest cookie
 * against a row that no longer exists.
 */
export async function clearCart(): Promise<CartMutationOutcome> {
  const cart = await resolveCart();

  if (!cart) {
    return { status: "not_found" };
  }

  await clearCartItems(cart.id);
  await touchCart(cart.id);

  return { status: "applied", quantity: 0 };
}