import "server-only";

import { count, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema/catalog";
import { DatabaseError } from "@/lib/errors";

/**
 * Data Access Layer — catalog (READ ONLY).
 *
 * This is the **only** module permitted to build catalog queries. Pages, layouts
 * and components call these functions; they never import Drizzle or the schema.
 *
 * `docs/architecture.md` §4.4 is the rule: Chronospeed reads `products`, `brands`,
 * `categories`, `product_categories`, `watch_details`, `product_images` and
 * `inventory`, and never inserts, updates or deletes any of them. There is
 * therefore no write function in this file. The single sanctioned exception in the
 * whole project is the Phase 8 inventory-reservation service, which owns its own
 * module; a catalog mutation must never appear here.
 *
 * Phase 1 intentionally ships only the read the foundation needs to prove the
 * wiring end to end. Listing, PDP, search and filtering are Phase 2.
 */

/**
 * Number of products a customer can currently see.
 *
 * `products.is_active` is the admin's published/unpublished switch, so this is the
 * catalog size the storefront will show — and the Phase 1 proof that the DAL is
 * connected to the real Neon catalog.
 */
export async function getActiveProductCount(): Promise<number> {
  try {
    const [row] = await db
      .select({ total: count() })
      .from(products)
      .where(eq(products.isActive, true));

    return row?.total ?? 0;
  } catch (error) {
    // A driver message can contain host or credential detail. Keep it in `cause`
    // for the server log; callers (and the browser) only ever see a generic error.
    throw new DatabaseError({ cause: error });
  }
}
