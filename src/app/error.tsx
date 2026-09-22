"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Container } from "@/components/ui/container";

/**
 * Route-level error boundary (Next 16 `error.tsx` convention).
 *
 * Must be a Client Component, and receives `retry` (stable as of Next 16.3) to
 * re-render the failed segment.
 *
 * Security (`docs/security-plan.md` §12): only `error.digest` — Next's opaque,
 * server-side-correlatable id — is ever shown. `error.message` is deliberately
 * never rendered: in a server error it can contain SQL, a path, or a connection
 * string. The full error is logged to the browser console for the developer only.
 */
export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[chronospeed] route error", error);
  }, [error]);

  return (
    <Container className="flex flex-1 flex-col items-start justify-center gap-5 py-20">
      <p className="text-xs tracking-[0.3em] text-accent uppercase">Unexpected error</p>

      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Something went wrong loading this page.
      </h1>

      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        The problem has been logged. You can try again, or return to the home page.
      </p>

      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-sm bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
        >
          Try again
        </button>

        <Link
          href="/"
          className="rounded-sm border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-surface-muted"
        >
          Back to home
        </Link>
      </div>
    </Container>
  );
}