import "server-only";

import { cache } from "react";

import { getLoginThrottleLimits, getSessionCookieMaxAgeSeconds, getSessionTtlMs } from "@/config/auth";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
import { evaluateLoginThrottle } from "@/lib/auth/login-throttle";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/tokens";
import { mergeGuestCartAfterSignIn } from "@/lib/cart/merge";
import {
  findActiveSessionByTokenHash,
  findCustomerCredentialsByEmail,
  findPublicCustomerById,
  insertCustomer,
  insertSession,
  recordFailedLogin,
  recordSuccessfulLogin,
  revokeSessionByTokenHash,
} from "@/lib/dal/customer";
import { ConflictError, UnauthorizedError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AuthenticatedCustomer, PublicCustomer } from "@/lib/types/customer";
import type { RegistrationInput, SignInInput } from "@/lib/validation/auth";

/**
 * Customer authentication service.
 *
 * Everything that decides identity lives here — hashing, throttle evaluation,
 * session issuance, session resolution and revocation — and nowhere else. Server
 * Actions are thin wrappers over these functions, so there is exactly one
 * implementation of each rule and no route can drift from it.
 *
 * Two properties are worth stating explicitly, because they are the whole point of
 * the module:
 *
 * 1. **Failures are uniform.** Sign-in rejects with one message whether the email is
 *    unknown, the account is disabled, the password is wrong or the throttle is
 *    active. Otherwise the login form becomes an account-enumeration oracle
 *    (`docs/security-plan.md` T-1, T-11).
 * 2. **The browser only ever receives a `PublicCustomer`** — no password hash, no
 *    session token, no internal id beyond what the account UI needs.
 */

/**
 * The single failure message for sign-in. Deliberately identical for every cause and
 * deliberately non-specific: it must not tell a caller whether the account exists,
 * is disabled, or is temporarily locked.
 */
const GENERIC_SIGN_IN_FAILURE = "Invalid email or password.";

/** The single message for a throttled attempt, for the same reason. */
const GENERIC_THROTTLED_MESSAGE = "Too many sign-in attempts. Please try again later.";

/**
 * Why an authentication attempt failed, as a fixed union rather than free text, so a
 * Server Action cannot accidentally pass a driver message through to the browser.
 */
export type AuthFailureReason =
  | "invalid_credentials"
  | "rate_limited"
  | "email_taken"
  | "unexpected";

export interface AuthSuccess {
  readonly ok: true;
  readonly customer: AuthenticatedCustomer;
}

export interface AuthFailure {
  readonly ok: false;
  readonly reason: AuthFailureReason;
  readonly message: string;
}

export type AuthResult = AuthSuccess | AuthFailure;

const invalidCredentials: AuthFailure = {
  ok: false,
  reason: "invalid_credentials",
  message: GENERIC_SIGN_IN_FAILURE,
};

const throttled: AuthFailure = {
  ok: false,
  reason: "rate_limited",
  message: GENERIC_THROTTLED_MESSAGE,
};

export interface RequestContext {
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
}

/**
 * Issue a session for a customer and set the cookie.
 *
 * The raw token is generated here, hashed for storage, and passed straight to the
 * cookie. It goes nowhere else: not into the return value, not into a log.
 */
async function startSession(
  customer: PublicCustomer,
  context: RequestContext,
): Promise<AuthenticatedCustomer> {
  const rawToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + getSessionTtlMs());

  const sessionId = await insertSession({
    customerId: customer.id,
    tokenHash: hashSessionToken(rawToken),
    expiresAt,
    userAgent: context.userAgent,
    ipAddress: context.ipAddress,
  });

  await setSessionCookie(rawToken, getSessionCookieMaxAgeSeconds());

  // Phase 4: the visitor is now authenticated, so anything they put in a guest cart while
  // signed out is moved into their customer cart before the redirect renders a page. This
  // runs *after* the session cookie is set and never throws — a cart problem must not fail a
  // sign-in (`lib/cart/merge.ts` documents the failure policy).
  await mergeGuestCartAfterSignIn(customer.id);

  return {
    ...customer,
    sessionId,
    sessionExpiresAt: expiresAt.toISOString(),
  };
}
/** Register a new customer and sign them in immediately. */
export async function registerCustomer(
  input: RegistrationInput,
  context: RequestContext,
): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);

  try {
    const customer = await insertCustomer({
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
    });

    // Registration signs the customer in, so it stamps the same fields a sign-in
    // would. Skipping this would leave `last_login_at` null on an account that is
    // demonstrably signed in, and would make the two entry points disagree.
    await recordSuccessfulLogin(customer.id, new Date());

    return { ok: true, customer: await startSession(customer, context) };
  } catch (error) {
    if (error instanceof ConflictError) {
      // The UNIQUE index rejected the insert. The message is neutral: it confirms
      // only the address the customer just typed themselves, which is unavoidable in
      // a signup form and is why it says nothing about the existing account.
      logger.info("auth.register.email_taken");

      return {
        ok: false,
        reason: "email_taken",
        message: "An account with that email address already exists.",
      };
    }

    logger.error("auth.register.failed", { error });

    return {
      ok: false,
      reason: "unexpected",
      message: "We could not create your account. Please try again.",
    };
  }
}

