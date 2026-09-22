import Link from "next/link";

import { Container } from "@/components/ui/container";

/**
 * Not-found UI. Renders inside the root layout (so the chrome is intact) and answers
 * with a 404 status for non-streamed responses.
 *
 * It is intentionally generic: it never reveals whether a missing product, category
 * or order ever existed (`docs/security-plan.md` §12).
 */
export default function NotFound() {
  return (
    <Container className="flex flex-1 flex-col items-start justify-center gap-5 py-20">
      <p className="font-mono text-xs tracking-[0.3em] text-accent uppercase">404</p>

      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Page not found</h1>

      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        The page you were looking for does not exist or has moved.
      </p>

      <Link
        href="/"
        className="rounded-sm bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
      >
        Back to home
      </Link>
    </Container>
  );
}