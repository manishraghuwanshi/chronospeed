import type { ZodError } from "zod";

/**
 * The result shape a form renders, and a Server Action returns.
 *
 * Client-safe (no server imports) but never *authored* on the client: the action is
 * the only producer, so a component cannot fabricate a "signed in" state. It carries
 * display text only — no customer id, no token, no hash — which is why it is safe for
 * the value to travel back into the client component tree through `useActionState`.
 */

export type AuthFieldName = "email" | "password" | "firstName" | "lastName" | "form";

export interface AuthFormState {
  readonly status: "idle" | "error";
  /** Form-level message, shown once above the fields. */
  readonly message?: string;
  /** Per-field messages, keyed by the input `name`. */
  readonly fieldErrors?: Partial<Record<AuthFieldName, string>>;
  /**
   * Values echoed back so a failed submit does not clear what the customer typed.
   * **The password is never included.**
   */
  readonly values?: Partial<Record<"email" | "firstName" | "lastName", string>>;
}

export const INITIAL_AUTH_FORM_STATE: AuthFormState = { status: "idle" };

/**
 * Collapse a Zod error into one message per field.
 *
 * Only the first issue per field is kept: a form shows one sentence under an input,
 * and the shared schemas are written so the most useful rule is reported first.
 */
export function fieldErrorsFromZod(error: ZodError): AuthFormState["fieldErrors"] {
  const fieldErrors: Partial<Record<AuthFieldName, string>> = {};

  for (const issue of error.issues) {
    const field = (issue.path[0] ?? "form") as AuthFieldName;

    if (!fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }

  return fieldErrors;
}