import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { Container } from "@/components/ui/container";
import { getCurrentCustomer } from "@/lib/auth/session";
import { SITE_NAME } from "@/lib/site";
import { customerDisplayName } from "@/lib/types/customer";

/**
 * Storefront header shell, with the Phase 2 authentication state.
 *
 * Still a **Server Component**, so the signed-in customer's identity is resolved on
 * the server and only a display name reaches the browser. The account area shows one
 * of two static states:
 *
 * - anonymous → `Sign in` / `Create account` links;
 * - authenticated → the customer's name linking to `/account`, plus a sign-out form.
 *
 * Resolving the session makes the header dynamic. That is correct rather than a
 * compromise: a personalised header must not be cached across customers, and it is why
 * no `middleware`/`proxy` file exists — an optimistic cookie-presence check in a proxy
 * would only *hide* a link, never authorize anything, and the DAL is the real boundary
 * (`docs/security-plan.md` §1, `docs/architecture.md` §4.2).
 *
 * Cart, search and a mobile drawer remain absent: they belong to later phases, and
 * inert placeholders would imply functionality that does not exist.
 */

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Watches" },
  { href: "/about", label: "About" },
] as const;

export async function SiteHeader() {
  const customer = await getCurrentCustomer();

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

        <div className="flex items-center gap-3 text-sm">
          {customer ? (
            <>
              <Link
                href="/account"
                className="max-w-40 truncate font-medium text-foreground transition-colors hover:text-accent"
              >
                {customerDisplayName(customer)}
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-sm bg-accent px-3.5 py-1.5 font-medium text-accent-foreground transition-opacity hover:opacity-90"
              >
                Create account
              </Link>
            </>
          )}
        </div>
      </Container>
    </header>
  );
}