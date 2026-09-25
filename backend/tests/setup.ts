/**
 * `bun test` preload (registered in the root `bunfig.toml`).
 *
 * Runs once before any test file is loaded, so an unsafe configuration aborts
 * the whole run at startup instead of half-way through a suite that has already
 * begun writing fixtures.
 *
 * Three outcomes:
 *
 *   • `TEST_DATABASE_URL` (or a non-production `DATABASE_URL`) is configured
 *     → integration tests run; the safe target is logged as host/database only.
 *   • production is detected → `TestDatabaseRefusedError` is thrown and the run
 *     stops with `REFUSING TEST AGAINST PRODUCTION DATABASE`.
 *   • nothing is configured → a notice is printed and the DB-gated tests skip,
 *     exactly as before.
 *
 * No credentials, connection strings, or secrets are ever printed.
 */
import { assertTestDatabaseIsSafe, describeTarget } from "../db/test-database.js";

const decision = assertTestDatabaseIsSafe();

if (decision.available) {
  console.log(`[test-db] integration tests will use ${describeTarget(decision.target)} (from ${decision.source}).`);
} else {
  console.log(
    "[test-db] no test database configured — DB-gated integration tests will skip. " +
      "Set TEST_DATABASE_URL to a disposable PostgreSQL database to run them.",
  );
}
