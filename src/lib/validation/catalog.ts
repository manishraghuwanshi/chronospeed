import { z } from "zod";

/**
 * Catalogue browse-parameter schemas (client-safe).
 *
 * A product listing is reachable from a plain `<a href>`, so every value that shapes
 * a query — sort order, filters, page, page size — arrives as a URL search parameter
 * and is therefore attacker-controlled. Nothing here is trusted: `searchParams` is
 * parsed with this schema before the DAL sees it, and the DAL only ever receives the
 * parsed, bounded result.
 *
 * Two deliberate design choices:
 *
 * 1. **A bad parameter degrades, it does not 404.** Every field ends in `.catch(...)`
 *    so a hand-typed URL such as `?page=abc&sort=cheapest` renders a sensible page
 *    instead of an error. This is a public, high-traffic surface where a visitor must
 *    never hit a 500 because of a query string, and it is also why the bound is enforced
 *    in Zod rather than by trusting `limit`/`offset` arithmetic.
 * 2. **Casing is normalized before it is compared.** Category and brand filters are
 *    lower-cased so `/products?category=Watches` cannot silently return an empty grid
 *    for a value the database stores in lower case.
 *
 * The bounds are the ones `admin-backend` uses for the same columns
 * (`max 100` characters for `q`, `1..220` for a slug), so the two applications agree
 * on what a valid value is.
 */

/** Characters allowed in a filter value, mirroring `admin-backend`'s `slugSchema`. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MAX_SEARCH_LENGTH = 100;
const MAX_SLUG_LENGTH = 220;

/**
 * A filter value that may legitimately be absent.
 *
 * An over-long or malformed value is treated as *absent* rather than rejected, so an
 * unknown filter narrows nothing instead of failing the request. `safeParse` accepts
 * `unknown`, so a required key is not a problem: absent keys are simply caught here.
 */
const optionalFilterValue = (max: number) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .max(max)
    .regex(SLUG_PATTERN)
    .catch("");

export const catalogSearchQuerySchema = z
  .string()
  .trim()
  .max(MAX_SEARCH_LENGTH)
  .catch("");

export const catalogCategoryFilterSchema = optionalFilterValue(MAX_SLUG_LENGTH);
export const catalogBrandFilterSchema = optionalFilterValue(MAX_SLUG_LENGTH);

/**
 * Whole-INR price bounds. They are plain integers compared against `products.price`,
 * which is stored in whole currency units (`12999` = ₹12,999) — never paise, and never
 * a decimal (`docs/database-plan.md` §9, ADR-003).
 */
const optionalPriceBound = z
  .string()
  .trim()
  .max(15)
  .regex(/^\d{1,15}$/)
  .transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value >= 0)
  .optional()
  .catch(undefined);

/**
 * Sorting options offered to a visitor.
 *
 * The set is a closed allow-list and each entry maps to a fixed SQL ordering in the
 * DAL. A user-supplied column name never reaches a query, which is what keeps ordering
 * parameterizable without becoming an injection surface.
 */
export const CATALOG_SORT_OPTIONS = [
  { value: "newest", label: "Newest arrivals" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "name-asc", label: "Name: A to Z" },
] as const;

export type CatalogSort = (typeof CATALOG_SORT_OPTIONS)[number]["value"];

export const DEFAULT_CATALOG_SORT: CatalogSort = "newest";

export const catalogSortSchema = z
  .enum(CATALOG_SORT_OPTIONS.map((option) => option.value))
  .catch(DEFAULT_CATALOG_SORT);

/** Page sizes a visitor may choose from. */
export const CATALOG_PAGE_SIZE_OPTIONS = [12, 24, 48] as const;

export const DEFAULT_CATALOG_PAGE_SIZE = 12;

/**
 * Upper bound on a requested page.
 *
 * It exists so that a deep offset cannot be used to make the database scan an
 * arbitrary distance; beyond it the first page is served instead. A real catalogue of
 * this size never reaches it.
 */
export const MAX_CATALOG_PAGE = 500;

export const catalogPageSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_CATALOG_PAGE)
  .catch(1);

export const catalogPageSizeSchema = z.coerce
  .number()
  .int()
  .refine(
    (value): value is (typeof CATALOG_PAGE_SIZE_OPTIONS)[number] =>
      (CATALOG_PAGE_SIZE_OPTIONS as readonly number[]).includes(value),
  )
  .catch(DEFAULT_CATALOG_PAGE_SIZE);

/**
 * The complete, parsed shape of a catalogue URL query.
 *
 * `minPrice`/`maxPrice` are normalized so the range is never inverted: a visitor who
 * types them backwards gets the range they obviously meant rather than nothing.
 */
export const catalogQuerySchema = z
  .object({
    q: catalogSearchQuerySchema,
    category: catalogCategoryFilterSchema,
    brand: catalogBrandFilterSchema,
    sort: catalogSortSchema,
    minPrice: optionalPriceBound,
    maxPrice: optionalPriceBound,
    page: catalogPageSchema,
    pageSize: catalogPageSizeSchema,
  })
  .transform((query) => {
    const [minPrice, maxPrice] = [query.minPrice, query.maxPrice];

    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      return { ...query, minPrice: maxPrice, maxPrice: minPrice };
    }

    return query;
  });

export type CatalogQuery = z.output<typeof catalogQuerySchema>;

/**
 * Parse untrusted search parameters.
 *
 * Never throws: because every field carries a `.catch()`, parsing an entirely empty or
 * entirely malformed object still yields a usable query. Callers therefore do not need
 * a failure branch, and a page cannot be broken by its own URL.
 */
export function parseCatalogQuery(params: Record<string, unknown>): CatalogQuery {
  const result = catalogQuerySchema.safeParse(params);

  /* c8 ignore next 4 -- unreachable: every field is catch-guarded, so parsing cannot fail. */
  if (!result.success) {
    return catalogQuerySchema.parse({});
  }

  return result.data;
}