import Link from "next/link";

import { catalogHref, paginationItems } from "@/lib/catalog-url";
import type { AppliedCatalogQuery } from "@/lib/types/catalog";

/**
 * Pagination for the listing.
 *
 * Server-rendered anchors, not buttons: each page is a real URL that can be opened in a
 * new tab, shared, prefetched and indexed. The current page is a `<span>` with
 * `aria-current="page"` rather than a link to nowhere.
 *
 * The gap marker is an `aria-hidden` ellipsis; the navigation landmark carries
 * `aria-label`, and the previous/next controls are labelled for screen readers, so the
 * control is usable without seeing the numerals.
 */
export function CatalogPagination({
  query,
  page,
  totalPages,
}: {
  query: AppliedCatalogQuery;
  page: number;
  totalPages: number;
}) {
  const items = paginationItems(page, totalPages);

  if (items.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Catalogue pages" className="flex flex-wrap items-center gap-2">
      {page > 1 ? (
        <Link
          href={catalogHref(query, { page: page - 1 })}
          rel="prev"
          className="rounded-sm border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted"
        >
          Previous
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="rounded-sm border border-border px-3 py-1.5 text-sm text-muted-foreground/50"
        >
          Previous
        </span>
      )}

      <ul className="flex flex-wrap items-center gap-1">
        {items.map((item, index) =>
          item === null ? (
            <li key={`gap-${index}`} aria-hidden className="px-1 text-sm text-muted-foreground">
              …
            </li>
          ) : (
            <li key={item}>
              {item === page ? (
                <span
                  aria-current="page"
                  className="block rounded-sm bg-accent px-3 py-1.5 font-mono text-sm text-accent-foreground"
                >
                  {item}
                </span>
              ) : (
                <Link
                  href={catalogHref(query, { page: item })}
                  aria-label={`Page ${item}`}
                  className="block rounded-sm border border-border px-3 py-1.5 font-mono text-sm transition-colors hover:bg-surface-muted"
                >
                  {item}
                </Link>
              )}
            </li>
          ),
        )}
      </ul>

      {page < totalPages ? (
        <Link
          href={catalogHref(query, { page: page + 1 })}
          rel="next"
          className="rounded-sm border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted"
        >
          Next
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="rounded-sm border border-border px-3 py-1.5 text-sm text-muted-foreground/50"
        >
          Next
        </span>
      )}
    </nav>
  );
}