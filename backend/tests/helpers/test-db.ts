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

/**
 * Delete a fixture user and every row the schema will not cascade for it.
 *
 * Why this exists: the suites used to clean up with
 * `finally { DELETE FROM users WHERE id = $1 }`, but `orders.user_id` has no
 * `ON DELETE CASCADE`. As soon as a test created an order the delete threw, the
 * `finally` swallowed nothing, and the fixture rows survived the run — which is
 * exactly how fixture shops accumulated in the application database. Delete the
 * non-cascading children first, then the user (whose `sellers → shops →
 * products` chain does cascade).
 *
 * Safe on a disposable test database; never call it against the application one.
 */
export async function deleteFixtureUser(userId: string): Promise<void> {
  const { query } = await import("../../db/index.js");

  const ordersOfUser = "SELECT id FROM orders WHERE user_id = $1";
  const sellersOfUser = "SELECT id FROM sellers WHERE user_id = $1";
  const productsOfUser = `SELECT p.id FROM products p
                            JOIN shops sh ON sh.id = p.shop_id
                           WHERE sh.seller_id IN (${sellersOfUser})`;

  // payments / refunds / order_items reference orders without a cascade.
  await query(`DELETE FROM refunds WHERE order_id IN (${ordersOfUser})`, [userId]);
  await query(`DELETE FROM payments WHERE order_id IN (${ordersOfUser})`, [userId]);
  await query(`DELETE FROM order_items WHERE order_id IN (${ordersOfUser})`, [userId]);
  await query(`DELETE FROM orders WHERE user_id = $1`, [userId]);

  // order_items elsewhere that point at this user's fixture products.
  await query(`DELETE FROM order_items WHERE product_id IN (${productsOfUser})`, [userId]);

  // Seller- and user-scoped tables with a nullable or absent cascade rule.
  await query(`DELETE FROM commissions WHERE seller_id IN (${sellersOfUser})`, [userId]);
  await query(`DELETE FROM settlements WHERE seller_id IN (${sellersOfUser})`, [userId]);
  await query(`DELETE FROM product_reviews WHERE shop_id IN (SELECT id FROM shops WHERE seller_id IN (${sellersOfUser}))`, [
    userId,
  ]);
  await query(`DELETE FROM subscriptions WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM vrepeat_packages WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM behavioral_events WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM media WHERE uploaded_by = $1`, [userId]);

  await query(`DELETE FROM users WHERE id = $1`, [userId]);
}

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
