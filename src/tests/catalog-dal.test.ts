import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getActiveProductCount,
  getBrandFacets,
  getCategoryFacets,
  getProductBySlug,
  getProducts,
} from "@/lib/dal/catalog";
import { parseCatalogQuery } from "@/lib/validation/catalog";

import { seedBrand, seedCategory, seedProduct } from "./helpers/catalog";
import { applyCatalogSchema, clearCatalogData } from "./helpers/catalog-schema";
import { createTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * The catalogue DAL against the real admin DDL.
 *
 * Every case runs on an in-memory PGlite database carrying the catalogue tables exactly as
 * `admin-backend`'s migrations leave them (`./helpers/catalog-schema.ts`), and inserts
 * through the mirrored Drizzle schema. That combination is deliberate: it means the tests
 * also prove the mirror is faithful, and that the storefront's read path works against the
 * tables it will actually meet on Neon.
 *
 * The three properties worth guarding, and what each group of cases below is for:
 *
 * 1. **Visibility is not optional.** An inactive product, a product under a deactivated
 *    brand, and an inactive category assigned to a live product must all be handled the
 *    same way by every entry point — listing, detail, facets, count. A rule that only
 *    holds on one code path is the failure mode this suite exists to catch.
 * 2. **The reported total and the rendered rows agree.** Filtering, sorting and paging are
 *    driven by one shared condition builder, so a case that counts differently from the
 *    rows would silently make pagination lie.
 * 3. **Availability is derived, never stored.** `quantity - reserved_quantity`, floored at
 *    zero, with a missing inventory row meaning out of stock — not invisible.
 */

/** Parse search parameters exactly as the page does, so tests exercise the real boundary. */
function query(params: Record<string, unknown> = {}) {
  return parseCatalogQuery(params);
}

/** Slugs of a page's items, in the order the database returned them. */
function slugsOf(page: { items: readonly { slug: string }[] }): string[] {
  return page.items.map((item) => item.slug);
}

/**
 * The same slugs, sorted.
 *
 * Used wherever a case is about *which* products a filter selected rather than about the
 * order between them: rows seeded with the column default share a timestamp to the
 * resolution the database stores, so asserting a sequence there would be asserting an
 * accident. Ordering has its own cases, with explicit timestamps.
 */
function sortedSlugsOf(page: { items: readonly { slug: string }[] }): string[] {
  return slugsOf(page).sort();
}

describe("catalog DAL", () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
    await applyCatalogSchema(handle);
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await clearCatalogData(handle);
  });

  describe("visibility: active product under an active brand", () => {
    it("shows a published product and hides an unpublished one", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      await seedProduct(handle, {
        name: "Published",
        slug: "published",
        sku: "PUB-1",
        brandId: brand.id,
        price: 12000,
      });
      await seedProduct(handle, {
        name: "Draft",
        slug: "draft",
        sku: "DRF-1",
        brandId: brand.id,
        price: 9000,
        isActive: false,
      });

      expect(slugsOf(await getProducts(query()))).toEqual(["published"]);
      expect(await getProductBySlug("draft")).toBeNull();
      expect(await getActiveProductCount()).toBe(1);
    });

    it("hides a published product whose brand was deactivated, everywhere", async () => {
      const brand = await seedBrand(handle, { name: "Retired", slug: "retired", isActive: false });
      await seedProduct(handle, {
        name: "Orphaned",
        slug: "orphaned",
        sku: "ORP-1",
        brandId: brand.id,
        price: 15000,
      });

      expect(slugsOf(await getProducts(query()))).toEqual([]);
      expect(await getProductBySlug("orphaned")).toBeNull();
      expect(await getActiveProductCount()).toBe(0);
      expect(await getBrandFacets()).toEqual([]);
    });

    it("returns null for an unknown slug, without distinguishing it from a hidden product", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      await seedProduct(handle, {
        name: "Hidden",
        slug: "hidden",
        sku: "HID-1",
        brandId: brand.id,
        price: 5000,
        isActive: false,
      });

      expect(await getProductBySlug("never-existed")).toBeNull();
      expect(await getProductBySlug("hidden")).toBeNull();
    });

    it("shows a live product but omits an inactive category it is filed under", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      const diving = await seedCategory(handle, { name: "Diving", slug: "diving", sortOrder: 1 });
      const retired = await seedCategory(handle, {
        name: "Retired",
        slug: "retired",
        isActive: false,
      });

      await seedProduct(handle, {
        name: "Marine",
        slug: "marine",
        sku: "MAR-1",
        brandId: brand.id,
        price: 25000,
        categoryIds: [diving.id, retired.id],
      });

      const listed = (await getProducts(query())).items[0]!;
      const detail = await getProductBySlug("marine");

      expect(listed.categories.map((category) => category.slug)).toEqual(["diving"]);
      expect(detail!.categories.map((category) => category.slug)).toEqual(["diving"]);
    });

    it("does not match a filter on an inactive category", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      const retired = await seedCategory(handle, {
        name: "Retired",
        slug: "retired",
        isActive: false,
      });

      await seedProduct(handle, {
        name: "Filed only under retired",
        slug: "filed",
        sku: "FLD-1",
        brandId: brand.id,
        price: 1000,
        categoryIds: [retired.id],
      });

      const filtered = await getProducts(query({ category: "retired" }));

      expect(filtered.totalCount).toBe(0);
      expect(filtered.items).toEqual([]);
    });
  });

  describe("availability: derived from quantity minus reserved", () => {
    it("computes what a customer may buy and never stores it", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      await seedProduct(handle, {
        name: "Reserved three",
        slug: "reserved-three",
        sku: "RSV-3",
        brandId: brand.id,
        price: 10000,
        inventory: { quantity: 10, reservedQuantity: 3 },
      });

      const item = (await getProducts(query())).items[0]!;

      expect(item.availability).toEqual({
        quantity: 10,
        reservedQuantity: 3,
        availableQuantity: 7,
        isInStock: true,
      });
    });

    it("treats a product with no inventory row as out of stock, not as hidden", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      await seedProduct(handle, {
        name: "No stock row",
        slug: "no-stock-row",
        sku: "NSR-1",
        brandId: brand.id,
        price: 7000,
        inventory: null,
      });

      const page = await getProducts(query());
      const detail = await getProductBySlug("no-stock-row");

      expect(slugsOf(page)).toEqual(["no-stock-row"]);
      expect(page.items[0]!.availability).toEqual({
        quantity: 0,
        reservedQuantity: 0,
        availableQuantity: 0,
        isInStock: false,
      });
      expect(detail!.availability.isInStock).toBe(false);
    });

    it("reports zero available when every unit is reserved", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      await seedProduct(handle, {
        name: "Fully reserved",
        slug: "fully-reserved",
        sku: "FRS-1",
        brandId: brand.id,
        price: 8000,
        inventory: { quantity: 4, reservedQuantity: 4 },
      });

      const detail = await getProductBySlug("fully-reserved");

      expect(detail!.availability.availableQuantity).toBe(0);
      expect(detail!.availability.isInStock).toBe(false);
    });

    it("stays advertised even when out of stock, because an out-of-stock watch is not a hidden one", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      await seedProduct(handle, {
        name: "Sold out",
        slug: "sold-out",
        sku: "SLD-1",
        brandId: brand.id,
        price: 6000,
        inventory: { quantity: 0 },
      });

      const page = await getProducts(query());

      expect(slugsOf(page)).toEqual(["sold-out"]);
      expect(page.totalCount).toBe(1);
    });
  });

  describe("filtering: search, brand, category and price", () => {
    /**
     * A small catalogue whose names, brands, categories and prices all disagree, so a
     * wrong `WHERE` cannot pass by coincidence.
     */
    async function seedCatalogue() {
      const seiko = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      const casio = await seedBrand(handle, { name: "Casio", slug: "casio" });
      const diving = await seedCategory(handle, { name: "Diving", slug: "diving", sortOrder: 1 });
      const dress = await seedCategory(handle, { name: "Dress", slug: "dress", sortOrder: 2 });

      await seedProduct(handle, {
        name: "Zulu Diver",
        slug: "zulu-diver",
        sku: "ZUL-1",
        brandId: seiko.id,
        price: 30000,
        shortDescription: "A tool watch for the deep",
        categoryIds: [diving.id],
      });
      await seedProduct(handle, {
        name: "Alpha Dress",
        slug: "alpha-dress",
        sku: "ALP-1",
        brandId: casio.id,
        price: 10000,
        shortDescription: "A slim quartz dress watch",
        categoryIds: [dress.id],
      });
      await seedProduct(handle, {
        name: "Mike Marine",
        slug: "mike-marine",
        sku: "MIK-1",
        brandId: seiko.id,
        price: 20000,
        shortDescription: "A quartz diver",
        categoryIds: [diving.id, dress.id],
      });
    }

    it("searches name, short description and brand name, case-insensitively", async () => {
      await seedCatalogue();

      expect(await getProducts(query({ q: "zulu" })).then(slugsOf)).toEqual(["zulu-diver"]);
      expect(await getProducts(query({ q: "QUARTZ" })).then(sortedSlugsOf)).toEqual([
        "alpha-dress",
        "mike-marine",
      ]);
      expect(await getProducts(query({ q: "seiko" })).then(sortedSlugsOf)).toEqual([
        "mike-marine",
        "zulu-diver",
      ]);
    });

    it("treats LIKE wildcards in the search box as literal text", async () => {
      await seedCatalogue();

      // Without escaping, `%` would match the entire catalogue and `_` any character.
      expect((await getProducts(query({ q: "%" }))).totalCount).toBe(0);
      expect((await getProducts(query({ q: "_" }))).totalCount).toBe(0);
      expect((await getProducts(query({ q: "zulu_div" }))).totalCount).toBe(0);
    });

    it("filters by brand, and reports the count the rows agree with", async () => {
      await seedCatalogue();

      const page = await getProducts(query({ brand: "seiko" }));

      expect(sortedSlugsOf(page)).toEqual(["mike-marine", "zulu-diver"]);
      expect(page.totalCount).toBe(2);
    });

    it("filters by category without duplicating a product filed under several categories", async () => {
      await seedCatalogue();

      // `mike-marine` belongs to both categories: a join would return it twice and make
      // the count disagree with the page.
      const page = await getProducts(query({ category: "diving" }));

      expect(sortedSlugsOf(page)).toEqual(["mike-marine", "zulu-diver"]);
      expect(page.totalCount).toBe(2);
    });

    it("applies an inclusive whole-INR price range", async () => {
      await seedCatalogue();

      const middle = await getProducts(query({ minPrice: "10000", maxPrice: "20000" }));

      expect(sortedSlugsOf(middle)).toEqual(["alpha-dress", "mike-marine"]);
      expect((await getProducts(query({ maxPrice: "9999" }))).totalCount).toBe(0);
      expect((await getProducts(query({ minPrice: "30001" }))).totalCount).toBe(0);
    });

    it("combines filters as AND, not as OR", async () => {
      await seedCatalogue();

      const both = await getProducts(query({ brand: "seiko", category: "dress" }));
      const impossible = await getProducts(query({ brand: "casio", category: "diving" }));

      expect(slugsOf(both)).toEqual(["mike-marine"]);
      expect(impossible.totalCount).toBe(0);
    });

    it("returns nothing for a filter value that matches no brand or category", async () => {
      await seedCatalogue();

      expect((await getProducts(query({ brand: "rolex" }))).totalCount).toBe(0);
      expect((await getProducts(query({ category: "smartwatches" }))).totalCount).toBe(0);
    });

    it("carries the applied query back, clamped and normalized", async () => {
      await seedCatalogue();

      const page = await getProducts(query({ brand: "Seiko", category: "DIVING", page: "2" }));

      expect(page.query).toEqual({
        q: "",
        category: "diving",
        brand: "seiko",
        sort: "newest",
        minPrice: undefined,
        maxPrice: undefined,
        page: 1,
        pageSize: 12,
      });
    });
  });

  describe("sorting: a closed set of orderings", () => {
    /**
     * Names are deliberately out of step with prices, and creation instants are explicit,
     * so a wrong `ORDER BY` fails instead of passing by coincidence.
     */
    async function seedPrices() {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });

      await seedProduct(handle, {
        name: "Zulu",
        slug: "zulu",
        sku: "AAA",
        brandId: brand.id,
        price: 30000,
        createdAt: new Date("2024-01-01T00:00:00Z"),
      });
      await seedProduct(handle, {
        name: "Alpha",
        slug: "alpha",
        sku: "BBB",
        brandId: brand.id,
        price: 10000,
        createdAt: new Date("2024-02-01T00:00:00Z"),
      });
      await seedProduct(handle, {
        name: "Mike",
        slug: "mike",
        sku: "CCC",
        brandId: brand.id,
        price: 20000,
        createdAt: new Date("2024-03-01T00:00:00Z"),
      });
    }

    it("sorts by price in both directions", async () => {
      await seedPrices();

      expect(await getProducts(query({ sort: "price-asc" })).then(slugsOf)).toEqual([
        "alpha",
        "mike",
        "zulu",
      ]);
      expect(await getProducts(query({ sort: "price-desc" })).then(slugsOf)).toEqual([
        "zulu",
        "mike",
        "alpha",
      ]);
    });

    it("sorts by name, independently of price", async () => {
      await seedPrices();

      expect(await getProducts(query({ sort: "name-asc" })).then(slugsOf)).toEqual([
        "alpha",
        "mike",
        "zulu",
      ]);
    });

    it("sorts newest first by default, from the stored timestamps", async () => {
      await seedPrices();

      // Seeded oldest-first, so the expected order is the reverse of insertion.
      expect(await getProducts(query()).then(slugsOf)).toEqual(["mike", "alpha", "zulu"]);
      expect(await getProducts(query({ sort: "newest" })).then(slugsOf)).toEqual([
        "mike",
        "alpha",
        "zulu",
      ]);
    });

    it("falls back to the default ordering for a sort value outside the allow-list", async () => {
      await seedPrices();

      // The value never reaches SQL, so the worst case is the default order.
      const page = await getProducts(query({ sort: "price; DROP TABLE products" }));

      expect(slugsOf(page)).toEqual(["mike", "alpha", "zulu"]);
    });
  });

  describe("pagination: a clamped page that never repeats or drops a row", () => {
    /** Fifteen products with distinct prices and distinct creation instants. */
    async function seedFifteen() {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });

      for (let index = 1; index <= 15; index += 1) {
        await seedProduct(handle, {
          name: `Watch ${String(index).padStart(2, "0")}`,
          slug: `watch-${String(index).padStart(2, "0")}`,
          sku: `SKU-${String(index).padStart(2, "0")}`,
          brandId: brand.id,
          price: index * 1000,
          createdAt: new Date(Date.UTC(2024, 0, index)),
        });
      }
    }

    it("reports the totals and the availability of neighbouring pages", async () => {
      await seedFifteen();

      const first = await getProducts(query({ pageSize: "12" }));
      const second = await getProducts(query({ pageSize: "12", page: "2" }));

      expect(first.totalCount).toBe(15);
      expect(first.totalPages).toBe(2);
      expect(first.page).toBe(1);
      expect(first.hasPreviousPage).toBe(false);
      expect(first.hasNextPage).toBe(true);
      expect(second.page).toBe(2);
      expect(second.hasPreviousPage).toBe(true);
      expect(second.hasNextPage).toBe(false);
      expect(second.items).toHaveLength(3);
    });

    it("clamps a page past the end instead of returning an empty grid", async () => {
      await seedFifteen();

      const page = await getProducts(query({ pageSize: "12", page: "99" }));

      expect(page.page).toBe(2);
      expect(page.query.page).toBe(2);
      expect(page.items).toHaveLength(3);
      expect(page.hasNextPage).toBe(false);
    });

    it("clamps to page 1 when the result set is empty", async () => {
      const page = await getProducts(query({ page: "7" }));

      expect(page.totalCount).toBe(0);
      expect(page.totalPages).toBe(1);
      expect(page.page).toBe(1);
      expect(page.items).toEqual([]);
    });

    it("shows each product exactly once across pages", async () => {
      await seedFifteen();

      const seen: string[] = [];

      for (let page = 1; page <= 2; page += 1) {
        const result = await getProducts(query({ pageSize: "12", page: String(page) }));
        seen.push(...slugsOf(result));
      }

      expect(seen).toHaveLength(15);
      expect(new Set(seen).size).toBe(15);
    });

    it("keeps the ordering stable across pages, so no row is skipped", async () => {
      await seedFifteen();

      const all = await getProducts(query({ sort: "price-desc", pageSize: "48" }));
      const first = await getProducts(query({ sort: "price-desc", pageSize: "12" }));
      const second = await getProducts(query({ sort: "price-desc", pageSize: "12", page: "2" }));

      expect([...slugsOf(first), ...slugsOf(second)]).toEqual(slugsOf(all));
    });

    it("honours each advertised page size", async () => {
      await seedFifteen();

      expect((await getProducts(query({ pageSize: "12" }))).items).toHaveLength(12);
      expect((await getProducts(query({ pageSize: "24" }))).items).toHaveLength(15);
      expect((await getProducts(query({ pageSize: "48" }))).items).toHaveLength(15);
    });
  });

  describe("facets: the filter rail", () => {
    it("counts only published products under active brands and categories", async () => {
      const seiko = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      const retired = await seedBrand(handle, { name: "Retired", slug: "retired", isActive: false });
      const diving = await seedCategory(handle, { name: "Diving", slug: "diving", sortOrder: 1 });
      const dress = await seedCategory(handle, { name: "Dress", slug: "dress", sortOrder: 2 });
      const hidden = await seedCategory(handle, { name: "Hidden", slug: "hidden", isActive: false });

      await seedProduct(handle, {
        name: "Live diver",
        slug: "live-diver",
        sku: "LVD-1",
        brandId: seiko.id,
        price: 10000,
        categoryIds: [diving.id, hidden.id],
      });
      await seedProduct(handle, {
        name: "Draft diver",
        slug: "draft-diver",
        sku: "DRD-1",
        brandId: seiko.id,
        price: 11000,
        isActive: false,
        categoryIds: [diving.id],
      });
      await seedProduct(handle, {
        name: "Retired brand dress",
        slug: "retired-dress",
        sku: "RTD-1",
        brandId: retired.id,
        price: 12000,
        categoryIds: [dress.id],
      });

      expect(await getCategoryFacets()).toEqual([
        { slug: "diving", name: "Diving", productCount: 1 },
      ]);
      expect(await getBrandFacets()).toEqual([{ slug: "seiko", name: "Seiko", productCount: 1 }]);
    });

    it("orders categories by the admin's sort order and brands by name", async () => {
      const alpha = await seedBrand(handle, { name: "Alpha", slug: "alpha" });
      const zulu = await seedBrand(handle, { name: "Zulu", slug: "zulu" });
      const second = await seedCategory(handle, { name: "Second", slug: "second", sortOrder: 20 });
      const first = await seedCategory(handle, { name: "First", slug: "first", sortOrder: 10 });

      await seedProduct(handle, {
        name: "Zulu watch",
        slug: "zulu-watch",
        sku: "ZUL-9",
        brandId: zulu.id,
        price: 100,
        categoryIds: [second.id, first.id],
      });
      await seedProduct(handle, {
        name: "Alpha watch",
        slug: "alpha-watch",
        sku: "ALP-9",
        brandId: alpha.id,
        price: 200,
        categoryIds: [first.id],
      });

      expect((await getCategoryFacets()).map((facet) => facet.slug)).toEqual(["first", "second"]);
      expect((await getBrandFacets()).map((facet) => facet.slug)).toEqual(["alpha", "zulu"]);
    });

    it("returns no facets for an empty catalogue rather than a row of zeroes", async () => {
      expect(await getCategoryFacets()).toEqual([]);
      expect(await getBrandFacets()).toEqual([]);
    });

    it("agrees with the listing about how many products a filter will find", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      const diving = await seedCategory(handle, { name: "Diving", slug: "diving" });

      await seedProduct(handle, {
        name: "One",
        slug: "one",
        sku: "ONE-1",
        brandId: brand.id,
        price: 100,
        categoryIds: [diving.id],
      });
      await seedProduct(handle, {
        name: "Two",
        slug: "two",
        sku: "TWO-1",
        brandId: brand.id,
        price: 200,
        categoryIds: [diving.id],
      });

      const [categoryFacet] = await getCategoryFacets();
      const [brandFacet] = await getBrandFacets();

      expect(categoryFacet!.productCount).toBe(
        (await getProducts(query({ category: "diving" }))).totalCount,
      );
      expect(brandFacet!.productCount).toBe(
        (await getProducts(query({ brand: "seiko" }))).totalCount,
      );
    });
  });
});