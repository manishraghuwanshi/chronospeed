import { z } from "zod";

/**
 * Shared Zod primitives.
 *
 * Client-safe: these modules contain no secrets and can be imported by Client
 * Components (they will be used by customer-facing forms from Phase 4). Phase 2+
 * adds feature-specific schemas (`catalog.ts`, `cart.ts`, ...) that build on the
 * primitives here.
 *
 * `admin-backend/src/utils/schemas.ts` is the reference implementation; the bounds
 * are deliberately identical so the two applications agree on what a valid value is.
 */

/** Same bound as `admin-backend`: an amount that survives a `number` round trip. */
export const MAX_SAFE_AMOUNT = Number.MAX_SAFE_INTEGER;

/**
 * A non-negative **whole-unit** monetary amount (₹12,999 → `12999`).
 *
 * There is no scale factor anywhere in this codebase: the number is the amount.
 */
export const amountSchema = z
  .number({ error: "Amount must be a number" })
  .int({ error: "Amount must be a whole number of currency units" })
  .min(0, { error: "Amount must not be negative" })
  .max(MAX_SAFE_AMOUNT, { error: `Amount must not exceed ${MAX_SAFE_AMOUNT}` });

/** The same rule for a query string / form field, where the value arrives as text. */
export const amountInputSchema = z.coerce
  .number({ error: "Amount must be a number" })
  .int({ error: "Amount must be a whole number of currency units" })
  .min(0, { error: "Amount must not be negative" })
  .max(MAX_SAFE_AMOUNT, { error: `Amount must not exceed ${MAX_SAFE_AMOUNT}` });

/** ISO-4217 currency code, defaulting to the only currency the store sells in. */
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, { error: "Currency must be a 3-letter ISO-4217 code" })
  .default("INR");

export const uuidSchema = z.uuid({ error: "Expected a UUID" });

/** URL-safe slug, as used by `products.slug` and `categories.slug`. */
export const slugSchema = z
  .string()
  .trim()
  .min(1, { error: "Slug must not be empty" })
  .max(220, { error: "Slug must not exceed 220 characters" })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error: "Slug may only contain lower-case letters, digits and single hyphens",
  });