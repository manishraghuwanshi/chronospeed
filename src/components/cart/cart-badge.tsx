import Link from "next/link";

import { getCartCount } from "@/lib/cart/service";

/**
 * The cart badge in the header.
 *
 * A **Server Component**, so the count is read from the database rather than kept in client
 * state that could disagree with it. That matters more than it looks: an optimistic badge in
 * the browser is a second source of truth for something the server already knows, and it would
 * be wrong after a guest cart merges on sign-in or after a line is clamped to availability.
 *
 * The count is deliberately `totalQuantity` (units) rather than the number of lines: two
 * watches and a strap set is three things in the bag.
 *
 * A zero count renders the same link without a badge — the control is always in the same place,
 * which is easier to find than a link that appears and disappears.
 */
export async function CartBadge() {
  const count = await getCartCount();
  const label = count.totalQuantity === 1 ? "1 item" : `${count.totalQuantity} items`;

  return (
    <Link
      href="/cart"
      className="relative inline-flex items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
      // The accessible name carries the count, so a screen-reader user does not have to
      // interrogate the badge itself.
      aria-label={`Your bag, ${label}`}
    >
      <span aria-hidden>Bag</span>

      {count.totalQuantity > 0 ? (
        <span
          aria-hidden
          className="min-w-5 rounded-xs bg-accent px-1.5 py-0.5 text-center font-mono text-[0.7rem] leading-none text-accent-foreground"
        >
          {count.totalQuantity}
        </span>
      ) : null}
    </Link>
  );
}