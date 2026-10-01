import Link from "next/link";

import { catalogEmptyCopy } from "@/lib/catalog-summary";

/**
 * The listing's empty state.
 *
 * Two different empties, distinguished on purpose because they mean different things to a
 * visitor and require different actions:
 *
 * - **no filters applied** — the catalogue genuinely has nothing published, so the next
 *   step is to leave the listings, not to loosen a filter that was never set;
 * - **filters applied** — the query is the reason, so the action offered is to clear it.
 *
 * The distinction is also honest: a storefront that always said "no results, try fewer
 * filters" on an empty catalogue would send visitors looking for a filter control that
 * cannot help.
 *
 * The wording itself lives in `lib/catalog-summary.ts` rather than here, because the page
 * heading makes the same claim about the same result count and the two must agree.
 */
export function CatalogEmptyState({ filtered }: { filtered: boolean }) {
  const copy = catalogEmptyCopy(filtered);

  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-border bg-surface-raised p-6">
      <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">{copy.eyebrow}</p>

      <h2 className="text-lg font-medium tracking-tight">{copy.title}</h2>

      <p className="max-w-prose text-sm leading-6 text-muted-foreground">{copy.body}</p>

      {filtered ? (
        <Link
          href="/products"
          className="mt-1 rounded-sm border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-muted"
        >
          Clear filters
        </Link>
      ) : (
        <Link
          href="/"
          className="mt-1 rounded-sm border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-muted"
        >
          Back to home
        </Link>
      )}
    </div>
  );
}