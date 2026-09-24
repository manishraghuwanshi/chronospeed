import type { ReactNode } from "react";

/**
 * A labelled form control with inline error text.
 *
 * Presentational only — no hooks, no state — so it can be rendered from either a
 * Server or a Client Component and carries nothing that could leak into the client
 * bundle. Errors arrive as plain strings produced by the Server Action, never as a
 * raw validation object with paths and internal codes.
 *
 * `aria-describedby`/`aria-invalid` are wired here rather than at each call site, so
 * a screen reader always associates a message with the input it belongs to.
 */

interface FieldProps {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly type: "text" | "email" | "password";
  readonly autoComplete: string;
  readonly error?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly required?: boolean;
  readonly hint?: ReactNode;
}

export function FormField({
  id,
  name,
  label,
  type,
  autoComplete,
  error,
  defaultValue,
  required = false,
  hint,
}: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden className="ml-1 text-danger">
            *
          </span>
        ) : null}
      </label>

      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`rounded-sm border bg-surface-raised px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground/70 ${
          error ? "border-danger" : "border-border focus:border-accent"
        }`}
      />

      {hint ? (
        <p id={hintId} className="text-xs leading-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="text-xs leading-5 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Form-level message. `role="alert"` so a failed sign-in is announced immediately
 * rather than only being visible.
 */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-sm border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger"
    >
      {children}
    </p>
  );
}

/** Submit button that disables itself while the action is in flight. */
export function SubmitButton({
  children,
  pending,
}: {
  children: ReactNode;
  pending: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-sm bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Please wait…" : children}
    </button>
  );
}