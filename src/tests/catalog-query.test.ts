import { describe, expect, it } from "vitest";

import {
  catalogFilterHref,
  catalogHref,
  hasActiveFilters,
  paginationItems,
} from "@/lib/catalog-url";
import type { AppliedCatalogQuery } from "@/lib/types/catalog";
import {
  DEFAULT_CATALOG_PAGE_SIZE,
  DEFAULT_CATALOG_SORT,
  MAX_CATALOG_PAGE,
  parseCatalogQuery,
} from "@/lib/validation/catalog";

/**
 * Catalogue query parsing.
 *
 * This module is the listing's front door: everything a visitor types into the address bar
 * becomes a bounded query here. It is pure, so it is tested directly — no database, no
 * request context — and a regression shows up as an unbounded or wrongly-normalized value
 * rather than as a page that merely renders oddly.
 *
 * The property that matters most is the one the module documents: **a bad parameter
 * degrades, it does not fail.** `parseCatalogQuery` cannot throw and cannot return
 * something the DAL would have to defend against.
 */

/** A defaulted applied query, so each URL case states only the field it is about. */
function applied(overrides: Partial<AppliedCatalogQuery> = {}): AppliedCatalogQuery {
  return {
    q: "",
    category: "",
    brand: "",
    sort: DEFAULT_CATALOG_SORT,
    minPrice: undefined,
    maxPrice: undefined,
    page: 1,
    pageSize: DEFAULT_CATALOG_PAGE_SIZE,
    ...overrides,
  };
}

describe("catalog query: degrading instead of failing", () => {
  it("returns a usable query for an entirely empty input", () => {
    expect(parseCatalogQuery({})).toEqual({
      q: "",
      category: "",
      brand: "",
      sort: DEFAULT_CATALOG_SORT,
      minPrice: undefined,
      maxPrice: undefined,
      page: 1,
      pageSize: DEFAULT_CATALOG_PAGE_SIZE,
    });
  });

  it("degrades an unrecognised sort, page, page size and price rather than throwing", () => {
    const query = parseCatalogQuery({
      sort: "cheapest",
      page: "abc",
      pageSize: "9999",
      minPrice: "free",
    });

    expect(query.sort).toBe(DEFAULT_CATALOG_SORT);
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(DEFAULT_CATALOG_PAGE_SIZE);
    expect(query.minPrice).toBeUndefined();
  });

  it("treats a malformed filter value as absent, so an unknown filter narrows nothing", () => {
    for (const value of ["../etc/passwd", "a".repeat(221), "Diving! ", "  ", "café"]) {
      expect(parseCatalogQuery({ category: value }).category, value).toBe("");
    }
  });

  it("lower-cases and trims filters, so one value has one spelling", () => {
    const query = parseCatalogQuery({ category: "  Diving-Watches  ", brand: "SEIKO" });

    expect(query.category).toBe("diving-watches");
    expect(query.brand).toBe("seiko");
  });

  it("caps the search term instead of rejecting it", () => {
    expect(parseCatalogQuery({ q: "x".repeat(101) }).q).toBe("");
    expect(parseCatalogQuery({ q: "  seiko  " }).q).toBe("seiko");
    expect(parseCatalogQuery({ q: "x".repeat(100) }).q).toHaveLength(100);
  });

  it("bounds a page request at the documented maximum", () => {
    expect(parseCatalogQuery({ page: "3" }).page).toBe(3);
    expect(parseCatalogQuery({ page: String(MAX_CATALOG_PAGE) }).page).toBe(MAX_CATALOG_PAGE);
    expect(parseCatalogQuery({ page: "999999" }).page).toBe(1);
    expect(parseCatalogQuery({ page: "-4" }).page).toBe(1);
    expect(parseCatalogQuery({ page: "2.5" }).page).toBe(1);
    expect(parseCatalogQuery({ page: "0" }).page).toBe(1);
  });

  it("accepts only the advertised page sizes", () => {
    expect(parseCatalogQuery({ pageSize: "24" }).pageSize).toBe(24);
    expect(parseCatalogQuery({ pageSize: "48" }).pageSize).toBe(48);
    expect(parseCatalogQuery({ pageSize: "13" }).pageSize).toBe(DEFAULT_CATALOG_PAGE_SIZE);
  });

  it("reads price bounds as whole units and normalizes an inverted range", () => {
    const inverted = parseCatalogQuery({ minPrice: "20000", maxPrice: "5000" });

    expect(inverted.minPrice).toBe(5000);
    expect(inverted.maxPrice).toBe(20000);
  });

  it("keeps a single-sided price bound and rejects a decimal or negative one", () => {
    expect(parseCatalogQuery({ minPrice: "5000" }).minPrice).toBe(5000);
    expect(parseCatalogQuery({ minPrice: "5000" }).maxPrice).toBeUndefined();
    expect(parseCatalogQuery({ maxPrice: "0" }).maxPrice).toBe(0);
    expect(parseCatalogQuery({ minPrice: "4999.99" }).minPrice).toBeUndefined();
    expect(parseCatalogQuery({ minPrice: "-1" }).minPrice).toBeUndefined();
  });

  it("ignores an array-valued parameter instead of picking an element", () => {
    // `?sort=a&sort=b` arrives as an array. Picking an element would let a repeated
    // parameter select a sort the visitor did not choose.
    const query = parseCatalogQuery({ sort: ["newest", "price-asc"], page: ["2", "3"] });

    expect(query.sort).toBe(DEFAULT_CATALOG_SORT);
    expect(query.page).toBe(1);
  });
});

