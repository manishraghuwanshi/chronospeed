import Link from "next/link";

import { catalogFilterHref, hasActiveFilters } from "@/lib/catalog-url";
import { priceRangeLabel } from "@/lib/catalog-summary";
import { appliedFilterCount, type AppliedCatalogQuery, type CatalogFacet } from "@/lib/types/catalog";
import { CATALOG_PAGE_SIZE_OPTIONS, CATALOG_SORT_OPTIONS } from "@/lib/validation/catalog";

/**
 * The listing's filter rail: search, sort, page size, brand, category and price.
 *
 * A **plain `<form method="get">`**, deliberately — not a Client Component, and not a
 * Server Action. Three reasons:
 *
 * 1. The listing is already driven entirely by its URL, so a GET form that submits to
 *    `/products` produces exactly the canonical URL this page defines, with no client
 *    JavaScript, no hydration cost and no loading state to design.
 * 2. It works before hydration and keeps working if a script fails. A filter control is a
 *    navigation, not a mutation, and it should not depend on React having run.
 * 3. Submitting is unambiguous about *when* the query changes, which a change-on-input
 *    control is not — and it keeps one request per intent instead of one per keystroke.
 *
 * The controls are ordinary form fields, so this can become a progressively enhanced
 * client component later (with the same markup and the same URLs) without changing what
 * the page means. Links are used for the facet groups so the browser can prefetch them.
 */
export function CatalogFilters({
  query,
  brands,
  categories,
}: {
  query: AppliedCatalogQuery;
  brands: readonly CatalogFacet[];
  categories: readonly CatalogFacet[];
}) {
  const activeCount = appliedFilterCount(query);
  const priceLabel = priceRangeLabel(query.minPrice, query.maxPrice);

  return (
    <form
      action="/products"
      method="get"
      aria-labelledby="catalog-filter-heading"
      className="flex flex-col gap-6 rounded-md border border-border bg-surface-raised p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="catalog-filter-heading"
          className="text-xs tracking-[0.2em] text-muted-foreground uppercase"
        >
          Refine
        </h2>

        {hasActiveFilters(query) ? (
          <Link href="/products" className="text-xs text-accent hover:underline">
            Clear all
          </Link>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" htmlFor="catalog-search">
          Search
        </label>
        <input
          id="catalog-search"
          name="q"
          type="search"
          defaultValue={query.q}
          placeholder="Model, brand, feature"
          className="rounded-sm border border-border bg-surface px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground/70 focus:border-accent"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" htmlFor="catalog-sort">
          Sort
        </label>
        <select
          id="catalog-sort"
          name="sort"
          defaultValue={query.sort}
          className="rounded-sm border border-border bg-surface px-3 py-2 text-sm transition-colors outline-none focus:border-accent"
        >
          {CATALOG_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Results per page</legend>

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="catalog-page-size">
            Results per page
          </label>
          <select
            id="catalog-page-size"
            name="pageSize"
            defaultValue={String(query.pageSize)}
            className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm transition-colors outline-none focus:border-accent"
          >
            {CATALOG_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} per page
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Price (₹)</legend>

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="catalog-min-price">
            Minimum price in rupees
          </label>
          <input
            id="catalog-min-price"
            name="minPrice"
            type="number"
            inputMode="numeric"
            min={0}
            defaultValue={query.minPrice ?? ""}
            placeholder="Min"
            className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />

          <span aria-hidden className="text-muted-foreground">
            –
          </span>

          <label className="sr-only" htmlFor="catalog-max-price">
            Maximum price in rupees
          </label>
          <input
            id="catalog-max-price"
            name="maxPrice"
            type="number"
            inputMode="numeric"
            min={0}
            defaultValue={query.maxPrice ?? ""}
            placeholder="Max"
            className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        {/*
          A price bound is the most common reason a filtered listing comes back empty — and
          the hardest to notice, because a number in an input looks like a value the shop
          suggested rather than one the visitor chose. Stating the range in words makes an
          applied bound visible at the place it would be removed. Rendered only when a bound
          is set, so the rail is unchanged on an unfiltered listing.
        */}
        {priceLabel.length > 0 ? (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Showing {priceLabel}
          </p>
        ) : null}
      </fieldset>

      {/*
        The facet groups are links, so the form has to carry their selection itself —
        otherwise submitting the search box would silently drop the brand or category the
        visitor had already chosen. A GET form has no state of its own to rely on.
      */}
      <input type="hidden" name="category" value={query.category} />
      <input type="hidden" name="brand" value={query.brand} />

      <button
        type="submit"
        className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
      >
        {activeCount > 0 ? `Apply filters (${activeCount})` : "Apply filters"}
      </button>

      {categories.length > 0 ? (
        <FilterLinks
          heading="Category"
          facets={categories}
          active={query.category}
          buildHref={(slug) => catalogFilterHref(query, { category: slug })}
        />
      ) : null}

      {brands.length > 0 ? (
        <FilterLinks
          heading="Brand"
          facets={brands}
          active={query.brand}
          buildHref={(slug) => catalogFilterHref(query, { brand: slug })}
        />
      ) : null}
    </form>
  );
}

/**
 * One facet group rendered as a link list.
 *
 * The counts come from the same visibility rules as the listing, so a facet can never
 * advertise products the listing would then hide. The active facet links to the listing
 * with that filter removed — the least surprising way to undo a selection.
 */
function FilterLinks({
  heading,
  facets,
  active,
  buildHref,
}: {
  heading: string;
  facets: readonly CatalogFacet[];
  active: string;
  buildHref: (slug: string) => string;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 className="text-xs tracking-[0.2em] text-muted-foreground uppercase">{heading}</h3>

      <ul className="flex flex-col gap-1 text-sm">
        {facets.map((facet) => {
          const isActive = active === facet.slug;

          return (
            <li key={facet.slug}>
              {isActive ? (
                <span
                  aria-current="true"
                  className="flex items-baseline justify-between gap-2 rounded-xs bg-surface-muted px-2 py-1 font-medium text-accent"
                >
                  <span>
                    {facet.name}
                    <span className="sr-only"> (filter applied)</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {facet.productCount}
                  </span>
                </span>
              ) : (
                <Link
                  href={buildHref(facet.slug)}
                  className="flex items-baseline justify-between gap-2 rounded-xs px-2 py-1 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                >
                  <span>{facet.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {facet.productCount}
                  </span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}