/**
 * Public, client-safe configuration.
 *
 * Contains only values that are safe to ship to a browser, and no Zod dependency —
 * this module may be imported from a Client Component, and Phase 1 does not need to
 * pay for a validator in the browser bundle.
 *
 * `NEXT_PUBLIC_SITE_URL` is inlined by Next.js at build time from `.env*` (see the
 * Next.js environment-variables guide), so this is the one place a public value is
 * read. It deliberately has a default: a missing site URL must never break a build.
 *
 * Rule: nothing secret may ever be added here. Server secrets live in
 * `src/config/env.ts`, which is guarded by `server-only`.
 */

const DEFAULT_SITE_URL = "http://localhost:3000";

function normalizeSiteUrl(value: string | undefined): string {
  const raw = value?.trim();

  if (!raw) {
    return DEFAULT_SITE_URL;
  }

  try {
    const parsed = new URL(raw);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return DEFAULT_SITE_URL;
    }

    // Absolute origin only: a path or query here would corrupt canonical URLs.
    return parsed.origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

/** Absolute site origin without a trailing slash, e.g. `https://chronospeed.example`. */
export const siteUrl: string = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);