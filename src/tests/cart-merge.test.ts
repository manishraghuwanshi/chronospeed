import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { env } from "@/config/env";
import { mergeGuestCartAfterSignIn } from "@/lib/cart/merge";
import { hashGuestCartToken } from "@/lib/cart/tokens";
import { products } from "@/lib/db/schema/catalog";
import { customers } from "@/lib/db/schema/customer";

import { seedCustomer } from "./helpers/auth";
import { applyCatalogSchema, clearCatalogData } from "./helpers/catalog-schema";
import { seedBrand, seedProduct } from "./helpers/catalog";
import {
  findCartByCustomerId,
  findCartByGuestToken,
  readCartItems,
  seedCart,
} from "./helpers/cart";
import { clearTestData, createTestDatabase, type TestDatabase } from "./helpers/db";
import { testCookieJar } from "./stubs/next-headers";

/**
 * Guest → customer merge, and ownership isolation.
 *
 * These are the security-relevant cases for Phase 4. The merge is the one place where two
 * ownership models meet, and a mistake there either loses a customer's items or — far worse —
 * hands one visitor's cart to another. So the assertions are deliberately concrete: exact
 * quantities, exact row counts, and explicit checks that a token belonging to someone else
 * resolves to nothing.
 */

describe("cart guest merge", () => {
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
    testCookieJar.reset();
  });

  async function seedWatch(slug: string, price: number, quantity = 10) {
    const brand = await seedBrand(handle, { name: `Brand ${slug}`, slug: `brand-${slug}` });

    return seedProduct(handle, {
      name: `Watch ${slug}`,
      slug,
      sku: `SKU-${slug}`,
      brandId: brand.id,
      price,
      inventory: { quantity },
    });
  }

  /** Put a raw guest token in the cookie jar, exactly as a browser would send it. */
  function putGuestCookie(rawToken: string): void {
    testCookieJar.seed(env.GUEST_CART_COOKIE_NAME, rawToken);
  }

  it("adopts a guest cart when the customer has none", async () => {
    const customer = await seedCustomer(handle);
    const watch = await seedWatch("adopt-me", 20000, 5);

    await seedCart(handle, {
      guestToken: "guest-abc",
      lines: [{ productId: watch.id, quantity: 3 }],
    });
    putGuestCookie("guest-abc");

    await mergeGuestCartAfterSignIn(customer.id);

    const customerCart = await findCartByCustomerId(handle, customer.id);

    expect(customerCart).not.toBeNull();
    expect(customerCart!.expiresAt).toBeNull();
    expect(customerCart!.guestTokenHash).toBeNull();

    const lines = await readCartItems(handle, customerCart!.id);

    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe(3);

    // The guest cookie is cleared, so the browser stops sending a dead token: expired with
    // `maxAge: 0` and the same attributes it was set with (`lib/cart/cookies.ts`).
    expect(testCookieJar.value(env.GUEST_CART_COOKIE_NAME)).toBe("");
    expect(testCookieJar.options(env.GUEST_CART_COOKIE_NAME)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  });

  it("sums quantities when both carts hold the same product", async () => {
    const customer = await seedCustomer(handle);
    const watch = await seedWatch("shared-watch", 30000, 10);

    await seedCart(handle, {
      customerId: customer.id,
      lines: [{ productId: watch.id, quantity: 2 }],
    });
    await seedCart(handle, {
      guestToken: "guest-sum",
      lines: [{ productId: watch.id, quantity: 3 }],
    });
    putGuestCookie("guest-sum");

    await mergeGuestCartAfterSignIn(customer.id);

    const customerCart = await findCartByCustomerId(handle, customer.id);
    const lines = await readCartItems(handle, customerCart!.id);

    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe(5);
  });

  it("caps the sum at availability", async () => {
    const customer = await seedCustomer(handle);
    const watch = await seedWatch("scarce-watch", 30000, 4);

    await seedCart(handle, {
      customerId: customer.id,
      lines: [{ productId: watch.id, quantity: 3 }],
    });
    await seedCart(handle, {
      guestToken: "guest-cap",
      lines: [{ productId: watch.id, quantity: 3 }],
    });
    putGuestCookie("guest-cap");

    await mergeGuestCartAfterSignIn(customer.id);

    const customerCart = await findCartByCustomerId(handle, customer.id);
    const lines = await readCartItems(handle, customerCart!.id);

    // 3 + 3 = 6, but only 4 exist.
    expect(lines[0]!.quantity).toBe(4);
  });

  it("keeps the customer's own items and adds the guest's distinct ones", async () => {
    const customer = await seedCustomer(handle);
    const customerWatch = await seedWatch("customer-watch", 10000, 5);
    const guestWatch = await seedWatch("guest-watch", 12000, 5);

    await seedCart(handle, {
      customerId: customer.id,
      lines: [{ productId: customerWatch.id, quantity: 1 }],
    });
    await seedCart(handle, {
      guestToken: "guest-distinct",
      lines: [{ productId: guestWatch.id, quantity: 2 }],
    });
    putGuestCookie("guest-distinct");

    await mergeGuestCartAfterSignIn(customer.id);

    const customerCart = await findCartByCustomerId(handle, customer.id);
    const lines = await readCartItems(handle, customerCart!.id);

    expect(lines).toHaveLength(2);
    expect(lines.find((line) => line.productId === customerWatch.id)!.quantity).toBe(1);
    expect(lines.find((line) => line.productId === guestWatch.id)!.quantity).toBe(2);
  });

  it("does not create duplicate lines when both carts hold the same product", async () => {
    const customer = await seedCustomer(handle);
    const watch = await seedWatch("dedupe-watch", 15000, 10);

    await seedCart(handle, {
      customerId: customer.id,
      lines: [{ productId: watch.id, quantity: 1 }],
    });
    await seedCart(handle, {
      guestToken: "guest-dedupe",
      lines: [{ productId: watch.id, quantity: 1 }],
    });
    putGuestCookie("guest-dedupe");

    await mergeGuestCartAfterSignIn(customer.id);

    const customerCart = await findCartByCustomerId(handle, customer.id);
    const lines = await readCartItems(handle, customerCart!.id);

    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe(2);
  });

  it("deletes the guest cart so a retry cannot merge twice", async () => {
    const customer = await seedCustomer(handle);
    const watch = await seedWatch("retry-watch", 15000, 10);

    await seedCart(handle, {
      guestToken: "guest-retry",
      lines: [{ productId: watch.id, quantity: 2 }],
    });
    putGuestCookie("guest-retry");

    await mergeGuestCartAfterSignIn(customer.id);

    const afterFirst = await findCartByCustomerId(handle, customer.id);
    const firstPass = await readCartItems(handle, afterFirst!.id);

    // A duplicated sign-in POST arrives with the same cookie value still set.
    putGuestCookie("guest-retry");
    await mergeGuestCartAfterSignIn(customer.id);

    const afterSecond = await findCartByCustomerId(handle, customer.id);
    const secondPass = await readCartItems(handle, afterSecond!.id);

    expect(firstPass[0]!.quantity).toBe(2);
    expect(secondPass[0]!.quantity).toBe(2);
    expect(await findCartByGuestToken(handle, "guest-retry")).toBeNull();
  });

  it("clears a cookie that resolves to nothing", async () => {
    const customer = await seedCustomer(handle);

    putGuestCookie("token-with-no-cart");

    await mergeGuestCartAfterSignIn(customer.id);

    expect(testCookieJar.value(env.GUEST_CART_COOKIE_NAME)).toBe("");
    expect(testCookieJar.options(env.GUEST_CART_COOKIE_NAME)).toMatchObject({ maxAge: 0 });
    expect(await findCartByCustomerId(handle, customer.id)).toBeNull();
  });

  it("clears a cookie whose cart has expired", async () => {
    const customer = await seedCustomer(handle);

    await seedCart(handle, {
      guestToken: "expired-guest",
      expiresAt: new Date(Date.now() - 60_000),
    });
    putGuestCookie("expired-guest");

    await mergeGuestCartAfterSignIn(customer.id);

    // The row is refused by the expiry rule, so the dead cookie is removed rather than
    // being sent on every subsequent request.
    expect(testCookieJar.value(env.GUEST_CART_COOKIE_NAME)).toBe("");
    expect(testCookieJar.options(env.GUEST_CART_COOKIE_NAME)).toMatchObject({ maxAge: 0 });
    expect(await findCartByCustomerId(handle, customer.id)).toBeNull();
  });

  it("does nothing when the visitor has no guest cookie", async () => {
    const customer = await seedCustomer(handle);

    await mergeGuestCartAfterSignIn(customer.id);

    expect(await findCartByCustomerId(handle, customer.id)).toBeNull();
  });

  it("drops a withdrawn product instead of carrying it into the customer cart", async () => {
    const customer = await seedCustomer(handle);
    const watch = await seedWatch("gone-watch", 9000, 5);

    await handle.db.update(products).set({ isActive: false }).where(eq(products.id, watch.id));

    await seedCart(handle, {
      guestToken: "guest-gone",
      lines: [{ productId: watch.id, quantity: 2 }],
    });
    putGuestCookie("guest-gone");

    await mergeGuestCartAfterSignIn(customer.id);

    const customerCart = await findCartByCustomerId(handle, customer.id);

    // The cart exists — the visitor is signed in and has a cart — but the unbuyable line was
    // dropped rather than carried into a cart where it could never be checked out.
    expect(customerCart).not.toBeNull();
    expect(await readCartItems(handle, customerCart!.id)).toHaveLength(0);
  });

  it("never lets one guest token resolve another guest's cart", async () => {
    const otherWatch = await seedWatch("other-guest-watch", 11000, 5);
    const mineWatch = await seedWatch("my-guest-watch", 13000, 5);

    await seedCart(handle, {
      guestToken: "guest-one",
      lines: [{ productId: otherWatch.id, quantity: 4 }],
    });
    await seedCart(handle, {
      guestToken: "guest-two",
      lines: [{ productId: mineWatch.id, quantity: 1 }],
    });

    const one = await findCartByGuestToken(handle, "guest-one");
    const two = await findCartByGuestToken(handle, "guest-two");

    expect(one!.id).not.toBe(two!.id);

    expect((await readCartItems(handle, one!.id)).map((line) => line.productId)).toEqual([
      otherWatch.id,
    ]);
    expect((await readCartItems(handle, two!.id)).map((line) => line.productId)).toEqual([
      mineWatch.id,
    ]);
  });

  it("does not treat a fabricated token as an existing cart", async () => {
    await seedCart(handle, { guestToken: "real-token" });

    expect(await findCartByGuestToken(handle, "real-token")).not.toBeNull();
    expect(await findCartByGuestToken(handle, "guessed-token")).toBeNull();
    // Handing the *digest* back as if it were the token must not work either: it is hashed
    // again, so a leaked digest cannot be replayed as a cookie value.
    expect(await findCartByGuestToken(handle, hashGuestCartToken("real-token"))).toBeNull();
  });

  it("leaves the guest cart intact when the merge cannot complete", async () => {
    const customer = await seedCustomer(handle);
    const watch = await seedWatch("failure-watch", 7000, 5);

    await seedCart(handle, {
      guestToken: "guest-failure",
      lines: [{ productId: watch.id, quantity: 2 }],
    });
    putGuestCookie("guest-failure");

    // The account disappears mid-flow, so the merge's transaction cannot finish.
    await handle.db.delete(customers).where(eq(customers.id, customer.id));

    await mergeGuestCartAfterSignIn(customer.id);

    // The guest cart survives and the cookie is *not* cleared, so a later sign-in can still
    // recover the items instead of losing them.
    expect(await findCartByGuestToken(handle, "guest-failure")).not.toBeNull();
    expect(testCookieJar.value(env.GUEST_CART_COOKIE_NAME)).toBe("guest-failure");
  });
});