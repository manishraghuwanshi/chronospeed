import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit — Chronospeed's **own** migration lineage.
 *
 * Two lines in this file are safety controls, not preferences:
 *
 * 1. `schema` lists **only Chronospeed-owned tables**. `./schema/catalog.ts` must
 *    never be added here. It mirrors admin-owned tables (`products`, `brands`,
 *    `categories`, `inventory`, …) for read-only typing; if it were in this list,
 *    `drizzle-kit generate` would emit `CREATE TABLE` for the shared catalog and a
 *    later `push`/`migrate` could attempt to create or alter tables owned by
 *    `admin-backend` (`docs/database-plan.md` §7). Add a file here only when it
 *    declares a table Chronospeed creates and owns.
 * 2. `migrations.table` gives this lineage its **own journal**. The default is
 *    `drizzle.__drizzle_migrations`, which `admin-backend` already uses; sharing it
 *    would let one application's migration timestamps decide whether the other's
 *    migrations are applied.
 *
 * `drizzle-kit generate` only diffs this schema against the snapshots in
 * `./drizzle/` and writes SQL — it never connects to the database. `push` and
 * `migrate` do, which is why `DATABASE_URL` is loaded from the local env files.
 */

loadEnv({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  dialect: "postgresql",

  // Chronospeed-owned tables only. Never add a catalog mirror here.
  schema: ["./src/lib/db/schema/customer.ts"],

  out: "./drizzle",

  migrations: {
    // Kept separate from admin-backend's `__drizzle_migrations`.
    table: "chronospeed_migrations",
    schema: "drizzle",
    prefix: "index",
  },

  dbCredentials: {
    // Empty when unset; only the commands that connect require a real value.
    url: process.env.DATABASE_URL ?? "",
  },
});