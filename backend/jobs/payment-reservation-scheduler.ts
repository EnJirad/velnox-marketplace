/**
 * Payment-reservation expiry sweep.
 *
 * The DATABASE is the source of truth. An unpaid order carries
 * `orders.payment_expires_at` (written at order creation by
 * `lib/payment-reservation.ts`); this job finds the ones whose deadline has
 * passed and ends them: order → `expired`, reserved stock released exactly once,
 * the abandoned Stripe Checkout Session closed.
 *
 * WHY A SWEEP AND NOT A TIMER PER ORDER
 * `setTimeout` dies with the process, and this deployment restarts, scales and
 * sleeps. A row with a deadline plus a polling scan survives all of that, is
 * safe to run in several instances at once (every write is a guarded UPDATE that
 * claims the row), and can be inspected from the database alone. The frontend
 * timer is PRESENTATION ONLY — it never decides anything.
 *
 * CONCURRENCY
 *  1. The claim is `UPDATE orders … WHERE status = ANY(expirable) AND
 *     inventory_released = FALSE AND payment_expires_at <= NOW()`. PostgreSQL
 *     serialises the two writers on the row lock; the loser re-evaluates its
 *     WHERE clause against the committed row and matches 0 rows. So exactly one
 *     of {expiry sweep, payment webhook, customer cancel} wins.
 *  2. If a `paid`/`processing` payment row exists for the order, the claim is
 *     refused outright — a live charge must never be expired out from under the
 *     customer, and money that arrived must never be released as free stock.
 *  3. Stock release goes through `releaseOrderInventory()` — the ONE release
 *     path — whose `inventory_released` claim makes a repeated, concurrent,
 *     retried or webhook-driven release impossible.
 *
 * A late payment for an order that already expired cannot resurrect it:
 * `markPaymentSucceeded` (routes/stripe.ts) only moves `pending`/`pending_payment`
 * orders that have NOT released their stock, logs the case loudly, and leaves the
 * money on the payment row — which is exactly what makes it refundable by an
 * operator instead of silently stealing another customer's units.
 */
import { query, withTransaction } from "../db/index.js";
import { releaseOrderInventory } from "../lib/inventory.js";
import {
  isUndefinedColumnError,
  PAYMENT_RESERVATION_EXPIRABLE_STATUSES,
  PAYMENT_RESERVATION_EXPIRED_STATUS,
} from "../lib/payment-reservation.js";
import { broadcast, CHANNELS } from "../realtime/index.js";
import { expireStripeCheckoutSession } from "../routes/stripe.js";

/**
 * Payment states that must block an automatic expiry (see header note 2).
 * Exported: it is part of this worker's contract, and the wiring test pins it so
 * a future edit cannot quietly drop the "never expire a live charge" guard.
 */
export const EXPIRY_BLOCKING_PAYMENT_STATUSES = ["paid", "processing"] as const;

export type ExpiredReservationOutcome = "expired" | "skipped" | "missing";

export interface ReservationExpiryResult {
  orderId: string;
  outcome: ExpiredReservationOutcome;
  /** True only for the caller that actually released the reserved stock. */
  released: boolean;
  /** True when this sweep closed the Stripe Checkout Session. */
  sessionExpired: boolean;
  reason: string;
}

/**
 * Reserve nothing, decide nothing: the list of orders whose deadline has passed.
 *
 * Uses `orders (payment_expires_at) WHERE payment_expires_at IS NOT NULL`, so the
 * range scan and the ORDER BY both come from the index; the status and
 * `inventory_released` filters are applied to the (few) due rows.
 */
export async function findDuePaymentReservations(limit = 25): Promise<string[]> {
  const due = await query(
    `SELECT id FROM orders
      WHERE payment_expires_at IS NOT NULL
        AND payment_expires_at <= NOW()
        AND status = ANY($2::text[])
        AND inventory_released = FALSE
      ORDER BY payment_expires_at ASC
      LIMIT $1`,
    [Math.max(1, Math.min(limit, 200)), [...PAYMENT_RESERVATION_EXPIRABLE_STATUSES]],
  );
  return due.rows.map((r: { id: string }) => r.id);
}

/**
 * Expire ONE order's payment reservation.
 *
 * Safe to call concurrently with a Stripe webhook, another sweep, or the
 * customer's own cancel: the guarded claim decides, and the loser is a no-op.
 */
