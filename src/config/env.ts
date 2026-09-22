import "server-only";

import { z } from "zod";

/**
 * Chronospeed environment configuration.
 *
 * This is the ONLY place in the application that reads `process.env` (besides the
 * documented exception in `src/lib/db/client.ts`, where Next.js inlines
 * `process.env.DATABASE_URL` into the server bundle at build time).
 *
 * Behaviour (mirrors `admin-backend/src/config/env.ts`):
 * - the schema is parsed once, at module load, and the result is frozen;
 * - a missing/invalid variable fails fast with a message listing the
 *   **variable name and reason only** — never the value, never a connection
 *   string, so secrets cannot leak through a crash log;
 * - server secrets stay server-only: `import "server-only"` makes it a build
 *   error to pull this module into a browser bundle.
 *
 * Next.js loads `.env*` files itself, so there is no `dotenv` dependency here.
 */

const NODE_ENVIRONMENTS = ["development", "test", "production"] as const;

/** Anything shorter than this cannot be a real secret. */
const MIN_SECRET_LENGTH = 32;

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(NODE_ENVIRONMENTS, {
      error: `NODE_ENV: expected one of ${NODE_ENVIRONMENTS.join(", ")}`,
    })
    .default("development"),

  /** Neon PostgreSQL connection string shared with `admin-backend` / `devzen`. */
  DATABASE_URL: z
    .url({ error: "DATABASE_URL: expected a postgres:// or postgresql:// connection string" })
    .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
      error: "DATABASE_URL: expected a postgres:// or postgresql:// connection string",
    }),

  /**
   * Maximum pooled connections held by a single Chronospeed server instance.
   * Kept small on purpose: `admin-backend` shares the same database.
   */
  DATABASE_MAX_CONNECTIONS: z.coerce
    .number({ error: "DATABASE_MAX_CONNECTIONS: expected a number" })
    .int({ error: "DATABASE_MAX_CONNECTIONS: expected an integer" })
    .min(1, { error: "DATABASE_MAX_CONNECTIONS: expected a number >= 1" })
    .max(100, { error: "DATABASE_MAX_CONNECTIONS: expected a number <= 100" })
    .default(5),

  /** Public site origin. Used for canonical URLs and metadata. */
  NEXT_PUBLIC_SITE_URL: z
    .url({ error: "NEXT_PUBLIC_SITE_URL: expected an absolute URL" })
    .default("http://localhost:3000"),

  // ---------------------------------------------------------------------------
  // Later phases. Deliberately optional in Phase 1 so the foundation builds and
  // runs without payment/shipping/email credentials, while still enforcing the
  // grouping rules below. Each phase tightens its own validation.
  // ---------------------------------------------------------------------------

  /** Phase 4 — customer session signing material. */
  AUTH_SECRET: z.string().min(MIN_SECRET_LENGTH).optional(),
  /** Phase 4 — customer session cookie name. */
  SESSION_COOKIE_NAME: z.string().min(1).optional(),

  /** Phase 9 — Razorpay. */
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),

  /** Phase 10 — Shiprocket. */
  SHIPROCKET_API_TOKEN: z.string().min(1).optional(),
  SHIPROCKET_WEBHOOK_SECRET: z.string().min(1).optional(),

  /** Phase 3 — image signing against the existing private object-storage bucket. */
  STORAGE_ENDPOINT_URL: z
    .url({ error: "STORAGE_ENDPOINT_URL: expected an absolute URL" })
    .optional(),
  STORAGE_REGION: z.string().min(1).optional(),
  STORAGE_BUCKET: z.string().min(1).optional(),
  STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce
    .number({ error: "STORAGE_SIGNED_URL_TTL_SECONDS: expected a number" })
    .int({ error: "STORAGE_SIGNED_URL_TTL_SECONDS: expected an integer" })
    .min(60, { error: "STORAGE_SIGNED_URL_TTL_SECONDS: expected a number >= 60" })
    .max(3600, { error: "STORAGE_SIGNED_URL_TTL_SECONDS: expected a number <= 3600" })
    .optional(),
});

export type Environment = z.infer<typeof environmentSchema>;

/**
 * Credentials that must be present together. Setting half of a group is always a
 * misconfiguration, so it fails loudly instead of shipping a half-wired feature.
 */
const CREDENTIAL_GROUPS: readonly (readonly [string, readonly (keyof Environment)[]])[] = [
  ["Razorpay", ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]],
  ["Shiprocket", ["SHIPROCKET_API_TOKEN", "SHIPROCKET_WEBHOOK_SECRET"]],
  [
    "Object storage",
    [
      "STORAGE_ENDPOINT_URL",
      "STORAGE_REGION",
      "STORAGE_BUCKET",
      "STORAGE_ACCESS_KEY_ID",
      "STORAGE_SECRET_ACCESS_KEY",
    ],
  ],
];

function parseEnvironment(): Environment {
  const result = environmentSchema.safeParse(process.env);

  if (!result.success) {
    // Variable names and reasons only — values are never echoed back.
    throw new Error(
      "Invalid Chronospeed environment configuration. Copy .env.example to .env.local and fill it in.\n" +
        z.prettifyError(result.error),
    );
  }

  const env: Environment = result.data;
  const problems: string[] = [];

  for (const [label, names] of CREDENTIAL_GROUPS) {
    const missing = names.filter((name) => env[name] === undefined);

    // Only complain when the group is partially configured.
    if (missing.length > 0 && missing.length < names.length) {
      problems.push(`${label}: ${missing.join(", ")} must be set together with the rest of the group`);
    }
  }

  if (env.NODE_ENV === "production" && env.NEXT_PUBLIC_SITE_URL.startsWith("http://")) {
    problems.push("NEXT_PUBLIC_SITE_URL: must use https:// in production");
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid Chronospeed environment configuration:\n${problems
        .map((problem) => `  - ${problem}`)
        .join("\n")}`,
    );
  }

  return Object.freeze(env);
}

/**
 * Validated, frozen, typed configuration. Import this instead of touching
 * `process.env` anywhere else in the application.
 *
 * Validation runs on the **first property access**, not at import time, and the
 * result is memoized. That ordering is deliberate: Next.js imports the whole route
 * graph while collecting page data during `next build`, so validating at import
 * would make every production build require database credentials, and a route that
 * never touches the database should not need them either. The first real query — in
 * dev, in `next start`, in a Server Action or a Route Handler — still fails loudly
 * and immediately if a required variable is missing.
 */
let cachedEnvironment: Environment | undefined;

function getEnvironment(): Environment {
  cachedEnvironment ??= parseEnvironment();

  return cachedEnvironment;
}

export const env: Environment = new Proxy({} as Environment, {
  get(_target, property) {
    return getEnvironment()[property as keyof Environment];
  },
  has(_target, property) {
    return property in getEnvironment();
  },
  ownKeys() {
    return Reflect.ownKeys(getEnvironment());
  },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = Object.getOwnPropertyDescriptor(
      getEnvironment(),
      property as keyof Environment,
    );

    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
});

export const isProduction = (): boolean => env.NODE_ENV === "production";
export const isDevelopment = (): boolean => env.NODE_ENV === "development";
export const isTest = (): boolean => env.NODE_ENV === "test";