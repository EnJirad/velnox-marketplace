/**
 * Shared fixture cleanup for the DB-gated integration tests.
 *
 * A plain `DELETE FROM users` only works for fixtures that created no orders
 * and never approved a verification: every FK back to `users` cascades or is
 * SET NULL EXCEPT `orders.user_id` and `seller_verifications.reviewed_by`,
 * which are ON DELETE NO ACTION. Deleting a fixture user while its order (or
 * an approval it reviewed) still exists throws 23503 — which surfaced as a
 * *failing test whose assertions had all passed*, because the error was thrown
 * from the test's own `finally` block.
 *
 * The order below is dictated by the FK graph, verified live against the
 * canonical bootstrap (`db/run-sqleditor.sql`):
 *
 *   1. the NO ACTION children of the user's orders (product_reviews, payments,
 *      refunds, commissions, vrepeat_deliveries), then the orders themselves —
 *      order_items and shipments cascade, checkout_requests and velrepeat_runs
 *      are SET NULL, so neither blocks;
 *   2. `seller_verifications.reviewed_by` is cleared, so those rows can leave
 *      with their seller (seller_verifications.seller_id → sellers CASCADE);
 *   3. the users — sellers, shops, products, inventory, seller goals,
 *      notifications, velrepeat plans, review history (reviewer_id → SET NULL)
 *      and everything else cascade from here.
 *
 * Every statement is scoped to the ids passed in: nothing test-run did not
 * create is touched. The remaining NO ACTION FKs to `users` (`media`,
 * `subscriptions`, `behavioral_events`, `platform_settings`,
 * `product_verifications`) are deliberately not handled — no fixture in this
 * suite writes them, and silently deleting them would hide a real leak.
 */
export async function purgeUsers(userIds: Array<string | null | undefined>): Promise<void> {
  const ids = userIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  const { query } = await import("../../db/index.js");

  for (const table of ["product_reviews", "payments", "refunds", "commissions", "vrepeat_deliveries"]) {
    await query(
      `DELETE FROM ${table} WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::uuid[]))`,
      [ids],
    );
  }
  await query(`DELETE FROM orders WHERE user_id = ANY($1::uuid[])`, [ids]);
  await query(`UPDATE seller_verifications SET reviewed_by = NULL WHERE reviewed_by = ANY($1::uuid[])`, [ids]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
}
