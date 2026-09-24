import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { env } from "@/config/env";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { generateSessionToken, hashSessionToken, sessionExpiresAt } from "@/lib/auth/tokens";
import { customerSessions, customers } from "@/lib/db/schema/customer";
import { isUniqueViolation } from "@/lib/db/errors";
import { createTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * The storage primitives the session model rests on.
 *
 * These are the properties a reviewer should be able to confirm without reading the
 * whole auth flow: passwords are Argon2id and never reversible, session tokens are
 * 256 bits of entropy stored only as a digest, and the schema itself refuses a
 * non-lower-case email or a negative failure counter.
 */

describe("auth primitives: password hashing", () => {
  it("stores an Argon2id digest, never the password", async () => {
    const password = "CorrectHorse42!";
    const hash = await hashPassword(password);

    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain(password);
    expect(await verifyPassword(hash, password)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("CorrectHorse42!");

    expect(await verifyPassword(hash, "CorrectHorse43!")).toBe(false);
  });

  it("returns false rather than throwing on a malformed stored hash", async () => {
    // A corrupt row must be a failed sign-in, not a 500 that could leak a driver
    // message or a stack trace to the browser.
    expect(await verifyPassword("not-a-hash", "whatever")).toBe(false);
    expect(await verifyPassword("", "whatever")).toBe(false);
  });
});

describe("auth primitives: session tokens", () => {
  it("generates 256 bits of hex and hashes deterministically to a digest", () => {
    const token = generateSessionToken();

    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);

    const digest = hashSessionToken(token);

    expect(digest).toHaveLength(64);
    expect(digest).not.toBe(token);
    // Deterministic: the same cookie value must resolve to the same stored row.
    expect(hashSessionToken(token)).toBe(digest);
  });

  it("never produces a reusable token", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateSessionToken()));

    expect(tokens.size).toBe(200);
  });

  it("computes an expiry in the future", () => {
    const now = Date.now();
    const expiresAt = sessionExpiresAt(30, now);

    expect(expiresAt.getTime()).toBe(now + 30 * 24 * 60 * 60 * 1000);
  });
});

describe("auth primitives: schema constraints", () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await handle.db.delete(customerSessions);
    await handle.db.delete(customers);
  });

  it("refuses a second customer with the same email", async () => {
    await handle.db.insert(customers).values({
      email: "ada@example.test",
      passwordHash: await hashPassword("CorrectHorse42!"),
    });

    const duplicate = handle.db.insert(customers).values({
      email: "ada@example.test",
      passwordHash: await hashPassword("CorrectHorse42!"),
    });

    await expect(duplicate).rejects.toSatisfy(isUniqueViolation);
  });

  it("refuses a non-lower-case email at the database level", async () => {
    // Normalization happens in `lib/validation/auth.ts`, but the CHECK constraint is
    // what makes the invariant impossible to bypass from a future code path.
    const uppercase = handle.db.insert(customers).values({
      email: "Ada@Example.test",
      passwordHash: "x",
    });

    await expect(uppercase).rejects.toThrow();
  });

  it("refuses a negative failed-login counter", async () => {
    const negative = handle.db.insert(customers).values({
      email: "ada@example.test",
      passwordHash: "x",
      failedLoginAttempts: -1,
    });

    await expect(negative).rejects.toThrow();
  });

  it("refuses a duplicate session token digest", async () => {
    const [customer] = await handle.db
      .insert(customers)
      .values({ email: "ada@example.test", passwordHash: "x" })
      .returning();

    const tokenHash = hashSessionToken(generateSessionToken());
    const expiresAt = sessionExpiresAt(30);

    await handle.db
      .insert(customerSessions)
      .values({ customerId: customer!.id, tokenHash, expiresAt });

    const duplicate = handle.db
      .insert(customerSessions)
      .values({ customerId: customer!.id, tokenHash, expiresAt });

    await expect(duplicate).rejects.toSatisfy(isUniqueViolation);
  });

  it("cascades session deletion when the customer is removed", async () => {
    const [customer] = await handle.db
      .insert(customers)
      .values({ email: "ada@example.test", passwordHash: "x" })
      .returning();

    await handle.db
      .insert(customerSessions)
      .values({
        customerId: customer!.id,
        tokenHash: hashSessionToken(generateSessionToken()),
        expiresAt: sessionExpiresAt(30),
      });

    await handle.db.delete(customers).where(eq(customers.id, customer!.id));

    expect(await handle.db.select().from(customerSessions)).toHaveLength(0);
  });

  it("uses the configured cookie name default", () => {
    expect(env.SESSION_COOKIE_NAME).toBe("cs_customer_session");
  });
});