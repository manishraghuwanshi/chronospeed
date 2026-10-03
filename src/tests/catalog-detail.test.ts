import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getProductBySlug, getRelatedProducts } from "@/lib/dal/catalog";

import { seedBrand, seedCategory, seedProduct } from "./helpers/catalog";
import { applyCatalogSchema, clearCatalogData } from "./helpers/catalog-schema";
import { createTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * The product detail read, and the recommendations that hang off it.
 *
 * Split from the listing suite because these two functions have their own hazards: the
 * detail read projects an optional `watch_details` row and a free-form `jsonb` column into
 * display-ready pairs, and the recommendation query must exclude the product itself while
 * preferring category overlap over same-brand rows. Both are easy to get subtly wrong in
 * ways that still render *something*, which is why the assertions below are about exact
 * values and exact orders rather than about non-emptiness.
 */

describe("catalog DAL: product detail", () => {
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

  describe("specifications: labelled and in a fixed order", () => {
    it("labels watch attributes and drops the blanks", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      await seedProduct(handle, {
        name: "Detailed",
        slug: "detailed",
        sku: "DET-1",
        brandId: brand.id,
        price: 45000,
        description: "A description with\nmultiple lines.",
        watchDetails: {
          movement: "Automatic",
          caseMaterial: "  Stainless steel  ",
          caseDiameter: "40.00",
          caseThickness: "12.50",
          dialColor: "",
          waterResistance: "200 m",
        },
      });

      const detail = await getProductBySlug("detailed");

      expect(detail!.description).toBe("A description with\nmultiple lines.");
      expect(detail!.specifications).toEqual([
        { label: "Movement", value: "Automatic" },
        { label: "Case material", value: "Stainless steel" },
        { label: "Case diameter", value: "40 mm" },
        { label: "Case thickness", value: "12.5 mm" },
        { label: "Water resistance", value: "200 m" },
      ]);
    });

    it("keeps an integer measurement intact while trimming trailing zeroes", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      await seedProduct(handle, {
        name: "Integer case",
        slug: "integer-case",
        sku: "INT-1",
        brandId: brand.id,
        price: 5000,
        watchDetails: { caseDiameter: "40", caseThickness: "10.20" },
      });

      const detail = await getProductBySlug("integer-case");

      // `40` must not lose its last digit, and `10.20` must not render as `10.2 0 mm`.
      expect(detail!.specifications).toEqual([
        { label: "Case diameter", value: "40 mm" },
        { label: "Case thickness", value: "10.2 mm" },
      ]);
    });

    it("renders free-form additional specifications and ignores non-scalar entries", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      await seedProduct(handle, {
        name: "Extra specs",
        slug: "extra-specs",
        sku: "EXT-1",
        brandId: brand.id,
        price: 5000,
        watchDetails: {
          movement: "Quartz",
          additionalSpecifications: {
            "Lug width": "20 mm",
            "Battery life": 5,
            Chronograph: true,
            Nested: { depth: 1 },
            Tags: ["a", "b"],
            Blank: "   ",
          },
        },
      });

      const detail = await getProductBySlug("extra-specs");
      const rendered = detail!.additionalSpecifications;

      // A nested object or an array must never reach the page as `[object Object]`.
      expect(
        [...rendered].sort((left, right) => left.label.localeCompare(right.label)),
      ).toEqual([
        { label: "Battery life", value: "5" },
        { label: "Chronograph", value: "true" },
        { label: "Lug width", value: "20 mm" },
      ]);
      // `jsonb` does not preserve key order — Postgres stores its keys sorted by length
      // then bytewise — so the DAL promises a stable *shape*, not the admin's typing
      // order. Asserting an order here would be asserting a storage detail.
      expect(rendered).toHaveLength(3);
    });

    it("returns empty lists for a product with no watch_details row", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      await seedProduct(handle, {
        name: "Bare",
        slug: "bare",
        sku: "BAR-1",
        brandId: brand.id,
        price: 3000,
      });

      const detail = await getProductBySlug("bare");

      expect(detail!.specifications).toEqual([]);
      expect(detail!.additionalSpecifications).toEqual([]);
      expect(detail!.images).toEqual([]);
      expect(detail!.description).toBeNull();
    });
  });

  describe("images: keys only, primary first", () => {
    it("orders the gallery primary-first, then by the admin's sort order", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      await seedProduct(handle, {
        name: "Gallery",
        slug: "gallery",
        sku: "GAL-1",
        brandId: brand.id,
        price: 9000,
        images: [
          { storageKey: "products/gallery/third.jpg", sortOrder: 30 },
          { storageKey: "products/gallery/second.jpg", sortOrder: 20 },
          // Primary wins on `is_primary` regardless of its `sort_order`.
          { storageKey: "products/gallery/primary.jpg", sortOrder: 40, isPrimary: true },
          { storageKey: "products/gallery/first.jpg", sortOrder: 10 },
        ],
      });

      const detail = await getProductBySlug("gallery");

      expect(detail!.images.map((image) => image.storageKey)).toEqual([
        "products/gallery/primary.jpg",
        "products/gallery/first.jpg",
        "products/gallery/second.jpg",
        "products/gallery/third.jpg",
      ]);
      expect(detail!.images[0]!.isPrimary).toBe(true);
    });

    it("carries storage keys as opaque values, never as URLs", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      await seedProduct(handle, {
        name: "Keys",
        slug: "keys",
        sku: "KEY-1",
        brandId: brand.id,
        price: 9000,
        thumbnailStorageKey: "products/keys/thumb.jpg",
        images: [{ storageKey: "products/keys/full.jpg", altText: "Front view" }],
      });

      const detail = await getProductBySlug("keys");

      expect(detail!.thumbnailStorageKey).toBe("products/keys/thumb.jpg");
      expect(detail!.images[0]).toEqual({
        id: expect.any(String),
        storageKey: "products/keys/full.jpg",
        altText: "Front view",
        isPrimary: false,
      });
    });
  });

  describe("related products: relevant, excluding the product itself", () => {
    it("prefers a category match, then falls back to the same brand", async () => {
      const seiko = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      const casio = await seedBrand(handle, { name: "Casio", slug: "casio" });
      const diving = await seedCategory(handle, { name: "Diving", slug: "diving" });
      const dress = await seedCategory(handle, { name: "Dress", slug: "dress" });

      await seedProduct(handle, {
        name: "Subject",
        slug: "subject",
        sku: "SUB-1",
        brandId: seiko.id,
        price: 10000,
        categoryIds: [diving.id],
      });
      // Same brand, no shared category.
      await seedProduct(handle, {
        name: "Same brand",
        slug: "same-brand",
        sku: "SMB-1",
        brandId: seiko.id,
        price: 11000,
        categoryIds: [dress.id],
      });
      // Different brand, shared category.
      await seedProduct(handle, {
        name: "Shares category",
        slug: "shares-category",
        sku: "SHC-1",
        brandId: casio.id,
        price: 12000,
        categoryIds: [diving.id],
      });
      // Neither relevant: must not appear.
      await seedProduct(handle, {
        name: "Unrelated",
        slug: "unrelated",
        sku: "UNR-1",
        brandId: casio.id,
        price: 13000,
        categoryIds: [dress.id],
      });

      const detail = await getProductBySlug("subject");
      const related = await getRelatedProducts(detail!);
      const slugs = related.map((item) => item.slug).sort();

      expect(slugs).toEqual(["same-brand", "shares-category"]);
      expect(slugs).not.toContain("subject");
      expect(slugs).not.toContain("unrelated");
    });

    it("falls back to the same brand when the product has no category at all", async () => {
      const seiko = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      const casio = await seedBrand(handle, { name: "Casio", slug: "casio" });

      await seedProduct(handle, {
        name: "Unfiled",
        slug: "unfiled",
        sku: "UNF-1",
        brandId: seiko.id,
        price: 10000,
      });
      await seedProduct(handle, {
        name: "Sibling",
        slug: "sibling",
        sku: "SIB-1",
        brandId: seiko.id,
        price: 12000,
      });
      await seedProduct(handle, {
        name: "Stranger",
        slug: "stranger",
        sku: "STR-1",
        brandId: casio.id,
        price: 14000,
      });

      const detail = await getProductBySlug("unfiled");
      const related = await getRelatedProducts(detail!);

      expect(related.map((item) => item.slug)).toEqual(["sibling"]);
    });

    it("recommends no unpublished product and none under a deactivated brand", async () => {
      const seiko = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      const retired = await seedBrand(handle, { name: "Retired", slug: "retired", isActive: false });
      const diving = await seedCategory(handle, { name: "Diving", slug: "diving" });

      await seedProduct(handle, {
        name: "Subject",
        slug: "subject",
        sku: "SUB-2",
        brandId: seiko.id,
        price: 10000,
        categoryIds: [diving.id],
      });
      await seedProduct(handle, {
        name: "Live sibling",
        slug: "live-sibling",
        sku: "LVS-1",
        brandId: seiko.id,
        price: 12000,
        categoryIds: [diving.id],
      });
      await seedProduct(handle, {
        name: "Draft sibling",
        slug: "draft-sibling",
        sku: "DFS-1",
        brandId: seiko.id,
        price: 13000,
        isActive: false,
        categoryIds: [diving.id],
      });
      await seedProduct(handle, {
        name: "Retired sibling",
        slug: "retired-sibling",
        sku: "RTS-1",
        brandId: retired.id,
        price: 14000,
        categoryIds: [diving.id],
      });

      const detail = await getProductBySlug("subject");
      const related = await getRelatedProducts(detail!);

      expect(related.map((item) => item.slug)).toEqual(["live-sibling"]);
    });

    it("caps the number of recommendations, whatever the caller asks for", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      const diving = await seedCategory(handle, { name: "Diving", slug: "diving" });

      await seedProduct(handle, {
        name: "Subject",
        slug: "subject",
        sku: "SUB-3",
        brandId: brand.id,
        price: 10000,
        categoryIds: [diving.id],
      });

      for (let index = 1; index <= 20; index += 1) {
        await seedProduct(handle, {
          name: `Sibling ${index}`,
          slug: `sibling-${index}`,
          sku: `SIB-${index}`,
          brandId: brand.id,
          price: 10000 + index,
          categoryIds: [diving.id],
        });
      }

      const detail = await getProductBySlug("subject");

      expect(await getRelatedProducts(detail!, 4)).toHaveLength(4);
      // The DAL clamps its own limit, so a caller cannot ask for the whole catalogue.
      expect(await getRelatedProducts(detail!, 999)).toHaveLength(12);
    });

    it("returns an empty list rather than an error when nothing is related", async () => {
      const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
      await seedProduct(handle, {
        name: "Alone",
        slug: "alone",
        sku: "ALN-1",
        brandId: brand.id,
        price: 10000,
      });

      const detail = await getProductBySlug("alone");

      expect(await getRelatedProducts(detail!)).toEqual([]);
    });
  });
});