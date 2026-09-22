/**
 * All mirrored database schema modules.
 *
 * Kept as a barrel so the Drizzle client (`../client.ts`) can hand one `schema`
 * object to the ORM, and so future phases can add `customer.ts` here without
 * touching the client. `drizzle-kit` will also read this file once a migration
 * lineage exists (Phases 2+).
 *
 * NOTE: this module deliberately does **not** import `server-only`. It contains no
 * secrets and no database access, and keeping it importable lets build-time tooling
 * (drizzle-kit, scripts) reuse the exact same definitions. Access to the database
 * itself is guarded in `../client.ts`. Do not import it from a Client Component.
 */
export * from "./catalog";