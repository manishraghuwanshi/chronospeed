"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { addToCartAction } from "@/lib/cart/actions";
import { INITIAL_CART_ACTION_STATE } from "@/lib/cart/form-state";
import { MAX_CART_ITEM_QUANTITY } from "@/lib/validation/cart";

/**
 * "Add to bag" control.
 *
 * A Client Component only for the pending state and the result message; every rule is
 * enforced again by `addToCartAction` on the server, so a submission that bypasses this
 * component changes nothing.
 *
 * ## Why a quantity select rather than a number input
 *
 * The available quantity is known on the server, so the control offers exactly the quantities
 * a customer can actually buy and nothing else. A free-text number input would invite a value
 * the shop cannot honour, and the honest reply to that is a clamp the customer did not ask
 * for. When nothing is in stock the control is not rendered at all — a disabled "Add" button
 * promises a capability that does not exist.
 *
 * The form is a plain `POST` to a Server Action, so it works without JavaScript; the client
 * component only adds the pending state and the confirmation message.
 */

function AddButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-sm bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Adding..." : "Add to bag"}
    </button>
  );
}

export function AddToCartForm({
  productId,
  availableQuantity,
}: {
  productId: string;
  availableQuantity: number;
}) {
  const [state, formAction] = useActionState(addToCartAction, INITIAL_CART_ACTION_STATE);

  // The ceiling is applied here as well as in the schema, so the options never exceed what the
  // server would accept — the bound is `min(stock, per-line ceiling)`, not stock alone.
  const maxSelectable = Math.min(availableQuantity, MAX_CART_ITEM_QUANTITY);
  const options = Array.from({ length: maxSelectable }, (_, index) => index + 1);

  if (maxSelectable < 1) {
    return (
      <p className="rounded-sm border border-border bg-surface p-3 text-xs leading-5 text-muted-foreground">
        This watch is currently out of stock. Availability shown here is read live from the
        store&apos;s inventory.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="productId" value={productId} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs tracking-[0.2em] text-muted-foreground uppercase" htmlFor="cart-quantity">
            Quantity
          </label>

          <select
            id="cart-quantity"
            name="quantity"
            defaultValue="1"
            className="rounded-sm border border-border bg-surface-raised px-3 py-2 font-mono text-sm transition-colors outline-none focus:border-accent"
          >
            {options.map((quantity) => (
              <option key={quantity} value={quantity}>
                {quantity}
              </option>
            ))}
          </select>
        </div>

        <AddButton />
      </div>

      {state.status === "success" && state.message ? (
        <p aria-live="polite" className="text-xs leading-5 text-muted-foreground">
          {state.message}{" "}
          <a className="text-accent underline-offset-4 hover:underline" href="/cart">
            View bag
          </a>
        </p>
      ) : null}

      {state.status === "error" && state.message ? (
        <p role="alert" className="text-xs leading-5 text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}