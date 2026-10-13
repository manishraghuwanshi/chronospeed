import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { env } from "@/config/env";
import { products } from "@/lib/db/schema/catalog";

import {
  addToCartAction,
  removeCartItemAction,
  updateCartItemAction,
} from "@/lib/cart/actions";
import { INITIAL_CART_ACTION_STATE } from "@/lib/cart/form-state";
import {
  addProductToCart,
  getCartCount,
  getCartSummary,
  resolveCart,
  summariseLines,
} from "@/lib/cart/service";
import { EMPTY_CART_SUMMARY, type CartLine } from "@/lib/types/cart";
import { MAX_CART_ITEM_QUANTITY, addToCartSchema } from "@/lib/validation/cart";

import { seedCustomer } from "./helpers/auth";
import { applyCatalogSchema, clearCatalogData } from "./helpers/catalog-schema";
import { seedBrand, seedProduct } from "./helpers/catalog";
import { readCartItems, seedCart } from "./helpers/cart";
import { clearTestData, createTestDatabase, type TestDatabase } from "./helpers/db";
import { signInAs } from "./helpers/session";
import { testCookieJar } from "./stubs/next-headers";

/**
 * Cart behaviour through the public surface: the service and the Server Actions.
 *
 * The action cases are the ones that matter most, because a Server Action is a public HTTP
 * endpoint: each one must re-derive ownership on its own. These tests drive the real actions
 * with real `FormData`, so what is exercised is the path a browser actually reaches —
 * field parsing, validation, ownership resolution and the write.
 */

