"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { fieldErrorsFromZod, type AuthFormState } from "@/lib/auth/form-state";
import { consumeRateLimit, registerRule, signInRule } from "@/lib/auth/rate-limit";
import {
  registerCustomer,
  signInCustomer,
  signOutCustomer,
  type RequestContext,
} from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { registrationSchema, signInSchema } from "@/lib/validation/auth";

/**
 * Authentication Server Actions.
 *
 * These are the *only* entry points a browser has into authentication. Each is a thin
 * adapter: read the submitted fields, re-validate them server-side, apply the
 * per-client rate limit, and delegate the decision to `./session.ts`. No rule is
 * implemented here, so there is no second copy to drift out of step.
 *
 * ## Why Server Actions rather than Route Handlers
 *
 * `docs/architecture.md` §4.2 and ADR-004 put customer mutations behind Server
 * Actions; a Route Handler would mean re-implementing CSRF protection by hand. Server
 * Actions in Next 16 are POST-only and are additionally checked against the `Origin`
 * and `Host` headers by the framework, so a browser cannot be tricked into invoking
 * one cross-site. Combined with the `SameSite=Lax` session cookie (`./cookies.ts`)
 * this is the Phase 0 CSRF position: no token machinery, no framework, and no
 * state-changing GET.
 *
 * ## What is deliberately absent
 *
 * - Client-side validation in the forms is a convenience; every value here is parsed
 *   again. A bypassed form changes nothing.
 * - No action returns credential material. Success produces a redirect, and the
 *   session token leaves the server only as an `HttpOnly` cookie.
 * - No action accepts a customer id, an email-to-look-up or a role from the client.
 */

/**
 * Optional, server-controlled redirect target after a successful sign-in.
 *
 * Validated to be a **same-origin absolute path**, so a crafted `next` value cannot
 * turn the login form into an open redirect. Anything else — a full URL, a
 * protocol-relative `//host`, a backslash trick — is discarded in favour of `/account`.
 */
function safeRedirectTarget(value: FormDataEntryValue | null): string {
  const DEFAULT_TARGET = "/account";

  if (typeof value !== "string") {
    return DEFAULT_TARGET;
  }

  const candidate = value.trim();

  // A single leading slash only: `//` and `/\` are both read as a host by browsers.
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/\\")) {
    return DEFAULT_TARGET;
  }

  if (/[\u0000-\u001f\u007f]/.test(candidate) || candidate.includes("://")) {
    return DEFAULT_TARGET;
  }

  return candidate;
}

/** The client identity the rate limiter is keyed by, plus the session's user agent. */
async function requestContext(): Promise<{ context: RequestContext; clientKey: string }> {
  const headerList = await headers();

  // `x-forwarded-for` is a comma-separated chain; the left-most entry is the client.
  // A hosting proxy is what makes this trustworthy, so it is used as a rate-limit key
  // only — never as an authorization input.
  const forwardedFor = headerList.get("x-forwarded-for");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || headerList.get("x-real-ip") || null;

  return {
    context: {
      userAgent: headerList.get("user-agent")?.slice(0, 500) ?? null,
      ipAddress: ipAddress?.slice(0, 64) ?? null,
    },
    clientKey: ipAddress ?? "unknown",
  };
}

/** Preserve what the customer typed, minus anything secret. */
function echoValues(formData: FormData, fields: readonly string[]): AuthFormState["values"] {
  const values: NonNullable<AuthFormState["values"]> = {};

  for (const field of fields) {
    const raw = formData.get(field);

    if (typeof raw === "string" && raw.length > 0) {
      values[field as keyof NonNullable<AuthFormState["values"]>] = raw.slice(0, 255);
    }
  }

  return values;
}

const registrationEcho = ["email", "firstName", "lastName"] as const;
/**
 * Create a customer account and sign in.
 *
 * Signature matches `useActionState`: `(previousState, formData)`.
 */
export async function registerAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { context, clientKey } = await requestContext();

  const limits = consumeRateLimit(registerRule, clientKey);

  if (!limits.allowed) {
    logger.warn("auth.register.rate_limited", { retryAfterSeconds: limits.retryAfterSeconds });

    return {
      status: "error",
      message: "Too many sign-up attempts. Please try again later.",
      values: echoValues(formData, registrationEcho),
    };
  }

  const parsed = registrationSchema.safeParse({
    firstName: formData.get("firstName") ?? undefined,
    lastName: formData.get("lastName") ?? undefined,
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
      values: echoValues(formData, registrationEcho),
    };
  }

  const result = await registerCustomer(parsed.data, context);

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      fieldErrors: result.reason === "email_taken" ? { email: result.message } : undefined,
      values: echoValues(formData, registrationEcho),
    };
  }

  redirect(safeRedirectTarget(formData.get("next")));
}

/** Sign in an existing customer. Signature matches `useActionState`. */
export async function signInAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { context, clientKey } = await requestContext();

  const limits = consumeRateLimit(signInRule, clientKey);

  if (!limits.allowed) {
    logger.warn("auth.sign_in.rate_limited", { retryAfterSeconds: limits.retryAfterSeconds });

    return {
      status: "error",
      message: "Too many sign-in attempts. Please try again later.",
      values: echoValues(formData, signInEcho),
    };
  }

  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    // A malformed address or an empty password is reported against the field without
    // reaching the database. A valid-looking but nonexistent address is *not*
    // distinguished here — it is handled downstream exactly like a wrong password.
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
      values: echoValues(formData, signInEcho),
    };
  }

  const result = await signInCustomer(parsed.data, context);

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      values: echoValues(formData, signInEcho),
    };
  }

  redirect(safeRedirectTarget(formData.get("next")));
}

/**
 * Sign out, then return to the home page.
 *
 * The session row is revoked before the redirect. `redirect()` is called outside any
 * `try`, so Next's own redirect signal is never swallowed by a `catch`.
 */
export async function signOutAction(): Promise<void> {
  await signOutCustomer();

  redirect("/");
}
const signInEcho = ["email"] as const;