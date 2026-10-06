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
 *      refunds, commissions, vrepeat_deliveries, payment_incidents), then the
 *      orders themselves — order_items and shipments cascade,
 *      checkout_requests and velrepeat_runs are SET NULL, so neither blocks;
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
 *
 * `payment_incidents` joined this list with audit HIGH #5 (2026-09-29). It is
 * a NO ACTION child of `orders`, and it is written AUTOMATICALLY by the
 * webhook whenever money arrives that cannot be settled — so it is not
 * something a fixture opts into: any suite whose scenario reaches a late
 * payment produces one, and without this the `DELETE FROM orders` below
 * throws 23503 from the test's own `finally` block, which surfaces as a
 * failing test whose assertions had all passed.
 */
export async function purgeUsers(userIds: Array<string | null | undefined>): Promise<void> {
  const ids = userIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  const { query } = await import("../../db/index.js");

  // `refunds` comes BEFORE `payments`, and the order is load-bearing:
  // `refunds.payment_id` is a NO ACTION child of `payments`, so deleting a payment
  // row while a refund still names it throws 23503 — which surfaced as a *failing
  // test whose assertions had all passed*, thrown from this file's own cleanup.
  for (const table of [
    "payment_incidents",
    "product_reviews",
    "refunds",
    "payments",
    "commissions",
    "vrepeat_deliveries",
  ]) {
    await query(
      `DELETE FROM ${table} WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::uuid[]))`,
      [ids],
    );
  }

  // A refund of a MULTI-SHOP purchase names the purchase, not an order: since
  // migration 055 it is stored as `order_id IS NULL, checkout_group_id = <group>`,
  // so the order_id-scoped DELETE above cannot see it, and the payments delete
  // below would then fail on `refunds_payment_id_fkey`. Scoping by `payment_id`
  // covers every group refund without depending on `refunds.checkout_group_id`
  // existing in the database under test.
  await query(
    `DELETE FROM refunds
      WHERE payment_id IN (SELECT id FROM payments
                            WHERE checkout_group_id IN (
                                    SELECT id FROM checkout_groups WHERE user_id = ANY($1::uuid[])))`,
    [ids],
  );

  // A CHECKOUT GROUP payment carries no `order_id` (it parents the whole
  // purchase), so the order_id-scoped DELETE above cannot see it — and it is a
  // NO ACTION child of `checkout_groups`, which would then block the user's
  // deletion with 23503.
  await query(
    `DELETE FROM payments
      WHERE checkout_group_id IN (SELECT id FROM checkout_groups WHERE user_id = ANY($1::uuid[]))`,
    [ids],
  );
  await query(`DELETE FROM checkout_groups WHERE user_id = ANY($1::uuid[])`, [ids]);
  await query(`DELETE FROM orders WHERE user_id = ANY($1::uuid[])`, [ids]);
  await query(`UPDATE seller_verifications SET reviewed_by = NULL WHERE reviewed_by = ANY($1::uuid[])`, [ids]);
  await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
}
