/**
 * Order STATE authority — the ONE place that projects the three lifecycle axes
 * onto the legacy `orders.status` column.
 *
 * WHY THIS MODULE EXISTS (P0-1 in `.ai/audit/FINAL_GAP_REPORT.md`)
 * ---------------------------------------------------------------
 * `orders.status` used to carry THREE different facts in one column:
 *
 *   payment      'pending_payment' | 'paid' | 'payment_failed' | 'refunded' | 'expired'
 *   order        'pending' | 'cancelled' | 'completed'
 *   fulfilment   'confirmed' | 'packing' | 'shipped' | 'delivered'
 *
 * Twelve writer sites each wrote their own family into it, so a move on one axis
 * could destroy a fact on another. The concrete data loss: a full refund ran
 * `UPDATE orders SET status = 'refunded'`, which overwrote a `shipped` or
 * `delivered` value — the record that the parcel left the warehouse was gone.
 *
 * Migration 056 added the destination columns (`orders.order_state`,
 * `orders.fulfillment_status`) with their vocabularies and CHECK constraints and
 * **no writer** — a verified zero-reference. This module is the missing half:
 * the writers now record the axis they actually moved, and the legacy column
 * becomes a DERIVED projection of the three axes instead of a fourth opinion.
 *
 *   payment state  ─┐
 *   order_state    ─┼─> projectOrderStatus(...) ──> orders.status (legacy, read-only projection)
 *   fulfillment_status ─┘
 *
 * NO NEW STATE MACHINE
 * --------------------
 * The transitions stay where they were: `backend/lib/order-fulfillment.ts` is
 * still the ONE fulfilment state machine (`FULFILLMENT_TRANSITIONS`), and the
 * payment lifecycle is still `payments` folded through the covering set
 * (`lib/payment-attempt.ts`). This module adds no transitions of its own — it
 * only maps the machine's own statuses onto the two storage axes
 * (`axesForFulfillmentStatus`) and projects the axes back down.
 *
 * THE PAYMENT AXIS IS DERIVED, NOT A COLUMN
 * ------------------------------------------
 * There is deliberately no `orders.payment_state`: the payment fact already has
 * an authoritative home (`payments`, read through the covering set so a
 * multi-shop purchase's single group charge is visible from every member order).
 * A writer that moves the payment axis therefore passes the payment state it is
 * writing as an INPUT to the projection, exactly like `lib/order-lock.ts` reads
 * the same fold. Adding a second home for money state would have created the very
 * disagreement this module exists to prevent.
 *
 * PRECEDENCE — FULFILMENT OUTRANKS PAYMENT
 * ----------------------------------------
 *   1. `shipped` / `delivered` / `packing` win outright. A refund, a failed
 *      retry or an abandoned session can never erase the fact that the parcel
 *      went out; the money fact is still readable from `paymentStatus`.
 *   2. A lapsed payment reservation (`expired`) ends the order.
 *   3. `cancelled` (either axis) and `completed`.
 *   4. Payment facts, only while nothing has shipped.
 *   5. `confirmed` — the shop accepted the order.
 *   6. Otherwise `pending` / `pending_payment`.
 *
 * The projection is a pure function of its three inputs and covers every
 * combination the schema's vocabularies allow, so the legacy column can never
 * hold a value outside `orders_status_check`'s twelve.
 */
import type pg from "pg";
import {
  FULFILLMENT_STATUSES,
  FulfillmentError,
  canTransitionFulfillment,
  normalizeOrderStatusToFulfillment,
  type FulfillmentStatus,
} from "./order-fulfillment.js";
// The order-row lock authority and the covering-set payment fold — the same two
// helpers every other order writer reads the money through, so a projection
// written from here cannot disagree with the ones the routes write.
import { latestPaymentStatusForOrder } from "./order-lock.js";

// ─── Axis vocabularies (mirrors the CHECK constraints from migration 056) ────

