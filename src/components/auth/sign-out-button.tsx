"use client";

import { useFormStatus } from "react-dom";

import { signOutAction } from "@/lib/auth/actions";

/**
 * Sign-out control.
 *
 * A **form** posting to a Server Action, not a link. Sign-out is a state change, and
 * making it a GET would let any page — or any prefetcher — end a session by embedding
 * an image or a link (the classic CSRF-by-GET). Posting to a Server Action means the
 * browser sends `POST` with the `Origin` header, which Next 16 validates against the
 * host before the action runs.
 */

function SignOutSubmit() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-sm px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <SignOutSubmit />
    </form>
  );
}