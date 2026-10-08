/**
 * The ONE shipment transition helper.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The repository already had a canonical vocabulary for a parcel
 * (`shipments_status_check`, migration 056) but no way to MOVE a shipment
 * through it: `ensureShipmentForShipping()` could only create the row (and was
 * the only writer that ever touched `shipments.status`, always to `created`).
 * Everything after that — picked up, in transit, out for delivery, delivered —
 * had no writer at all, so the later states of the lifecycle were unreachable.
 *
 * This module adds exactly that missing piece and nothing else:
 *
 *   • ONE helper (`transitionShipment`) that both the seller route and the
 *     VelCenter route call, so the two surfaces can never disagree about what a
 *     shipment move means.
 *   • It reuses the EXISTING creation path for the row (`ensureShipmentForShipping`
 *     — the only keyed shipment insert in the codebase, with the Phase-2
 *     `ON CONFLICT (order_id)` arbitration and the order-row lock it takes
 *     itself). No second shipment system, and the Phase-2 invariant (one
 *     canonical shipment per order) is untouched.
 *   • It reuses the EXISTING fulfilment authority to decide whether the ORDER
 *     moves (`advanceOrderFulfillmentAxis` → `canTransitionFulfillment` +
 *     `projectOrderStatus`). No duplicate state machine, and no direct write to
 *     `orders.status`.
 *
 * CONCURRENCY
 * -----------
 * Two requests for the same order are serialised by the ORDER ROW, exactly as
 * every other order writer in this codebase is (`lib/order-lock.ts` — the lock
 * is taken FIRST, so there is no cycle to deadlock on). Under READ COMMITTED the
 * loser waits, then re-reads the committed row and is judged against the state
 * the winner produced — so `created → picked_up` racing itself yields one
 * `picked_up`, and the second request is refused (or, if it asked for the status
 * that was just reached, answered as an idempotent success).
 *
 * The UPDATE is additionally CONDITIONAL on the status that was read
 * (`WHERE id = $n AND status = $n+1`), so even a writer that somehow reached
 * this statement without the lock cannot move a shipment from a state other than
 * the one it validated against.
 *
 * IDEMPOTENCY
 * -----------
 * Asking for a transition the shipment is ALREADY in is a SUCCESS, not an error
 * and not a write: the row is returned unchanged — no timestamp is re-stamped, no
 * carrier or tracking number is touched, and the order axis is not advanced
 * twice (`moved` is false). A repeated `delivered` after a delivered shipment
 * therefore has no effect at all.
 *
 * Everything else that is not an edge in `SHIPMENT_TRANSITIONS`
 * (`order-shipment-states.ts`) is refused with 409
 * `INVALID_SHIPMENT_TRANSITION` — including every backward move
 * (`delivered → created`, `in_transit → picked_up`, …), any move into `returned`
 * (the returns/RMA flow owns that value), and any move out of a terminal state.
 */
import type pg from "pg";
import { lockOrderRow } from "./order-lock.js";
import { FulfillmentError, ensureShipmentForShipping } from "./order-fulfillment.js";
import { advanceOrderFulfillmentAxis } from "./order-state.js";
import {
  SHIPMENT_HANDOFF_STATUS,
  canTransitionShipment,
  type ShipmentRecord,
  type ShipmentStatus,
} from "./order-shipment-states.js";

/**
 * The shipment states that ARE a fulfilment fact for the order, and the order
 * fulfilment status each one implies.
 *
 * This mapping is read off the source, not invented: `FULFILLMENT_STATUSES` in
 * `order-fulfillment.ts` defines `shipped` as "a real shipment row with a carrier
 * and tracking number exists" and `delivered` as "the shipment arrived", and
 * `shipments.shipped_at` / `delivered_at` (migration 056) are the shipment's own
 * stamps for those two moments. So the handoff is the order's `shipped`, and the
 * arrival is the order's `delivered`.
 *
 * The states that carry no order meaning are absent on purpose — `pending` and
 * `created` only mean "a row exists" (the order-status routes already move the
 * order to `shipped` when they create the parcel), and `cancelled` / `lost` /
 * `returned` are operator/carrier facts about the PARCEL: mapping them onto the
 * order would silently cancel a fulfilment decision that belongs to the
 * order-status routes and their payment gates.
 */
