import "server-only";

import { unstable_cache } from "next/cache";

import {
  getBrandFacets,
  getCategoryFacets,
  getProductBySlug,
  getProducts,
} from "@/lib/dal/catalog";
import type { CatalogProductDetail, CatalogProductPage } from "@/lib/types/catalog";
import type { CatalogQuery } from "@/lib/validation/catalog";

/**
 * Time-based caching for the public catalogue (ADR: `docs/architecture.md` §4.3).
 *
 * ## Why this is a separate module
 *
 * `unstable_cache` does not cache anything outside a Next.js request: it looks up the
 * framework's incremental cache and throws `Invariant: incrementalCache missing` when
 * there is none. Two consequences shaped this split:
 *
 * 1. The query functions in `lib/dal/catalog.ts` must stay uncached, so they remain
 *    directly callable — and therefore directly testable — from a plain Node process.
 *    Caching wraps them here instead of living inside them.
 * 2. These wrappers can only be used from a Server Component, Server Action or Route
 *    Handler. Do not import this module from a test; test the queries directly.
 *
 * ## What is cached, and for how long
 *
 * Catalogue writes happen in `admin-backend`, which cannot call `revalidateTag` in this
 * application, so there is no trustworthy invalidation signal to subscribe to. The
 * strategy is therefore **time-based revalidation**: a fresh storefront picks up a newly
 * published product within the window below, and the window is short enough that an
 * admin correcting a price is not a support incident. `revalidate` is positive and
 * finite because `unstable_cache` rejects `0`, and `false` (cache forever) is exactly
 * what a storefront must not do without a tag-based invalidation path.
 *
 * A tag-based design is deferred, not rejected: when `admin-backend` (or an internal
 * route handler) can call `revalidateTag`, the tags below are already in the right place
 * to make the windows irrelevant.
 */

/** Seconds a listing page, a filter rail or a PDP may be served from cache. */
export const CATALOG_REVALIDATE_SECONDS = 300;

const LISTING_TAG = "catalog:products";
const DETAIL_TAG = "catalog:product";
const FACET_TAG = "catalog:facets";

/**
 * One page of the listing.
 *
 * `query` is a plain object of primitives, so it serialises into the cache key without
 * ambiguity — the generated key is derived from the arguments, which is why two
 * different filters can never collide on one entry.
 */
export const getCachedProducts = unstable_cache(
  async (query: CatalogQuery): Promise<CatalogProductPage> => getProducts(query),
  ["catalog-products"],
  { tags: [LISTING_TAG], revalidate: CATALOG_REVALIDATE_SECONDS },
);

/** A single product detail page. */
export const getCachedProductBySlug = unstable_cache(
  async (slug: string): Promise<CatalogProductDetail | null> => getProductBySlug(slug),
  ["catalog-product"],
  { tags: [DETAIL_TAG], revalidate: CATALOG_REVALIDATE_SECONDS },
);

/** The filtered category rail. Shared across every listing URL, hence its own entry. */
export const getCachedCategoryFacets = unstable_cache(
  async () => getCategoryFacets(),
  ["catalog-category-facets"],
  { tags: [FACET_TAG], revalidate: CATALOG_REVALIDATE_SECONDS },
);

/** The filtered brand rail. */
export const getCachedBrandFacets = unstable_cache(
  async () => getBrandFacets(),
  ["catalog-brand-facets"],
  { tags: [FACET_TAG], revalidate: CATALOG_REVALIDATE_SECONDS },
);