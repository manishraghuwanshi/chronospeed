/**
 * Test stub for `server-only`.
 *
 * The real package throws on import outside a React Server Component, which is
 * exactly what we want in an application build and exactly what must not happen in a
 * plain Node test process. `vitest.config.ts` maps the specifier here instead.
 *
 * This is a test-only substitution: `next build` resolves the real package, so the
 * production guarantee ("this module cannot reach a client bundle") is untouched.
 * Nothing in this file is imported by application code.
 */
export {};