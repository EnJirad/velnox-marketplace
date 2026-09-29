/**
 * Order FULFILMENT state machine — the ONE authority.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `orders.status` is a superset of two lifecycles: the PAYMENT one that
 * `routes/stripe.ts` writes (`pending_payment` → `paid` | `payment_failed`,
 * terminal `refunded`) and the FULFILMENT one the seller drives. The fulfilment
 * chain used to be `pending → confirmed → shipped → delivered → completed` with
 * `confirmed` doubling as "the shop accepted it" AND "the shop is preparing it",
 * which is exactly the ambiguity that made the customer's cancel button wrong:
 * there was no state in which a seller had STARTED packing, so the only rule
 * available was "you may cancel until it ships" — and cancelling an order whose
 * items were already being packed is not a business the marketplace can honour.
 *
 * `packing` closes that hole:
 *
 *     pending ──> confirmed ──> packing ──> shipped ──> delivered ──> completed
 *        │            │
 *        └────────────┴──> cancelled
 *
 *   pending    created; the shop has not answered. Seller: confirm | cancel.
 *   confirmed  the shop ACCEPTED the order — packing has NOT started.
 *   packing    fulfilment has STARTED (items being picked/packed).
 *   shipped    a real shipment row with a carrier + tracking number exists.
 *   delivered  the shipment arrived.         completed  terminal.
 *   cancelled  terminal.
 *
 * `packing` and everything after it is the point of no return: from `packing`
 * onwards NEITHER side may cancel (the seller's own transition table has no
 * such edge). `cancelled` and `completed` are terminal and move nowhere — there
 * is no edge back, which is what keeps a cancelled order from being resurrected
 * by a late transition.
 *
 * Every rule below is enforced by the SERVER inside the caller's transaction,
 * under a `FOR UPDATE` lock on the order row. The seller/center UIs read the
 * same table through `NEXT_ORDER_STATUSES` (`packages/shared/src/lib/commerce.ts`)
 * so a button is only ever offered for a move the API accepts — but the button
 * is UX, and this module is the authority.
 *
 * PAYMENT IS A SEPARATE AXIS
 * --------------------------
 * A fulfilment status never stands in for a payment status. `confirmed` means
 * "the shop accepted it"; it says nothing about money, and the payment state
 * lives in `payments` (exposed to clients as `paymentStatus`). What the state
 * machine does enforce is the ORDER of the two: a Card/PromptPay order may only
 * be CONFIRMED once a payment row proves the money moved (`paid`, written by the
 * Stripe webhook — the only authority on payment state). A seller can never mark
 * an order paid, and an unpaid order cannot enter fulfilment.
 *
 * COD is settled by a carrier, not by a webhook, so its rule is different — but
 * COD is DISABLED (`isCodEnabled()` defaults to off, fails closed), and this
 * module does not enable it: the COD branch below can only open if a deployment
 * turns the rail on, exactly like `assertPaymentMethodUsable()`.
 */
import type pg from "pg";
import { isCodEnabled } from "./payment-config.js";

// ─── The state machine ───────────────────────────────────────────────────────

export const FULFILLMENT_STATUSES = [
  "pending",
  "confirmed",
  "packing",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
] as const;

export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

/**
 * Allowed transitions. Terminal rows (`completed`, `cancelled`) are empty on
 * purpose: there is no way back, so a late or duplicated request cannot
 * resurrect an order that has already ended.
 *
 * `packing` has NO edge to `cancelled` — once fulfilment has started the order
 * must go out (or be handled as a return/refund, which is a different flow).
 */
export const FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["packing", "cancelled"],
  packing: ["shipped"],
  shipped: ["delivered"],
  delivered: ["completed"],
  completed: [],
  cancelled: [],
};

/** Terminal statuses: nothing may leave them. */
export const TERMINAL_FULFILLMENT_STATUSES = ["completed", "cancelled"] as const;

/**
 * The statuses a CUSTOMER may still cancel from.
 *
 * `pending` (created, never taken to Stripe), `pending_payment` (has — possibly
 * abandoned — Checkout Session) and `confirmed` (accepted, not yet packed).
 * `packing` and everything after it is deliberately absent: the seller has
 * started fulfilling, so the money/stock problem moves to the return flow.
 * Mirrored by `CUSTOMER_CANCELABLE_ORDER_STATUSES` in
 * `packages/shared/src/lib/commerce.ts`, which
 * `PATCH /api/customer/orders/:orderId/cancel` pins its own literal list against.
 */
