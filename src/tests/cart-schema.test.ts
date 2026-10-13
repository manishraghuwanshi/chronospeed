import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { cartItems, carts } from "@/lib/db/schema/cart";
import { customers } from "@/lib/db/schema/customer";

import { seedCustomer } from "./helpers/auth";
import { clearCatalogData, applyCatalogSchema } from "./helpers/catalog-schema";
import { seedBrand, seedProduct } from "./helpers/catalog";
import {
  findCartByCustomerId,
  findCartByGuestToken,
  readCartItems,
  seedCart,
} from "./helpers/cart";
import { clearTestData, createTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * Cart schema invariants, asserted against the real migration.
 *
 * These cases exist because every one of them is a rule the *application* also relies on. A
 * constraint that silently stopped being applied — a migration edited by hand, a column made
 * nullable, an index dropped — would not fail a single behavioural test while quietly making an
 * invariant unenforceable. Asserting that the database refuses the bad state is what keeps the
 * guarantee real rather than conventional.
 *
 * `createTestDatabase()` applies this repository's actual `drizzle/*.sql` files, so the DDL
 * under test is byte-for-byte the DDL that would reach Neon.
 */

describe("cart schema", () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
    await applyCatalogSchema(handle);
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await clearTestData(handle);
    await clearCatalogData(handle);
  });

  it("rejects a cart that is both a customer cart and a guest cart", async () => {
    const customer = await seedCustomer(handle);

    await expect(
      handle.client.exec(
        `INSERT INTO "carts" ("customer_id", "guest_token_hash", "expires_at")
         VALUES ('${customer.id}', 'digest', now() + interval '1 day');`,
      ),
    ).rejects.toThrow();
  });

  it("rejects a cart with no owner at all", async () => {
    await expect(
      handle.client.exec(
        `INSERT INTO "carts" ("customer_id", "guest_token_hash", "expires_at")
         VALUES (NULL, NULL, NULL);`,
      ),
    ).rejects.toThrow();
  });

  it("rejects a guest cart without an expiry", async () => {
    // This is the rule that stops an anonymous cart living forever by omission.
    await expect(
      handle.client.exec(
        `INSERT INTO "carts" ("customer_id", "guest_token_hash", "expires_at")
         VALUES (NULL, 'guest-digest', NULL);`,
      ),
    ).rejects.toThrow();
  });

  it("rejects a customer cart that carries an expiry", async () => {
    const customer = await seedCustomer(handle);

    await expect(
      handle.client.exec(
        `INSERT INTO "carts" ("customer_id", "guest_token_hash", "expires_at")
         VALUES ('${customer.id}', NULL, now() + interval '1 day');`,
      ),
    ).rejects.toThrow();
  });

  it("allows a customer cart with no expiry and a guest cart with one", async () => {
    const customer = await seedCustomer(handle);

    const customerCart = await seedCart(handle, { customerId: customer.id });
    const guestCart = await seedCart(handle, { guestToken: "guest-token-1" });

    expect(customerCart.expiresAt).toBeNull();
    expect(guestCart.customerId).toBeNull();
    expect(guestCart.guestTokenHash).not.toBeNull();
  });

  it("allows at most one cart per customer", async () => {
    const customer = await seedCustomer(handle);

    await seedCart(handle, { customerId: customer.id });

    await expect(seedCart(handle, { customerId: customer.id })).rejects.toThrow();
  });

  it("allows at most one cart per guest token digest", async () => {
    await seedCart(handle, { guestToken: "shared-token" });

    await expect(seedCart(handle, { guestToken: "shared-token" })).rejects.toThrow();
  });

  it("stores only a digest of the guest token", async () => {
    const rawToken = "a-raw-token-that-must-not-be-stored";

    await seedCart(handle, { guestToken: rawToken });

    const cart = await findCartByGuestToken(handle, rawToken);
    const all = await handle.db.select().from(carts);

    expect(cart).not.toBeNull();
    expect(cart!.guestTokenHash).not.toBe(rawToken);
    expect(JSON.stringify(all)).not.toContain(rawToken);
  });

  it("rejects a zero or negative quantity", async () => {
    const customer = await seedCustomer(handle);
    const cart = await seedCart(handle, { customerId: customer.id });
    const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
    const product = await seedProduct(handle, {
      name: "Presage",
      slug: "presage",
      sku: "SKU-PRESAGE",
      brandId: brand.id,
      price: 45000,
    });

    for (const quantity of [0, -1]) {
      await expect(
        handle.db
          .insert(cartItems)
          .values({ cartId: cart.id, productId: product.id, quantity }),
      ).rejects.toThrow();
    }
  });

  it("allows at most one line per product per cart", async () => {
    const customer = await seedCustomer(handle);
    const cart = await seedCart(handle, { customerId: customer.id });
    const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
    const product = await seedProduct(handle, {
      name: "Presage",
      slug: "presage",
      sku: "SKU-PRESAGE",
      brandId: brand.id,
      price: 45000,
    });

    await handle.db
      .insert(cartItems)
      .values({ cartId: cart.id, productId: product.id, quantity: 1 });

    await expect(
      handle.db
        .insert(cartItems)
        .values({ cartId: cart.id, productId: product.id, quantity: 2 }),
    ).rejects.toThrow();

    expect(await readCartItems(handle, cart.id)).toHaveLength(1);
  });

  it("cascades lines when a cart is deleted", async () => {
    const customer = await seedCustomer(handle);
    const brand = await seedBrand(handle, { name: "Seiko", slug: "seiko" });
    const product = await seedProduct(handle, {
      name: "Presage",
      slug: "presage",
      sku: "SKU-PRESAGE",
      brandId: brand.id,
      price: 45000,
    });

    const cart = await seedCart(handle, {
      customerId: customer.id,
      lines: [{ productId: product.id, quantity: 2 }],
    });

    await handle.db.delete(carts).where(eq(carts.id, cart.id));

    expect(await readCartItems(handle, cart.id)).toHaveLength(0);
  });

  it("removes a customer's cart when the account is deleted", async () => {
    const customer = await seedCustomer(handle);
    const cart = await seedCart(handle, { customerId: customer.id });

    await handle.db.delete(customers).where(eq(customers.id, customer.id));

    expect(await findCartByCustomerId(handle, customer.id)).toBeNull();
    expect(await readCartItems(handle, cart.id)).toHaveLength(0);
  });
});