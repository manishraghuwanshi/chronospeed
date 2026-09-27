/**
 * Typed read-only catalogue contracts.
 *
 * These are the shapes the DAL returns to the rest of the application. They are
 * hand-written (not inferred from Drizzle rows) so pages and components never
 * depend on the mirrored schema directly, and so a column rename in the
 * admin-owned catalogue surfaces as one compile error in the DAL rather than
 * silently changing a component's props.
 *
 * Money is always **whole INR units**. `12999` means ₹12,999 — format it with
 * `lib/money.ts` and never divide it.
 *
 * Image storage keys are private object-storage keys. Server-side DAL functions
 * resolve them into short-lived signed URLs for browser rendering. Storage
 * credentials and signing logic never cross the server/client boundary.
 */

import type { CatalogSort } from "@/lib/validation/catalog";

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
 * What a customer may buy, derived — never stored.
 *
 * `quantity - reserved_quantity`, floored at zero. Phase 8 is the only writer of
 * `reserved_quantity`, and it does so inside a transaction; this module only reads.
 */
export interface CatalogAvailability {
  readonly quantity: number;
  readonly reservedQuantity: number;
  readonly availableQuantity: number;
  readonly isInStock: boolean;
}

/** A catalogue listing row: enough to render a card, no more. */
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
  /** Short-lived signed URL for the private product thumbnail, or null. */
  readonly thumbnailUrl: string | null;
  readonly brand: BrandSummary;
  readonly availability: CatalogAvailability;
  /** Categories this product belongs to; used for the card's metadata line. */
  readonly categories: readonly CategorySummary[];
}

/**
 * The page of results a listing request produced, together with everything the
 * pagination controls need.
 *
 * `page` is clamped to `totalPages` (or to `1` for an empty catalogue) so a visitor
 * who hand-edits the URL past the end lands on the last real page instead of seeing
 * an empty grid that looks like a broken filter.
 */
export interface CatalogProductPage {
  readonly items: readonly CatalogProductListItem[];
  /** Rows matching the filters across all pages, for the "N watches" summary. */
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly hasPreviousPage: boolean;
  readonly hasNextPage: boolean;
  /** Echo of the applied query, with `page` already clamped. */
  readonly query: AppliedCatalogQuery;
}

export interface AppliedCatalogQuery {
  readonly q: string;
  readonly category: string;
  readonly brand: string;
  readonly sort: CatalogSort;
  readonly minPrice: number | undefined;
  readonly maxPrice: number | undefined;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Just the fields that *narrow* a listing — what a filter control reads and counts.
 *
 * Defined separately from `AppliedCatalogQuery` because it is the honest signature of a
 * predicate like `hasActiveFilters`: those functions read exactly these five fields and
 * nothing else, yet they were typed to demand the whole applied query, including the page
 * size and the sort order they deliberately ignore.
 *
 * The price bounds are **optional properties** rather than required-but-`undefined` ones,
 * and that is deliberate: it is the only spelling that accepts both query types this
 * codebase has. `parseCatalogQuery` produces optional bounds (`{ minPrice?: number }`,
 * inferred from Zod), while `AppliedCatalogQuery` produces required ones
 * (`{ minPrice: number | undefined }`, written by hand). A required-but-`undefined` field
 * here would reject the parsed query, so the listing page could not ask "is anything
 * filtering this?" about the query it had just parsed — which is exactly the question that
 * caught the heading/empty-state contradiction — without a cast. Both shapes satisfy
 * optional fields, and `value !== undefined` reads the same either way.
 */
export interface CatalogFilterSelection {
  readonly q: string;
  readonly category: string;
  readonly brand: string;
  readonly minPrice?: number | undefined;
  readonly maxPrice?: number | undefined;
}

/**
 * How many filters are narrowing the current listing.
 *
 * `sort`, `page` and `pageSize` are deliberately not counted: they change how results are
 * presented, not which results there are, and counting them would make the "Clear filters"
 * control appear on a plain `/products`.
 *
 * This lives here, beside the query shape it counts, because both the Server Component
 * that renders the control and any future client-side UI must agree on the definition.
 */
export function appliedFilterCount(query: CatalogFilterSelection): number {
  return (
    [query.q, query.category, query.brand].filter(
      (value) => value.length > 0,
    ).length +
    [query.minPrice, query.maxPrice].filter(
      (value) => value !== undefined,
    ).length
  );
}

/**
 * Whether a product is on sale — the only condition under which the "was" price is shown.
 *
 * A `compare_at_price` equal to or below `price` is not a discount, and rendering one
 * would advertise a saving that does not exist. How `price` itself is displayed is the
 * admin's choice (`admin-backend` allows a compare-at price below the selling price to
 * represent a struck-through display price); this helper only decides whether the
 * secondary figure belongs on the page at all.
 */
export function isDiscounted(
  price: number,
  compareAtPrice: number | null,
): boolean {
  return compareAtPrice !== null && compareAtPrice > price;
}

/** A filter value plus the label and result count shown in the filter rail. */
export interface CatalogFacet {
  readonly slug: string;
  readonly name: string;
  readonly productCount: number;
}

/** One selectable value on the product detail page's specification table. */
export interface WatchSpecification {
  readonly label: string;
  readonly value: string;
}

/**
 * A product gallery entry.
 *
 * `storageKey` remains the private object-storage key used server-side.
 * `url` is a short-lived signed URL safe to send to the browser for rendering.
 */
export interface ProductImageRef {
  readonly id: string;
  readonly storageKey: string;
  readonly url: string | null;
  readonly altText: string | null;
  readonly isPrimary: boolean;
}

/**
 * A full product detail page.
 *
 * Gathered in a fixed number of round trips (see `lib/dal/catalog.ts`), never one
 * query per related row.
 */
export interface CatalogProductDetail {
  readonly id: string;
  readonly slug: string;
  readonly sku: string;
  readonly name: string;
  readonly shortDescription: string | null;
  readonly description: string | null;
  readonly price: number;
  readonly compareAtPrice: number | null;
  readonly currency: string;
  readonly isFeatured: boolean;
  readonly thumbnailStorageKey: string | null;
  readonly brand: BrandSummary;
  readonly availability: CatalogAvailability;
  readonly categories: readonly CategorySummary[];
  readonly images: readonly ProductImageRef[];
  /** Watch-specific attributes, already labelled and in a stable order. */
  readonly specifications: readonly WatchSpecification[];
  readonly additionalSpecifications: readonly WatchSpecification[];
}