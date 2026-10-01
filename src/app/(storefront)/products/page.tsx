import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CatalogEmptyState } from "@/components/catalog/catalog-empty-state";
import { CatalogFilters } from "@/components/catalog/catalog-filters";
import { CatalogPagination } from "@/components/catalog/catalog-pagination";
import { CatalogUnavailable } from "@/components/catalog/catalog-unavailable";
import { ProductCard } from "@/components/catalog/product-card";
import { Container } from "@/components/ui/container";
import { catalogHref, hasActiveFilters } from "@/lib/catalog-url";
import { catalogCountLabel } from "@/lib/catalog-summary";
import {
  getCachedBrandFacets,
  getCachedCategoryFacets,
  getCachedProducts,
} from "@/lib/dal/catalog-cache";
import { logger } from "@/lib/logger";
import { SITE_NAME } from "@/lib/site";
import type { CatalogFacet, CatalogProductPage } from "@/lib/types/catalog";
import { parseCatalogQuery } from "@/lib/validation/catalog";

/**
 * The catalogue listing.
 *
 * ## The URL is the state
 *
 * Filters, sort, page size and page all live in search parameters, and the result page is
 * re-derived from them on every request. Every view of the catalogue is therefore a
 * shareable, bookmarkable, prefetchable URL, and the filter rail can be a plain GET form
 * (see `CatalogFilters`) with no client state to reconcile.
 *
 * Search parameters are parsed with `parseCatalogQuery` before anything else reads them:
 * the DAL never sees a raw query-string value, and an unrecognised one degrades to a
 * default instead of reaching a query (`docs/phase-roadmap.md` §6, "Query parameters are
 * validated").
 *
 * ## Redirects
 *
 * Two cases redirect rather than render, so that a given set of results has exactly one
 * address:
 *
 * - a `page` beyond the end (or on an empty result set) is sent to the canonical URL for
 *   that query, so a stale or hand-edited link does not show an empty grid that looks
 *   like a broken filter;
 * - any explicit `page=1` is sent to the same URL without it, because `catalogHref` omits
 *   default values.
 *
 * ## Failure behaviour
 *
 * A database failure degrades to `CatalogUnavailable` inside the page instead of throwing
 * to `error.tsx`. The listing is a browse surface: an unavailable catalogue should leave
 * the header, navigation and filters usable, and the driver's error belongs in the server
 * log, not in a response (`docs/security-plan.md` §12).
 */

export const metadata: Metadata = {
  title: "Watches",
  description: `Browse the ${SITE_NAME} watch catalogue by brand, category and price.`,
  alternates: { canonical: "/products" },
};

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const rawParams = await searchParams;
  const parsed = parseCatalogQuery(rawParams);

  // Computed from the parsed query rather than from `page.query`: `hasActiveFilters` ignores
  // page and page size, so the two agree, and this one is available even when the catalogue
  // read failed. One value, used by both the heading and the empty state.
  const filtered = hasActiveFilters(parsed);

  let page: CatalogProductPage;

  try {
    page = await getCachedProducts(parsed);
  } catch (error) {
    logger.error("catalog.list.failed", { error });

    return (
      <Container className="flex flex-1 flex-col gap-8 py-14 sm:py-20">
        <CatalogHeading totalCount={null} filtered={filtered} />

        <CatalogUnavailable context="The catalogue" />
      </Container>
    );
  }

  // Canonicalise before rendering. `catalogHref` drops default values, so redirecting to
  // it covers both cases at once: a clamped page, and an explicit `page=1`.
  if (page.page !== parsed.page || (page.page === 1 && rawParams.page !== undefined)) {
    redirect(catalogHref(page.query));
  }

  const [brands, categories] = await Promise.all([
    facetsOrEmpty(getCachedBrandFacets, "brand"),
    facetsOrEmpty(getCachedCategoryFacets, "category"),
  ]);

  return (
    <Container className="flex flex-1 flex-col gap-8 py-14 sm:py-20">
      <CatalogHeading totalCount={page.totalCount} filtered={filtered} />

      <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        <CatalogFilters query={page.query} brands={brands} categories={categories} />

        <div className="flex flex-col gap-6">
          {page.items.length === 0 ? (
            <CatalogEmptyState filtered={filtered} />
          ) : (
            <>
              <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {page.items.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </ul>

              <CatalogPagination
                query={page.query}
                page={page.page}
                totalPages={page.totalPages}
              />
            </>
          )}
        </div>
      </div>
    </Container>
  );
}

/**
 * Page heading and result count.
 *
 * The count line comes from `catalogCountLabel`, which is also what the empty state uses,
 * because the heading and the empty state are two statements about the same number and must
 * not disagree. `filtered` is exactly what that shared helper needs: `totalCount` counts
 * rows *after* filtering, so `0` alone cannot distinguish "the shop is empty" from "nothing
 * matched" — and the heading used to guess, announcing "No watches are published yet." above
 * a filter rail with an applied price bound.
 */
function CatalogHeading({
  totalCount,
  filtered,
}: {
  totalCount: number | null;
  filtered: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs tracking-[0.3em] text-accent uppercase">Catalogue</p>

      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Watches</h1>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {catalogCountLabel(totalCount, filtered)}
      </p>
    </div>
  );
}

/**
 * Read one filter rail, degrading to no facets.
 *
 * The rail is an enhancement, not the page: if the facet aggregation fails while the
 * listing query succeeded, the visitor should still see products rather than an error
 * page. The failure is logged, so it is not silent on the server.
 */
async function facetsOrEmpty(
  load: () => Promise<CatalogFacet[]>,
  facet: string,
): Promise<CatalogFacet[]> {
  try {
    return await load();
  } catch (error) {
    logger.error("catalog.facets.failed", { facet, error });

    return [];
  }
}