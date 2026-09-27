import { formatInr } from "@/lib/money";

/**
 * How the catalogue describes its own result set.
 *
 * ## Why this is not written inline in the components
 *
 * The listing states its result count in two places — the page heading ("N watches") and,
 * when nothing matched, the empty state ("No matches"). Those two statements are about the
 * *same* number, so they must never contradict each other. They did: `totalCount` counts
 * rows **after filtering** (`lib/dal/catalog.ts`), so a filtered query with zero matches
 * reported `totalCount === 0` and the heading announced "No watches are published yet."
 * directly above an empty state that correctly said "No matches". A visitor reading only
 * the heading would conclude the shop was empty and leave, when the real cause was their
 * own price filter.
 *
 * The fix is structural rather than a reworded string in one of the two places: both
 * statements are derived here, from the same two inputs — the count and whether any filter
 * is active. Two callers, one decision, no way for them to drift again.
 *
 * ## Empty is two different facts
 *
 * "There are no watches" and "your filters matched nothing" look identical in a count but
 * mean opposite things to the person reading it, and call for opposite actions — leaving
 * the listings versus widening a filter. `filtered` is what separates them, and it is
 * passed in rather than re-derived, so the heading and the empty state cannot end up
 * disagreeing about which situation this is.
 *
 * Client-safe: pure functions over plain values, no server imports.
 */

/**
 * The heading's count line.
 *
 * `totalCount: null` means the count could not be read, which is a different statement
 * from "zero results" — the heading says so rather than showing a confident `0`.
 */
export function catalogCountLabel(totalCount: number | null, filtered: boolean): string {
  if (totalCount === null) {
    return "Showing the catalogue is temporarily unavailable.";
  }

  if (totalCount === 0) {
    return filtered ? "No watches match these filters." : "No watches are published yet.";
  }

  return totalCount === 1 ? "1 watch" : `${totalCount.toLocaleString("en-IN")} watches`;
}

/** The eyebrow and prose for the listing's empty state, which is the same two cases. */
export interface CatalogEmptyCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
}

/**
 * The empty state's copy.
 *
 * Deliberately honest about which empty this is: a storefront that always said "no results,
 * try fewer filters" on a genuinely empty catalogue would send visitors hunting for a
 * filter control that cannot help.
 *
 * The title states what to *do* rather than restating the heading verbatim. The filtered
 * case would otherwise repeat "No watches match these filters." directly beneath the
 * heading that already says it — true, but it reads like a rendering fault. "No matches"
 * records the fact; the title and the "Clear filters" control below it offer the way out.
 */
export function catalogEmptyCopy(filtered: boolean): CatalogEmptyCopy {
  return filtered
    ? {
        eyebrow: "No matches",
        title: "Adjust your filters to see more watches.",
        body: "Try removing a filter, widening the price range, or searching for a different term.",
      }
    : {
        eyebrow: "Nothing published yet",
        title: "The catalogue is empty.",
        body: "No watches are published at the moment. New stock appears here as soon as the catalogue team publishes it.",
      };
}

/**
 * A price filter as a range label, e.g. `₹4,500 – ₹12,000`.
 *
 * Rendered in the filter rail and in any future summary, so a visitor can see at a glance
 * that a price bound is what narrowed their results — the single most common reason for a
 * filtered listing coming back empty, and the hardest to spot in a URL.
 */
export function priceRangeLabel(
  minPrice: number | undefined,
  maxPrice: number | undefined,
): string {
  if (minPrice !== undefined && maxPrice !== undefined) {
    return `${formatInr(minPrice)} – ${formatInr(maxPrice)}`;
  }

  if (minPrice !== undefined) {
    return `${formatInr(minPrice)} and above`;
  }

  if (maxPrice !== undefined) {
    return `Up to ${formatInr(maxPrice)}`;
  }

  return "";
}