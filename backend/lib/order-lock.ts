/**
 * Order-row concurrency control — the ONE place the lock order is defined.
 *
 * WHY THIS EXISTS
 * An order's lifecycle is decided by several writers that each touch BOTH
 * `orders` and `payments`:
 *
 *   • the customer's own cancellation        (routes/cart.ts)
 *   • a settlement webhook                   (routes/stripe.ts — payment_intent.succeeded,
 *                                             checkout.session.completed / async_payment_succeeded)
 *   • a failure / provider-cancel webhook    (routes/stripe.ts — payment_intent.payment_failed,
 *                                             payment_intent.canceled, checkout.session.expired,
 *                                             checkout.session.async_payment_failed)
 *   • the payment-reservation expiry sweep    (jobs/payment-reservation-scheduler.ts)
 *   • a refund sync                          (routes/stripe.ts — syncRefundFromStripe)
 *
 * They already serialise CORRECTLY on the order row: every transition is a
 * guarded `UPDATE orders … WHERE status = ANY(…)` (or an equivalent conditional
 * claim), so under READ COMMITTED the loser blocks on the row lock and then
 * re-evaluates its WHERE clause against the committed row, matching 0 rows.
 * Exactly one writer can move an order. That is why a cancelled order can never
 * be resurrected as `paid`, and why stock can never be committed and released.
 *
 * What they did NOT share was the ORDER in which they take their locks. The
 * cancellation invalidates the abandoned payment row AFTER moving the order
 * (orders → payments); the failure/expiry webhook handlers updated the payment
 * row FIRST and the order second (payments → orders). Two transactions taking
 * the same two rows in opposite orders is a textbook AB-BA deadlock: PostgreSQL
 * detects it after `deadlock_timeout` and aborts one side, which surfaces as a
 * 500 on the customer's cancel, or as a `failed` payment event Stripe must
 * redeliver. No state is corrupted — but the outcome stops being deterministic,
 * and the losing side is decided by lock timing rather than by the business rule.
 *
 * THE RULE, THEREFORE: every transaction that writes more than one of
 * {orders, payments, refunds, order_items} takes the ORDER row lock as its
 * FIRST statement, through this function. The order row is the single
 * serialisation point for the whole order, so there is no cycle to deadlock on,
 * and the guarded UPDATE below it is evaluated against a row nobody else can
 * be moving.
 *
 * Call it INSIDE an existing `withTransaction` block (it locks a row and must be
 * released by the caller's COMMIT/ROLLBACK).
 */
import type pg from "pg";

import { coveringPaymentsPredicateForOrderId } from "./payment-attempt.js";

/** The order fields every decision in these transactions needs under the lock. */
export interface LockedOrderRow {
  id: string;
  status: string;
  inventory_released: boolean;
}

/**
 * Take the order row's exclusive lock. MUST be the first statement of any
 * transaction that also writes `payments`, `refunds` or `order_items`.
 *
 * Returns the locked row (status and the release flag read at lock time, so a
 * caller can decide from a value that can no longer change underneath it), or
 * `null` when the order does not exist — a deleted order has nothing to
 * transition, and the callers' guarded writes below already match 0 rows.
 */
export async function lockOrderRow(
  client: pg.PoolClient,
  orderId: string,
): Promise<LockedOrderRow | null> {
  const res = await client.query(
    `SELECT id, status, inventory_released FROM orders WHERE id = $1 FOR UPDATE`,
    [orderId],
  );
  return (res.rows[0] as LockedOrderRow | undefined) ?? null;
}

/**
 * Payment states that OUTRANK a customer cancellation: the money is already
 * settled, or a charge is in flight and must be allowed to settle. A payment
 * that has reached either state may never be voided as "abandoned", and the
 * order it belongs to may never be returned to the shelf as free stock — the
 * only safe outcome left is a refund, which is an operator flow.
 *
 * Exported because both the cancellation route and its tests pin the same rule
 * (`routes/cart.ts` and `backend/tests/customer-order-cancel.test.ts`).
 */