export const CUSTOMER_CANCELABLE_FULFILLMENT_STATUSES = ["pending", "confirmed"] as const;

/** Is `value` one of the seven fulfilment statuses? */
export function isFulfillmentStatus(value: unknown): value is FulfillmentStatus {
  return typeof value === "string" && (FULFILLMENT_STATUSES as readonly string[]).includes(value);
}

/** Whether an order may move from `from` to `to` under the business rules. */
export function canTransitionFulfillment(from: string, to: string): boolean {
  if (!isFulfillmentStatus(from) || !isFulfillmentStatus(to)) return false;
  return FULFILLMENT_TRANSITIONS[from].includes(to);
}

/**
 * Map a raw `orders.status` value to its fulfilment meaning.
 *
 * The Stripe flow writes its own lifecycle statuses, which are NOT part of the
 * fulfilment state machine; they are translated here so a row carrying one is
 * judged by what it MEANS:
 *
 *   pending / pending_payment / paid → pending   (payment state lives in `payments`)
 *   packing                          → packing
 *   payment_failed / refunded / expired → cancelled (nothing left to fulfil)
 *
 * `expired` (the payment reservation window lapsed and the stock was released)
 * is grouped with `cancelled` so a sweep-expired order can never be confirmed
 * into fulfilment. Unknown values fall back to `pending` — the safest direction,
 * because the transition table then still requires a real confirmation.
 */
export function normalizeOrderStatusToFulfillment(dbStatus: string): FulfillmentStatus {
  switch (dbStatus) {
    case "pending":
    case "pending_payment":
    case "paid":
      return "pending";
    case "confirmed":
      return "confirmed";
    case "packing":
      return "packing";
    case "shipped":
      return "shipped";
    case "delivered":
      return "delivered";
    case "completed":
      return "completed";
    case "cancelled":
    case "payment_failed":
    case "refunded":
    case "expired":
      return "cancelled";
    default:
      return "pending";
  }
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * A refusal from the state machine, carrying the HTTP answer the route should
 * give. Thrown INSIDE the caller's transaction so the whole transition (status,
 * shipment row, stock) rolls back together.
 */
export class FulfillmentError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "FulfillmentError";
  }
}

// ─── Payment gate (confirm) ──────────────────────────────────────────────────

/** Payment statuses that prove the money actually moved. */
export const PAID_PAYMENT_STATUSES = ["paid"] as const;

/** Payment methods settled outside a webhook (`payments.method` values). */
export const COD_PAYMENT_METHODS = ["cod", "cash_on_delivery"] as const;

/** Is this payment row's method cash-on-delivery? */
export function isCodPaymentMethod(method: unknown): boolean {
  return (
    typeof method === "string" &&
    (COD_PAYMENT_METHODS as readonly string[]).includes(method.trim().toLowerCase())
  );
}

export interface PaymentRowForFulfillment {
  method?: string | null;
  status?: string | null;
}

/**
 * May this set of payment rows let the order be CONFIRMED (enter fulfilment)?
 *
 * Pure on purpose, so both the route and its tests read one rule:
 *   • a `paid` row anywhere in the order's history proves payment — the webhook
 *     is the only writer of that value, and a seller cannot set it;
 *   • otherwise COD may pass, but ONLY while the COD rail is actually enabled —
 *     and it is disabled by default, so this branch is closed in production.
 *
 * `rows` is newest-first (the same order the order APIs expose as `paymentStatus`).
 */
export function paymentAllowsConfirmation(
  rows: PaymentRowForFulfillment[],
  codEnabled: boolean = isCodEnabled(),
): { allowed: boolean; method: string | null } {
  const paidRow = rows.find(
    (row) =>
      typeof row.status === "string" &&
      (PAID_PAYMENT_STATUSES as readonly string[]).includes(row.status.trim().toLowerCase()),
  );
  if (paidRow) return { allowed: true, method: paidRow.method ?? null };

  const latest = rows[0] ?? null;
  if (codEnabled && latest && isCodPaymentMethod(latest.method)) {
    return { allowed: true, method: latest.method ?? null };
  }

  return { allowed: false, method: latest?.method ?? null };
}