describe("catalog URL: one canonical address per view", () => {
  it("omits every default, so a plain listing is a bare path", () => {
    expect(catalogHref(applied())).toBe("/products");
  });

  it("writes only non-default values", () => {
    expect(catalogHref(applied(), { sort: "price-asc" })).toBe("/products?sort=price-asc");
    expect(catalogHref(applied(), { pageSize: 24 })).toBe("/products?pageSize=24");
    expect(catalogHref(applied(), { page: 2 })).toBe("/products?page=2");
  });

  it("encodes a search term so a space or ampersand cannot break the URL", () => {
    const href = catalogHref(applied(), { q: "dive & field" });

    expect(href).toBe("/products?q=dive+%26+field");
    expect(new URLSearchParams(href.split("?")[1]).get("q")).toBe("dive & field");
  });

  it("orders parameters predictably, so two equal queries produce one string", () => {
    const href = catalogHref(applied(), {
      q: "seiko",
      category: "diving",
      brand: "seiko",
      sort: "price-desc",
      minPrice: 5000,
      maxPrice: 20000,
      pageSize: 48,
      page: 2,
    });

    expect(href).toBe(
      "/products?q=seiko&category=diving&brand=seiko&sort=price-desc&minPrice=5000&maxPrice=20000&pageSize=48&page=2",
    );
  });

  it("clears a parameter when an override is explicitly undefined", () => {
    const filtered = applied({ q: "seiko", brand: "seiko", minPrice: 5000, page: 4 });

    expect(catalogHref(filtered, { brand: undefined })).toBe(
      "/products?q=seiko&minPrice=5000&page=4",
    );
    expect(catalogHref(filtered, { minPrice: undefined })).toBe(
      "/products?q=seiko&brand=seiko&page=4",
    );
    expect(catalogHref(filtered, { q: "" })).toBe("/products?brand=seiko&minPrice=5000&page=4");
  });

  it("keeps the applied value when a key is omitted from the overrides", () => {
    const filtered = applied({ q: "seiko", category: "diving", brand: "seiko" });

    expect(catalogHref(filtered, { category: "dress" })).toBe(
      "/products?q=seiko&category=dress&brand=seiko",
    );
  });

  it("resets to page 1 whenever the selection changes", () => {
    const paged = applied({ category: "diving", page: 5 });

    expect(catalogFilterHref(paged, { brand: "seiko" })).toBe(
      "/products?category=diving&brand=seiko",
    );
    expect(catalogFilterHref(paged, { pageSize: 48 })).toBe("/products?category=diving&pageSize=48");
  });

  it("counts only the filters that narrow results", () => {
    expect(hasActiveFilters(applied())).toBe(false);
    // Presentation only: these change how results are shown, not which ones there are.
    expect(hasActiveFilters(applied({ sort: "price-asc", page: 3, pageSize: 48 }))).toBe(false);
    expect(hasActiveFilters(applied({ q: "seiko" }))).toBe(true);
    expect(hasActiveFilters(applied({ category: "diving" }))).toBe(true);
    expect(hasActiveFilters(applied({ brand: "seiko" }))).toBe(true);
    expect(hasActiveFilters(applied({ minPrice: 0 }))).toBe(true);
    expect(hasActiveFilters(applied({ maxPrice: 0 }))).toBe(true);
  });
});

describe("catalog pagination: windowed page numbers", () => {
  it("renders nothing when there is at most one page", () => {
    expect(paginationItems(1, 1)).toEqual([]);
    expect(paginationItems(1, 0)).toEqual([]);
  });

  it("lists every page when the total is short", () => {
    expect(paginationItems(1, 3)).toEqual([1, 2, 3]);
    expect(paginationItems(2, 3)).toEqual([1, 2, 3]);
  });

  it("always keeps both ends reachable and collapses the middle", () => {
    expect(paginationItems(1, 20)).toEqual([1, 2, 3, null, 20]);
    expect(paginationItems(10, 20)).toEqual([1, null, 8, 9, 10, 11, 12, null, 20]);
    expect(paginationItems(20, 20)).toEqual([1, null, 18, 19, 20]);
  });

  it("never repeats a page number", () => {
    const items = paginationItems(2, 4);

    expect(items).toEqual([1, 2, 3, 4]);
    expect(new Set(items).size).toBe(items.length);
  });
});