/** `orders_order_state_check` — the ORDER lifecycle. */
export const ORDER_STATES = ["pending", "confirmed", "processing", "completed", "cancelled"] as const;
export type OrderState = (typeof ORDER_STATES)[number];

/** `orders_fulfillment_status_check` — the FULFILMENT lifecycle. */
export const FULFILLMENT_AXIS_STATUSES = [
  "unfulfilled",
  "ready",
  "picking",
  "packing",
  "ready_to_ship",
  "shipped",
  "delivered",
  "failed",
  "cancelled",
] as const;
export type FulfillmentAxisStatus = (typeof FULFILLMENT_AXIS_STATUSES)[number];

/**
 * The payment axis' vocabulary: the fold `ORDER_PAYMENT_STATUS_SQL`
 * (`lib/payment-attempt.ts`) produces, plus `expired` — the reservation window
 * lapse, which the expiry sweep owns (`PAYMENT_RESERVATION_EXPIRED_STATUS`).
 * `unpaid` is the pre-existing sentinel for "no payment row at all".
 */
export const PAYMENT_STATES = [
  "unpaid",
  "pending",
  "requires_action",
  "processing",
  "authorized",
  "paid",
  "failed",
  "cancelled",
  "expired",
  "partially_refunded",
  "refunded",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** `orders_status_check` — the legacy projection's twelve values, unchanged. */
export const LEGACY_ORDER_STATUSES = [
  "pending",
  "pending_payment",
  "paid",
  "confirmed",
  "packing",
  "shipped",
  "delivered",
  "completed",
  "payment_failed",
  "refunded",
  "cancelled",
  "expired",
] as const;
export type LegacyOrderStatus = (typeof LEGACY_ORDER_STATUSES)[number];

export interface OrderAxes {
  orderState: OrderState;
  fulfillmentStatus: FulfillmentAxisStatus;
}

// ─── Machine status ⇄ axis pair (no transitions here — those live in the machine) ──

/**
 * The axis pair that RECORDS a fulfilment machine status.
 *
 * Identical to the mapping migration 056 used to backfill existing rows, so a
 * row written by the new code and a row converted by the migration describe the
 * same state. `delivered` and `completed` share the fulfilment axis `delivered`
 * — the completion fact rides on `order_state`, which is the only place the
 * vocabulary can hold it.
 *
 * This is NOT a second state machine: it holds no transition table and no rules,
 * it only names the storage encoding of the statuses `FULFILLMENT_TRANSITIONS`
 * already governs.
 */
const AXES_BY_FULFILLMENT_STATUS: Record<FulfillmentStatus, OrderAxes> = {
  pending: { orderState: "pending", fulfillmentStatus: "unfulfilled" },
  confirmed: { orderState: "confirmed", fulfillmentStatus: "ready" },
  packing: { orderState: "processing", fulfillmentStatus: "packing" },
  shipped: { orderState: "processing", fulfillmentStatus: "shipped" },
  delivered: { orderState: "processing", fulfillmentStatus: "delivered" },
  completed: { orderState: "completed", fulfillmentStatus: "delivered" },
  cancelled: { orderState: "cancelled", fulfillmentStatus: "cancelled" },
};

/** The axis pair that records `status` (one of the seven machine statuses). */
export function axesForFulfillmentStatus(status: FulfillmentStatus): OrderAxes {
  return AXES_BY_FULFILLMENT_STATUS[status];
}

/**
 * The inverse: which machine status a stored axis pair means.
 *
 * `ready`/`unfulfilled` are ambiguous ON THEIR OWN — 056's backfill mapped both
 * the legacy `paid` (cash moved, shop has not answered) and the legacy
 * `confirmed` (shop accepted) onto `ready` — so the ORDER axis disambiguates:
 * `confirmed` in `order_state` is what makes `ready` mean "accepted".
 *
 * `failed` and `cancelled` are both terminal for the machine. `delivered`
 * resolves to `completed` when the order axis says the order ended, which is
 * exactly the pair `axesForFulfillmentStatus` writes for `completed`.
 */
export function fulfillmentStatusForAxes(axes: {
  orderState?: string | null;
  fulfillmentStatus?: string | null;
}): FulfillmentStatus {
  const f = normalizeFulfillmentAxis(axes.fulfillmentStatus);
  const o = normalizeOrderState(axes.orderState);
  switch (f) {
    case "unfulfilled":
    case "ready":
      return o === "confirmed" ? "confirmed" : "pending";
    case "picking":
    case "ready_to_ship":
      return "confirmed";
    case "packing":
      return "packing";
    case "shipped":
      return "shipped";
    case "delivered":
      return o === "completed" ? "completed" : "delivered";
    case "failed":
    case "cancelled":
      return "cancelled";
  }
}

/**
 * The axes a FRESHLY CREATED order carries: no shop has answered, nothing has
 * shipped, no money has moved. The projection of this pair with the `unpaid`
 * payment axis is `pending` — the value the checkout INSERT wrote before the
 * axes existed, so an order created by the new code is indistinguishable from
 * one created by the old code on the legacy column.
 */
export const NEW_ORDER_AXES: OrderAxes = axesForFulfillmentStatus("pending");

// ─── Normalisation of an untrusted axis value ────────────────────────────────

/**
 * Unknown values fall in the SAFEST direction — the one that still requires a
 * real transition before anything is fulfilled or any money is claimed:
 * an unrecognised fulfilment value can never read as shipped/delivered, and an
 * unrecognised payment value never reads as paid or refunded.
 */
export function normalizeFulfillmentAxis(value: unknown): FulfillmentAxisStatus {
  return typeof value === "string" && (FULFILLMENT_AXIS_STATUSES as readonly string[]).includes(value)
    ? (value as FulfillmentAxisStatus)
    : "unfulfilled";
}

export function normalizeOrderState(value: unknown): OrderState {
  return typeof value === "string" && (ORDER_STATES as readonly string[]).includes(value)
    ? (value as OrderState)
    : "pending";
}

export function normalizePaymentState(value: unknown): PaymentState {
  return typeof value === "string" && (PAYMENT_STATES as readonly string[]).includes(value)
    ? (value as PaymentState)
    : "unpaid";
}

// ─── THE projection ─────────────────────────────────────────────────────────

export interface OrderStateProjectionInput {
  /** The payment axis. See `PAYMENT_STATES`. */
  paymentState?: string | null;
  /** `orders.order_state`. */
  orderState?: string | null;
  /** `orders.fulfillment_status`. */
  fulfillmentStatus?: string | null;
}

/**
 * Project the three axes onto the legacy `orders.status` value.
 *
 * Deterministic, total, and free of side effects: the same three inputs always
 * produce the same one of the twelve `orders_status_check` values, whatever a
 * caller passes in.
 */
export function projectOrderStatus(input: OrderStateProjectionInput): LegacyOrderStatus {
  const f = normalizeFulfillmentAxis(input.fulfillmentStatus);
  const o = normalizeOrderState(input.orderState);
  const p = normalizePaymentState(input.paymentState);

  // 1. FULFILMENT FACTS OUTRANK PAYMENT FACTS — the reason this module exists.
  //    A refund, a failed retry or a lapsed session must never rewrite the
  //    record that the parcel went out.
  if (f === "shipped") return "shipped";
  if (f === "delivered") return o === "completed" ? "completed" : "delivered";
  if (f === "picking" || f === "packing" || f === "ready_to_ship") return "packing";
  if (f === "failed") return "cancelled";

  // 2. The payment reservation window lapsed: the sweep's own terminal state.
  //    Checked before the cancellation branch because both axes read `cancelled`
  //    for an abandoned purchase — only the payment axis knows the window ended.
  if (p === "expired") return "expired";

  // 3. Terminal endings carried by the order / fulfilment axis.
  if (o === "cancelled" || f === "cancelled") return "cancelled";

  // 4. The order itself ended.
  if (o === "completed") return "completed";

  // 5. Payment facts, only while nothing has shipped.
  if (p === "refunded") return "refunded";
  if (o === "confirmed") return "confirmed";
  if (o === "processing") return "packing";
  if (p === "paid" || p === "partially_refunded") return "paid";
  if (p === "failed") return "payment_failed";

  // 6. Nothing has happened yet.
  if (p === "unpaid") return "pending";
  return "pending_payment";
}

/**
 * The SQL mirror of `projectOrderStatus`, for writers that must project WITHOUT
 * a read-modify-write round trip (the value has to be computed in the same
 * statement that moves the axis, under the order row's lock).
 *
 * CONTRACT: the fragment reads the BARE column names `order_state` and
 * `fulfillment_status`, so it is only valid inside an `UPDATE orders SET …`
 * — where every right-hand side sees the PRE-update row — or inside a query
 * whose `orders` alias is unambiguously these two columns. It never reads the
 * legacy `status` column, because that is the value being replaced.
 *
 * `paymentStateExpr` is interpolated verbatim: pass a bound parameter (`$3`) or
 * a literal this module's own caller controls. Never pass user input.
 *
 * `backend/tests/order-state-projection.test.ts` asserts this mirror and
 * `projectOrderStatus` agree on EVERY combination of the three vocabularies
 * against a live database, so the two encodings cannot drift apart.
 */
export function projectOrderStatusSql(paymentStateExpr: string): string {
  return `CASE
              WHEN fulfillment_status = 'shipped' THEN 'shipped'
              WHEN fulfillment_status = 'delivered' AND order_state = 'completed' THEN 'completed'
              WHEN fulfillment_status = 'delivered' THEN 'delivered'
              WHEN fulfillment_status IN ('picking', 'packing', 'ready_to_ship') THEN 'packing'
              WHEN fulfillment_status = 'failed' THEN 'cancelled'
              WHEN ${paymentStateExpr} = 'expired' THEN 'expired'
              WHEN order_state = 'cancelled' OR fulfillment_status = 'cancelled' THEN 'cancelled'
              WHEN order_state = 'completed' THEN 'completed'
              WHEN ${paymentStateExpr} = 'refunded' THEN 'refunded'
              WHEN order_state = 'confirmed' THEN 'confirmed'
              WHEN order_state = 'processing' THEN 'packing'
              WHEN ${paymentStateExpr} IN ('paid', 'partially_refunded') THEN 'paid'
              WHEN ${paymentStateExpr} = 'failed' THEN 'payment_failed'
              -- The two remaining branches mirror normalizePaymentState: an
              -- UNKNOWN value falls towards 'pending' (nothing claimed), while
              -- the known "waiting on the customer" states project to
              -- 'pending_payment'. Listing the known set explicitly is what keeps
              -- the mirror total — the ELSE can only ever see a value outside the
              -- vocabulary, which is the case the normaliser treats as 'unpaid'.
              WHEN ${paymentStateExpr} IN ('pending', 'requires_action', 'processing', 'authorized', 'cancelled')
                THEN 'pending_payment'
              ELSE 'pending'
            END`;
}

/** Is `value` one of the seven fulfilment machine statuses? (re-exported for callers) */
export const ORDER_FULFILLMENT_STATUSES = FULFILLMENT_STATUSES;

// ─── The axis WRITER (for lifecycles outside the order-status routes) ─────────

/**
 * The fulfilment chain in ORDER, exactly as `FULFILLMENT_TRANSITIONS` walks it.
 *
 * Used only to answer "is the order already AT or PAST this status?", which is
 * how an idempotent repeat is told apart from a move that still needs judging.
 * `cancelled` is deliberately absent: it is not a position on the chain, so an
 * order that was cancelled has no successor and is handled separately below.
 */
const FULFILLMENT_CHAIN: readonly FulfillmentStatus[] = [
  "pending",
  "confirmed",
  "packing",
  "shipped",
  "delivered",
  "completed",
];

/**
 * Advance the ORDER's fulfilment axis to `target` on behalf of a lifecycle that
 * is not one of the order-status routes (today: the shipment lifecycle, see
 * `lib/order-shipment.ts`).
 *
 * It is NOT a second state machine: it decides with the ONE authority's own
 * predicate (`canTransitionFulfillment`, from `order-fulfillment.ts`) and records
 * the result with this module's own projection (`axesForFulfillmentStatus` +
 * `projectOrderStatus`), so a parcel can never move an order anywhere the seller
 * or VelCenter routes would refuse. It also writes no new column: the legacy
 * `orders.status` stays the derived projection described in the module header.
 *
 * THE CALLER MUST ALREADY HOLD THE ORDER ROW LOCK (`lib/order-lock.ts`) inside
 * its transaction. The read below is only authoritative because the row is
 * locked, and the payment axis is read from the covering set under that same
 * lock so the projection is derived from the money as it is at commit time.
 *
 * Returning `moved: false` is the idempotent repeat — the order was already at
 * (or past) `target` — and it is a SUCCESS, not a no-op error.
 *
 * Refusals use the state machine's own error type, so every surface already
 * knows how to answer them:
 *   • 404 `NOT_FOUND`       — no such order (nothing to advance).
 *   • 409 `ORDER_NOT_READY` — the order is behind `target` and the canonical
 *     machine has NO edge there (it is still `pending`/`confirmed`, or it was
 *     `cancelled`). The outside event contradicts the order, so the caller must
 *     refuse rather than let the two lifecycles disagree.
 */
export async function advanceOrderFulfillmentAxis(
  client: pg.PoolClient,
  orderId: string,
  target: FulfillmentStatus,
): Promise<{ moved: boolean; from: FulfillmentStatus }> {
  const res = await client.query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
  const rawFrom = res.rows[0]?.status as string | undefined;
  if (rawFrom === undefined) {
    throw new FulfillmentError(404, "NOT_FOUND", "Order not found");
  }

  const from = normalizeOrderStatusToFulfillment(rawFrom);

  // Already there, or past it: nothing to write and nothing to complain about.
  // This is the branch a replayed delivery/ship event lands in.
  const fromAt = FULFILLMENT_CHAIN.indexOf(from);
  const targetAt = FULFILLMENT_CHAIN.indexOf(target);
  if (fromAt !== -1 && targetAt !== -1 && fromAt >= targetAt) {
    return { moved: false, from };
  }

  if (!canTransitionFulfillment(from, target)) {
    throw new FulfillmentError(
      409,
      "ORDER_NOT_READY",
      `This order is '${from}' and cannot be moved to '${target}' yet; finish the current fulfilment step first.`,
    );
  }

  const targetAxes = axesForFulfillmentStatus(target);
  const paymentState = await latestPaymentStatusForOrder(client, orderId);
  // Conditioned on the status it read, so the write is a CLAIM and not a blind
  // overwrite: a writer that somehow holds no lock cannot clobber this one.
  const updated = await client.query(
    `UPDATE orders
        SET status = $3, order_state = $4, fulfillment_status = $5, updated_at = NOW()
      WHERE id = $1 AND status = $2`,
    [
      orderId,
      rawFrom,
      projectOrderStatus({ paymentState, ...targetAxes }),
      targetAxes.orderState,
      targetAxes.fulfillmentStatus,
    ],
  );
  if (updated.rowCount === 0) {
    throw new FulfillmentError(
      409,
      "ORDER_CONCURRENT_MODIFICATION",
      "The order was modified concurrently. Please reload and try again.",
    );
  }

  return { moved: true, from };
}
