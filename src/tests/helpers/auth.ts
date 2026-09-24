import { eq } from "drizzle-orm";

import { customers } from "@/lib/db/schema/customer";
import { testCookieJar } from "@/tests/stubs/next-headers";

import type { TestDatabase } from "./db";

/**
 * Fixtures and small query helpers shared by the authentication suites.
 *
 * Everything here is test-only. Nothing asserts through the application's own
 * `toPublicCustomer` projection when checking what was *stored* — that would let a bug
 * in the projection hide a bug in the write. Reads go straight to the table.
 */

export const DEFAULT_CUSTOMER_PASSWORD = "CorrectHorse42!";

export const testCustomer = {
  email: "ada@example.test",
  firstName: "Ada",
  lastName: "Lovelace",
} as const;

/**
 * Insert a customer directly, bypassing the Server Action.
 *
 * Used to set up cases that need a pre-existing account (duplicates, sign-in, lockout)
 * without also asserting the registration path in the same test.
 */
export async function seedCustomer(
  handle: TestDatabase,
  overrides: Partial<{ email: string; passwordHash: string; isActive: boolean }> = {},
) {
  const [row] = await handle.db
    .insert(customers)
    .values({
      // Argon2id digest of `DEFAULT_CUSTOMER_PASSWORD`, produced by the application's
      // own hasher in `createCustomer` below when a real hash is needed.
      email: overrides.email ?? testCustomer.email,
      passwordHash: overrides.passwordHash ?? "unused-placeholder-hash",
      firstName: testCustomer.firstName,
      lastName: testCustomer.lastName,
      isActive: overrides.isActive ?? true,
    })
    .returning();

  return row!;
}

export async function findCustomerByEmail(handle: TestDatabase, email: string) {
  const [row] = await handle.db
    .select()
    .from(customers)
    .where(eq(customers.email, email))
    .limit(1);

  return row ?? null;
}

export async function customerCount(handle: TestDatabase): Promise<number> {
  const rows = await handle.db.select({ id: customers.id }).from(customers);

  return rows.length;
}

/**
 * Build a `FormData` for a Server Action from a plain object, dropping `undefined`
 * entries so an absent optional field looks absent rather than empty.
 */
export function formDataOf(entries: Record<string, string | undefined>): FormData {
  const formData = new FormData();

  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) {
      formData.append(key, value);
    }
  }

  return formData;
}

/** The cookie jar the `next/headers` stub exposes, reset alongside the database. */
export function resetCookieJar(): void {
  testCookieJar.reset();
}