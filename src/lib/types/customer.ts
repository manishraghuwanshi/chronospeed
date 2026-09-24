/**
 * Customer-facing contracts for authentication.
 *
 * Client-safe: no secrets, no server imports. These are the **only** customer
 * shapes that may cross the server boundary, and they are hand-written rather than
 * inferred from a Drizzle row so that:
 *
 * - `passwordHash` cannot be structurally present (it is not a field here at all,
 *   so a component can never render it even by accident);
 * - a column rename surfaces as one compile error in the DAL rather than silently
 *   changing a component's props.
 */

/** What the browser is allowed to know about the signed-in customer. */
export interface PublicCustomer {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly emailVerified: boolean;
}

/**
 * A resolved, authenticated customer plus the session it was resolved from.
 *
 * `sessionId` is an opaque row id — it is not a credential — and exists so a later
 * phase can revoke one device. The raw session token is never part of any DTO.
 */
export interface AuthenticatedCustomer extends PublicCustomer {
  readonly sessionId: string;
  readonly sessionExpiresAt: string;
}

/** Best-effort human label for a header greeting. Falls back to the email address. */
export function customerDisplayName(customer: PublicCustomer): string {
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();

  return name.length > 0 ? name : customer.email;
}