export async function expirePaymentReservation(orderId: string): Promise<ReservationExpiryResult> {
  const state = await query(
    `SELECT o.id, o.status, o.inventory_released, o.payment_expires_at,
            (SELECT p.provider_checkout_session_id FROM payments p
              WHERE p.order_id = o.id AND p.provider = 'stripe'
                AND p.status IN ('pending', 'requires_action')
              ORDER BY p.created_at DESC LIMIT 1) AS open_session_id,
            (SELECT p.status FROM payments p
              WHERE p.order_id = o.id AND p.status = ANY($2::text[])
              ORDER BY p.created_at DESC LIMIT 1) AS blocking_payment_status
       FROM orders o WHERE o.id = $1`,
    [orderId, [...EXPIRY_BLOCKING_PAYMENT_STATUSES]],
  );
  const order = state.rows[0];
  if (!order) return { orderId, outcome: "missing", released: false, sessionExpired: false, reason: "order not found" };

  if (!PAYMENT_RESERVATION_EXPIRABLE_STATUSES.includes(order.status)) {
    return {
      orderId,
      outcome: "skipped",
      released: false,
      sessionExpired: false,
      reason: `status '${order.status}' is already decided`,
    };
  }
  if (order.inventory_released) {
    return { orderId, outcome: "skipped", released: false, sessionExpired: false, reason: "stock already released" };
  }
  if (!order.payment_expires_at || new Date(order.payment_expires_at).getTime() > Date.now()) {
    return { orderId, outcome: "skipped", released: false, sessionExpired: false, reason: "reservation not due yet" };
  }
  if (order.blocking_payment_status) {
    // A charge is live (or already captured): the webhook owns this order.
    return {
      orderId,
      outcome: "skipped",
      released: false,
      sessionExpired: false,
      reason: `payment is '${order.blocking_payment_status}'`,
    };
  }

  const claimed = await withTransaction(async (client) => {
    const claim = await client.query(
      `UPDATE orders
          SET status = $2, updated_at = NOW()
        WHERE id = $1
          AND status = ANY($3::text[])
          AND inventory_released = FALSE
          AND payment_expires_at IS NOT NULL
          AND payment_expires_at <= NOW()
          AND NOT EXISTS (
            SELECT 1 FROM payments p
             WHERE p.order_id = orders.id
               AND p.status = ANY($4::text[])
          )
        RETURNING id`,
      [
        orderId,
        PAYMENT_RESERVATION_EXPIRED_STATUS,
        [...PAYMENT_RESERVATION_EXPIRABLE_STATUSES],
        [...EXPIRY_BLOCKING_PAYMENT_STATUSES],
      ],
    );
    if (claim.rows.length === 0) return false;

    // The waiting payment row stops waiting — the same transition the Stripe
    // `checkout.session.expired` webhook performs, so the payment domain never
    // disagrees with the order domain. A `paid` row is never touched.
    await client.query(
      `UPDATE payments
          SET status = 'cancelled', failure_code = 'PAYMENT_RESERVATION_EXPIRED',
              failure_message = 'The payment reservation window expired.', updated_at = NOW()
        WHERE order_id = $1 AND provider = 'stripe' AND status <> 'paid'`,
      [orderId],
    );

    // ONE release path, claimed atomically inside this transaction.
    await releaseOrderInventory(client, orderId);
    return true;
  });

  if (!claimed) {
    return {
      orderId,
      outcome: "skipped",
      released: false,
      sessionExpired: false,
      reason: "another writer decided this order first (paid, cancelled or already expired)",
    };
  }

  // The order is now terminal, so the provider side is closed AFTER the fact:
  // an order can never be held open by a session we failed to expire, and a
  // session that cannot be expired (already completed/cancelled) is a non-event.
  let sessionExpired = false;
  if (order.open_session_id) {
    sessionExpired = await expireStripeCheckoutSession(order.open_session_id as string);
  }

  broadcast(CHANNELS.ORDER_UPDATED, "order:updated", {
    orderId,
    to: PAYMENT_RESERVATION_EXPIRED_STATUS,
  });

  console.log(
    `[reservation] order ${orderId} expired — payment reservation lapsed at ${new Date(order.payment_expires_at).toISOString()}, stock released`,
  );
  return {
    orderId,
    outcome: "expired",
    released: true,
    sessionExpired,
    reason: "payment reservation window expired",
  };
}

/**
 * Process every currently-due reservation. Called by the loop and directly by
 * tests / operators.
 */
export async function processExpiredPaymentReservations(
  limit = 25,
): Promise<{ due: number; expired: number; skipped: number }> {
  const ids = await findDuePaymentReservations(limit);
  let expired = 0;
  let skipped = 0;
  for (const id of ids) {
    const result = await expirePaymentReservation(id);
    if (result.outcome === "expired") expired++;
    else if (result.outcome === "skipped") {
      skipped++;
      console.log(`[reservation] order ${id} left alone — ${result.reason}`);
    }
  }
  return { due: ids.length, expired, skipped };
}

let running = false;

/**
 * True while the scan has failed because the columns are missing (migration 048
 * not applied yet). It keeps the 30 s tick from repeating the same line forever,
 * and a later successful scan clears it — so applying the migration re-enables
 * the sweep on the next tick, without a restart.
 */
let schemaMissingWarned = false;

/**
 * Start the expiry sweep. Mirrors the VelRepeat scheduler: the interval only
 * triggers a scan, the database decides, and overlapping ticks are impossible
 * within one process.
 */
export function startPaymentReservationScheduler(intervalMs = 30_000): NodeJS.Timeout {
  const ms = Math.max(10_000, Number(process.env.PAYMENT_RESERVATION_SCHEDULER_INTERVAL_MS) || intervalMs);
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { due, expired, skipped } = await processExpiredPaymentReservations(25);
      schemaMissingWarned = false;
      if (due > 0) console.log(`[reservation] sweep: due=${due} expired=${expired} skipped=${skipped}`);
    } catch (err) {
      if (isUndefinedColumnError(err)) {
        // The backend is newer than the database. Say it once, clearly, and keep
        // serving: without the columns there is nothing to sweep, and every other
        // route still works.
        if (!schemaMissingWarned) {
          schemaMissingWarned = true;
          console.error(
            "[reservation] sweep disabled — orders.payment_expires_at is missing. " +
              "Apply db/migrations/048_payment_reservation.sql; the sweep resumes on its own.",
          );
        }
      } else {
        console.error("[reservation] sweep error:", err);
      }
    } finally {
      running = false;
    }
  };
  // Fire once shortly after boot so a deadline that passed during a deploy (or a
  // restart) is not delayed by a whole interval.
  setTimeout(() => void tick(), 5_000);
  const timer = setInterval(() => void tick(), ms);
  timer.unref?.();
  console.log(`[reservation] payment-reservation sweep started (interval ${ms}ms)`);
  return timer;
}
