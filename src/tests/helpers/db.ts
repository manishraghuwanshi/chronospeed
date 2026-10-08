import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as appSchema from "@/lib/db/schema";
import { setDbOverride, type Database } from "@/lib/db/client";

/**
 * Hermetic PostgreSQL for automated tests.
 *
 * Every test talks to an in-memory PGlite instance with **this repository's real
 * migrations** applied, so tables, indexes, checks and defaults behave like Neon while
 * no network connection is opened. The instance replaces the application client through
 * `setDbOverride()`, which the `db` proxy consults before it would lazily create the
 * real postgres.js client — so a test cannot reach Neon even by accident.
 *
 * The migrations folder is the one `drizzle-kit generate` writes, which means the SQL a
 * test runs against is byte-for-byte the SQL that would be applied to production. A
 * migration that touches a shared catalog table would therefore fail loudly here too.
 */

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../drizzle", import.meta.url));

export interface TestDatabase {
  /** The Drizzle client handed to the application through `setDbOverride()`. */
  readonly db: Database;
  /** Raw handle, for assertions that need to bypass the ORM. */
  readonly pglite: PgliteDatabase<typeof appSchema>;
  /**
   * The underlying PGlite instance.
   *
   * Exposed so a test can run DDL that this repository's migrations do not own — in
   * practice the admin-owned catalogue tables (`./catalog-schema.ts`). Drizzle's
   * `$client` exists at runtime but is not part of the typed surface.
   */
  readonly client: PGlite;
  close(): Promise<void>;
}

/** Boots a fresh, fully migrated in-memory database and installs it as the app client. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const pglite = drizzle(client, { schema: appSchema });

  await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER });

  const asAppDb = pglite as unknown as Database;

  setDbOverride(asAppDb);

  return {
    db: asAppDb,
    pglite,
    client,
    async close() {
      setDbOverride(undefined);
      await client.close();
    },
  };
}

/**
 * Removes every row a test created. Called from `beforeEach` so cases stay independent
 * without paying for a fresh migration each time.
 *
 * Children are deleted before parents so the foreign keys in the real schema stay
 * satisfied, exactly as they would on Neon.
 */
export async function clearTestData(handle: TestDatabase): Promise<void> {
  // Cart rows cascade from `carts`, and `carts` cascades from `customers`, so the real
  // foreign keys stay satisfied while deleting children before parents — exactly as they
  // would on Neon.
  await handle.db.delete(appSchema.cartItems);
  await handle.db.delete(appSchema.carts);
  await handle.db.delete(appSchema.customerSessions);
  await handle.db.delete(appSchema.customers);
}