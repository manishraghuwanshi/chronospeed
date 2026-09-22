import { connection } from "next/server";
import { Suspense } from "react";

import { getActiveProductCount } from "@/lib/dal/catalog";
import { logger } from "@/lib/logger";

/**
 * Proves the read path end to end:
 * Server Component → DAL (`lib/dal/catalog`) → Drizzle → Neon.
 *
 * Two properties matter here and are the point of the component:
 * 1. the database is only ever reached through the DAL — this module imports no
 *    Drizzle, no schema, and no connection string;
 * 2. a database failure degrades the section instead of breaking the page. The
 *    driver's error is logged server-side and never reaches the browser
 *    (`docs/security-plan.md` §12).
 *
 * `connection()` marks this section as request-time. That matters twice: the count
 * must reflect live catalogue state rather than being frozen into a prerendered
 * shell, and a production build must not require database credentials. Next.js
 * prerenders the surrounding shell and streams this section per request.
 */

async function ActiveProductCount() {
  await connection();

  let total: number;

  try {
    total = await getActiveProductCount();
  } catch (error) {
    logger.error("catalog.count.failed", { error });

    return (
      <div className="rounded-md border border-border bg-surface p-4">
        <p className="text-sm text-muted-foreground">
          The catalogue is temporarily unavailable. Please try again shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="font-mono text-3xl tracking-tight">{total}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {total === 1 ? "active watch" : "active watches"} currently published in the shared catalogue
      </p>
    </div>
  );
}

function CountSkeleton() {
  return (
    <div className="animate-pulse rounded-md border border-border bg-surface p-4" aria-hidden>
      <div className="h-8 w-16 rounded-sm bg-surface-muted" />
      <div className="mt-2 h-4 w-56 rounded-sm bg-surface-muted" />
    </div>
  );
}

export function CatalogStatus() {
  return (
    <section aria-labelledby="catalog-status-heading" className="flex flex-col gap-3">
      <h2 id="catalog-status-heading" className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
        Catalogue connection
      </h2>

      <Suspense fallback={<CountSkeleton />}>
        <ActiveProductCount />
      </Suspense>

      <p className="text-xs text-muted-foreground">
        Read directly from the shared Neon catalogue through the server-only data access layer. This
        application has no write access to catalogue tables.
      </p>
    </section>
  );
}