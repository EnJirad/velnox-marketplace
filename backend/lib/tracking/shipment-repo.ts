/**
 * Shipment repository — the DB half of the tracking sync.
 *
 * Reads/writes the existing `shipments` + `tracking_events` tables (never a
 * second storage system). Event-dedupe is signature-based: a repeated carrier
 * pull cannot insert the same event twice. `updateShipmentSync` only ever
 * touches the tracking columns added for this feature — the shipment machine
 * (`status`) is exclusively moved by `order-shipment.transitionShipment`.
 */
import { query, withTransaction } from "../../db/index.js";
import type { TrackedEventStatus } from "./types.js";

/**
 * True when a Postgres error is a schema-gap error (a column or table the code
 * references does not exist yet). These are the ONLY errors the read fallbacks
 * handle — production may not have been reconciled to the new tracking columns,
 * and the reader must degrade to the legacy projection instead of 500-ing the
 * whole order. Every OTHER error (connection, SQL syntax, deadlock…) is
 * rethrown so a genuine failure is never masked as "success with no data".
 */
export function isSchemaGapError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "42703" || code === "42P01";
}

export interface ShipmentRow {
  id: string;
  orderId: string;
  carrier: string;
  carrierCode: string | null;
  trackingNumber: string | null;
  status: string;
  estimatedDeliveryDate: string | null;
  originalStatus: string | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  trackingConfirmed: boolean;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function rowToShipment(r: any): ShipmentRow {
  return {
    id: r.id,
    orderId: r.order_id,
    carrier: r.carrier ?? "",
    carrierCode: r.carrier_code ?? null,
    trackingNumber: r.tracking_number ?? null,
    status: r.status ?? "pending",
    estimatedDeliveryDate: r.estimated_delivery_date ?? null,
    originalStatus: r.original_status ?? null,
    lastCheckedAt: r.last_checked_at ?? null,
    lastError: r.last_error ?? null,
    lastErrorAt: r.last_error_at ?? null,
    trackingConfirmed: r.tracking_confirmed ?? false,
    shippedAt: r.shipped_at ?? null,
    deliveredAt: r.delivered_at ?? null,
    createdAt: r.created_at ?? new Date(),
    updatedAt: r.updated_at ?? new Date(),
  };
}

/** The canonical shipment for an order (one per order is enforced in the DB).
 *  Defensive: if the DB has not been reconciled to the new tracking columns,
 *  falls back to the legacy projection so the reader never 500s. */
export async function getShipmentForOrder(orderId: string): Promise<ShipmentRow | null> {
  const EXTENDED = `SELECT id, order_id, carrier, carrier_code, tracking_number, status,
            estimated_delivery_date, original_status, last_checked_at,
            last_error, last_error_at, tracking_confirmed,
            shipped_at, delivered_at, created_at, updated_at
     FROM shipments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`;
  const LEGACY = `SELECT id, order_id, carrier, tracking_number, status,
            estimated_delivery_date, shipped_at, delivered_at, created_at, updated_at
     FROM shipments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`;

  let res;
  try {
    res = await query(EXTENDED, [orderId]);
  } catch (err) {
    if (!isSchemaGapError(err)) throw err;
    res = await query(LEGACY, [orderId]);
  }
  return res.rows[0] ? rowToShipment(res.rows[0]) : null;
}

export interface IncomingTrackingEvent {
  status: TrackedEventStatus;
  description: string | null;
  location: string | null;
  occurredAt: Date | null;
  originalStatus: string | null;
}

function eventSignature(e: IncomingTrackingEvent): string {
  const ms = e.occurredAt ? e.occurredAt.getTime() : 0;
  return [ms, e.status, e.originalStatus ?? "", (e.description ?? "").slice(0, 120)].join("|");
}

/** Signatures of every stored event for a shipment, for dedupe comparison. */
export async function loadEventSignatures(shipmentId: string): Promise<Set<string>> {
  const res = await query(
    `SELECT occurred_at, status, carrier_status, description FROM tracking_events WHERE shipment_id = $1`,
    [shipmentId],
  );
  const set = new Set<string>();
  for (const r of res.rows) {
    set.add(
      [
        r.occurred_at ? new Date(r.occurred_at).getTime() : 0,
        r.status,
        r.carrier_status ?? "",
        (r.description ?? "").slice(0, 120),
      ].join("|"),
    );
  }
  return set;
}

/**
 * Persist a tracking sync for a shipment. Returns the events actually appended
 * (deduplicated) so the caller can tell whether anything changed.
 */
export async function persistTrackingSync(
  shipmentId: string,
  opts: {
    events: IncomingTrackingEvent[];
    originalStatus: string | null;
    trackingConfirmed: boolean;
    lastError: string | null;
    lastErrorAt: Date | null;
    checkedAt: Date;
    estimatedDeliveryDate: Date | null;
  },
): Promise<{ insertedEvents: IncomingTrackingEvent[] }> {
  const insertedEvents: IncomingTrackingEvent[] = [];
  await withTransaction(async (client) => {
    const existing = await loadEventSignatures(shipmentId);
    for (const e of opts.events) {
      const sig = eventSignature(e);
      if (existing.has(sig)) continue;
      await client.query(
        `INSERT INTO tracking_events (shipment_id, status, description, location, occurred_at, carrier_status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          shipmentId,
          e.status,
          e.description,
          e.location,
          e.occurredAt,
          e.originalStatus,
        ],
      );
      existing.add(sig);
      insertedEvents.push(e);
    }
    await client.query(
      `UPDATE shipments SET
         original_status = $2,
         tracking_confirmed = $3,
         last_checked_at = $4,
         last_error = $5,
         last_error_at = $6,
         estimated_delivery_date = COALESCE($7, estimated_delivery_date),
         updated_at = NOW()
       WHERE id = $1`,
      [
        shipmentId,
        opts.originalStatus,
        opts.trackingConfirmed,
        opts.checkedAt,
        opts.lastError,
        opts.lastErrorAt,
        opts.estimatedDeliveryDate,
      ],
    );
  });
  return { insertedEvents };
}

/** Persist a failed sync (last_checked_at + normalized error code only). */
export async function persistTrackingError(
  shipmentId: string,
  checkedAt: Date,
  errorCode: string,
  trackingConfirmed: boolean,
): Promise<void> {
  await query(
    `UPDATE shipments SET
       last_checked_at = $2,
       last_error = $3,
       last_error_at = $2,
       tracking_confirmed = $4,
       updated_at = NOW()
     WHERE id = $1`,
    [shipmentId, checkedAt, errorCode, trackingConfirmed],
  );
}

/** The order's recipient phone, read SERVER-side for carriers that verify the
 *  receiver (J&T). Security rule: never accepted from the client — the phone is
 *  only sent in a carrier request body, never logged, stored or returned. */
export async function recipientPhoneForOrder(orderId: string): Promise<string | null> {
  const res = await query(`SELECT shipping_address FROM orders WHERE id = $1`, [orderId]);
  const raw = res.rows[0]?.shipping_address;
  if (!raw) return null;
  const obj = typeof raw === "string" ? safeJson(raw) : raw;
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const phone =
    (typeof rec.phone === "string" && rec.phone) ||
    (typeof rec.recipientPhone === "string" && rec.recipientPhone) ||
    (typeof rec.recipient_phone === "string" && rec.recipient_phone) ||
    null;
  return phone && phone.trim() ? phone.trim() : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