describe("cart service and actions", () => {
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

  function formDataOf(entries: Record<string, string>): FormData {
    const formData = new FormData();

    for (const [key, value] of Object.entries(entries)) {
      formData.append(key, value);
    }

    return formData;
  }

  describe("summariseLines", () => {
    function lineOf(overrides: Partial<CartLine>): CartLine {
      return {
        itemId: "item-1",
        productId: "product-1",
        productSlug: "watch-1",
        name: "Watch",
        brandName: "Brand",
        thumbnailUrl: null,
        unitPrice: 1000,
        compareAtPrice: null,
        currency: "INR",
        quantity: 1,
        availableQuantity: 10,
        lineTotal: 1000,
        isAvailable: true,
        exceedsStock: false,
        ...overrides,
      };
    }

    it("returns the shared empty value for no lines", () => {
      expect(summariseLines([])).toBe(EMPTY_CART_SUMMARY);
    });

    it("sums subtotal in whole units and counts units separately from lines", () => {
      const summary = summariseLines([
        lineOf({ itemId: "a", quantity: 2, lineTotal: 25998 }),
        lineOf({ itemId: "b", quantity: 3, lineTotal: 9000 }),
      ]);

      expect(summary.itemCount).toBe(2);
      expect(summary.totalQuantity).toBe(5);
      expect(summary.subtotal).toBe(34998);
      expect(summary.isEmpty).toBe(false);
    });

    it("excludes unavailable lines from the subtotal but keeps counting them", () => {
      const summary = summariseLines([
        lineOf({ itemId: "a", quantity: 1, lineTotal: 5000 }),
        lineOf({ itemId: "b", quantity: 4, lineTotal: 0, isAvailable: false }),
      ]);

      expect(summary.subtotal).toBe(5000);
      expect(summary.totalQuantity).toBe(5);
      expect(summary.hasUnavailableLines).toBe(true);
    });

    it("flags a line that exceeds stock as unavailable stock", () => {
      const summary = summariseLines([
        lineOf({ itemId: "a", quantity: 9, availableQuantity: 2, exceedsStock: true }),
      ]);

      expect(summary.hasUnavailableLines).toBe(false);
      expect(summary.lines[0]!.exceedsStock).toBe(true);
    });
  });

  describe("validation schema", () => {
    it("accepts a uuid and a bounded quantity", () => {
      const parsed = addToCartSchema.safeParse({
        productId: "6f6a1d5c-1f1e-4a4e-8a3f-0f0b1a2c3d4e",
        quantity: 3,
      });

      expect(parsed.success).toBe(true);
    });

    it("rejects a quantity above the accepted envelope", () => {
      const parsed = addToCartSchema.safeParse({
        productId: "6f6a1d5c-1f1e-4a4e-8a3f-0f0b1a2c3d4e",
        quantity: MAX_CART_ITEM_QUANTITY + 1,
      });

      expect(parsed.success).toBe(false);
    });

    it.each([0, -1, 1.5])("rejects an invalid quantity (%s)", (quantity) => {
      const parsed = addToCartSchema.safeParse({
        productId: "6f6a1d5c-1f1e-4a4e-8a3f-0f0b1a2c3d4e",
        quantity,
      });

      expect(parsed.success).toBe(false);
    });

    it("strips a client-supplied price or total rather than forwarding it", () => {
      const parsed = addToCartSchema.safeParse({
        productId: "6f6a1d5c-1f1e-4a4e-8a3f-0f0b1a2c3d4e",
        quantity: 1,
        price: 1,
        lineTotal: 1,
        cartId: "attacker-chosen",
        customerId: "attacker-chosen",
      });

      expect(parsed.success).toBe(true);
      expect(Object.keys(parsed.data!).sort()).toEqual(["productId", "quantity"]);
    });
  });

  describe("guest ownership", () => {
    it("creates a cart and a cookie on a guest's first add", async () => {
      const watch = await seedWatch("guest-first", 12000, 5);

      const outcome = await addProductToCart(watch.id, 2);

      expect(outcome).toEqual({ status: "applied", quantity: 2 });

      const token = testCookieJar.value(env.GUEST_CART_COOKIE_NAME);

      expect(token).toBeTruthy();
      // The cookie is HttpOnly, Lax and scoped to the root, exactly like the session cookie.
      expect(testCookieJar.options(env.GUEST_CART_COOKIE_NAME)).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });

      const summary = await getCartSummary();

      expect(summary.totalQuantity).toBe(2);
      expect(summary.subtotal).toBe(24000);
    });

    it("increments rather than replacing when the same product is added again", async () => {
      const watch = await seedWatch("guest-increment", 5000, 10);

      await addProductToCart(watch.id, 1);
      await addProductToCart(watch.id, 2);

      const summary = await getCartSummary();

      expect(summary.itemCount).toBe(1);
      expect(summary.totalQuantity).toBe(3);
    });

    it("reports a clamp instead of silently exceeding stock", async () => {
      const watch = await seedWatch("guest-clamp", 5000, 2);

      const outcome = await addProductToCart(watch.id, 5);

      expect(outcome).toEqual({ status: "clamped", quantity: 2, requested: 5 });
    });

    it("reports an out-of-stock product without writing a line", async () => {
      const watch = await seedWatch("guest-empty", 5000, 0);

      const outcome = await addProductToCart(watch.id, 1);

      expect(outcome).toEqual({ status: "unavailable" });

      const summary = await getCartSummary();

      expect(summary.isEmpty).toBe(true);
    });

    it("gives a fresh cart when the guest cookie has expired", async () => {
      const watch = await seedWatch("guest-expiry", 5000, 10);

      // A cart that has already expired, addressed by a token the browser still holds.
      await seedCart(handle, {
        guestToken: "expired-cookie-token",
        expiresAt: new Date(Date.now() - 1000),
      });
      testCookieJar.seed(env.GUEST_CART_COOKIE_NAME, "expired-cookie-token");

      const outcome = await addProductToCart(watch.id, 1);

      expect(outcome).toEqual({ status: "applied", quantity: 1 });

      // A new token was issued rather than the dead one being reused.
      const token = testCookieJar.value(env.GUEST_CART_COOKIE_NAME);

      expect(token).toBeTruthy();
      expect(token).not.toBe("expired-cookie-token");

      // The expired cart is untouched and its old token still resolves to nothing.
      const summary = await getCartSummary();

      expect(summary.totalQuantity).toBe(1);
    });

    it("never shows a guest cookie's cart to a signed-in customer", async () => {
      const customer = await seedCustomer(handle);
      const watch = await seedWatch("guest-not-shared", 5000, 10);

      await addProductToCart(watch.id, 3);

      const guestSummary = await getCartSummary();

      expect(guestSummary.totalQuantity).toBe(3);

      // The same browser now has a session. The guest cookie is still present, but it must be
      // ignored: without this, signing in would expose a cart that was never merged.
      await signInAs(handle, customer.id);

      const customerSummary = await getCartSummary();

      expect(customerSummary.isEmpty).toBe(true);
    });

    it("keeps two guests' carts apart", async () => {
      const watchOne = await seedWatch("guest-a", 5000, 10);
      const watchTwo = await seedWatch("guest-b", 6000, 10);

      await addProductToCart(watchOne.id, 1);

      const firstToken = testCookieJar.value(env.GUEST_CART_COOKIE_NAME)!;

      // A different browser: new jar, no session.
      testCookieJar.reset();
      await addProductToCart(watchTwo.id, 4);

      const secondToken = testCookieJar.value(env.GUEST_CART_COOKIE_NAME)!;

      expect(secondToken).not.toBe(firstToken);
      expect(await getCartCount()).toEqual({ itemCount: 1, totalQuantity: 4 });
    });
  });

  describe("customer ownership", () => {
    it("scopes the cart to the signed-in customer", async () => {
      const customer = await seedCustomer(handle);
      const watch = await seedWatch("customer-cart", 9000, 5);

      await signInAs(handle, customer.id);
      await addProductToCart(watch.id, 2);

      expect((await getCartSummary()).totalQuantity).toBe(2);

      // No guest cookie was issued: a signed-in visitor's cart is keyed by customer only.
      expect(testCookieJar.value(env.GUEST_CART_COOKIE_NAME)).toBeUndefined();
    });

    it("keeps two customers' carts apart", async () => {
      const first = await seedCustomer(handle, { email: "first@example.test" });
      const second = await seedCustomer(handle, { email: "second@example.test" });
      const watch = await seedWatch("two-customers", 9000, 10);

      await signInAs(handle, first.id);
      await addProductToCart(watch.id, 2);

      // The second customer's browser: same product, their own cart.
      testCookieJar.reset();
      await signInAs(handle, second.id);

      expect(await getCartCount()).toEqual({ itemCount: 0, totalQuantity: 0 });

      await addProductToCart(watch.id, 5);

      expect(await getCartCount()).toEqual({ itemCount: 1, totalQuantity: 5 });

      // Back to the first customer: their quantity is untouched.
      testCookieJar.reset();
      await signInAs(handle, first.id);

      expect(await getCartCount()).toEqual({ itemCount: 1, totalQuantity: 2 });
    });

    it("treats an expired session as a guest, not as the customer", async () => {
      const customer = await seedCustomer(handle);
      const watch = await seedWatch("expired-session", 9000, 5);

      await seedCart(handle, {
        customerId: customer.id,
        lines: [{ productId: watch.id, quantity: 3 }],
      });

      await signInAs(handle, customer.id, { expiresAt: new Date(Date.now() - 1000) });

      // The session is refused, so the visitor is anonymous and sees an empty cart rather
      // than the customer's.
      expect(await getCartSummary()).toMatchObject({ isEmpty: true });
    });
  });

  /**
   * `cookies()` is not a passive read during static generation: Next throws a control-flow
   * signal (an error with a `DYNAMIC_SERVER_USAGE` digest) that declares the route dynamic.
   *
   * `resolveCart` reads a session cookie and a guest cart cookie, and it degrades to "no cart"
   * on failure. Those two behaviours conflict, and the resolution matters: if the signal were
   * caught, the page would resolve to an empty cart instead of becoming dynamic, so an empty
   * cart could be cached and served to everyone. The signal must escape untouched.
   */
  describe("dynamic rendering signal", () => {
    it("propagates the dynamic-usage error from a cookie read instead of reporting an empty cart", async () => {
      const dynamicUsage = new Error(
        "Dynamic server usage: Route /cart couldn't be rendered statically because it used `cookies`.",
      );

      Object.assign(dynamicUsage, { digest: "DYNAMIC_SERVER_USAGE" });

      testCookieJar.failNextRead(dynamicUsage);

      // Identity, not a message match: the framework's own object has to come out the other
      // side for the route to be generated correctly.
      const rejection = await resolveCart().then(
        () => null,
        (error: unknown) => error,
      );

      expect(rejection).toBe(dynamicUsage);
    });
  });

  describe("server actions", () => {
    it("adds via the action", async () => {
      const watch = await seedWatch("action-add", 11000, 5);

      const state = await addToCartAction(
        INITIAL_CART_ACTION_STATE,
        formDataOf({ productId: watch.id, quantity: "2" }),
      );

      expect(state.status).toBe("success");
      expect((await getCartSummary()).totalQuantity).toBe(2);
    });

    it("rejects a malformed product id without writing anything", async () => {
      const state = await addToCartAction(
        INITIAL_CART_ACTION_STATE,
        formDataOf({ productId: "not-a-uuid", quantity: "1" }),
      );

      expect(state.status).toBe("error");
      expect(await getCartSummary()).toMatchObject({ isEmpty: true });
    });

    it("refuses an unpublished product through the action", async () => {
      const watch = await seedWatch("action-hidden", 11000, 5);

      await handle.db.update(products).set({ isActive: false }).where(eq(products.id, watch.id));

      const state = await addToCartAction(
        INITIAL_CART_ACTION_STATE,
        formDataOf({ productId: watch.id, quantity: "1" }),
      );

      expect(state.status).toBe("error");
    });

    it("updates and removes a line through the actions", async () => {
      const watch = await seedWatch("action-update", 7000, 10);

      await addToCartAction(
        INITIAL_CART_ACTION_STATE,
        formDataOf({ productId: watch.id, quantity: "1" }),
      );

      const summary = await getCartSummary();
      const itemId = summary.lines[0]!.itemId;

      const updateState = await updateCartItemAction(
        INITIAL_CART_ACTION_STATE,
        formDataOf({ itemId, quantity: "4" }),
      );

      expect(updateState.status).toBe("success");
      expect((await getCartSummary()).totalQuantity).toBe(4);

      const removeState = await removeCartItemAction(
        INITIAL_CART_ACTION_STATE,
        formDataOf({ itemId }),
      );

      expect(removeState.status).toBe("success");
      expect(await getCartSummary()).toMatchObject({ isEmpty: true });
    });

    it("refuses to update a line that belongs to another cart", async () => {
      const other = await seedCustomer(handle, { email: "other@example.test" });
      const watch = await seedWatch("action-cross-cart", 7000, 10);

      // A line belonging to a different customer.
      const otherCart = await seedCart(handle, {
        customerId: other.id,
        lines: [{ productId: watch.id, quantity: 3 }],
      });
      const otherLine = (await readCartItems(handle, otherCart.id))[0]!;

      // The caller is an anonymous visitor with their own, different cart.
      await addProductToCart(watch.id, 1);

      const state = await updateCartItemAction(
        INITIAL_CART_ACTION_STATE,
        formDataOf({ itemId: otherLine.id, quantity: "9" }),
      );

      expect(state.status).toBe("error");

      // The other customer's line is exactly as it was.
      const untouched = await readCartItems(handle, otherCart.id);

      expect(untouched).toHaveLength(1);
      expect(untouched[0]!.quantity).toBe(3);
    });

    it("refuses to remove a line that belongs to another cart", async () => {
      const other = await seedCustomer(handle, { email: "other-remove@example.test" });
      const watch = await seedWatch("action-cross-remove", 7000, 10);

      const otherCart = await seedCart(handle, {
        customerId: other.id,
        lines: [{ productId: watch.id, quantity: 3 }],
      });
      const otherLine = (await readCartItems(handle, otherCart.id))[0]!;

      const state = await removeCartItemAction(
        INITIAL_CART_ACTION_STATE,
        formDataOf({ itemId: otherLine.id }),
      );

      expect(state.status).toBe("error");
      expect(await readCartItems(handle, otherCart.id)).toHaveLength(1);
    });
  });
});