/**
 * Refuse a confirmation of an order that has not been paid.
 *
 * Runs inside the caller's transaction, after the order row is locked, so a
 * webhook landing at the same instant either committed before this read (and the
 * confirmation is then legitimate) or waits behind the lock — the order can
 * never be confirmed on a stale reading of the payment state.
 */
export async function assertPaymentConfirmedForConfirmation(
  client: pg.PoolClient,
  orderId: string,
): Promise<{ method: string | null }> {
  let rows: PaymentRowForFulfillment[] = [];
  try {
    const res = await client.query(
      `SELECT method, status FROM payments WHERE order_id = $1 ORDER BY created_at DESC`,
      [orderId],
    );
    rows = res.rows as PaymentRowForFulfillment[];
  } catch (err: any) {
    // `payments` is part of the core schema, so a missing table here means a
    // database that cannot fulfil orders at all — never silently allow the move.
    if (err?.code === "42P01") {
      throw new FulfillmentError(
        409,
        "PAYMENT_NOT_CONFIRMED",
        "This order has no payment record yet, so it cannot be confirmed.",
      );
    }
    throw err;
  }

  const decision = paymentAllowsConfirmation(rows);
  if (!decision.allowed) {
    throw new FulfillmentError(
      409,
      "PAYMENT_NOT_CONFIRMED",
      "This order has not been paid yet. Confirm it once the payment is settled.",
    );
  }
  return { method: decision.method };
}

// ─── Shipment gate (packing → shipped) ───────────────────────────────────────

export interface ShipmentInput {
  carrier?: unknown;
  trackingNumber?: unknown;
}

export interface ShipmentRecord {
  id: string;
  carrier: string;
  trackingNumber: string | null;
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Make sure a real shipment exists before an order is marked `shipped`.
 *
 * `shipped` must never be a placeholder: it is the state that tells the
 * customer their parcel is on its way, so it requires a `shipments` row that
 * carries a carrier and a tracking number. There is no second shipment system —
 * this writes the SAME table the order pages already read.
 *
 * The caller may pass the details (the seller UI's ship dialog does); when it
 * does not, an existing valid shipment on the order is accepted unchanged, and
 * anything else is refused with `SHIPMENT_REQUIRED`.
 *
 * Runs inside the caller's transaction, so a refused transition never leaves a
 * half-created shipment behind.
 */
export async function ensureShipmentForShipping(
  client: pg.PoolClient,
  orderId: string,
  input: ShipmentInput = {},
): Promise<ShipmentRecord> {
  const carrier = clean(input.carrier);
  const trackingNumber = clean(input.trackingNumber);

  const existingRes = await client.query(
    `SELECT id, carrier, tracking_number FROM shipments
      WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );
  const existing = existingRes.rows[0] as
    | { id: string; carrier: string | null; tracking_number: string | null }
    | undefined;

  if (existing) {
    const nextCarrier = carrier ?? clean(existing.carrier);
    const nextTracking = trackingNumber ?? clean(existing.tracking_number);
    if (nextCarrier && nextTracking) {
      const updated = await client.query(
        `UPDATE shipments
            SET carrier = $1, tracking_number = $2,
                status = CASE WHEN status = 'pending' THEN 'created' ELSE status END,
                updated_at = NOW()
          WHERE id = $3
          RETURNING id, carrier, tracking_number`,
        [nextCarrier, nextTracking, existing.id],
      );
      const row = updated.rows[0];
      return { id: row.id, carrier: row.carrier, trackingNumber: row.tracking_number };
    }
    throw new FulfillmentError(
      400,
      "SHIPMENT_REQUIRED",
      "A carrier and a tracking number are required before an order can be marked as shipped.",
    );
  }

  if (carrier && trackingNumber) {
    const inserted = await client.query(
      `INSERT INTO shipments (order_id, carrier, tracking_number, status)
       VALUES ($1, $2, $3, 'created')
       RETURNING id, carrier, tracking_number`,
      [orderId, carrier, trackingNumber],
    );
    const row = inserted.rows[0];
    return { id: row.id, carrier: row.carrier, trackingNumber: row.tracking_number };
  }

  throw new FulfillmentError(
    400,
    "SHIPMENT_REQUIRED",
    "A carrier and a tracking number are required before an order can be marked as shipped.",
  );
}