const ORDER_STATUS_FOR_SHIPMENT: Partial<Record<ShipmentStatus, "shipped" | "delivered">> = {
  [SHIPMENT_HANDOFF_STATUS]: "shipped",
  in_transit: "shipped",
  out_for_delivery: "shipped",
  delivered: "delivered",
};

/** What a transition call did — the payload the routes publish. */
export interface ShipmentTransitionResult {
  shipment: ShipmentRecord;
  /** The status the shipment held before the call. */
  from: ShipmentStatus;
  /** The status the shipment holds after the call. */
  to: ShipmentStatus;
  /** False when the shipment was ALREADY in `to` (an idempotent repeat). */
  moved: boolean;
  /** True when the order's own fulfilment axis advanced as part of this move. */
  orderAdvanced: boolean;
}

/** Trim a client value to a usable string, or null. */
function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The current canonical shipment of an order, or null when it has none. */
export async function readShipment(
  client: pg.PoolClient,
  orderId: string,
): Promise<ShipmentRecord | null> {
  const res = await client.query(
    `SELECT id, carrier, tracking_number, status, shipped_at, delivered_at
       FROM shipments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );
  const r = res.rows[0] as
    | {
        id: string;
        carrier: string | null;
        tracking_number: string | null;
        status: string;
        shipped_at: Date | null;
        delivered_at: Date | null;
      }
    | undefined;
  return r ? rowToShipment(r) : null;
}

function rowToShipment(r: {
  id: string;
  carrier: string | null;
  tracking_number: string | null;
  status: string;
  shipped_at: Date | null;
  delivered_at: Date | null;
}): ShipmentRecord {
  return {
    id: r.id,
    carrier: r.carrier ?? "",
    trackingNumber: r.tracking_number,
    status: r.status as ShipmentStatus,
    shippedAt: r.shipped_at ? new Date(r.shipped_at) : null,
    deliveredAt: r.delivered_at ? new Date(r.delivered_at) : null,
  };
}

/**
 * Move an order's shipment to `targetStatus`.
 *
 * MUST be called inside the caller's `withTransaction` block: it takes the order
 * row lock itself and the whole check-and-move (shipment status, timestamps, and
 * the order's fulfilment axis) commits or rolls back with the caller.
 *
 * `input.carrier` / `input.trackingNumber` are ADDITIVE: they fill a value the
 * row does not have yet and are never used to overwrite one it already has, so
 * no transition can lose a tracking number.
 */
export async function transitionShipment(
  client: pg.PoolClient,
  orderId: string,
  targetStatus: ShipmentStatus,
  input: { carrier?: unknown; trackingNumber?: unknown } = {},
): Promise<ShipmentTransitionResult> {
  const carrier = clean(input.carrier);
  const trackingNumber = clean(input.trackingNumber);

  // The order is the serialisation point for everything about the order,
  // including its parcel. Taken FIRST, as lib/order-lock.ts requires.
  const order = await lockOrderRow(client, orderId);
  if (!order) {
    throw new FulfillmentError(404, "NOT_FOUND", "Order not found");
  }

  let shipment = await readShipment(client, orderId);

  // `created` is the one status that may bring the row into existence, and it
  // goes through the EXISTING single writer — the same call the two order-status
  // routes make, with the same Phase-2 ON CONFLICT arbitration behind it. Every
  // other target needs a parcel that already exists.
  if (!shipment && targetStatus === "created") {
    await ensureShipmentForShipping(client, orderId, { carrier, trackingNumber });
    shipment = await readShipment(client, orderId);
  }
  if (!shipment) {
    throw new FulfillmentError(
      404,
      "SHIPMENT_NOT_FOUND",
      "This order has no shipment yet. Create one by moving it to 'created' with a carrier and a tracking number.",
    );
  }

  const currentStatus = shipment.status;

  // A repeat is a SUCCESS and a no-op — checked BEFORE the transition table,
  // which deliberately has no self-edges so that a repeat is never mistaken for a
  // state change (nothing here re-stamps a timestamp or rewrites tracking).
  if (currentStatus === targetStatus) {
    return { shipment, from: currentStatus, to: targetStatus, moved: false, orderAdvanced: false };
  }

  if (!canTransitionShipment(currentStatus, targetStatus)) {
    throw new FulfillmentError(
      409,
      "INVALID_SHIPMENT_TRANSITION",
      `Cannot move shipment from '${currentStatus}' to '${targetStatus}'.`,
    );
  }

  // The handoff is the first state that means "the parcel is physically with the
  // courier", so it is the one move that must have a carrier and a tracking
  // number behind it — the same requirement, and the same refusal, the order's
  // own `shipped` branch has always enforced through the creation helper.
  if (targetStatus === SHIPMENT_HANDOFF_STATUS) {
    const hasCarrier = Boolean(shipment.carrier) || Boolean(carrier);
    const hasTracking = Boolean(shipment.trackingNumber) || Boolean(trackingNumber);
    if (!hasCarrier || !hasTracking) {
      throw new FulfillmentError(
        400,
        "SHIPMENT_REQUIRED",
        "A carrier and a tracking number are required before a shipment can be handed to the carrier.",
      );
    }
  }

  // Additive SQL: a value that is already present can never be replaced, so a
  // retry cannot lose a carrier or a tracking number, and each timestamp is
  // stamped once. (COALESCE — never a read-modify-write.)
  const setClauses = ["status = $2", "updated_at = NOW()"];
  const values: unknown[] = [shipment.id, targetStatus];
  const add = (clause: (n: number) => string, value: unknown) => {
    values.push(value);
    setClauses.push(clause(values.length));
  };
  if (targetStatus === SHIPMENT_HANDOFF_STATUS) {
    add((n) => `shipped_at = COALESCE(shipped_at, $${n})`, new Date());
  }
  if (targetStatus === "delivered") {
    add((n) => `delivered_at = COALESCE(delivered_at, $${n})`, new Date());
  }
  if (carrier) add((n) => `carrier = COALESCE(NULLIF(carrier, ''), $${n}::text)`, carrier);
  if (trackingNumber) {
    add((n) => `tracking_number = COALESCE(tracking_number, $${n}::text)`, trackingNumber);
  }

  // The claim: the row must still be in the status this decision was made
  // against. Under the order-row lock it always is; the guard is what makes that
  // true even for a writer that reached this statement without the lock.
  values.push(currentStatus);
  const res = await client.query(
    `UPDATE shipments SET ${setClauses.join(", ")}
      WHERE id = $1 AND status = $${values.length}
      RETURNING id, carrier, tracking_number, status, shipped_at, delivered_at`,
    values,
  );
  const row = res.rows[0] as Parameters<typeof rowToShipment>[0] | undefined;
  if (!row) {
    throw new FulfillmentError(
      409,
      "SHIPMENT_CONCURRENT_MODIFICATION",
      "The shipment was modified concurrently. Please reload and try again.",
    );
  }
  const updated = rowToShipment(row);

  // ── Order fulfilment integration ─────────────────────────────────────────
  // The parcel is the authority for the parcel; the ORDER is the authority for
  // fulfilment — so the order is only ever asked to move through its own machine,
  // and a move it has no edge for REFUSES this request (409 ORDER_NOT_READY)
  // rather than letting the two lifecycles disagree.
  let orderAdvanced = false;
  const orderTarget = ORDER_STATUS_FOR_SHIPMENT[targetStatus];
  if (orderTarget) {
    const advanced = await advanceOrderFulfillmentAxis(client, orderId, orderTarget);
    orderAdvanced = advanced.moved;
  }

  return { shipment: updated, from: currentStatus, to: targetStatus, moved: true, orderAdvanced };
}
