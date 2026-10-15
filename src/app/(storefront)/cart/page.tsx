import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { CartLineControls, ClearCartButton } from "@/components/cart/cart-line-controls";
import { PlaceholderImage } from "@/components/catalog/placeholder-image";
import { Container } from "@/components/ui/container";
import { getCartSummary } from "@/lib/cart/service";
import { formatInr } from "@/lib/money";
import { isDiscounted } from "@/lib/types/catalog";
import type { CartLine, CartSummary } from "@/lib/types/cart";

/**
 * The bag page.
 *
 * ## Server-rendered, always
 *
 * The cart is read per request through `getCartSummary`, which resolves ownership from the
 * session or the guest cookie and prices every line from the live catalogue. There is no
 * client-side cart state and nothing price-related is sent from the browser, so the numbers on
 * this page are the numbers the server computed (`docs/security-plan.md` T-5).
 *
 * ## Failure behaviour
 *
 * `getCartSummary` degrades to an empty bag if the read fails, and logs the cause. That is
 * deliberate for a review surface: an unavailable database should not replace the header, the
 * navigation and the rest of the store with an error page. The caveat is real and worth
 * stating — a failed read *looks* like an empty bag, which is why the failure is logged loudly
 * rather than swallowed.
 *
 * ## Unavailable lines are shown, not hidden
 *
 * A product can be withdrawn or sell out between visits. The line stays, marked, with its
 * quantity to reduce or remove. Silently dropping it would be a worse lie than an item the
 * customer can see they cannot buy, and it would leave them wondering why the total changed.
 *
 * ## No checkout
 *
 * Checkout is Phase 5, so this page stops at a reviewer's summary. There is no "Proceed to
 * payment" control, because a button that leads nowhere is worse than its absence.
 */

export const metadata: Metadata = {
  title: "Your bag",
  description: "The watches you have chosen, priced from the live catalogue.",
  robots: { index: false, follow: false },
};

export default async function CartPage() {
  const cart = await getCartSummary();

  return (
    <Container className="flex flex-1 flex-col gap-10 py-14 sm:py-20">
      <div className="flex flex-col gap-3">
        <p className="text-xs tracking-[0.3em] text-accent uppercase">Bag</p>

        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your bag</h1>

        <p className="text-sm text-muted-foreground" aria-live="polite">
          {cart.isEmpty
            ? "Nothing in your bag yet."
            : `${cart.totalQuantity} ${cart.totalQuantity === 1 ? "item" : "items"} across ${cart.itemCount} ${cart.itemCount === 1 ? "line" : "lines"}.`}
        </p>
      </div>

      {cart.isEmpty ? (
        <EmptyBag />
      ) : (
        <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-4">
              {cart.lines.map((line) => (
                <CartLineRow key={line.itemId} line={line} />
              ))}
            </ul>

            <ClearCartButton />
          </div>

          <CartTotalsSummary cart={cart} />
        </div>
      )}
    </Container>
  );
}

