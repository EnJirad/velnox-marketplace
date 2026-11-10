/**
 * Velnox Integrated Multi-Carrier Tracking — shared types.
 *
 * The unified vocabulary and the carrier-adapter contract. Every carrier
 * adapter speaks this shape, and the frontends render this shape, so a carrier
 * change never leaks through to the UI.
 *
 * Unified status vocabulary (tracking_events.status):
 *
 *   info             informational / generic event (also the legacy default)
 *   created          parcel created, not yet handed to the carrier
 *   picked_up        carrier took the parcel (first physical handoff)
 *   arrived_at_hub   arrived at a sorting / pickup hub
 *   in_transit       moving between hubs
 *   out_for_delivery on the last leg to the customer
 *   delivered        arrived.                        TERMINAL
 *   failed           delivery failed (delivery_failed)
 *   returning        on its way back to the seller
 *   returned         came back.                      TERMINAL
 *   cancelled        cancelled before handoff.       TERMINAL
 *   lost             declared lost by the carrier.   TERMINAL
 *   unknown          a status the normalizer cannot map
 *
 * This EXTENDS the existing vocabulary used by `backend/lib/order-shipment-states.ts`
 * and the existing `trackingLabels` i18n map — it never replaces the shipment
 * machine status (`shipments.status`), which stays the fulfilment authority.
 */

/** The six supported carriers. */
export type CarrierCode = "JT" | "FLASH" | "SPX" | "TNT" | "KERRY" | "THAILANDPOST";

export type TrackedEventStatus =
  | "info"
  | "created"
  | "picked_up"
  | "arrived_at_hub"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "failed"
  | "returning"
  | "returned"
  | "cancelled"
  | "lost"
  | "unknown";

/** The statuses after which re-fetching the carrier is pointless. */
export const TERMINAL_TRACKED_STATUSES: readonly TrackedEventStatus[] = [
  "delivered",
  "returned",
  "cancelled",
  "lost",
] as const;

/**
 * Normalized, SAFE error codes. These are what gets exposed to clients and
 * persisted in `shipments.last_error` — never free-form carrier text and never
 * a phone number or other PII.
 */
export type TrackingErrorCode =
  | "INVALID_TRACKING_NUMBER"
  | "NOT_FOUND"
  | "CAPTCHA_REQUIRED"
  | "BLOCKED"
  | "UNSUPPORTED"
  | "OFFICIAL_ACCESS_REQUIRED"
  | "PII_REQUIRED"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "CARRIER_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "UNKNOWN_ERROR";

export interface CarrierError {
  code: TrackingErrorCode;
  message: string;
  /** May safely be retried after a short cooldown (network-level errors only). */
  retryable: boolean;
}

export interface TrackingEventInput {
  /** Normalized unified status. */
  status: TrackedEventStatus;
  description: string | null;
  location: string | null;
  occurredAt: Date | null;
  /** The carrier's ORIGINAL status string — never normalized away. */
  originalStatus: string | null;
  /** Stable ordering position for same-timestamp events. */
  order?: number;
}

export interface FetchTrackingInput {
  trackingNumber: string;
  /** Optional phone used by carriers that verify the receiver (J&T). Never logged. */
  phone?: string;
}

export type FetchTrackingResult =
  | {
      ok: true;
      /** Raw latest status string from the carrier, if the carrier reports one. */
      originalStatus: string | null;
      currentStatus: TrackedEventStatus;
      events: TrackingEventInput[];
      estimatedDeliveryDate: Date | null;
      /** True when the carrier actually confirmed a live record for the number. */
      confirmed: boolean;
    }
  | { ok: false; error: CarrierError };

/** The carrier-adapter contract — every carrier implements exactly this. */
export interface CarrierAdapter {
  readonly code: CarrierCode;
  readonly name: string;
  readonly nameTh: string;
  /** Sample tracking-number shapes, for placeholder/help text. */
  readonly numberExamples: readonly string[];
  /**
   * True when the public endpoint is gated (captcha / anti-bot / official
   * access). The adapter still implements the call so it can run when
   * credentials or official access are provided, but the registry reports it
   * as not production-ready until then.
   */
  readonly requiresOfficialAccess: boolean;
  /** Format check only — never a guarantee the carrier has the parcel. */
  validate(trackingNumber: string): boolean;
  fetch(input: FetchTrackingInput): Promise<FetchTrackingResult>;
}
