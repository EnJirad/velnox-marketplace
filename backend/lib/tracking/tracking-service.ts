/**
 * Tracking service — the orchestrator between the carrier adapters, the DB and
 * the shipment lifecycle.
 *
 * Responsibilities (task Phase 6):
 *   • cache    — in-memory TTL store; read surfaces never hit the carrier when
 *                a fresh answer exists,
 *   • dedup    — concurrent refreshes for the same parcel share ONE in-flight
 *                promise (no carrier hammering from double taps / two tabs),
 *   • cooldown — a forced re-check inside the cooldown window returns the
 *                stored state with `message: RECENTLY_CHECKED`,
 *   • timeout  — every adapter call enforces a non-zero timeout via safeFetch,
 *   • error normalization — carrier problems become safe `TrackingErrorCode`s,
 *   • machine integration — a carrier status that maps to a further shipment
 *                machine state advances it STEP BY STEP through
 *                `transitionShipment` (the one legal mover), publishing the
 *                shipment:updated event and writing the customer notification
 *                once, on the final reached state.
 *
 * No fake data: an unreachable carrier yields a normalized error and the stored
 * events/vocabulary stay untouched.
 */
import { CARRIERS_BY_CODE, resolveCarrierCode, carrierName } from "./carrier-adapter.js";
import {
  getShipmentForOrder,
  persistTrackingSync,
  persistTrackingError,
  recipientPhoneForOrder,
  isSchemaGapError,
  type ShipmentRow,
  type IncomingTrackingEvent,
} from "./shipment-repo.js";
import { transitionShipment } from "../order-shipment.js";
import { canTransitionShipment, isTerminalShipmentStatus, type ShipmentStatus } from "../order-shipment-states.js";
import { publishOrderEvent } from "../order-events.js";
import { notifyOrderCustomerOfShipment } from "../order-notifications.js";
import { latestEventStatus } from "./normalizer.js";
import { withTransaction, query } from "../../db/index.js";
import type { CarrierAdapter, CarrierCode, TrackedEventStatus } from "./types.js";

// ─── Tunables (env, safe defaults — task forbids 0 timeouts) ────────────────
export const TRACKING_CACHE_TTL_MS = Number(process.env.TRACKING_CACHE_TTL_MS ?? 15 * 60_000);
export const TRACKING_REFRESH_COOLDOWN_MS = Number(process.env.TRACKING_REFRESH_COOLDOWN_MS ?? 60_000);
export const TRACKING_CARRIER_TIMEOUT_MS = Number(process.env.TRACKING_CARRIER_TIMEOUT_MS ?? 10_000);
const TERMINAL_CACHE_TTL_MS = 6 * 60 * 60_000;
const ERROR_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  at: number;
  view: TrackingResultView;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<TrackingResultView>>();

export type RefreshMessage =
  | "UPDATED"
  | "NO_TRACKING_NUMBER"
  | "UNSUPPORTED_CARRIER"
  | "RECENTLY_CHECKED"
  | "CARRIER_ERROR"
  | "CARRIER_NO_RECORD";

export interface TrackingResultView {
  shipmentId: string;
  orderId: string;
  carrier: string;
  carrierCode: string | null;
  carrierName: string;
  trackingNumber: string | null;
  /** Latest normalized event status (the timeline headline). */
  status: TrackedEventStatus;
  /** The shipment MACHINE status (fulfilment authority). */
  shipmentStatus: string;
  originalStatus: string | null;
  estimatedDeliveryDate: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  trackingConfirmed: boolean;
  refreshed: boolean;
  message: RefreshMessage;
  events: Array<{
    status: TrackedEventStatus;
    description: string | null;
    location: string | null;
    occurredAt: string | null;
    originalStatus: string | null;
  }>;
}

/** Event statuses that have a shipment-machine counterpart. */
const EVENT_TO_MACHINE: Partial<Record<TrackedEventStatus, ShipmentStatus>> = {
  picked_up: "picked_up",
  arrived_at_hub: "in_transit",
  in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  cancelled: "cancelled",
  lost: "lost",
};

const MACHINE_PATH: ShipmentStatus[] = ["picked_up", "in_transit", "out_for_delivery", "delivered"];

function cacheKey(shipment: ShipmentRow): string {
  return `${shipment.id}:${shipment.trackingNumber ?? ""}`;
}

