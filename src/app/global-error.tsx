"use client";

import { useEffect } from "react";

import { Container } from "@/components/ui/container";

/**
 * Global error boundary. Catches failures in the root layout itself, so it must
 * render its own `<html>`/`<body>` and cannot rely on the layout, the header or the
 * footer. Styles still come from the global stylesheet, which Next injects.
 *
 * Same redaction rule as `error.tsx`: message content is never rendered.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[chronospeed] global error", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-surface text-foreground antialiased">
        <Container className="flex min-h-screen flex-col items-start justify-center gap-5 py-20">
          <p className="text-xs tracking-[0.3em] text-accent uppercase">Chronospeed</p>

          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            The application failed to start this page.
          </h1>

          <p className="max-w-prose text-sm leading-6 text-muted-foreground">
            Please reload the page. If the problem continues, try again in a few minutes.
          </p>

          {error.digest ? (
            <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
          ) : null}

          <button
            type="button"
            onClick={() => retry()}
            className="rounded-sm bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
          >
            Reload
          </button>
        </Container>
      </body>
    </html>
  );
}