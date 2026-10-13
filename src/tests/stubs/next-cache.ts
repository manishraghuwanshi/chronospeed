/**
 * Test stub for `next/cache`.
 *
 * Two functions matter here:
 *
 * - `revalidatePath` / `revalidateTag` are no-ops that record their arguments. In a real Next
 *   request they invalidate cached segments; in a test there is no framework cache to
 *   invalidate, and a Server Action that calls them must still be directly callable. Recording
 *   the calls lets a test assert that a mutation actually invalidated the cart surfaces, which
 *   is the part a bug would silently drop.
 * - `unstable_cache` is a **passthrough**. The real implementation throws
 *   `Invariant: incrementalCache missing` outside a Next request, so without this stub any
 *   module that imports the catalogue cache could not be loaded in a test process at all. The
 *   wrapper is bypassed rather than emulated: caching is not the behaviour under test here, and
 *   a fake cache would only add a way for a test to pass for the wrong reason.
 *
 * Test-only. `next build` resolves the real module.
 */

const revalidated: string[] = [];
const revalidatedTags: string[] = [];

export const testCache = {
  /** Every path passed to `revalidatePath`, in order. */
  paths(): readonly string[] {
    return revalidated;
  },

  /** Every tag passed to `revalidateTag`, in order. */
  tags(): readonly string[] {
    return revalidatedTags;
  },

  reset(): void {
    revalidated.length = 0;
    revalidatedTags.length = 0;
  },
};

export function revalidatePath(path: string): void {
  revalidated.push(path);
}

export function revalidateTag(tag: string): void {
  revalidatedTags.push(tag);
}

/** Passthrough: call the uncached function every time. */
export function unstable_cache<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return fn;
}

/** Next 16 requires a `cacheLife` argument; unused by Chronospeed, stubbed for completeness. */
export function cacheLife(): void {
  // no-op
}