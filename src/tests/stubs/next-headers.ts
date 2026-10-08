/**
 * Test stub for `next/headers`.
 *
 * Provides a mutable in-memory cookie jar so a Server Action can be exercised
 * directly, and records the options each `set` was called with. Recording the options
 * is the point: it lets a test assert the *security attributes* of the session cookie
 * (`HttpOnly`, `SameSite`, `Path`, `Secure`) rather than only that a value was stored.
 *
 * Test-only. `next build` uses the real module.
 */

export interface StoredCookie {
  value: string;
  options?: Record<string, unknown> | undefined;
}

const jar = new Map<string, StoredCookie>();

/**
 * An error the *next* `cookies()` access should throw, if any.
 *
 * `cookies()` is not a passive read in Next: during static generation it throws a
 * control-flow signal that tells the framework the route is dynamic. A caller that wraps a
 * cookie read in a broad `try`/`catch` swallows that signal, so a test needs a way to make
 * the read fail on demand and assert the error is not treated as a routine failure.
 */
let pendingReadError: Error | undefined;

export const testCookieJar = {
  /** Empties the jar between cases. */
  reset(): void {
    jar.clear();
    pendingReadError = undefined;
  },

  /**
   * Make the next `cookies()` access throw `error`, exactly as Next's dynamic-usage signal
   * does during static generation. Cleared by `reset()`.
   */
  failNextRead(error: Error): void {
    pendingReadError = error;
  },

  /** The raw value last written for `name`, or `undefined`. */
  value(name: string): string | undefined {
    return jar.get(name)?.value;
  },

  /** The options last written for `name`, or `undefined`. */
  options(name: string): Record<string, unknown> | undefined {
    return jar.get(name)?.options;
  },

  /** Seed a cookie as though the browser had sent it. */
  seed(name: string, value: string): void {
    jar.set(name, { value });
  },

  names(): string[] {
    return [...jar.keys()];
  },
};

export async function cookies() {
  if (pendingReadError) {
    const error = pendingReadError;

    // One-shot, like the real signal: the framework retries the render as dynamic.
    pendingReadError = undefined;

    throw error;
  }

  return {
    get(name: string): { name: string; value: string } | undefined {
      const entry = jar.get(name);

      return entry ? { name, value: entry.value } : undefined;
    },

    getAll(): { name: string; value: string }[] {
      return [...jar.entries()].map(([name, entry]) => ({ name, value: entry.value }));
    },

    has(name: string): boolean {
      return jar.has(name);
    },

    set(
      nameOrObject: string | { name: string; value: string } & Record<string, unknown>,
      value?: string,
      options?: Record<string, unknown>,
    ): void {
      if (typeof nameOrObject === "string") {
        jar.set(nameOrObject, { value: value ?? "", options });

        return;
      }

      const { name, value: objectValue, ...rest } = nameOrObject;

      jar.set(name, { value: objectValue, options: rest });
    },

    delete(name: string): void {
      jar.delete(name);
    },
  };
}

export async function headers() {
  return new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.10" });
}