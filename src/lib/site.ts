/**
 * Site metadata shared by the root layout and the route-level metadata exports.
 *
 * Imported by Server Components (the root layout), so it reads from the public
 * config module rather than the server-only `env.ts`: Next.js validates and inlines
 * `NEXT_PUBLIC_*` values at build time, and the build must never depend on a
 * database credential being present.
 */

import { siteUrl } from "@/config/public";

export { siteUrl };

export const SITE_NAME = "Chronospeed";

export const SITE_DESCRIPTION =
  "Chronospeed — a curated store for mechanical and quartz watches from the brands we trust.";