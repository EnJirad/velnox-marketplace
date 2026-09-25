/**
 * The single gate every DB-gated integration test uses.
 *
 * Replaces the previous per-file check:
 *
 *     const hasDb = Boolean(process.env.DATABASE_URL);
 *     const testFn = hasDb ? test : test.skip;
 *
 * That check was the root cause of the test fixtures (`so-test-*`, `inv-test-*`,
 * `inv-cancel-*`, `inv-paid-*`, `*@test.local` users → sellers → shops →
 * products → orders) appearing in production: `DATABASE_URL` in this repository
 * *is* the production Neon connection string, so on any machine carrying it the
 * gate was simply `true` and the suite wrote live rows.
 *
 * `hasTestDatabase()` is now driven by `decideTestDatabase()` in
 * `backend/db/test-database.ts`, which:
 *
 *   • prefers the explicit `TEST_DATABASE_URL`;
 *   • returns `false` — never a fallback — when the only configured database
 *     looks like production;
 *   • can never report an available database that `backend/db/index.ts` would
 *     then refuse to connect to, because both read the same decision.
 *
 * A dangerous configuration never reaches here as "available": it is `fatal`,
 * and the pool factory plus the `bun test` preload (`backend/tests/setup.ts`)
 * have already aborted the run.
 */
import { assertTestDatabaseIsSafe, decideTestDatabase } from "../../db/test-database.js";

// Fail fast, at import time, for every DB-gated test file.
//
// This is deliberately at module scope: importing the gate is the first thing a
// DB-gated test does, so an unsafe configuration aborts that file before any
// `beforeAll`, fixture insert, or pool connection can run. It is the
// cwd-independent half of the guard — `bun run test` uses the root
// `bunfig.toml` preload, while `cd backend && bun test tests` relies on this.
// A safe-but-absent configuration does NOT throw here; those tests skip.
assertTestDatabaseIsSafe();

/**
 * True only when a non-production database is configured for tests.
 * Safe to call at module scope: it never throws and never connects.
 */
export function hasTestDatabase(): boolean {
  return decideTestDatabase().available;
}

/**
 * The safe target description (`host/database`) for logging, or null when no
 * test database is configured. Never contains credentials.
 */
export function testDatabaseLabel(): string | null {
  const decision = decideTestDatabase();
  if (!decision.available || !decision.target) return null;
  return `${decision.target.host}/${decision.target.database || "(default)"} (${decision.source})`;
}
