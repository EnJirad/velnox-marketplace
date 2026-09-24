/**
 * Test-facing database isolation helper.
 *
 * `bun test` auto-loads `.env`, so the production `DATABASE_URL` used to be
 * picked up by every "integration" test and the fixtures landed in production.
 * Every DB-backed test must gate on this helper instead of
 * `Boolean(process.env.DATABASE_URL)`:
 *
 *   const testFn = integrationTest;   // `test` only when a disposable test DB is configured
 *
 * Behaviour:
 *   • TEST_DATABASE_URL missing        → integration tests SKIP (never fall back to DATABASE_URL)
 *   • TEST_DATABASE_URL rejected as
 *     production / not disposable      → this module THROWS, failing the suite closed
 *   • TEST_DATABASE_URL valid          → integration tests run against it through the
 *                                        guarded pool in `backend/db/index.ts`
 *
 * Only credential-free information is ever printed.
 */
import { test } from "bun:test";
import { resolveTestDatabaseUrl, type DatabaseVerdict } from "../../db/database-guard.js";

export const testDatabase: DatabaseVerdict = resolveTestDatabaseUrl();

/** True only when a validated disposable test database is configured. */
export const hasTestDatabase = testDatabase.ok;

/** `test` when a disposable test database is available, `test.skip` otherwise. */
export const integrationTest = hasTestDatabase ? test : test.skip;

/** Returns the validated test database URL or throws with the guard's reason. */
export function requireTestDatabase(): string {
  if (!testDatabase.ok || !testDatabase.url) {
    throw new Error(`[test-db] ${testDatabase.reason}`);
  }
  return testDatabase.url;
}

declare global {
  // eslint-disable-next-line no-var
  var __velnoxTestDbBannerShown: boolean | undefined;
}

function announce(): void {
  if (globalThis.__velnoxTestDbBannerShown) return;
  globalThis.__velnoxTestDbBannerShown = true;

  if (!testDatabase.configured) {
    console.info(
      "[test-db] no TEST_DATABASE_URL → integration tests SKIPPED. " +
        "The application DATABASE_URL is ignored by the test suite; set TEST_DATABASE_URL " +
        "to a disposable database whose name contains \"test\" (for example velnox_test) to run them.",
    );
    return;
  }

  console.info(`[test-db] integration database: ${testDatabase.reason} (classification=${testDatabase.classification})`);
}

announce();

// Fail closed: a configured-but-rejected URL means the suite was pointed at a
// database it must not write to. Never silently continue.
if (testDatabase.configured && !testDatabase.ok) {
  throw new Error(
    `[test-db] refusing to run the test suite: ${testDatabase.reason}. ` +
      "Fix TEST_DATABASE_URL (or unset it to skip the integration tests); the application " +
      "DATABASE_URL is never used by the test suite.",
  );
}
