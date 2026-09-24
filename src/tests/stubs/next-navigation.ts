/**
 * Test stub for `next/navigation`.
 *
 * `redirect()` in a Server Action works by *throwing* a special signal that the
 * framework catches and turns into a `Location` response. A test driving the action
 * directly therefore has to be able to observe that signal, so the stub throws a
 * distinguishable error carrying the target path.
 *
 * Test-only. `next build` uses the real module.
 */

export class RedirectSignal extends Error {
  readonly destination: string;

  constructor(destination: string) {
    super(`NEXT_REDIRECT:${destination}`);
    this.name = "RedirectSignal";
    this.destination = destination;
  }
}

export function redirect(destination: string): never {
  throw new RedirectSignal(destination);
}

/** Narrows a caught value to the redirect signal, for assertions. */
export function isRedirectSignal(error: unknown): error is RedirectSignal {
  return error instanceof RedirectSignal;
}