/**
 * Take the SAME lock over EVERY order of a checkout group.
 *
 * One purchase can be N per-shop orders, so a single Stripe charge settles N
 * rows. The rule this function exists for is unchanged: the order rows are the
 * serialisation point and must be the FIRST statement of the transaction, so a
 * concurrent cancellation of any member takes the same rows in the same order
 * and there is no cycle.
 *
 * `ORDER BY id ASC` is not cosmetic. Locking the group in a stable, identical
 * sequence is what stops two concurrent deliveries of the same event from
 * deadlocking against each other (A→B on one side, B→A on the other); the
 * caller then settles in exactly the order returned here.
 *
 * MUST be called INSIDE an existing `withTransaction` block, and BEFORE any
 * write through `payments` — the same contract as `lockOrderRow`.
 */
export async function lockCheckoutGroupOrderRows(
  client: pg.PoolClient,
  checkoutGroupId: string,
): Promise<LockedOrderRow[]> {
  const res = await client.query(
    `SELECT id, status, inventory_released FROM orders
      WHERE checkout_group_id = $1
      ORDER BY id ASC
      FOR UPDATE`,
    [checkoutGroupId],
  );
  return res.rows as LockedOrderRow[];
}

export const PAYMENT_SETTLED_STATUSES = ["paid", "processing"] as const;

/** True when a payment state blocks a cancellation (see above). */
export function paymentBlocksCancellation(status: unknown): boolean {
  return typeof status === "string" && (PAYMENT_SETTLED_STATUSES as readonly string[]).includes(status);
}

/**
 * The order's newest payment status, read inside the caller's transaction —
 * i.e. under the order lock taken above, from a row that can no longer change.
 *
 * The cancellation route reads the same value before it opens its transaction,
 * where it serves as a fast path (and as the 404 owner check). This is the
 * AUTHORITATIVE read: without it the rule would be a read-then-write check in
 * which a payment that settled while the request waited for the lock stays
 * invisible. The query is identical to the fast path's, deliberately — the two
 * gates can never disagree about what "a settled payment" means.
 */
export async function latestPaymentStatusForOrder(
  client: pg.PoolClient,
  orderId: string,
): Promise<string | null> {
  // THE COVERING SET, folded by precedence (lib/payment-attempt.ts) — not the
  // newest row, and not `WHERE order_id = $1`.
  //
  // Both parts matter, and both were wrong here:
  //   • A multi-shop purchase's charge is ONE row with `order_id IS NULL`,
  //     `checkout_group_id = <group>`. `WHERE order_id = $1` matched NOTHING and
  //     answered NULL — and NULL is not a settled status, so
  //     `paymentBlocksCancellation()` returned FALSE for a PAID purchase. A
  //     customer could cancel, and the stock release would refuse (its own guard
  //     is separate) — money kept, order cancelled, stock never returned.
  //   • A retry that opened after the charge settled is NEWER, so
  //     `ORDER BY created_at DESC LIMIT 1` answered `requires_action` for a
  //     settled purchase. The fold answers `paid`, which is what the webhook
  //     already wrote to `orders.status`.
  //
  // The fold also surfaces `refunded` / `partially_refunded`, so a refunded
  // payment can never read as merely `pending`.
  const res = await client.query(
    `SELECT CASE
              WHEN bool_or(p.refund_status = 'refunded') THEN 'refunded'
              WHEN bool_or(p.refund_status = 'partially_refunded') THEN 'partially_refunded'
              WHEN bool_or(p.status = 'paid') THEN 'paid'
              WHEN bool_or(p.status = 'processing') THEN 'processing'
              ELSE (array_agg(p.status ORDER BY p.created_at DESC, p.id DESC))[1]
            END AS status
       FROM payments p
      WHERE ${coveringPaymentsPredicateForOrderId("p", "$1")}`,
    [orderId],
  );
  return (res.rows[0]?.status as string | undefined) ?? null;
}
