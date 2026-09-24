import "server-only";

import argon2 from "argon2";

/**
 * Customer password hashing.
 *
 * `docs/security-plan.md` §3 mandates **Argon2id** — the same family the admin
 * application uses — and forbids MD5/SHA/bcrypt-only storage. The admin
 * implementation (`admin-backend/src/lib/auth/password.ts`) is deliberately not
 * copied line for line: it exports its own policy helper, whereas here the
 * password *policy* lives in the client-safe `lib/validation/auth.ts` so a form can
 * show the same rules the server enforces, and this module owns only the hashing.
 *
 * Rules:
 * - a plaintext password never leaves these three functions;
 * - a hash is produced only here and is never returned to a browser
 *   (`PublicCustomer` in `lib/types/customer.ts` has no hash field);
 * - `verifyPassword` returns `false` rather than throwing, so a malformed stored
 *   hash can never turn a failed login into a 500 or leak a driver message.
 */

/** Argon2id, library defaults for cost parameters (memory 64 MiB, time 3). */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

/**
 * Constant-time verification. Returns `false` for any failure — including a
 * malformed hash — so callers cannot distinguish "wrong password" from
 * "corrupt row" and nothing about the stored hash escapes.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * True when a stored hash was produced with weaker parameters than the current ones,
 * so the password could be re-hashed on the next successful sign-in.
 *
 * `needsRehash` accepts only cost parameters (its type is deliberately narrower than
 * `hash`'s), and `hashPassword` above uses the library defaults, so no options are
 * passed: the comparison is against exactly the defaults used to write the hash.
 */
export function passwordNeedsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash);
  } catch {
    return false;
  }
}