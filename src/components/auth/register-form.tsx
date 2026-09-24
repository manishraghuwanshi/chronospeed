"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { FormAlert, FormField, SubmitButton } from "@/components/auth/form-field";
import { registerAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/lib/auth/form-state";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/auth";

/**
 * Create-account form.
 *
 * Same boundary as `SignInForm`: a Client Component only for form state, with every
 * rule enforced again by `registerAction` on the server. The password is never
 * echoed back into the DOM after a failed attempt — `state.values` deliberately does
 * not carry it — so a rejected password is retyped rather than left sitting in a
 * value attribute.
 */

function RegisterButton() {
  const { pending } = useFormStatus();

  return <SubmitButton pending={pending}>Create account</SubmitButton>;
}

export function RegisterForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(registerAction, INITIAL_AUTH_FORM_STATE);
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.status === "error" && state.message ? <FormAlert>{state.message}</FormAlert> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          id="register-first-name"
          name="firstName"
          label="First name"
          type="text"
          autoComplete="given-name"
          defaultValue={state.values?.firstName}
          error={fieldErrors.firstName}
        />

        <FormField
          id="register-last-name"
          name="lastName"
          label="Last name"
          type="text"
          autoComplete="family-name"
          defaultValue={state.values?.lastName}
          error={fieldErrors.lastName}
        />
      </div>

      <FormField
        id="register-email"
        name="email"
        label="Email address"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={fieldErrors.email}
      />

      <FormField
        id="register-password"
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        error={fieldErrors.password}
        hint={
          <>
            At least {PASSWORD_MIN_LENGTH} characters, including one letter and one number. A long
            passphrase is fine.
          </>
        }
      />

      <RegisterButton />

      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link className="text-accent underline-offset-4 hover:underline" href="/login">
          Sign in
        </Link>
      </p>
    </form>
  );
}