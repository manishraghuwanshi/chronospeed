import { z } from "zod";

import { amountSchema, uuidSchema } from "./primitives";

/**
 * Cart schemas (client-safe).
 *
 * Client and server parse with these same schemas, but only the **server** parse is
 * authoritative (`docs/security-plan.md` §7). A cart form posts a product id and a
 * quantity and nothing else: there is deliberately no field for a price, a line total, a
 * cart id or a customer id, because none of those may ever be supplied by a browser
 * (`docs/phase-roadmap.md` §7). A body that tries to include one has it stripped here
 * before it can reach any query.
 *
 * The quantity bound is an **outer envelope**, not the configured ceiling: it is the
 * largest value the application will ever accept, and `lib/cart/service.ts` additionally
 * caps a line at `CART_MAX_LINE_QUANTITY` and at live availability. Keeping the envelope
 * here means this module stays client-safe — it cannot import server configuration.
 */

/** Absolute maximum quantity the schemas accept; the service cap is stricter. */
export const MAX_CART_ITEM_QUANTITY = 100;

/**
 * A quantity from a form or a Server Action.
 *
 * `z.coerce` because an `input[type=number]` submits text. Rejecting rather than clamping
 * is deliberate: silently turning `?quantity=0` into `1`, or `999` into `10`, would
 * report success for something the customer did not ask for.
 */
export const cartQuantitySchema = z.coerce
  .number({ error: "Quantity must be a number" })
  .int({ error: "Quantity must be a whole number" })
  .min(1, { error: "Quantity must be at least 1" })
  .max(MAX_CART_ITEM_QUANTITY, {
    error: `Quantity must not exceed ${MAX_CART_ITEM_QUANTITY}`,
  });

export const addToCartSchema = z.object({
  productId: uuidSchema,
  quantity: cartQuantitySchema.default(1),
});

export type AddToCartInput = z.output<typeof addToCartSchema>;

/**
 * An "add to cart" form is plain HTML with no JavaScript, so every control that can
 * reach it is a `<button name="quantity" value="n">`.
 */
export const addToCartFormSchema = z.object({
  productId: uuidSchema,
  quantity: cartQuantitySchema.optional(),
});

export const updateCartItemSchema = z.object({
  /** Identifies a **cart line**, not a product, and only within the caller's own cart. */
  itemId: uuidSchema,
  quantity: cartQuantitySchema,
});

export type UpdateCartItemInput = z.output<typeof updateCartItemSchema>;

export const removeCartItemSchema = z.object({
  itemId: uuidSchema,
});

export type RemoveCartItemInput = z.output<typeof removeCartItemSchema>;

/**
 * The shape of a cart's money.
 *
 * Nothing here is submitted by a browser — prices and totals are computed server-side
 * from `products` — but the schema exists because the totals are also re-validated after
 * computation, so a bug or an unexpected column value produces a rejected cart rather
 * than an absurd number rendered to a customer.
 */
export const cartAmountSchema = amountSchema;