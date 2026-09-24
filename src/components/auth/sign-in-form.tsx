"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { FormAlert, FormField, SubmitButton } from "@/components/auth/form-field";
import { signInAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_FORM_STATE } from "@/lib/auth/form-state";

/**
 * Sign-in form.
 *
 * A Client Component for one reason only: it needs `useActionState` to render the
 * message the Server Action returns and `useFormStatus` to disable the button while
 * the request is in flight. It performs **no** authentication and holds **no**
 * credential: `signInAction` runs on the server and the session token only ever
 * arrives back as an `HttpOnly` cookie.
 *
 * The `required` attributes are browser conveniences; the action re-validates every
 * value, so a bypassed form changes nothing.
 */

function SignInButton() {
  const { pending } = useFormStatus();

  return <SubmitButton pending={pending}>Sign in</SubmitButton>;
}

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(signInAction, INITIAL_AUTH_FORM_STATE);
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.status === "error" && state.message ? <FormAlert>{state.message}</FormAlert> : null}

      <FormField
        id="sign-in-email"
        name="email"
        label="Email address"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={fieldErrors.email}
      />

      <FormField
        id="sign-in-password"
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        error={fieldErrors.password}
      />

      <SignInButton />

      <p className="text-sm text-muted-foreground">
        New to Chronospeed?{" "}
        <Link className="text-accent underline-offset-4 hover:underline" href="/register">
          Create an account
        </Link>
      </p>
    </form>
  );
}