import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { inventory, products } from "@/lib/db/schema/catalog";
import {
  findCartForCustomer,
  findOrCreateCartForCustomer,
  listCartLines,
  upsertCartItemQuantity,
} from "@/lib/dal/cart";

import { seedCustomer } from "./helpers/auth";
import { applyCatalogSchema, clearCatalogData } from "./helpers/catalog-schema";
import { seedBrand, seedProduct } from "./helpers/catalog";
import { readCartItems } from "./helpers/cart";
import { clearTestData, createTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * Cart data access, against the real schema.
 *
 * The cases below are chosen for the rules that would be *expensive* to get wrong: the price
 * that must never be stored, the quantity that must never exceed stock, and the ownership scope
 * that must never match another cart's row. Anything cosmetic is left to the page.
 *
 * Note the deliberate pattern of reading the database directly for assertions rather than
 * through the function under test — an assertion that "the DAL says it saved 3" proves nothing
 * if the DAL is what is broken.
 */

describe("cart data access", () => {
  let handle: TestDatabase;
  let customerId: string;

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

    const customer = await seedCustomer(handle);
    customerId = customer.id;
  });

  /** A published product with a known price and stock level. */
  async function seedWatch(options: {
    slug: string;
    price: number;
    quantity?: number;
    reservedQuantity?: number;
    isActive?: boolean;
    brandActive?: boolean;
  }) {
    const brand = await seedBrand(handle, {
      name: `Brand ${options.slug}`,
      slug: `brand-${options.slug}`,
      isActive: options.brandActive ?? true,
    });

    return seedProduct(handle, {
      name: `Watch ${options.slug}`,
      slug: options.slug,
      sku: `SKU-${options.slug}`,
      brandId: brand.id,
      price: options.price,
      isActive: options.isActive ?? true,
      inventory: {
        quantity: options.quantity ?? 10,
        reservedQuantity: options.reservedQuantity ?? 0,
      },
    });
  }

  it("creates a cart for a customer and finds it again", async () => {
    const created = await findOrCreateCartForCustomer(customerId);
    const found = await findCartForCustomer(customerId);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.customerId).toBe(customerId);
  });

  it("returns null for a customer who has never added anything", async () => {
    expect(await findCartForCustomer(customerId)).toBeNull();
  });

  it("prices a line from the catalogue, never from the cart", async () => {
    const watch = await seedWatch({ slug: "price-check", price: 45000 });
    const cart = await findOrCreateCartForCustomer(customerId);

    await upsertCartItemQuantity(cart.id, watch.id, 2, 10);

    const [line] = await listCartLines(cart.id);

    expect(line!.unitPrice).toBe(45000);
    expect(line!.lineTotal).toBe(90000);
    expect(line!.quantity).toBe(2);
  });

  it("reflects a catalogue price change immediately", async () => {
    const watch = await seedWatch({ slug: "repriced", price: 10000 });
    const cart = await findOrCreateCartForCustomer(customerId);

    await upsertCartItemQuantity(cart.id, watch.id, 1, 10);

    // The admin corrects the price. No cart row is touched.
    await handle.db.update(products).set({ price: 12000 }).where(eq(products.id, watch.id));

    const [line] = await listCartLines(cart.id);

    expect(line!.unitPrice).toBe(12000);
    expect(line!.lineTotal).toBe(12000);
  });

  it("subtracts reserved stock from availability", async () => {
    const watch = await seedWatch({
      slug: "reserved",
      price: 5000,
      quantity: 10,
      reservedQuantity: 7,
    });
    const cart = await findOrCreateCartForCustomer(customerId);

    await upsertCartItemQuantity(cart.id, watch.id, 3, 10);

    const [line] = await listCartLines(cart.id);

    expect(line!.availableQuantity).toBe(3);
    expect(line!.exceedsStock).toBe(false);
  });

  it("clamps a write to availability and reports what it stored", async () => {
    const watch = await seedWatch({ slug: "scarce", price: 5000, quantity: 2 });
    const cart = await findOrCreateCartForCustomer(customerId);

    const written = await upsertCartItemQuantity(cart.id, watch.id, 9, 10);

    expect(written!.quantity).toBe(2);
  });

  it("clamps a write to the per-line ceiling", async () => {
    const watch = await seedWatch({ slug: "plentiful", price: 5000, quantity: 500 });
    const cart = await findOrCreateCartForCustomer(customerId);

    const written = await upsertCartItemQuantity(cart.id, watch.id, 50, 10);

    expect(written!.quantity).toBe(10);
  });

  it("stores nothing for a product with no stock", async () => {
    const watch = await seedWatch({ slug: "sold-out", price: 5000, quantity: 0 });
    const cart = await findOrCreateCartForCustomer(customerId);

    const written = await upsertCartItemQuantity(cart.id, watch.id, 1, 10);

    expect(written).toBeNull();
    expect(await readCartItems(handle, cart.id)).toHaveLength(0);
  });

  it("reports a withdrawn line rather than dropping it", async () => {
    const watch = await seedWatch({ slug: "withdrawn", price: 7000 });
    const cart = await findOrCreateCartForCustomer(customerId);

    await upsertCartItemQuantity(cart.id, watch.id, 2, 10);
    await handle.db.update(products).set({ isActive: false }).where(eq(products.id, watch.id));

    const [line] = await listCartLines(cart.id);

    expect(line).toBeDefined();
    expect(line!.isAvailable).toBe(false);
    expect(line!.lineTotal).toBe(0);
  });

  it("reports a product whose brand was deactivated as unavailable", async () => {
    const watch = await seedWatch({ slug: "brand-off", price: 7000, brandActive: false });
    const cart = await findOrCreateCartForCustomer(customerId);

    await upsertCartItemQuantity(cart.id, watch.id, 1, 10);

    const [line] = await listCartLines(cart.id);

    expect(line!.isAvailable).toBe(false);
  });

  it("marks a line that exceeds stock without hiding its price", async () => {
    const watch = await seedWatch({ slug: "shrank", price: 8000, quantity: 10 });
    const cart = await findOrCreateCartForCustomer(customerId);

    await upsertCartItemQuantity(cart.id, watch.id, 6, 10);

    // Stock falls after the customer added the item — a normal race, not an attack.
    await handle.db.update(inventory).set({ quantity: 2 }).where(eq(inventory.productId, watch.id));

    const [line] = await listCartLines(cart.id);

    expect(line!.quantity).toBe(6);
    expect(line!.availableQuantity).toBe(2);
    expect(line!.exceedsStock).toBe(true);
    // The line is still sellable in principle, so its price is still shown.
    expect(line!.lineTotal).toBe(48000);
  });
});