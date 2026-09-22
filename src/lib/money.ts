/**
 * Money formatting — whole currency units, exactly as stored.
 *
 * `admin-backend` stores monetary columns as **whole currency units**, not minor
 * units: an INR price of ₹12,999 is stored as `12999` (`docs/database-plan.md` §9).
 * So the integer that comes out of the database is the amount itself and must be
 * rendered as-is. This module mirrors `devzen/src/lib/money.ts` — semantics are
 * identical, which is why there is exactly one conversion here: none.
 *
 * Client-safe: no secrets, no server imports. Safe to use from Client Components.
 */

export const DEFAULT_CURRENCY = "INR";

/** Coerce anything the database hands us into a usable ISO-4217 code. */
export function normalizeCurrency(currency: string | null | undefined): string {
  const code = (currency ?? "").trim().toUpperCase();

  return /^[A-Z]{3}$/.test(code) ? code : DEFAULT_CURRENCY;
}

/**
 * Format a whole-unit amount, e.g. `formatMoney(12999, "INR")` → `₹12,999`.
 *
 * Fraction digits are pinned to zero because amounts are always integers, so a
 * trailing `.00` would be noise. Falls back to a plain string if the runtime
 * rejects the currency code, and never throws on bad input — callers can render
 * a price without guarding.
 */
export function formatMoney(amount: number, currency?: string | null): string {
  const code = normalizeCurrency(currency);

  if (!Number.isFinite(amount)) {
    return `— ${code}`;
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${code}`;
  }
}

/** Convenience wrapper for the store's only currency. */
export function formatInr(amount: number): string {
  return formatMoney(amount, DEFAULT_CURRENCY);
}