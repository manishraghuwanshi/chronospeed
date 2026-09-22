/**
 * Typed read-only catalog contracts.
 *
 * These are the shapes the DAL returns to the rest of the application. They are
 * hand-written (not inferred from Drizzle rows) so pages and components never
 * depend on the mirrored schema directly, and so a column rename in the
 * admin-owned catalog surfaces as one compile error in the DAL rather than
 * silently changing a component's props.
 */

export interface BrandSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logoStorageKey: string | null;
}

export interface CategorySummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

/**
 * A catalog listing row.
 *
 * `price` and `compareAtPrice` are **whole INR units** (`12999` = ₹12,999) —
 * format them with `lib/money.ts`, never divide them.
 *
 * `thumbnailStorageKey` is an object-storage key, not a URL; image delivery is
 * Phase 3, so this field is `null` until then.
 */
export interface CatalogProductListItem {
  readonly id: string;
  readonly slug: string;
  readonly sku: string;
  readonly name: string;
  readonly shortDescription: string | null;
  readonly price: number;
  readonly compareAtPrice: number | null;
  readonly currency: string;
  readonly isFeatured: boolean;
  readonly thumbnailStorageKey: string | null;
  readonly brand: BrandSummary;
  readonly availability: {
    readonly availableQuantity: number;
    readonly isInStock: boolean;
  };
}