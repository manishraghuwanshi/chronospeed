import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for Chronospeed.
 *
 * Tests are hermetic. `src/tests/setup.ts` injects a self-contained environment whose
 * `DATABASE_URL` is an **inert loopback address**, so a test that accidentally used the
 * real client would fail to connect instantly instead of touching Neon. Every
 * database-backed case runs against an in-memory PGlite instance with this
 * repository's real Drizzle migrations applied.
 *
 * Three aliases exist only for the test process:
 *
 * - `server-only` → the no-op stub. That package throws by design outside a React
 *   Server Component, and a plain Node test process is not one. The marker is
 *   enforced by the Next.js build, which still sees the real package.
 * - `next/headers` / `next/navigation` → small in-memory stubs, so a Server Action can
 *   be driven directly (asserting the cookie jar and the redirect target) without an
 *   HTTP server.
 *
 * `pool: "forks"` gives each file its own process, which matters because the config
 * module caches one validated environment snapshot and the DB harness installs one
 * client override per process.
 */
const rootDir = fileURLToPath(new URL(".", import.meta.url));
const stub = (name: string) => fileURLToPath(new URL(`./src/tests/stubs/${name}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": stub("server-only.ts"),
      "next/headers": stub("next-headers.ts"),
      "next/navigation": stub("next-navigation.ts"),
      "next/cache": stub("next-cache.ts"),
    },
  },

  test: {
    root: rootDir,
    include: ["src/tests/**/*.test.ts"],
    exclude: ["src/tests/stubs/**", "node_modules/**"],
    setupFiles: ["src/tests/setup.ts"],
    environment: "node",
    globals: false,
    pool: "forks",
    maxWorkers: 1,
    isolate: true,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});