/**
 * Terminating a purchase that spans N shops — as ONE unit.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * One checkout = ONE charge = N per-shop orders (`lib/checkout-groups.ts`). Every
 * write path that ENDS a payment attempt was written for a single order, and each
 * one is unsafe on a purchase:
 *
 *   • The customer's cancel route moved ONE order to `cancelled`, released that
 *     order's stock, and voided the payment row with
 *     `WHERE order_id = $1 AND status IN ('pending','requires_action')`. For a
 *     grouped purchase that last predicate matches NOTHING (the charge hangs off
 *     `checkout_group_id`), so the Stripe session stayed OPEN: the customer could
 *     still pay a purchase whose one order had been cancelled, the charge settled
 *     against a `cancelled` order, and the amount no longer matched the goods.
 *
 *   • The reservation sweep expired ONE order, released its stock, and left the
 *     session open for the same reason. Worse, it then left the OTHER shops
 *     payable — and when the webhook finally settled, `settleCheckoutGroup()`
 *     moved no order at all (they were `expired`), so the money landed on
 *     `payments.status = 'paid'` with ZERO orders paid. Money taken, nothing sold,
 *     and no incident recorded: the worst outcome the system can produce.
 *
 * So a grouped purchase is terminated HERE, as a unit, in one transaction: the
 * member order rows are locked together (id ASC, `lib/order-lock.ts`), every one
 * is claimed, every one's stock is released, and the charge is voided LAST — after
 * which a late webhook has nothing left to settle and answers a benign
 * duplicate/terminal no-op.
 *
 * WHAT THIS IS NOT
 * ----------------
 *   • Not a second settlement path: nothing here can write `paid`. It only moves
 *     orders to a terminal NON-paid state, and it refuses outright when the money
 *     already moved.
 *   • Not a refund flow. Captured money on a grouped purchase is an operator
 *     refund (`routes/stripe.ts`), never a status change — the same rule the
 *     single-order cancellation has always followed.
 *   • Not a stock authority: every release goes through the ONE
 *     `releaseOrderInventory()` in `lib/inventory.ts`, so the guards, the
 *     `inventory_released` claim and the idempotency live in exactly one place.
 *
 * MUST be called INSIDE an existing `withTransaction` block, and the member order
 * rows are locked as this transaction's FIRST payment-touching step.
 */
import type pg from "pg";

import { lockCheckoutGroupOrderRows } from "./order-lock.js";
import { releaseOrderInventory } from "./inventory.js";

/**
 * The terminal NON-PAID states a purchase can be moved to. Every one is a
 * member of `orders_status_check` (db/migrations/050_orders_status_check.sql)
 * and of `RELEASABLE_STATUSES` (lib/inventory.ts), so the claim below can always
 * release the stock it held.
 */
export type GroupTerminalStatus = "cancelled" | "expired" | "payment_failed";

export interface GroupTerminationResult {
  /** True when this call claimed at least one member order. */
  moved: boolean;
  /** Every member order id, in the stable lock order (id ASC). */
  orders: string[];
  /** The orders this call claimed. */
  claimed: string[];
  /** The orders whose stock this call actually released. */
  released: string[];
  /**
   * The Stripe session that must be expired AT STRIPE **after** the commit. The
   * order is terminal either way, so a session that cannot be closed is a
   * non-event — but it must be attempted, or a payable page stays open.
   */
  openSessionId: string | null;
  /**
   * The settled payment status that refused the move, when one did
   * (`paid` / `processing`). Present ONLY on a refusal: captured money outranks a
   * cancellation in every direction, and the only safe outcome left is a refund.
   */
  blockedBy: string | null;
  /** How many open charge rows this call voided. */
  voidedRows: number;
}

/**
 * Move EVERY order of one purchase to a terminal non-paid status and void its
 * open charge.
 *
 * `allowedFrom` is the set of statuses an order may be claimed FROM. It defaults
 * to the two states a purchase can be abandoned out of. An order already past them
 * is left untouched and simply does not appear in `claimed`, so a repeat call — a
 * double click, a retried request, a redelivered webhook, the sweep racing the
 * customer — is an idempotent no-op rather than a second terminal transition.
 */
