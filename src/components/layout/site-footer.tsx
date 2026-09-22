import Link from "next/link";

import { Container } from "@/components/ui/container";
import { SITE_NAME } from "@/lib/site";

/**
 * Footer shell. Static content only — the "Watches" link points at the Phase 2
 * listing route, which is declared but not implemented, so it renders the
 * not-found page rather than pretending to be a live catalogue.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-surface-muted">
      <Container className="flex flex-col gap-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {year} {SITE_NAME}. All rights reserved.
        </p>

        <nav aria-label="Footer">
          <ul className="flex flex-wrap items-center gap-5">
            <li>
              <Link className="transition-colors hover:text-foreground" href="/products">
                Watches
              </Link>
            </li>
            <li>
              <Link className="transition-colors hover:text-foreground" href="/about">
                About
              </Link>
            </li>
          </ul>
        </nav>
      </Container>
    </footer>
  );
}