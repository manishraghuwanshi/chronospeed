import { and, eq } from "drizzle-orm";

import { env } from "@/config/env";
import { hashGuestCartToken } from "@/lib/cart/tokens";
import { cartItems, carts } from "@/lib/db/schema/cart";
import { testCookieJar } from "@/tests/stubs/next-headers";

import type { TestDatabase } from "./db";

/**
 * Fixtures and un-projected reads for the cart suites.
 *
 * Two conventions, both copied from `./session.ts` on purpose:
 *
 * - reads go **straight to the tables**, never through the DAL, so a test cannot pass because
 *   the code under test agrees with itself;
 * - the guest cookie is read from the stub jar and hashed with the application's own
 *   `hashGuestCartToken`, so a test asserts against the digest the application would really
 *   store rather than one it invented.
 */

/** The raw guest cart token currently held by the stub cookie jar, or `null`. */
export function guestTokenFromJar(): string | null {
  return testCookieJar.value(env.GUEST_CART_COOKIE_NAME) ?? null;
}

/** The digest the application would store for the jar's current token. */
export function guestTokenHashFromJar(): string | null {
  const token = guestTokenFromJar();

  return token ? hashGuestCartToken(token) : null;
}

/** Every cart row, as stored. */
export async function readAllCarts(handle: TestDatabase) {
  return handle.db.select().from(carts);
}

/** The cart owned by a customer, resolved by `customer_id`, or `null`. */
export async function findCartByCustomerId(handle: TestDatabase, customerId: string) {
  const [row] = await handle.db
    .select()
    .from(carts)
    .where(eq(carts.customerId, customerId))
    .limit(1);

  return row ?? null;
}

/** The guest cart for a raw token, resolved by digest, or `null`. */
export async function findCartByGuestToken(handle: TestDatabase, rawToken: string) {
  const [row] = await handle.db
    .select()
    .from(carts)
    .where(eq(carts.guestTokenHash, hashGuestCartToken(rawToken)))
    .limit(1);

  return row ?? null;
}

/** Every line of one cart, ordered for stable assertions. */
export async function readCartItems(handle: TestDatabase, cartId: string) {
  return handle.db.select().from(cartItems).where(eq(cartItems.cartId, cartId));
}

/** The quantity stored for one product in one cart, or `0`. */
export async function readLineQuantity(
  handle: TestDatabase,
  cartId: string,
  productId: string,
): Promise<number> {
  const [row] = await handle.db
    .select({ quantity: cartItems.quantity })
    .from(cartItems)
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)))
    .limit(1);

  return row?.quantity ?? 0;
}

/** Count of lines in a cart. */
export async function countCartLines(handle: TestDatabase, cartId: string): Promise<number> {
  const lines = await readCartItems(handle, cartId);

  return lines.length;
}

/** Insert a cart directly, so a test can set up ownership without going through the DAL. */
export async function seedCart(
  handle: TestDatabase,
  input:
    | { readonly customerId: string; readonly lines?: readonly { productId: string; quantity: number }[] }
    | { readonly guestToken: string; readonly expiresAt?: Date; readonly lines?: readonly { productId: string; quantity: number }[] },
) {
  const isGuest = "guestToken" in input;

  const [row] = await handle.db
    .insert(carts)
    .values(
      isGuest
        ? {
            guestTokenHash: hashGuestCartToken(input.guestToken),
            expiresAt: input.expiresAt ?? new Date(Date.now() + 86_400_000),
          }
        : { customerId: input.customerId },
    )
    .returning();

  const cart = row!;

  if (input.lines && input.lines.length > 0) {
    await handle.db
      .insert(cartItems)
      .values(input.lines.map((line) => ({ cartId: cart.id, ...line })));
  }

  return cart;
}