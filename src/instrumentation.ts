import "server-only";

import { logger } from "@/lib/logger";

/**
 * Next.js startup hook (root of `src/`, next to `app/`).
 *
 * Deliberately minimal: it runs once per server instance, before the server accepts
 * requests, and validates the environment as early as possible so a missing
 * `DATABASE_URL` fails at boot with a clear message instead of surfacing as a broken
 * page later. (Modules that read config validate on import too; this is the earliest
 * possible point.)
 *
 * It creates **no** connections and performs **no** queries — the Drizzle client is
 * lazy. Phase 13 can add OpenTelemetry registration here.
 */
export async function register(): Promise<void> {
  // Node-only: importing the Drizzle client (and therefore `postgres`) must never
  // happen in an edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  try {
    const { env } = await import("@/config/env");

    logger.info("chronospeed.startup", {
      environment: env.NODE_ENV,
      siteUrl: env.NEXT_PUBLIC_SITE_URL,
    });
  } catch (error) {
    // Misconfiguration is fatal and must stay fatal — the process refuses to start
    // rather than serving requests with a broken configuration. Logging it first
    // turns Next's generic "instrumentation hook" failure into an actionable
    // message. The error text lists variable names only, never their values.
    logger.error("chronospeed.startup.configuration_invalid", {
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}