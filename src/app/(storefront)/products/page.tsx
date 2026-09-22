import type { Metadata } from "next";

import { Container } from "@/components/ui/container";

/**
 * Placeholder for the Phase 2 catalogue listing.
 *
 * The route exists now so the header, the footer and the home page links resolve to
 * a real, honest page instead of a 404, and so Phase 2 has an obvious insertion
 * point. It deliberately renders no products: catalogue reads, filters, sorting and
 * pagination are Phase 2, and image delivery is Phase 3.
 */

export const metadata: Metadata = {
  title: "Watches",
  description: "Browse the Chronospeed watch catalogue.",
};

export default function ProductsPage() {
  return (
    <Container className="flex flex-1 flex-col items-start justify-center gap-5 py-20">
      <p className="text-xs tracking-[0.3em] text-accent uppercase">Catalogue</p>

      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Watches</h1>

      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        Catalogue browsing — listings, product pages, categories, filtering and search — is the next
        phase of this build. The route and the data access layer it will use are already in place.
      </p>
    </Container>
  );
}