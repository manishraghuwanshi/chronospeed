import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getStorageObjectUrl } from "@/lib/storage/urls";
import { db } from "@/lib/db/client";
import {
  brands,
  categories,
  inventory,
  productCategories,
  productImages,
  products,
  watchDetails,
} from "@/lib/db/schema/catalog";
import { DatabaseError } from "@/lib/errors";
import type {
  BrandSummary,
  CatalogAvailability,
  CatalogFacet,
  CatalogProductDetail,
  CatalogProductListItem,
  CatalogProductPage,
  ProductImageRef,
  WatchSpecification,
} from "@/lib/types/catalog";
import type { CatalogQuery, CatalogSort } from "@/lib/validation/catalog";

/**
 * Data Access Layer — catalogue (READ ONLY).
 *
 * This is the **only** module permitted to build catalogue queries. Pages, layouts
 * and components call these functions; they never import Drizzle or the schema.
 *
 * `docs/architecture.md` §4.4 is the rule: Chronospeed reads `products`, `brands`,
 * `categories`, `product_categories`, `watch_details`, `product_images` and
 * `inventory`, and never inserts, updates or deletes any of them. There is
 * therefore no write function in this file. The single sanctioned exception in the
 * whole project is the Phase 8 inventory-reservation service, which owns its own
 * module; a catalogue mutation must never appear here.
 *
 * ## Visibility rule
 *
 * A product is customer-visible when `products.is_active` is true **and** its brand is
 * active. This is the one rule every listing, detail and facet query applies, and it is
 * the storefront equivalent of the admin's published switch.
 *
 * ## Availability
 *
 * `quantity - reserved_quantity`, floored at zero, computed here and never stored. A
 * product with no `inventory` row is **shown as out of stock** rather than hidden: an
 * absent row is a data gap, and silently removing a published product from the
 * catalogue would be a harder failure to notice than showing it as unavailable.
 *
 * ## Query-shape rules
 *
 * 1. Every function issues a fixed number of round trips. Lists fetch their categories
 *    in one grouped follow-up query keyed by the page's ids, and the detail page gathers
 *    its children the same way — there is no query inside a loop (no N+1).
 * 2. Every value that came from a URL is a bound parameter, never string-concatenated
 *    (`docs/security-plan.md` T-9).
 * 3. Ordering is chosen from a closed set of column lists. A caller-supplied value can
 *    select a sort *option*, never a column name.
 *
 * Caching is deliberately **not** implemented in this module. `unstable_cache` requires
 * Next.js' request context and throws outside it, which would make every one of these
 * functions untestable in isolation. The cache wrappers live in
 * `lib/dal/catalog-cache.ts` instead, so the query layer stays a pure, directly testable
 * read and caching remains a thin, separately verifiable concern.
 */

// ---------------------------------------------------------------------------
// Shared row projection
// ---------------------------------------------------------------------------

/**
 * Columns every listing row needs, declared once so TypeScript tracks the exact
 * projection and the count/rows/detail queries cannot drift apart.
 */
const LIST_COLUMNS = {
  id: products.id,
  slug: products.slug,
  sku: products.sku,
  name: products.name,
  shortDescription: products.shortDescription,
  price: products.price,
  compareAtPrice: products.compareAtPrice,
  currency: products.currency,
  isFeatured: products.isFeatured,
  thumbnailStorageKey: productImages.storageKey,
  brandId: brands.id,
  brandName: brands.name,
  brandSlug: brands.slug,
  brandLogoStorageKey: brands.logoStorageKey,
  quantity: inventory.quantity,
  reservedQuantity: inventory.reservedQuantity,
};

interface ListRow {
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
  readonly brandId: string;
  readonly brandName: string;
  readonly brandSlug: string;
  readonly brandLogoStorageKey: string | null;
  readonly quantity: number | null;
  readonly reservedQuantity: number | null;
}

type ProductCategoryRef = CatalogProductListItem["categories"][number];

/**
 * Turn stored integers into the customer-visible availability.
 *
 * `reserved_quantity <= quantity` is a database CHECK constraint, so the subtraction
 * cannot normally go negative; it is floored anyway rather than trusting a constraint
 * that a future migration could relax. Both inputs default to `0`, which is what makes
 * a missing `inventory` row render as "out of stock" instead of throwing.
 */
function toAvailability(
  quantity: number | null | undefined,
  reservedQuantity: number | null | undefined,
): CatalogAvailability {
  const total = quantity ?? 0;
  const reserved = reservedQuantity ?? 0;
  const availableQuantity = Math.max(0, total - reserved);

  return {
    quantity: total,
    reservedQuantity: reserved,
    availableQuantity,
    isInStock: availableQuantity > 0,
  };
}