/** One line: image, identity, price, and the controls that address it by its own id. */
function CartLineRow({ line }: { line: CartLine }) {
  const discounted = isDiscounted(line.unitPrice, line.compareAtPrice);

  return (
    <li className="flex flex-col gap-4 rounded-md border border-border bg-surface-raised p-4 sm:flex-row sm:items-start sm:gap-5">
      <div className="relative aspect-square w-full shrink-0 overflow-hidden rounded-sm border border-border sm:w-24">
        {line.thumbnailUrl ? (
          <Image
            src={line.thumbnailUrl}
            alt={line.name}
            fill
            sizes="(min-width: 640px) 6rem, 100vw"
            className="object-cover"
          />
        ) : (
          <PlaceholderImage label={line.name} className="h-full w-full rounded-none border-0" />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-1">
          {line.brandName ? (
            <p className="font-mono text-[0.65rem] tracking-[0.2em] text-muted-foreground uppercase">
              {line.brandName}
            </p>
          ) : null}

          <h2 className="text-sm leading-6 font-medium">
            {line.isAvailable && line.productSlug ? (
              <Link className="hover:text-accent" href={`/products/${line.productSlug}`}>
                {line.name}
              </Link>
            ) : (
              line.name
            )}
          </h2>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {line.isAvailable ? (
            <>
              <span className="font-mono text-sm text-foreground">
                {formatInr(line.unitPrice)}
              </span>

              {discounted && line.compareAtPrice !== null ? (
                <span className="font-mono text-xs text-muted-foreground line-through">
                  {formatInr(line.compareAtPrice)}
                </span>
              ) : null}

              <span className="text-xs text-muted-foreground">each</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              Not available — this watch is no longer on sale.
            </span>
          )}
        </div>

        <LineAvailability line={line} />

        <div className="mt-auto flex flex-wrap items-end justify-between gap-4 pt-2">
          <p className="font-mono text-sm">
            {line.isAvailable ? (
              <>
                <span className="sr-only">Line total </span>
                {formatInr(line.lineTotal)}{" "}
                <span className="font-sans text-xs text-muted-foreground">
                  ({line.quantity} × {formatInr(line.unitPrice)})
                </span>
              </>
            ) : (
              <span className="font-sans text-xs text-muted-foreground">
                {line.quantity} in your bag
              </span>
            )}
          </p>

          <CartLineControls
            itemId={line.itemId}
            quantity={line.quantity}
            availableQuantity={line.availableQuantity}
          />
        </div>
      </div>
    </li>
  );
}

/**
 * The stock sentence for a line.
 *
 * Three distinct situations, stated plainly. "Only 2 left" is not the same as "you asked for 5
 * but we have 2", and neither is the same as "sold out" — collapsing them into one message
 * would hide the fact that a quantity change is the fix.
 */
function LineAvailability({ line }: { line: CartLine }) {
  if (!line.isAvailable) {
    return (
      <p className="text-xs text-danger">
        No longer available. Remove it and it will not be carried into checkout.
      </p>
    );
  }

  if (line.exceedsStock) {
    return (
      <p className="text-xs text-danger">
        Only {line.availableQuantity} left — reduce the quantity to continue.
      </p>
    );
  }

  if (line.availableQuantity <= 5) {
    return <p className="text-xs text-muted-foreground">Only {line.availableQuantity} left</p>;
  }

  return <p className="text-xs text-muted-foreground">In stock</p>;
}

/**
 * The money summary.
 *
 * A `subtotal` only — no shipping, tax or discount line, because none of those exist yet and a
 * placeholder figure would be a number the server has not actually computed. The note beneath
 * says so, so the absence reads as "not yet" rather than as a zero.
 */
function CartTotalsSummary({ cart }: { cart: CartSummary }) {
  return (
    <aside className="flex h-fit flex-col gap-4 rounded-md border border-border bg-surface-raised p-5">
      <h2 className="text-xs tracking-[0.2em] text-muted-foreground uppercase">Summary</h2>

      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">
            Subtotal
            <span className="sr-only"> ({cart.totalQuantity} items)</span>
          </dt>
          <dd className="font-mono">{formatInr(cart.subtotal)}</dd>
        </div>
      </dl>

      {cart.hasUnavailableLines ? (
        <p className="rounded-sm border border-danger/40 bg-danger/5 px-3 py-2 text-xs leading-5 text-danger">
          Some items in your bag are unavailable and are not included in the subtotal.
        </p>
      ) : null}

      <p className="text-xs leading-5 text-muted-foreground">
        Totals are recalculated on the server from the current catalogue every time this page is
        viewed. Delivery is calculated at checkout in a later phase.
      </p>
    </aside>
  );
}

/** Empty state: an honest sentence and a way back to the catalogue. */
function EmptyBag() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-md border border-dashed border-border bg-surface-raised p-8">
      <h2 className="text-lg font-medium">Your bag is empty</h2>

      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        Anything you add is stored on our server against your session, so it follows you between
        devices once you sign in — and, if you shop as a guest, it moves into your account the
        moment you sign in or create one.
      </p>

      <Link
        className="rounded-sm bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
        href="/products"
      >
        Browse watches
      </Link>
    </div>
  );
}