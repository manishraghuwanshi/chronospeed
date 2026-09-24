import { ensureTestEnv } from "./helpers/env";

/**
 * Vitest global setup (see `vitest.config.ts`).
 *
 * `ensureTestEnv()` runs at the very top of the module graph, before the test file's
 * imports are evaluated, because `src/config/env.ts` snapshots `process.env` the first
 * time a value is read. Importing any application module first would freeze the wrong
 * configuration in place.
 */
ensureTestEnv();