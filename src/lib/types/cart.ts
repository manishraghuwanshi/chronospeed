/**
 * Customer-facing cart contracts.
 *
 * Client-safe: no secrets, no server imports. These are the **only** cart shapes that may
 * cross the server boundary, and they are hand-written rather than inferred from a Drizzle
 * row for the same reason `./customer.ts` is — a column rename surfaces as one compile
 * error in the DAL instead of silently changing a component's props, and no internal
 * column can leak by spreading a row.
 *
 * Money is always **whole INR units** (`12999` means ₹12,999), matching `lib/money.ts`.
 * Nothing in this module divides.
 *
 * Note what is *absent*: `CartLine` carries no cart id, no customer id and no guest token.
 * A line knows its own `itemId` because the UI needs it to address one row when removing or
 * changing quantity, and the DAL verifies that the id belongs to the caller's cart before
 * touching it (`docs/security-plan.md` §5).
 */

/** One line of a cart, priced from the live catalogue at read time. */
export interface CartLine {
  /** The `cart_items` row id, valid only within the current visitor's cart. */
  readonly itemId: string;
  readonly productId: string;
  readonly productSlug: string;
  readonly name: string;
  readonly brandName: string;
  /** Short-lived signed URL for the private thumbnail, or `null`. */
  readonly thumbnailUrl: string | null;
  /** Current catalogue price per unit. Never a stored cart value. */
  readonly unitPrice: number;
  readonly compareAtPrice: number | null;
  readonly currency: string;
  /** How many the customer asked for. */
  readonly quantity: number;
  /** `quantity - reserved_quantity`, floored at zero, as of this read. */
  readonly availableQuantity: number;
  /** `unitPrice * quantity`, computed server-side. */
  readonly lineTotal: number;
  /**
   * Whether the product is still visible in the catalogue.
   *
   * A line survives a product being unpublished or deleted, because a cart is intent and
   * the customer should be told what changed rather than finding items silently missing.
   */
  readonly isAvailable: boolean;
  /** True when availability is the only reason the line cannot be fulfilled as asked. */
  readonly exceedsStock: boolean;
}

/** A cart, priced and summarised. */
export interface CartSummary {
  readonly lines: readonly CartLine[];
  /** Distinct products in the cart. */
  readonly itemCount: number;
  /** Sum of every line's quantity — what a badge should show, not `itemCount`. */
  readonly totalQuantity: number;
  /** Sum of every line total, in whole INR units. */
  readonly subtotal: number;
  /** `INR` unless the catalogue says otherwise; kept so a template never guesses. */
  readonly currency: string;
  /** True when any line is out of stock, short of stock, or no longer published. */
  readonly hasUnavailableLines: boolean;
  readonly isEmpty: boolean;
}

/** The two numbers a header badge needs, without pricing anything. */
export interface CartCount {
  readonly itemCount: number;
  readonly totalQuantity: number;
}

/** An empty cart. Used when a visitor has no cart yet, so callers never special-case it. */
export const EMPTY_CART_SUMMARY: CartSummary = {
  lines: [],
  itemCount: 0,
  totalQuantity: 0,
  subtotal: 0,
  currency: "INR",
  hasUnavailableLines: false,
  isEmpty: true,
};

export const EMPTY_CART_COUNT: CartCount = { itemCount: 0, totalQuantity: 0 };

/** Whether a line can be fulfilled exactly as requested. */
export function isLineFulfillable(line: CartLine): boolean {
  return line.isAvailable && !line.exceedsStock;
}

/**
 * Sum whole-unit amounts without leaving the range JavaScript represents exactly.
 *
 * `docs/database-plan.md` §9 requires integer aggregation, and an amount beyond
 * `Number.MAX_SAFE_INTEGER` is not a large number but a *wrong* one — two of them would
 * compare equal when they are not. Throwing keeps a corrupt total from being rendered as
 * a plausible one; the DAL maps the failure to a generic error.
 */
export function sumAmounts(amounts: readonly number[]): number {
  let total = 0;

  for (const amount of amounts) {
    total += amount;

    if (!Number.isSafeInteger(total)) {
      throw new RangeError("Cart total exceeds the safe integer range");
    }
  }

  return total;
}

/** Multiply a unit price by a quantity, refusing a result JavaScript cannot hold exactly. */
export function multiplyAmount(unitPrice: number, quantity: number): number {
  const total = unitPrice * quantity;

  if (!Number.isSafeInteger(total)) {
    throw new RangeError("Cart line total exceeds the safe integer range");
  }

  return total;
}