export async function terminateCheckoutGroup(
  client: pg.PoolClient,
  checkoutGroupId: string,
  options: {
    toStatus: GroupTerminalStatus;
    failureCode: string;
    failureMessage: string;
    allowedFrom?: readonly string[];
  },
): Promise<GroupTerminationResult> {
  const allowedFrom = options.allowedFrom ?? ["pending", "pending_payment"];

  // ── 1. ORDER ROWS FIRST, all N in ONE statement, in `id ASC` ─────────────
  // The same rule every other multi-row writer follows (lib/order-lock.ts): the
  // order rows are the serialisation point, so taking them in a stable sequence
  // is what stops two concurrent deliveries forming an AB-BA deadlock.
  const locked = await lockCheckoutGroupOrderRows(client, checkoutGroupId);
  const orders = locked.map((row) => row.id);
  if (locked.length === 0) {
    return {
      moved: false,
      orders: [],
      claimed: [],
      released: [],
      openSessionId: null,
      blockedBy: null,
      voidedRows: 0,
    };
  }

  // ── 2. Money outranks the move, checked UNDER the lock ───────────────────
  // Read from the orders this transaction now owns, so a webhook that settled
  // while this request waited for the lock is visible here — the outcome depends
  // on the money, not on who won the race.
  const settledRes = await client.query(
    `SELECT p.status
       FROM payments p
      WHERE p.status IN ('paid', 'processing')
        AND (p.checkout_group_id = $1 OR p.order_id = ANY($2::uuid[]))
      ORDER BY p.created_at DESC
      LIMIT 1`,
    [checkoutGroupId, orders],
  );
  const blockedBy = (settledRes.rows[0]?.status as string | undefined) ?? null;
  if (blockedBy) {
    return { moved: false, orders, claimed: [], released: [], openSessionId: null, blockedBy, voidedRows: 0 };
  }

  // The session that must be closed at Stripe after the commit. Read BEFORE the
  // rows are voided, because afterwards there is nothing left to name it.
  const openRes = await client.query(
    `SELECT p.provider_checkout_session_id
       FROM payments p
      WHERE p.provider = 'stripe'
        AND p.status IN ('pending', 'requires_action')
        AND p.provider_checkout_session_id IS NOT NULL
        AND (p.checkout_group_id = $1 OR p.order_id = ANY($2::uuid[]))
      ORDER BY p.created_at DESC
      LIMIT 1`,
    [checkoutGroupId, orders],
  );
  const openSessionId = (openRes.rows[0]?.provider_checkout_session_id as string | undefined) ?? null;

  // ── 3. Claim each order, then release ITS stock through the ONE release path
  // The per-order guard is identical to the single-order flows: the order must
  // still be in an abandonable state and its stock must not already have been
  // released. `releaseOrderInventory()` re-checks the settled guard itself, so
  // the two guards can never disagree.
  const claimed: string[] = [];
  const released: string[] = [];
  for (const order of locked) {
    if (!allowedFrom.includes(order.status)) continue;
    const claim = await client.query(
      `UPDATE orders SET status = $2, updated_at = NOW()
        WHERE id = $1 AND status = ANY($3::text[]) AND inventory_released = FALSE
        RETURNING id`,
      [order.id, options.toStatus, [...allowedFrom]],
    );
    if (claim.rows.length === 0) continue;
    claimed.push(order.id);
    if (await releaseOrderInventory(client, order.id)) released.push(order.id);
  }

  // ── 4. Void the charge LAST ─────────────────────────────────────────────
  // After every member order is terminal, so the void cannot race a settlement
  // into a half-moved purchase. `status <> 'paid'` is the terminal guard: a
  // captured row is never rewritten here — that would falsify money state.
  const voided = await client.query(
    `UPDATE payments
        SET status = 'cancelled', failure_code = $3, failure_message = $4, updated_at = NOW()
      WHERE provider = 'stripe'
        AND status IN ('pending', 'requires_action')
        AND (checkout_group_id = $1 OR order_id = ANY($2::uuid[]))`,
    [checkoutGroupId, orders, options.failureCode.slice(0, 120), options.failureMessage.slice(0, 500)],
  );

  return {
    moved: claimed.length > 0,
    orders,
    claimed,
    released,
    openSessionId,
    blockedBy: null,
    voidedRows: voided.rowCount ?? 0,
  };
}