function toBrandSummary(row: ListRow): BrandSummary {
  return {
    id: row.brandId,
    name: row.brandName,
    slug: row.brandSlug,
    logoStorageKey: row.brandLogoStorageKey,
  };
}

async function toListItem(
  row: ListRow,
  categories: readonly ProductCategoryRef[],
): Promise<CatalogProductListItem> {
  return {
    id: row.id,
    slug: row.slug,
    sku: row.sku,
    name: row.name,
    shortDescription: row.shortDescription,
    price: row.price,
    compareAtPrice: row.compareAtPrice,
    currency: row.currency,
    isFeatured: row.isFeatured,
    thumbnailStorageKey: row.thumbnailStorageKey,
    thumbnailUrl: await getStorageObjectUrl(row.thumbnailStorageKey),
    brand: toBrandSummary(row),
    availability: toAvailability(row.quantity, row.reservedQuantity),
    categories,
  };
}

// ---------------------------------------------------------------------------
// Query construction
// ---------------------------------------------------------------------------

/**
 * Escape LIKE metacharacters in a user-supplied search term.
 *
 * The term is already a bound parameter, so this is not an injection fix — it is a
 * semantics fix. Without it, typing `%` into the search box would match the entire
 * catalogue and `_` would match any character, which is not what a visitor means by
 * either. Backslash is PostgreSQL's default LIKE escape character, so the escaped
 * pattern can be passed straight to `ILIKE`.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * The ordering for each supported sort option, always ending in `products.id`.
 *
 * The id tiebreaker is not cosmetic: without a total order, two products with the same
 * price could come back in a different sequence for each page of the same query, so a
 * row could appear twice while another never appeared at all.
 */
function orderFor(sort: CatalogSort): SQL[] {
  switch (sort) {
    case "price-asc":
      return [asc(products.price), asc(products.name), asc(products.id)];
    case "price-desc":
      return [desc(products.price), asc(products.name), asc(products.id)];
    case "name-asc":
      return [asc(products.name), asc(products.id)];
    case "newest":
    default:
      return [desc(products.createdAt), desc(products.id)];
  }
}

/**
 * Visibility + filter conditions shared by the count query and the page query.
 *
 * One builder is what makes the reported total and the rendered page agree by
 * construction: there is no second, subtly different `WHERE` clause to keep in sync.
 */
function conditionsFor(query: CatalogQuery): SQL[] {
  const conditions: SQL[] = [
    eq(products.isActive, true),
    eq(brands.isActive, true),
  ];

  if (query.q.length > 0) {
    const pattern = `%${escapeLikePattern(query.q)}%`;

    const match = or(
      ilike(products.name, pattern),
      ilike(products.shortDescription, pattern),
      ilike(brands.name, pattern),
    );

    if (match) {
      conditions.push(match);
    }
  }

  if (query.brand.length > 0) {
    conditions.push(eq(brands.slug, query.brand));
  }

  if (query.category.length > 0) {
    // `exists` rather than a join: a product belongs to many categories, and joining
    // would multiply the row (breaking `count()`) and force a `DISTINCT`.
    conditions.push(
      exists(
        db
          .select({ matched: sql`1` })
          .from(productCategories)
          .innerJoin(
            categories,
            eq(categories.id, productCategories.categoryId),
          )
          .where(
            and(
              eq(productCategories.productId, products.id),
              eq(categories.slug, query.category),
              eq(categories.isActive, true),
            ),
          ),
      ),
    );
  }

  // Whole-INR bounds compared against `products.price` — never paise (`ADR-003`).
  if (query.minPrice !== undefined) {
    conditions.push(sql`${products.price} >= ${query.minPrice}`);
  }

  if (query.maxPrice !== undefined) {
    conditions.push(sql`${products.price} <= ${query.maxPrice}`);
  }

  return conditions;
}

/**
 * The listing query's `FROM` chain: product → brand (inner: a product without a brand
 * is not showable) → inventory (left: absence means out of stock, not invisible).
 */
function listSource() {
  return db
    .select(LIST_COLUMNS)
    .from(products)
    .innerJoin(brands, eq(brands.id, products.brandId))
    .leftJoin(inventory, eq(inventory.productId, products.id))
    .leftJoin(
      productImages,
      and(
        eq(productImages.productId, products.id),
        eq(productImages.isPrimary, true),
      ),
    );
}

