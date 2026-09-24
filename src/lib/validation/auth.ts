import { z } from "zod";

/**
 * Authentication input schemas (client-safe).
 *
 * Shared by the browser forms and re-parsed independently on the server. The
 * client copy is a convenience that produces an immediate message; it is never the
 * authority, because a form can be bypassed entirely. Every Server Action parses
 * the submitted values with the same schema before touching the database.
 *
 * Duplicate-detection and lookup both use the normalized form produced here
 * (`emailSchema`), so there is exactly one notion of "the same account" in the
 * codebase. No provider-specific reshaping (Gmail dot/plus folding) is applied:
 * only case and surrounding whitespace are normalized, which is the Phase 0 rule
 * (`docs/security-plan.md` §3).
 */

/** Password rules, exported so the form can state them and stay in step with the server. */
export const PASSWORD_MIN_LENGTH = 10;

/**
 * A password that is long enough and mixes letters and digits. Overly clever rules
 * are avoided on purpose: length is the dominant factor, and rejecting legitimate
 * long passphrases pushes customers toward weaker, reused ones.
 */
export const passwordSchema = z
  .string({ error: "Password is required" })
  .min(PASSWORD_MIN_LENGTH, {
    error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  })
  // An upper bound only to stop a request body from being used as a hashing bomb.
  .max(200, { error: "Password must not exceed 200 characters" })
  .refine((value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value), {
    error: "Password must contain at least one letter and one number",
  });

/**
 * Login input. Deliberately laxer than `passwordSchema`: a stored password may
 * predate a policy change, and rejecting a shape here would reveal policy detail
 * and produce a different failure than a wrong password. The only job is to hand
 * the routine a bounded string.
 */
export const signInPasswordSchema = z
  .string({ error: "Password is required" })
  .min(1, { error: "Password is required" })
  .max(200, { error: "Password must not exceed 200 characters" });

/**
 * Email address, normalized to the single canonical form used for storage,
 * duplicate detection and lookup: trimmed and lower-cased.
 *
 * The length bound is checked before the format so an oversized value fails as
 * "too long" instead of being pinned to a valid prefix.
 */
export const emailSchema = z
  .string({ error: "Email address is required" })
  .trim()
  .max(255, { error: "Email address must not exceed 255 characters" })
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address" }));

export const firstNameSchema = z
  .string()
  .trim()
  .min(1, { error: "First name must not be empty" })
  .max(80, { error: "First name must not exceed 80 characters" });

export const lastNameSchema = z
  .string()
  .trim()
  .min(1, { error: "Last name must not be empty" })
  .max(80, { error: "Last name must not exceed 80 characters" });

/** Optional fields accept an empty string from a form as "not supplied". */
const optionalText = (schema: z.ZodType<string, string>) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), schema.optional());

export const registrationSchema = z.object({
  firstName: optionalText(firstNameSchema),
  lastName: optionalText(lastNameSchema),
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  password: signInPasswordSchema,
});

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type SignInInput = z.infer<typeof signInSchema>;