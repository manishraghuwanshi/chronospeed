"use server";

import { revalidatePath } from "next/cache";

import {
  addProductToCart,
  clearCart,
  removeCartLine,
  updateCartLineQuantity,
  type CartMutationOutcome,
} from "@/lib/cart/service";
import { toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { CartActionState } from "@/lib/cart/form-state";
import {
  addToCartFormSchema,
  removeCartItemSchema,
  updateCartItemSchema,
} from "@/lib/validation/cart";

/**
 * Cart Server Actions.
 *
 * These are the **only** entry points a browser has into a cart. Each is a thin adapter: read
 * the submitted fields, re-validate them server-side, delegate the decision to
 * `lib/cart/service.ts`, then revalidate the cart surfaces. No ownership rule is implemented
 * here, so there is no second copy to drift out of step with the service.
 *
 * ## Why Server Actions rather than Route Handlers
 *
 * The same reasoning as `lib/auth/actions.ts`: `docs/architecture.md` ADR-004 puts customer
 * mutations behind Server Actions, and a Route Handler would mean re-implementing CSRF
 * protection by hand. Next 16 Server Actions are POST-only and are additionally checked against
 * the `Origin` and `Host` headers, which combined with the `SameSite=Lax` cookies is the
 * project's CSRF position (`docs/security-plan.md` §6). There is no state-changing GET.
 *
 * ## What is deliberately absent
 *
 * - **No id, price or total is ever read from the request.** A form supplies a product id and
 *   a quantity; the cart is identified entirely by the caller's session or guest cookie, and
 *   prices come from the catalogue at read time. A forged body cannot name another cart or
 *   influence an amount.
 * - **No action returns cart contents.** Success returns a small status the control can
 *   announce; the page re-renders from the server and shows the truth.
 * - **No action trusts the client's validation.** The forms carry `required`/`min`/`max`
 *   attributes as a convenience; the same schema runs again here.
 */

/**
 * Every surface that renders cart state.
 *
 * `revalidatePath` is needed even though the cart itself is dynamic: the product pages and the
 * cart page are rendered from cached catalogue reads plus a per-request cart read, and a
 * mutation must not leave a stale badge behind on a cached shell.
 */
const CART_PATHS = ["/cart", "/products", "/"] as const;

function revalidateCartSurfaces(): void {
  for (const path of CART_PATHS) {
    revalidatePath(path);
  }
}

/**
 * Turn a service outcome into a message.
 *
 * `clamped` is the case worth spelling out: the customer asked for more than the shop has, so
 * the reply says what actually happened rather than reporting a failure or silently pretending
 * the request succeeded.
 */
function stateForOutcome(outcome: CartMutationOutcome): CartActionState {
  switch (outcome.status) {
    case "applied":
      return { status: "success", message: "Updated your bag." };
    case "clamped":
      return {
        status: "success",
        message: `Only ${outcome.quantity} available — your bag was updated to ${outcome.quantity}.`,
      };
    case "unavailable":
      return { status: "error", message: "That watch is not available right now." };
    case "not_found":
      return { status: "error", message: "That item is no longer in your bag." };
  }
}

/** Map an unexpected failure to a generic state, keeping the cause in the server log. */
function unexpectedState(context: string, error: unknown): CartActionState {
  const { publicError } = toPublicError(error);

  logger.error(`cart.action.${context}.failed`, { error });

  return { status: "error", message: publicError.error.message };
}

/**
 * Add a product to the current visitor's bag.
 *
 * Signature matches `useActionState`: `(previousState, formData)`. A brand-new guest has no
 * cart and no cookie until this runs, which is why creating a cart is confined to the mutation
 * path (`lib/cart/service.ts`) and never happens during a render.
 */
export async function addToCartAction(
  _previousState: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const parsed = addToCartFormSchema.safeParse({
    productId: formData.get("productId"),
    quantity: formData.get("quantity") ?? undefined,
  });

  if (!parsed.success) {
    return { status: "error", message: "That request could not be processed." };
  }

  try {
    const outcome = await addProductToCart(
      parsed.data.productId,
      parsed.data.quantity ?? 1,
    );

    revalidateCartSurfaces();

    return stateForOutcome(outcome);
  } catch (error) {
    return unexpectedState("add", error);
  }
}

/** Set one line's quantity. `itemId` is scoped to the caller's cart inside the service. */
export async function updateCartItemAction(
  _previousState: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const parsed = updateCartItemSchema.safeParse({
    itemId: formData.get("itemId"),
    quantity: formData.get("quantity"),
  });

  if (!parsed.success) {
    return { status: "error", message: "That quantity is not valid." };
  }

  try {
    const outcome = await updateCartLineQuantity(
      parsed.data.itemId,
      parsed.data.quantity,
    );

    revalidateCartSurfaces();

    return stateForOutcome(outcome);
  } catch (error) {
    return unexpectedState("update", error);
  }
}

/** Remove one line from the current visitor's bag. */
export async function removeCartItemAction(
  _previousState: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const parsed = removeCartItemSchema.safeParse({
    itemId: formData.get("itemId"),
  });

  if (!parsed.success) {
    return { status: "error", message: "That item could not be found." };
  }

  try {
    const outcome = await removeCartLine(parsed.data.itemId);

    revalidateCartSurfaces();

    return stateForOutcome(outcome);
  } catch (error) {
    return unexpectedState("remove", error);
  }
}

/**
 * Empty the current visitor's bag.
 *
 * Returns nothing rather than a state: it is submitted from a plain form with no result to
 * render, and the revalidated page is the feedback. The error is re-thrown so the failure is
 * visible rather than swallowed — `error.tsx` is the boundary that renders it.
 */
export async function clearCartAction(): Promise<void> {
  try {
    await clearCart();

    revalidateCartSurfaces();
  } catch (error) {
    logger.error("cart.action.clear.failed", { error });

    throw error;
  }
}