/**
 * Load the categories of a page's products in one query, grouped by product id.
 *
 * This is the whole reason the listing is three round trips rather than 1 + N: the page
 * hands over its ids and the database does the grouping.
 */
async function categoriesForProducts(
  productIds: readonly string[],
): Promise<Map<string, ProductCategoryRef[]>> {
  const grouped = new Map<string, ProductCategoryRef[]>();

  if (productIds.length === 0) {
    return grouped;
  }

  const rows = await db
    .select({
      productId: productCategories.productId,
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
    })
    .from(productCategories)
    .innerJoin(categories, eq(categories.id, productCategories.categoryId))
    .where(
      and(
        inArray(productCategories.productId, productIds),
        eq(categories.isActive, true),
      ),
    )
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  for (const row of rows) {
    const existing = grouped.get(row.productId);

    if (existing) {
      existing.push({ id: row.id, name: row.name, slug: row.slug });
    } else {
      grouped.set(row.productId, [
        { id: row.id, name: row.name, slug: row.slug },
      ]);
    }
  }

  return grouped;
}

/** Fetch, decorate and return a set of rows in the order the database produced them. */
async function toListItems(
  rows: readonly ListRow[],
): Promise<CatalogProductListItem[]> {
  const categoryMap = await categoriesForProducts(rows.map((row) => row.id));

  return await Promise.all(
    rows.map((row) => toListItem(row, categoryMap.get(row.id) ?? [])),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Number of products a customer can currently see.
 *
 * Applies the same visibility rule as the listing — `products.is_active` **and** an
 * active brand — so the figure on the home page and the size of the catalogue a visitor
 * can actually browse can never disagree.
 */
export async function getActiveProductCount(): Promise<number> {
  try {
    const [row] = await db
      .select({ total: count() })
      .from(products)
      .innerJoin(brands, eq(brands.id, products.brandId))
      .where(and(eq(products.isActive, true), eq(brands.isActive, true)));

    return row?.total ?? 0;
  } catch (error) {
    // A driver message can contain host or credential detail. Keep it in `cause`
    // for the server log; callers (and the browser) only ever see a generic error.
    throw new DatabaseError({ cause: error });
  }
}

/**
 * One page of the catalogue listing.
 *
 * Three round trips regardless of page size: the filtered total, the page's rows, and
 * the categories of exactly those rows.
 *
 * `page` is clamped to the last real page **before** the rows are fetched, so a request
 * past the end returns the final page with correct pagination controls rather than an
 * empty grid. The returned `query.page` is the effective page; the page component
 * compares it with the requested one to decide whether to redirect a canonical URL.
 */
export async function getProducts(
  query: CatalogQuery,
): Promise<CatalogProductPage> {
  try {
    const where = and(...conditionsFor(query));
    const { pageSize } = query;

    const [totalRow] = await db
      .select({ total: count() })
      .from(products)
      .innerJoin(brands, eq(brands.id, products.brandId))
      .where(where);

    const totalCount = totalRow?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const page = Math.min(query.page, totalPages);

    // Skip the row query entirely for an empty result: it cannot return anything, and
    // the empty catalogue is the common case on a fresh environment.
    const rows: ListRow[] =
      totalCount === 0
        ? []
        : await listSource()
            .where(where)
            .orderBy(...orderFor(query.sort))
            .limit(pageSize)
            .offset((page - 1) * pageSize);

    return {
      items: await toListItems(rows),
      totalCount,
      page,
      pageSize,
      totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages,
      query: {
        q: query.q,
        category: query.category,
        brand: query.brand,
        sort: query.sort,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        page,
        pageSize,
      },
    };
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/**
 * A published product, by slug, with everything the detail page renders.
 *
 * An unknown slug, an unpublished product and a product whose brand has been
 * deactivated all produce `null` — the caller cannot distinguish them, and neither can
 * a visitor (`docs/security-plan.md` §12).
 *
 * Three round trips total (row, categories, images), whatever the product's number of
 * images or categories; the two child queries run concurrently.
 */
export async function getProductBySlug(
  slug: string,
): Promise<CatalogProductDetail | null> {
  try {
    const [row] = await listSource()
      .where(
        and(
          eq(products.slug, slug),
          eq(products.isActive, true),
          eq(brands.isActive, true),
        ),
      )
      .limit(1);

    if (!row) {
      return null;
    }

    const [detailRows, categoryRows, imageRows] = await Promise.all([
      db
        .select({
          description: products.description,
          watchType: watchDetails.watchType,
          movement: watchDetails.movement,
          caseMaterial: watchDetails.caseMaterial,
          caseShape: watchDetails.caseShape,
          caseDiameter: watchDetails.caseDiameter,
          caseThickness: watchDetails.caseThickness,
          strapMaterial: watchDetails.strapMaterial,
          strapColor: watchDetails.strapColor,
          dialColor: watchDetails.dialColor,
          glassMaterial: watchDetails.glassMaterial,
          waterResistance: watchDetails.waterResistance,
          powerReserve: watchDetails.powerReserve,
          warrantyPeriod: watchDetails.warrantyPeriod,
          gender: watchDetails.gender,
          additionalSpecifications: watchDetails.additionalSpecifications,
        })
        .from(products)
        .leftJoin(watchDetails, eq(watchDetails.productId, products.id))
        .where(eq(products.id, row.id))
        .limit(1),

      db
        .select({
          id: categories.id,
          name: categories.name,
          slug: categories.slug,
        })
        .from(productCategories)
        .innerJoin(categories, eq(categories.id, productCategories.categoryId))
        .where(
          and(
            eq(productCategories.productId, row.id),
            eq(categories.isActive, true),
          ),
        )
        .orderBy(asc(categories.sortOrder), asc(categories.name)),

      // Primary image first, then the admin's explicit ordering. `is_primary` is not
      // guaranteed unique by the schema, so `sort_order` also breaks any tie.
      db
        .select({
          id: productImages.id,
          storageKey: productImages.storageKey,
          altText: productImages.altText,
          isPrimary: productImages.isPrimary,
        })
        .from(productImages)
        .where(eq(productImages.productId, row.id))
        .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder)),
    ]);

    const detailRow = detailRows[0];

    const images: ProductImageRef[] = await Promise.all(
      imageRows.map(async (image) => ({
        ...image,
        url: await getStorageObjectUrl(image.storageKey),
      })),
    );

    return {
      id: row.id,
      slug: row.slug,
      sku: row.sku,
      name: row.name,
      shortDescription: row.shortDescription,
      description: detailRow?.description ?? null,
      price: row.price,
      compareAtPrice: row.compareAtPrice,
      currency: row.currency,
      isFeatured: row.isFeatured,
      thumbnailStorageKey: row.thumbnailStorageKey,
      brand: toBrandSummary(row),
      availability: toAvailability(row.quantity, row.reservedQuantity),
      categories: categoryRows,
      images,
      specifications: specificationsOf(detailRow),
      additionalSpecifications: additionalSpecificationsOf(
        detailRow?.additionalSpecifications,
      ),
    };
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/** The watch-attribute labels, in the order the detail page renders them. */
const SPECIFICATION_FIELDS = [
  ["watchType", "Watch type"],
  ["movement", "Movement"],
  ["caseMaterial", "Case material"],
  ["caseShape", "Case shape"],
  ["caseDiameter", "Case diameter"],
  ["caseThickness", "Case thickness"],
  ["strapMaterial", "Strap material"],
  ["strapColor", "Strap colour"],
  ["dialColor", "Dial colour"],
  ["glassMaterial", "Glass"],
  ["waterResistance", "Water resistance"],
  ["powerReserve", "Power reserve"],
  ["warrantyPeriod", "Warranty"],
  ["gender", "Gender"],
] as const;

interface WatchDetailRow {
  readonly caseDiameter: string | null;
  readonly caseThickness: string | null;
  readonly additionalSpecifications: unknown;
  readonly [key: string]: unknown;
}

/** The two `numeric(6, 2)` columns, which carry a unit and must not be read as money. */
const MEASUREMENT_FIELDS: readonly string[] = [
  "caseDiameter",
  "caseThickness",
];
const MEASUREMENT_UNIT = "mm";

/**
 * Trim a `numeric` value for display without ever parsing it as a float.
 *
 * Drizzle hands back `"40.00"`, and `40.00 mm` reads like a programming artefact, so
 * trailing zeros are removed textually. Guarding on the presence of a decimal point
 * matters: an integer like `"40"` must not lose its last digit. These values are
 * dimensions, not money, so the money rules do not apply — but the "never parse to a
 * float" discipline does.
 */
function trimNumeric(value: string): string {
  return value.includes(".")
    ? value.replace(/0+$/, "").replace(/\.$/, "")
    : value;
}

/**
 * Project the `watch_details` row into labelled specifications.
 *
 * Blank and null values are dropped rather than rendered as "—": the admin stores only
 * the attributes it knows, so a blank cell would be noise on every product that omits
 * one. Every cell is trimmed, and an empty string never becomes a row.
 */
function specificationsOf(
  row: WatchDetailRow | undefined,
): WatchSpecification[] {
  if (!row) {
    return [];
  }

  const specifications: WatchSpecification[] = [];

  for (const [field, label] of SPECIFICATION_FIELDS) {
    const raw = row[field];

    if (typeof raw !== "string") {
      continue;
    }

    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      continue;
    }

    specifications.push({
      label,
      value: MEASUREMENT_FIELDS.includes(field)
        ? `${trimNumeric(trimmed)} ${MEASUREMENT_UNIT}`
        : trimmed,
    });
  }

  return specifications;
}

/**
 * Render `additional_specifications` (`jsonb`) as a specification list.
 *
 * The column is free-form, so its shape is unknown by construction. Only a flat object
 * of scalar values is rendered — an array, a nested object or `null` is ignored rather
 * than stringified into the page, which keeps an unexpected admin payload from
 * producing `[object Object]` or leaking whatever a nested object happens to hold.
 */
function additionalSpecificationsOf(value: unknown): WatchSpecification[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const specifications: WatchSpecification[] = [];

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();

      if (trimmed.length > 0) {
        specifications.push({ label: key, value: trimmed });
      }

      continue;
    }

    if (typeof entry === "number" || typeof entry === "boolean") {
      specifications.push({ label: key, value: String(entry) });
    }
  }

  return specifications;
}

/**
 * Active categories with the number of published products in each.
 *
 * Used by the filter rail. The aggregate is one grouped join rather than a query per
 * category, and the page layer caches the result, so a listing render does not pay for
 * it on every request.
 */
export async function getCategoryFacets(): Promise<CatalogFacet[]> {
  try {
    return await db
      .select({
        slug: categories.slug,
        name: categories.name,
        productCount: count(products.id),
      })
      .from(categories)
      .innerJoin(
        productCategories,
        eq(productCategories.categoryId, categories.id),
      )
      .innerJoin(products, eq(products.id, productCategories.productId))
      .innerJoin(brands, eq(brands.id, products.brandId))
      .where(
        and(
          eq(categories.isActive, true),
          eq(products.isActive, true),
          eq(brands.isActive, true),
        ),
      )
      .groupBy(
        categories.id,
        categories.slug,
        categories.name,
        categories.sortOrder,
      )
      .orderBy(asc(categories.sortOrder), asc(categories.name));
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/** Active brands with the number of published products in each. */
export async function getBrandFacets(): Promise<CatalogFacet[]> {
  try {
    return await db
      .select({
        slug: brands.slug,
        name: brands.name,
        productCount: count(products.id),
      })
      .from(brands)
      .innerJoin(products, eq(products.brandId, brands.id))
      .where(and(eq(brands.isActive, true), eq(products.isActive, true)))
      .groupBy(brands.id, brands.slug, brands.name)
      .orderBy(asc(brands.name));
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}

/**
 * Other published products a visitor may be interested in.
 *
 * Preference order is "shares a category with this product", then "same brand",
 * excluding the product itself. The category ids come from the detail row the caller
 * already fetched, so this adds exactly one query and no correlated-subquery subtleties
 * (a self-referencing `product_categories` subquery would need an alias to mean what it
 * looks like it means).
 */
export async function getRelatedProducts(
  product: Pick<CatalogProductDetail, "id" | "brand" | "categories">,
  limit = 4,
): Promise<CatalogProductListItem[]> {
  try {
    const categoryIds = product.categories.map((category) => category.id);

    const sharesCategory =
      categoryIds.length === 0
        ? undefined
        : exists(
            db
              .select({ matched: sql`1` })
              .from(productCategories)
              .where(
                and(
                  eq(productCategories.productId, products.id),
                  inArray(productCategories.categoryId, categoryIds),
                ),
              ),
          );

    const relevance = sharesCategory
      ? or(sharesCategory, eq(products.brandId, product.brand.id))
      : eq(products.brandId, product.brand.id);

    const rows: ListRow[] = await listSource()
      .where(
        and(
          eq(products.isActive, true),
          eq(brands.isActive, true),
          ne(products.id, product.id),
          relevance,
        ),
      )
      .orderBy(
        desc(products.isFeatured),
        desc(products.createdAt),
        desc(products.id),
      )
      .limit(Math.max(1, Math.min(limit, 12)));

    return await toListItems(rows);
  } catch (error) {
    throw new DatabaseError({ cause: error });
  }
}