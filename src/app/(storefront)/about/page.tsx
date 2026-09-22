import type { Metadata } from "next";

import { Container } from "@/components/ui/container";
import { SITE_NAME } from "@/lib/site";

/**
 * About page. Static content for the header/footer navigation; a real marketing page
 * belongs to a later, non-functional phase.
 */

export const metadata: Metadata = {
  title: "About",
  description: `What ${SITE_NAME} is and how it is being built.`,
};

export default function AboutPage() {
  return (
    <Container className="flex flex-1 flex-col gap-6 py-20">
      <p className="text-xs tracking-[0.3em] text-accent uppercase">{SITE_NAME}</p>

      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">About the store</h1>

      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        {SITE_NAME} is a customer-facing watch store. It reads its catalogue directly from the same
        database that powers the existing administration system, so prices, stock and product data
        always come from one source of truth.
      </p>

      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        The application is being built in phases. This release is the foundation: typed configuration,
        a read-only catalogue data access layer, shared design tokens and the application shell.
        Browsing, accounts, cart, checkout, payments and shipping follow.
      </p>
    </Container>
  );
}