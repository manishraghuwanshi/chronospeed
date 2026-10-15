"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateCartItemAction, removeCartItemAction } from "@/lib/cart/actions";
import { INITIAL_CART_ACTION_STATE } from "@/lib/cart/form-state";
import {
  clearCartAction,
} from "@/lib/cart/actions";
import { MAX_CART_ITEM_QUANTITY } from "@/lib/validation/cart";

/**
 * Per-line controls: change quantity, remove the line.
 *
 * Two Client Components for the pending states, nothing more. Every rule — ownership of the
 * line, the available quantity, the ceiling — is re-checked by the Server Action, because a
 * Server Action is a public endpoint and this markup is only a suggestion
 * (`docs/security-plan.md` §5).
 *
 * The quantity selector offers every value the *server* would accept, capped at what is in
 * stock. When a line already exceeds what is left, the current quantity is offered as the only
 * values it can keep, so the customer can reduce it to a buyable number or remove it.
 */

function PendingButton({
  children,
  pendingLabel,
  className,
}: {
  children: string;
  pendingLabel: string;
  className: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}

export function CartLineControls({
  itemId,
  quantity,
  availableQuantity,
}: {
  itemId: string;
  quantity: number;
  availableQuantity: number;
}) {
  const [updateState, updateAction] = useActionState(
    updateCartItemAction,
    INITIAL_CART_ACTION_STATE,
  );
  const [removeState, removeAction] = useActionState(
    removeCartItemAction,
    INITIAL_CART_ACTION_STATE,
  );

  // `Math.max(quantity, ...)`: if the line already holds more than is left in stock, that
  // quantity must remain selectable or the customer cannot re-submit it without changing it.
  const maxSelectable = Math.max(
    1,
    Math.min(Math.max(availableQuantity, quantity), MAX_CART_ITEM_QUANTITY),
  );
  const options = Array.from({ length: maxSelectable }, (_, index) => index + 1);

  const message =
    updateState.status !== "idle" && updateState.message ? updateState.message : null;
  const error =
    updateState.status === "error" && updateState.message
      ? updateState.message
      : removeState.status === "error" && removeState.message
        ? removeState.message
        : null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <form action={updateAction} className="flex items-center gap-2">
          <input type="hidden" name="itemId" value={itemId} />

          <label className="sr-only" htmlFor={`quantity-${itemId}`}>
            Quantity
          </label>

          <select
            id={`quantity-${itemId}`}
            name="quantity"
            defaultValue={String(quantity)}
            className="rounded-sm border border-border bg-surface-raised px-2 py-1.5 font-mono text-sm outline-none focus:border-accent"
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <PendingButton
            pendingLabel="Saving..."
            className="rounded-sm border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-accent hover:text-foreground disabled:opacity-60"
          >
            Update
          </PendingButton>
        </form>

        <form action={removeAction}>
          <input type="hidden" name="itemId" value={itemId} />

          <PendingButton
            pendingLabel="Removing..."
            className="rounded-sm border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-danger hover:text-danger disabled:opacity-60"
          >
            Remove
          </PendingButton>
        </form>
      </div>

      {message ? (
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Empty-bag control.
 *
 * Posts directly to `clearCartAction` rather than through `useActionState`: the action returns
 * nothing, so there is no per-form result to render — the revalidated page is the feedback and
 * a genuine failure reaches `error.tsx`. The pending state still comes from `useFormStatus`.
 */
export function ClearCartButton() {
  return (
    <form action={clearCartAction}>
      <PendingButton
        pendingLabel="Emptying..."
        className="w-fit rounded-sm border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-danger hover:text-danger disabled:opacity-60"
      >
        Empty bag
      </PendingButton>
    </form>
  );
}