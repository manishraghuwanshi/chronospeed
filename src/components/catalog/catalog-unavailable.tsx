import Link from "next/link";

/**
 * Shown when the catalogue cannot be read.
 *
 * A degraded section, not a crashed page: the database error is already logged server-side
 * by the caller, and a visitor gets a truthful message plus a way to retry or leave. The
 * error's own message is never rendered — a driver message can carry a host name or a SQL
 * fragment (`docs/security-plan.md` §12).
 *
 * This mirrors the degradation already used on the home page (`CatalogStatus`), so a
 * catalogue outage looks the same everywhere in the storefront.
 */
export function CatalogUnavailable({ context }: { context: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-border bg-surface-raised p-6">
      <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">Unavailable</p>

      <h2 className="text-lg font-medium tracking-tight">The catalogue is temporarily unavailable.</h2>

      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        {context} could not be loaded just now. This is usually brief — please try again
        shortly.
      </p>

      <div className="mt-1 flex flex-wrap items-center gap-3">
        <Link
          href="/products"
          className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
        >
          Try again
        </Link>

        <Link
          href="/"
          className="rounded-sm border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-muted"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}