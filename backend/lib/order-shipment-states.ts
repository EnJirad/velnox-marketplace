/**
 * Shipment lifecycle — the canonical vocabulary and the transition table.
 *
 * This module is the authority for WHAT a shipment's status means and WHEN it
 * may move. It is consumed by `order-shipment.ts` (the ONE transition helper)
 * and by the two routes that drive a parcel (seller + VelCenter), so no surface
 * can invent a shipment move of its own.
 *
 * WHERE THE VOCABULARY COMES FROM (not invented — read off the repository)
 * ----------------------------------------------------------------------
 * The database already arbitrates it: `shipments_status_check` declares
 *
 *     status IN ('pending', 'created', 'picked_up', 'in_transit',
 *                'out_for_delivery', 'delivered', 'returned', 'lost', 'cancelled')
 *
 * and that exact list is what `db/migrations/056_commerce_core_invariants.sql`,
 * `db/schema.sql` and `db/run-sqleditor.sql` install (the three agree, and
 * `backend/tests/shipment-lifecycle.test.ts` pins the three-way agreement so a
 * drifting copy fails the suite instead of production). `pending` and `created`
 * are the two legacy spellings that predate the transit vocabulary; they stay
 * accepted so no historical row is invalidated.
 *
 * Vocabulary in words:
 *
 *   pending           default; the row exists but carries nothing yet (legacy).
 *   created           a real shipment exists — carrier + tracking recorded.
 *   picked_up         the carrier took the parcel (the first physical handoff).
 *   in_transit        moving between hubs.
 *   out_for_delivery  on the last leg to the customer.
 *   delivered         arrived.                        TERMINAL
 *   returned          came back (owned by the returns/RMA flow).  TERMINAL
 *   lost              declared lost by the carrier.               TERMINAL
 *   cancelled         cancelled before handoff.                   TERMINAL
 *
 * The machine is deliberately LINEAR and FORWARD-ONLY:
 *
 *     pending → created → picked_up → in_transit → out_for_delivery → delivered
 *
 * with `cancelled` / `lost` reachable from every non-terminal state (a parcel
 * can be abandoned or disappear at any point) and no edge OUT of any terminal
 * state (so a late or duplicated request can never resurrect a delivered
 * parcel — a backward move such as delivered → created is unrepresentable).
 *
 * `returned` has NO incoming edge here on purpose: it belongs to the
 * returns/RMA flow, which is a different (and out-of-scope) system. The value
 * stays in the vocabulary because the database accepts it and historical rows
 * may carry it; the lifecycle simply never produces it.
 */

export const SHIPMENT_STATUSES = [
  "pending",
  "created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "returned",
  "lost",
  "cancelled",
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/**
 * Allowed transitions. A terminal row is empty on purpose: there is no way
 * back, so a late or duplicated request cannot move a finished parcel.
 */
export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  pending: ["created", "cancelled", "lost"],
  created: ["picked_up", "cancelled", "lost"],
  picked_up: ["in_transit", "cancelled", "lost"],
  in_transit: ["out_for_delivery", "cancelled", "lost"],
  out_for_delivery: ["delivered", "cancelled", "lost"],
  delivered: [],
  returned: [],
  lost: [],
  cancelled: [],
};

/** Statuses nothing may leave. */
export const TERMINAL_SHIPMENT_STATUSES = [
  "delivered",
  "returned",
  "lost",
  "cancelled",
] as const;

/**
 * The status a shipment must hold BEFORE it can be handed to a carrier — the
 * first state that means "the parcel is physically with the courier". Entering
 * it is what stamps `shipments.shipped_at`, and it is the one move that must
 * have a carrier and a tracking number behind it.
 */
export const SHIPMENT_HANDOFF_STATUS: ShipmentStatus = "picked_up";

/** Is `value` one of the nine shipment statuses? */
export function isShipmentStatus(value: unknown): value is ShipmentStatus {
  return typeof value === "string" && (SHIPMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Whether a shipment may move from `from` to `to`.
 *
 * A move to the CURRENT status is NOT a transition and is therefore not legal
 * here — the helper treats it as an idempotent success before it ever asks this
 * function, so a repeat is a no-op rather than a machine edge (a self-edge
 * would make `delivered → delivered` look like a state change).
 */
export function canTransitionShipment(from: string, to: string): boolean {
  if (!isShipmentStatus(from) || !isShipmentStatus(to)) return false;
  return SHIPMENT_TRANSITIONS[from].includes(to);
}

/** Is this status terminal (nothing may leave it)? */
export function isTerminalShipmentStatus(value: unknown): boolean {
  return typeof value === "string" && (TERMINAL_SHIPMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * A shipment row as the transition helper returns it — one shape, so the two
 * routes and the tests read the same fields.
 */
export interface ShipmentRecord {
  id: string;
  carrier: string;
  trackingNumber: string | null;
  status: ShipmentStatus;
  shippedAt: Date | null;
  deliveredAt: Date | null;
}