async function loadEventsView(shipmentId: string): Promise<TrackingResultView["events"]> {
  // Defensive: production may not be reconciled to `carrier_status`; only a
  // schema-gap error falls back to the legacy column set. Any other failure is
  // treated as "no events" for the read surface (never a 500 on the order).
  const EVENTS_EXTENDED = `SELECT status, description, location, occurred_at, carrier_status
       FROM tracking_events WHERE shipment_id = $1 ORDER BY occurred_at ASC`;
  const EVENTS_LEGACY = `SELECT status, description, location, occurred_at
       FROM tracking_events WHERE shipment_id = $1 ORDER BY occurred_at ASC`;
  try {
    let res;
    try {
      res = await query(EVENTS_EXTENDED, [shipmentId]);
    } catch (err) {
      if (!isSchemaGapError(err)) throw err;
      res = await query(EVENTS_LEGACY, [shipmentId]);
    }
    return res.rows.map((r: any) => ({
      status: r.status as TrackedEventStatus,
      description: r.description ?? null,
      location: r.location ?? null,
      occurredAt: r.occurred_at ? new Date(r.occurred_at).toISOString() : null,
      originalStatus: r.carrier_status ?? null,
    }));
  } catch {
    return [];
  }
}

export async function buildView(
  shipment: ShipmentRow,
  overrides: Partial<TrackingResultView> = {},
): Promise<TrackingResultView> {
  const code = shipment.carrierCode ?? resolveCarrierCode(shipment.carrier);
  const events = shipment.trackingNumber ? await loadEventsView(shipment.id) : [];
  const latest = events.length ? events[events.length - 1]!.status : ("info" as TrackedEventStatus);
  return {
    shipmentId: shipment.id,
    orderId: shipment.orderId,
    carrier: shipment.carrier,
    carrierCode: code,
    carrierName: carrierName(code),
    trackingNumber: shipment.trackingNumber,
    status: latest,
    shipmentStatus: shipment.status,
    originalStatus: shipment.originalStatus,
    estimatedDeliveryDate: shipment.estimatedDeliveryDate,
    lastCheckedAt: shipment.lastCheckedAt ? shipment.lastCheckedAt.toISOString() : null,
    lastError: shipment.lastError,
    trackingConfirmed: shipment.trackingConfirmed,
    refreshed: false,
    message: "UPDATED",
    events,
    ...overrides,
  };
}

/** Read-only latest view — cache first, never calls a carrier. */
export async function getTrackingView(orderId: string): Promise<TrackingResultView> {
  const shipment = await getShipmentForOrder(orderId);
  if (!shipment) {
    throw new TrackingRequestError(404, "NO_SHIPMENT", "No shipment exists for this order");
  }
  const key = cacheKey(shipment);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TRACKING_CACHE_TTL_MS) return hit.view;
  const view = await buildView(shipment);
  cache.set(key, { at: Date.now(), view });
  return view;
}

/**
 * Refresh a parcel from its carrier. Enforces the cooldown window and merges
 * concurrent calls; only ever writes events the carrier actually reported.
 */
