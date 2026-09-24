import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { Container } from "@/components/ui/container";
import { getCurrentCustomer } from "@/lib/auth/session";
import { customerDisplayName } from "@/lib/types/customer";

/**
 * Account page — the Phase 2 authenticated surface.
 *
 * Deliberately minimal. It proves the server-side authorization path end to end
 * (`requireCustomer()`-equivalent guard → DAL → database) and gives the header
 * somewhere to link, and nothing more. Order history, addresses, wishlist and profile
 * editing are later phases; there is no placeholder for them here, because an account
 * page that shows empty future sections is worse than one that shows the truth.
 *
 * The guard is `getCurrentCustomer()` plus an explicit redirect rather than an
 * exception, so an unauthenticated visitor gets the sign-in page with a `next` back
 * here. The customer's own id is resolved from the session; no identifier is read from
 * the URL or from a form.
 */

export const metadata: Metadata = {
  title: "Your account",
  description: "Your Chronospeed account.",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const customer = await getCurrentCustomer();

  if (!customer) {
    redirect("/login?next=%2Faccount");
  }

  return (
    <Container className="flex flex-1 flex-col gap-10 py-14 sm:py-20">
      <div className="flex flex-col gap-3">
        <p className="text-xs tracking-[0.3em] text-accent uppercase">Account</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {customerDisplayName(customer)}
        </h1>
        <p className="text-sm text-muted-foreground">
          Signed in with a secure server-side session. Signing out revokes it immediately.
        </p>
      </div>

      <dl className="grid max-w-2xl gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2">
        <div className="flex flex-col gap-1 bg-surface-raised p-5">
          <dt className="text-xs tracking-[0.2em] text-muted-foreground uppercase">Email</dt>
          <dd className="text-sm break-all">{customer.email}</dd>
        </div>

        <div className="flex flex-col gap-1 bg-surface-raised p-5">
          <dt className="text-xs tracking-[0.2em] text-muted-foreground uppercase">Email verified</dt>
          <dd className="text-sm">
            {customer.emailVerified
              ? "Verified"
              : "Not verified — email verification arrives in a later phase"}
          </dd>
        </div>
      </dl>

      <section className="flex max-w-2xl flex-col gap-4">
        <h2 className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
          Session
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Your session is stored as an opaque, hashed record and is sent to the browser only as an
          HttpOnly cookie, so page scripts cannot read it.
        </p>

        <div>
          <SignOutButton />
        </div>
      </section>
    </Container>
  );
}