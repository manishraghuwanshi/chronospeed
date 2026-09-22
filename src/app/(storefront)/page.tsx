import type { Metadata } from "next";
import Link from "next/link";

import { CatalogStatus } from "@/components/catalog/catalog-status";
import { Container } from "@/components/ui/container";
import { SITE_NAME } from "@/lib/site";

/**
 * Foundation home page.
 *
 * This is NOT the storefront. It is the Phase 1 entry point that shows the shape of
 * the application and proves the database foundation works. The product listing,
 * detail pages, search and everything customer-facing arrive in later phases; there
 * are deliberately no product grids, carts or account links here.
 */

export const metadata: Metadata = {
  title: "Precision watches, curated",
  description: `${SITE_NAME} is being built as a customer-facing watch store on top of an existing catalogue.`,
};

const PLANNED_PHASES = [
  { phase: "2", title: "Catalogue browsing", detail: "Listings, product pages, categories, search" },
  { phase: "4", title: "Customer accounts", detail: "Registration, sign-in, sessions" },
  { phase: "6", title: "Cart", detail: "Persistent cart with server-side pricing" },
  { phase: "8", title: "Checkout & orders", detail: "Addresses, order placement, stock reservation" },
  { phase: "9", title: "Payments", detail: "Razorpay checkout with verified webhooks" },
  { phase: "10", title: "Shipping", detail: "Serviceability, tracking, delivery updates" },
] as const;

export default function HomePage() {
  return (
    <Container className="flex flex-1 flex-col gap-16 py-14 sm:py-20">
      <section className="flex max-w-2xl flex-col gap-6">
        <p className="text-xs tracking-[0.3em] text-accent uppercase">{SITE_NAME}</p>

        <h1 className="text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
          Precision watches, presented with restraint.
        </h1>

        <p className="text-base leading-7 text-muted-foreground sm:text-lg">
          A new customer-facing store is being built on the catalogue that already powers the admin
          system. The foundation is in place — the storefront itself arrives next.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/products"
            className="rounded-sm bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
          >
            Browse watches
          </Link>
          <Link
            href="/about"
            className="rounded-sm border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-surface-muted"
          >
            About the store
          </Link>
        </div>
      </section>

      <CatalogStatus />

      <section aria-labelledby="roadmap-heading" className="flex flex-col gap-6">
        <h2 id="roadmap-heading" className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
          What the foundation supports next
        </h2>

        <ul className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {PLANNED_PHASES.map((item) => (
            <li key={item.phase} className="flex flex-col gap-2 bg-surface-raised p-5">
              <span className="font-mono text-xs text-accent">Phase {item.phase}</span>
              <span className="font-medium">{item.title}</span>
              <span className="text-sm text-muted-foreground">{item.detail}</span>
            </li>
          ))}
        </ul>
      </section>
    </Container>
  );
}