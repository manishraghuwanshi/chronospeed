import Link from "next/link";

import { Container } from "@/components/ui/container";
import { SITE_NAME } from "@/lib/site";

/**
 * Storefront header shell.
 *
 * Phase 1 scope: brand mark and primary navigation only. There is intentionally no
 * cart badge, account menu, search field or mobile drawer — those are Phase 3 (search),
 * Phase 4 (account) and Phase 6 (cart). Adding inert placeholders for them here would
 * imply functionality that does not exist yet.
 *
 * A Server Component: it renders from static data, so no JavaScript ships for it.
 */

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Watches" },
  { href: "/about", label: "About" },
] as const;

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface-raised/80 backdrop-blur">
      <Container className="flex h-16 items-center justify-between gap-6">
        <Link
          href="/"
          className="flex items-baseline gap-2 text-lg font-semibold tracking-[0.2em] uppercase"
        >
          {SITE_NAME}
          <span aria-hidden className="h-1 w-6 rounded-xs bg-accent" />
        </Link>

        <nav aria-label="Primary">
          <ul className="flex items-center gap-5 text-sm text-muted-foreground sm:gap-7">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link className="transition-colors hover:text-foreground" href={link.href}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </header>
  );
}