export async function refreshOrderTracking(orderId: string): Promise<TrackingResultView> {
  const shipment = await getShipmentForOrder(orderId);
  if (!shipment) throw new TrackingRequestError(404, "NO_SHIPMENT", "No shipment exists for this order");
  if (!shipment.trackingNumber) return buildView(shipment, { message: "NO_TRACKING_NUMBER" });

  const code: CarrierCode | null = (shipment.carrierCode as CarrierCode | null) ?? resolveCarrierCode(shipment.carrier);
  const adapter = code ? CARRIERS_BY_CODE.get(code) : undefined;
  if (!code || !adapter) {
    return buildView(shipment, { message: "UNSUPPORTED_CARRIER" });
  }

  const key = cacheKey(shipment);

  if (shipment.lastCheckedAt && Date.now() - shipment.lastCheckedAt.getTime() < TRACKING_REFRESH_COOLDOWN_MS) {
    const hit = cache.get(key);
    if (hit) return { ...hit.view, refreshed: false, message: "RECENTLY_CHECKED" };
    return buildView(shipment, { refreshed: false, message: "RECENTLY_CHECKED" });
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = doRefresh(shipment, adapter, key);
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

async function doRefresh(shipment: ShipmentRow, adapter: CarrierAdapter, key: string): Promise<TrackingResultView> {
  const trackingNumber = shipment.trackingNumber!;
  // J&T verifies the receiver; the phone is read SERVER-side ONLY from this
  // order's own address snapshot — never from the client.
  const phone: string | undefined =
    adapter.code === "JT" ? (await recipientPhoneForOrder(shipment.orderId)) ?? undefined : undefined;
  const checkedAt = new Date();

  let outcome;
  try {
    outcome = await adapter.fetch({ trackingNumber, phone });
  } catch (err) {
    await persistTrackingError(shipment.id, checkedAt, "UNKNOWN_ERROR", false);
    const view = await buildView(shipment, {
      refreshed: true,
      message: "CARRIER_ERROR",
      lastError: "UNKNOWN_ERROR",
      lastCheckedAt: checkedAt.toISOString(),
    });
    return view;
  }

  if (!outcome.ok) {
    const code = outcome.error.code;
    await persistTrackingError(shipment.id, checkedAt, code, false);
    const view = await buildView(shipment, {
      refreshed: true,
      message: code === "NOT_FOUND" ? "CARRIER_NO_RECORD" : "CARRIER_ERROR",
      lastError: code,
      lastCheckedAt: checkedAt.toISOString(),
    });
    cache.set(key, { at: Date.now(), view });
    return view;
  }

  const events: IncomingTrackingEvent[] = outcome.events.map((e) => ({
    status: e.status,
    description: e.description,
    location: e.location,
    occurredAt: e.occurredAt,
    originalStatus: e.originalStatus,
  }));

  await persistTrackingSync(shipment.id, {
    events,
    originalStatus: outcome.originalStatus,
    trackingConfirmed: outcome.confirmed,
    lastError: null,
    lastErrorAt: null,
    checkedAt,
    estimatedDeliveryDate: outcome.estimatedDeliveryDate,
  });

  // Advance the shipment machine toward the carrier's current status.
  const latest = latestEventStatus(events);
  const machineTarget = EVENT_TO_MACHINE[latest];
  let fromStatus: string | undefined;
  let movedTo: string | null = null;

  if (machineTarget && !isTerminalShipmentStatus(machineTarget)) {
    const pathIndex = MACHINE_PATH.indexOf(machineTarget);
    if (pathIndex >= 0) {
      await withTransaction(async (client) => {
        let current: ShipmentStatus = shipment.status as ShipmentStatus;
        const currentIdx = MACHINE_PATH.indexOf(current);
        for (let i = Math.max(currentIdx, 0); i < pathIndex; i++) {
          const next = MACHINE_PATH[i + 1]!;
          if (!canTransitionShipment(current, next)) break;
          const before = current;
          const step = await transitionShipment(client, shipment.orderId, next);
          current = step.shipment.status;
          fromStatus = before;
          movedTo = current;
        }
      });
    }
  } else if (machineTarget === "cancelled" || machineTarget === "lost") {
    if (!isTerminalShipmentStatus(shipment.status) && canTransitionShipment(shipment.status, machineTarget)) {
      await withTransaction(async (client) => {
        const step = await transitionShipment(client, shipment.orderId, machineTarget);
        fromStatus = shipment.status;
        movedTo = step.shipment.status;
      });
    }
  }

  if (movedTo) {
    // Publish once on the final reached state (4 stepwise advances that happen
    // in one request are one user-visible "the parcel moved" event).
    const finalTo: ShipmentStatus = movedTo as ShipmentStatus;
    await publishOrderEvent("shipment:updated", shipment.orderId, {
      orderId: shipment.orderId,
      shipmentId: shipment.id,
      from: fromStatus,
      to: finalTo,
    });
    await notifyOrderCustomerOfShipment(shipment.orderId, finalTo);
  }

  const updated = (await getShipmentForOrder(shipment.orderId)) ?? shipment;
  const view = await buildView(updated, { refreshed: true, message: "UPDATED" });
  const ttl = isTerminalShipmentStatus(updated.status) ? TERMINAL_CACHE_TTL_MS : TRACKING_CACHE_TTL_MS;
  cache.set(key, { at: Date.now(), view });

  // Reap stale cache entries opportunistically so the map cannot grow unbounded.
  if (cache.size > 5_000) {
    const now = Date.now();
    for (const [k, entry] of cache) {
      const ttlFor = isTerminalShipmentStatus(entry.view.shipmentStatus) ? TERMINAL_CACHE_TTL_MS : ERROR_CACHE_TTL_MS;
      if (now - entry.at > ttlFor * 2) cache.delete(k);
    }
  }
  return view;
}

export class TrackingRequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "TrackingRequestError";
  }
}
