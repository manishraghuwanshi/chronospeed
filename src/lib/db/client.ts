import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/config/env";

import * as schema from "./schema";

/**
 * The single Drizzle/Neon client for Chronospeed.
 *
 * Rules for this module:
 * - it is the **only** place a database connection is created;
 * - it is imported by `lib/dal` modules only — never by a page, layout, component,
 *   or Client Component. Route handlers and Server Actions go through the DAL;
 * - the connection is created lazily on first use, so importing this module (for
 *   example during `next build`) never opens a socket.
 */

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * An open Drizzle transaction. Phase 8 helpers that must participate in the
 * caller's transaction accept this instead of the singleton.
 */
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type SqlClient = ReturnType<typeof postgres>;

interface DatabaseClient {
  readonly sql: SqlClient;
  readonly db: Database;
}

function createClient(): DatabaseClient {
  // Configuration is read at connection time, not at module load. Next.js imports
  // the whole route graph while collecting page data during `next build`, and an
  // import-time read would force every build to carry database credentials. Reading
  // here keeps the failure where it belongs: the first query, not the build.
  const { DATABASE_MAX_CONNECTIONS, DATABASE_URL } = env;

  const sql = postgres(DATABASE_URL, {
    // Small pool on purpose: `admin-backend` uses the same database.
    max: DATABASE_MAX_CONNECTIONS,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    // Prepared statements are left at the driver default, matching the proven
    // `admin-backend` configuration against this same database.
  });

  return { sql, db: drizzle(sql, { schema }) };
}

/**
 * Cached on `globalThis` so Next.js dev-server hot reloads do not leak pools.
 */
const globalScope = globalThis as typeof globalThis & {
  chronospeedDbClient?: DatabaseClient;
};

function getClient(): DatabaseClient {
  if (!globalScope.chronospeedDbClient) {
    globalScope.chronospeedDbClient = createClient();
  }

  return globalScope.chronospeedDbClient;
}

/**
 * Relational Drizzle client.
 *
 * A proxy is used so the connection is created on first query rather than at
 * import time, while callers still write `db.select()...` as usual.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, property) {
    const target = getClient().db as unknown as Record<PropertyKey, unknown>;
    const value = target[property];

    return typeof value === "function" ? value.bind(target) : value;
  },
});

/** Closes the pool. Used by scripts and by graceful shutdown. */
export async function closeDatabase(): Promise<void> {
  const client = globalScope.chronospeedDbClient;

  if (client) {
    globalScope.chronospeedDbClient = undefined;
    await client.sql.end({ timeout: 5 });
  }
}