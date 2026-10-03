import { describe, expect, it } from "vitest";

import { hasActiveFilters } from "@/lib/catalog-url";
import {
  catalogCountLabel,
  catalogEmptyCopy,
  priceRangeLabel,
} from "@/lib/catalog-summary";
import type { AppliedCatalogQuery } from "@/lib/types/catalog";
import { DEFAULT_CATALOG_PAGE_SIZE, DEFAULT_CATALOG_SORT } from "@/lib/validation/catalog";

/**
 * How the catalogue words its own result count.
 *
 * The bug this file exists to prevent is a *pair* of statements, not a single string: the
 * listing's heading and its empty state both describe one number, and they disagreed. A
 * filtered query with no matches reported `totalCount === 0`, so the heading announced
 * "No watches are published yet." above an empty state that correctly said "No matches" —
 * telling a visitor to leave the shop when their own price filter was the cause.
 *
 * Asserting the two together is the point, so the contradiction is expressed as a test
 * rather than left to a reviewer's eye.
 */

/** A defaulted applied query, so each case states only the field it is about. */
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

describe("catalog summary: the heading and the empty state agree", () => {
  it("never claims the catalogue is empty when a filter caused the zero", () => {
    const query = applied({ minPrice: 6000 });
    const filtered = hasActiveFilters(query);

    expect(catalogCountLabel(0, filtered)).toBe("No watches match these filters.");
    expect(catalogCountLabel(0, filtered)).not.toContain("published yet");
    expect(catalogEmptyCopy(filtered).eyebrow).toBe("No matches");
  });

  it("still reports a genuinely empty catalogue as empty", () => {
    const filtered = hasActiveFilters(applied());

    expect(filtered).toBe(false);
    expect(catalogCountLabel(0, filtered)).toBe("No watches are published yet.");
    expect(catalogEmptyCopy(filtered).eyebrow).toBe("Nothing published yet");
  });

  it("does not treat sort, page or page size as a filter, so paging a full catalogue is not 'no matches'", () => {
    const filtered = hasActiveFilters(applied({ sort: "price-asc", page: 3, pageSize: 48 }));

    expect(filtered).toBe(false);
    expect(catalogCountLabel(0, filtered)).toBe("No watches are published yet.");
  });

  it("states the count for a non-empty result, singular and plural", () => {
    expect(catalogCountLabel(1, false)).toBe("1 watch");
    expect(catalogCountLabel(2, false)).toBe("2 watches");
    expect(catalogCountLabel(1234, false)).toBe("1,234 watches");
  });

  it("says the count is unreadable rather than reporting zero when the read failed", () => {
    for (const filtered of [false, true]) {
      const label = catalogCountLabel(null, filtered);

      expect(label).toBe("Showing the catalogue is temporarily unavailable.");
      expect(label).not.toContain("0");
      expect(label).not.toContain("published yet");
    }
  });

  it("describes a filtered empty differently from an unfiltered one", () => {
    expect(catalogEmptyCopy(true).title).not.toBe(catalogEmptyCopy(false).title);
    expect(catalogEmptyCopy(true).body).not.toBe(catalogEmptyCopy(false).body);
  });

  it("does not repeat the heading text verbatim as the empty-state title", () => {
    expect(catalogEmptyCopy(true).title).not.toBe(catalogCountLabel(0, true));
  });

  it("gives every branch non-empty eyebrow, title and body text", () => {
    for (const filtered of [false, true]) {
      const copy = catalogEmptyCopy(filtered);

      expect(copy.eyebrow.trim().length, String(filtered)).toBeGreaterThan(0);
      expect(copy.title.trim().length, String(filtered)).toBeGreaterThan(0);
      expect(copy.body.trim().length, String(filtered)).toBeGreaterThan(0);
    }
  });
});

describe("catalog summary: price range label", () => {
  it("formats both bounds as whole rupees", () => {
    expect(priceRangeLabel(4500, 12000)).toBe("₹4,500 – ₹12,000");
  });

  it("describes a one-sided bound in words rather than leaving a blank side", () => {
    expect(priceRangeLabel(6000, undefined)).toBe("₹6,000 and above");
    expect(priceRangeLabel(undefined, 5000)).toBe("Up to ₹5,000");
  });

  it("returns nothing when there is no price filter, so no empty chip is rendered", () => {
    expect(priceRangeLabel(undefined, undefined)).toBe("");
  });

  it("keeps a zero bound, which is a real value and not an absent one", () => {
    expect(priceRangeLabel(0, undefined)).toBe("₹0 and above");
  });
});