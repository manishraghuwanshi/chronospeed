import "server-only";

import { clearGuestCartCookie, readGuestCartCookie } from "@/lib/cart/cookies";
import { hashGuestCartToken } from "@/lib/cart/tokens";
import { getMaxLineQuantity } from "@/config/cart";
import {
  adoptGuestCartForCustomer,
  findCartForCustomer,
  findCartForGuestToken,
  mergeGuestCartIntoCustomer,
} from "@/lib/dal/cart";
import { logger } from "@/lib/logger";

/**
 * Guest → customer cart merge, run once when a visitor becomes signed in.
 *
 * This is the bridge between the two ownership models, and it is deliberately the **only**
 * place the two carts meet. It runs at sign-in and at registration, immediately after the
 * customer session is established, so a customer never sees a page in which their old guest
 * items are missing.
 *
 * ## Three cases, and only one of them writes
 *
 * 1. **No guest cookie** — the common case for a returning customer. Nothing happens, and
 *    nothing is read beyond the cookie.
 * 2. **Guest cookie but no guest cart** (expired, or a value someone fabricated) — the cookie
 *    is cleared so the browser stops sending a dead token. This is a safe write: it removes
 *    only a value the server cannot honour.
 * 3. **Guest cart, and the customer already has a cart** — the atomic merge
 *    (`mergeGuestCartIntoCustomer`) sums shared products, caps at availability and retires
 *    the guest cart in one transaction.
 *
 * ## Why the "customer already has a cart" check happens first
 *
 * If the customer has **no** cart, the guest cart is *adopted* rather than merged: its rows
 * are simply re-owned. That is not an optimisation — it preserves each line's `created_at`, so
 * the cart keeps the order the customer added things in, and `carts_customer_id_key` means
 * there is no second cart to keep consistent.
 *
 * ## Failure policy
 *
 * A merge failure must never block a sign-in. The customer is already authenticated and the
 * session cookie is already set, so the cart is retried on the next sign-in and, in the
 * meantime, the guest cookie still points at a cart that still exists. The error is logged
 * with the internal cause and the caller is told only that the merge did not happen.
 */
export async function mergeGuestCartAfterSignIn(customerId: string): Promise<void> {
  let guestToken: string | null = null;

  try {
    guestToken = await readGuestCartCookie();
  } catch (error) {
    // Reading the cookie can fail outside a request context. That is not a merge problem, so
    // it is logged and treated as "no guest cart".
    logger.warn("cart.merge.cookie_read_failed", { error });

    return;
  }

  if (!guestToken) {
    return;
  }

  try {
    const guestCart = await findCartForGuestToken(hashGuestCartToken(guestToken), new Date());

    if (!guestCart) {
      // Expired or fabricated: the token resolves to nothing, so it is removed before it is
      // sent again on every future request.
      await clearGuestCartCookie();

      return;
    }

    const customerCart = await findCartForCustomer(customerId);

    if (!customerCart) {
      // Adopt: re-own the rows in place. The CHECK constraint requires `expires_at` and the
      // guest digest to be cleared in the same statement, which
      // `adoptGuestCartForCustomer` does.
      const adopted = await adoptGuestCartForCustomer(
        hashGuestCartToken(guestToken),
        customerId,
        getMaxLineQuantity(),
      );

      // Adopted by a concurrent request, or the row changed underneath us: either way the
      // guest cart is no longer the browser's, so the cookie goes.
      if (!adopted) {
        logger.info("cart.merge.adopt_raced");
      }

      await clearGuestCartCookie();

      return;
    }

    const result = await mergeGuestCartIntoCustomer(
      guestCart.id,
      customerCart.id,
      getMaxLineQuantity(),
    );

    logger.info("cart.merge.completed", { movedLines: result.movedLines });

    await clearGuestCartCookie();
  } catch (error) {
    // Never fatal to a sign-in. The guest cookie is intentionally **not** cleared here, so the
    // next attempt can find the same cart again rather than losing it.
    logger.error("cart.merge.failed", { error });
  }
}