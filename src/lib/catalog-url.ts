import type { AppliedCatalogQuery, CatalogFilterSelection } from "@/lib/types/catalog";
import {
  DEFAULT_CATALOG_PAGE_SIZE,
  DEFAULT_CATALOG_SORT,
  type CatalogSort,
} from "@/lib/validation/catalog";

/**
 * Canonical URL construction for the catalogue listing.
 *
 * Every link the listing renders — a page number, a sort option, a brand filter, a
 * "Next" control — goes through here, which is what makes the URL the single source of
 * truth for what is being browsed. Two properties follow from that:
 *
 * 1. **Only non-default values are written.** `pageSize=12` and `sort=newest` are the
 *    defaults, so they are omitted. A visitor who lands on `/products` therefore has one
 *    canonical URL rather than a dozen equivalent ones, and a shared link stays short.
 * 2. **Filter changes reset the page.** Pagination and filtering interact badly if they
 *    do not: narrowing a 400-result query while sitting on page 5 of the old one would
 *    request a page that no longer exists. `catalogFilterHref` is the helper that
 *    guarantees the reset, so a caller cannot forget it.
 *
 * Client-safe: pure functions over plain values, no server imports. A future client-side
 * filter UI can import this and produce byte-identical URLs to the server-rendered links.
 */

const CATALOG_PATH = "/products";

export interface CatalogHrefOverrides {
  readonly q?: string;
  readonly category?: string;
  readonly brand?: string;
  readonly sort?: CatalogSort;
  readonly minPrice?: number | undefined;
  readonly maxPrice?: number | undefined;
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * Build a listing URL from the currently applied query plus overrides.
 *
 * An override set explicitly to `undefined` **clears** that parameter, which is how the
 * "clear this filter" links are built. Omitting a key keeps the applied value.
 *
 * Because an override may be `undefined`, spreading it over the applied query produces
 * values that are *absent* rather than empty, so every field is normalized before it is
 * read. That normalizing step is the difference between "clear the brand filter" working
 * and it throwing on the next `.length` — which is exactly the kind of bug a URL builder
 * must not have, since every link on the listing goes through here.
 */
export function catalogHref(
  query: AppliedCatalogQuery,
  overrides: CatalogHrefOverrides = {},
): string {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();

  const q = merged.q ?? "";
  const category = merged.category ?? "";
  const brand = merged.brand ?? "";
  const sort = merged.sort ?? DEFAULT_CATALOG_SORT;

  if (q.length > 0) {
    params.set("q", q);
  }

  if (category.length > 0) {
    params.set("category", category);
  }

  if (brand.length > 0) {
    params.set("brand", brand);
  }

  if (sort !== DEFAULT_CATALOG_SORT) {
    params.set("sort", sort);
  }

  if (merged.minPrice !== undefined) {
    params.set("minPrice", String(merged.minPrice));
  }

  if (merged.maxPrice !== undefined) {
    params.set("maxPrice", String(merged.maxPrice));
  }

  if (merged.pageSize !== undefined && merged.pageSize !== DEFAULT_CATALOG_PAGE_SIZE) {
    params.set("pageSize", String(merged.pageSize));
  }

  if (merged.page !== undefined && merged.page > 1) {
    params.set("page", String(merged.page));
  }

  const search = params.toString();

  return search.length > 0 ? `${CATALOG_PATH}?${search}` : CATALOG_PATH;
}

/**
 * Build a URL for a change to the *selection* — filters or page size — always returning
 * to page 1. See the module comment for why that is not left to the caller.
 */
export function catalogFilterHref(
  query: AppliedCatalogQuery,
  overrides: CatalogHrefOverrides,
): string {
  return catalogHref(query, { ...overrides, page: 1 });
}

/** Whether any filter is currently narrowing the listing. */
export function hasActiveFilters(query: CatalogFilterSelection): boolean {
  return query.q.length > 0 || query.category.length > 0 || query.brand.length > 0 || query.minPrice !== undefined || query.maxPrice !== undefined;
}

/** One page number, or an ellipsis, in the pagination control. */
const PAGINATION_WINDOW = 2;

/**
 * The page numbers to render: the first and last page, plus a window around the current
 * one, with `null` marking a gap.
 *
 * A long result set must not turn into a hundred links, and a visitor must always be able
 * to reach the last page — so the ends are always present and only the middle collapses.
 */
export function paginationItems(page: number, totalPages: number): readonly (number | null)[] {
  if (totalPages <= 1) {
    return [];
  }

  const pages = new Set<number>([1, totalPages]);

  for (let offset = -PAGINATION_WINDOW; offset <= PAGINATION_WINDOW; offset += 1) {
    const candidate = page + offset;

    if (candidate >= 1 && candidate <= totalPages) {
      pages.add(candidate);
    }
  }

  const sorted = [...pages].sort((left, right) => left - right);
  const items: (number | null)[] = [];

  let previous = 0;

  for (const value of sorted) {
    if (previous !== 0 && value - previous > 1) {
      items.push(null);
    }

    items.push(value);
    previous = value;
  }

  return items;
}