/** Sign a customer in with email + password, honouring the per-account throttle. */
export async function signInCustomer(
  input: SignInInput,
  context: RequestContext,
): Promise<AuthResult> {
  const limits = getLoginThrottleLimits();
  const now = new Date();

  let credentials;

  try {
    credentials = await findCustomerCredentialsByEmail(input.email);
  } catch (error) {
    logger.error("auth.sign_in.lookup_failed", { error });

    return {
      ok: false,
      reason: "unexpected",
      message: "Sign-in is temporarily unavailable. Please try again.",
    };
  }

  // Unknown or disabled account: the same generic failure as a wrong password. There
  // is no throttle state to consult for an unknown address, so nothing is written —
  // an attacker cannot grow rows or influence a real account by guessing a
  // nonexistent one.
  if (!credentials || !credentials.isActive) {
    logger.info("auth.sign_in.rejected", { reason: credentials ? "disabled" : "unknown" });

    return invalidCredentials;
  }

  // Throttle before verifying: a locked or too-soon attempt must not pay for an
  // Argon2 verification, and the decision must not depend on the password.
  const decision = evaluateLoginThrottle(
    {
      failedLoginAttempts: credentials.failedLoginAttempts,
      lastFailedLoginAt: credentials.lastFailedLoginAt,
      lockedUntil: credentials.lockedUntil,
    },
    limits,
  );

  if (!decision.allowed) {
    logger.warn("auth.sign_in.throttled", {
      reason: decision.reason,
      retryAfterSeconds: decision.retryAfterSeconds,
    });

    return throttled;
  }

  const passwordValid = await verifyPassword(credentials.passwordHash, input.password);

  if (!passwordValid) {
    const state = await recordFailedLogin(credentials.id, {
      maxFailedAttempts: limits.maxFailedAttempts,
      lockoutMs: limits.lockoutMs,
      now,
    });

    logger.warn("auth.sign_in.failed", {
      reason: "bad_password",
      // 0 here means this failure tripped the lock, since the counter restarts at 1
      // only on the next failure after the lockout expires.
      failedLoginAttempts: state.failedLoginAttempts,
    });

    return invalidCredentials;
  }

  await recordSuccessfulLogin(credentials.id, now);

  const customer = await findPublicCustomerById(credentials.id);

  if (!customer) {
    // The row was deleted between the lookup and the update. Treat it as a failed
    // sign-in rather than issuing a session for a customer that no longer exists.
    logger.warn("auth.sign_in.customer_missing");

    return invalidCredentials;
  }

  return { ok: true, customer: await startSession(customer, context) };
}

/**
 * Revoke the current session and clear the cookie.
 *
 * Revocation happens before the cookie is cleared: if the database write fails the
 * error propagates and the cookie is *not* removed, so the browser is never left
 * believing it signed out while a live session remains in the database.
 */
export async function signOutCustomer(): Promise<void> {
  const token = await readSessionCookie();

  if (token) {
    await revokeSessionByTokenHash(hashSessionToken(token), new Date());
  }

  await clearSessionCookie();
}

/**
 * Resolve the signed-in customer for the current request, or `null`.
 *
 * Wrapped in React's `cache` so the several places in one render pass that need the
 * current customer (header, account page, guards) share a single database round trip.
 * It is a per-request cache, so it cannot leak one customer's identity into another
 * request.
 *
 * A missing, expired, revoked or forged session all resolve to `null`; the caller
 * does not need to know which, and a browser must not be able to tell them apart.
 */
export const getCurrentCustomer = cache(async (): Promise<AuthenticatedCustomer | null> => {
  const token = await readSessionCookie();

  if (!token) {
    return null;
  }

  try {
    const session = await findActiveSessionByTokenHash(hashSessionToken(token), new Date());

    if (!session) {
      return null;
    }

    return {
      ...session.customer,
      sessionId: session.sessionId,
      sessionExpiresAt: session.sessionExpiresAt.toISOString(),
    };
  } catch (error) {
    // A database outage must be visible in the logs, but authorization degrades in the
    // safe direction: anonymous, never "some customer".
    logger.error("auth.session.resolve_failed", { error });

    return null;
  }
});

/**
 * Authorization helper: the signed-in customer, or a rejection.
 *
 * Every protected read or mutation calls this and then scopes its query by the
 * returned id. Identity is never taken from a parameter, a form field, a URL or a
 * cookie beyond the opaque token the server itself issued.
 */
export async function requireCustomer(): Promise<AuthenticatedCustomer> {
  const customer = await getCurrentCustomer();

  if (!customer) {
    throw new UnauthorizedError();
  }

  return customer;
}