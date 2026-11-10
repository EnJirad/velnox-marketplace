/**
 * Thailand Post (ไปรษณีย์ไทย) adapter — official Track & Trace API v1.
 *
 * STATUS: **READY, TOKEN REQUIRED.** Unlike the gated carriers, Thailand Post
 * publishes a real, documented JSON API for tracking:
 *
 *   POST https://trackapi.thailandpost.co.th/post/api/v1/track
 *   Headers: Authorization: Token <token>, Content-Type: application/json
 *   Body:    { "status": "all", "language": "TH", "barcode": ["<code>", ...] }
 *
 * The token comes from the Thailand Post developer portal (free registration,
 * per-application). This adapter:
 *   • returns `OFFICIAL_ACCESS_REQUIRED` when `THAILANDPOST_API_TOKEN` is unset
 *     — never a fabricated status,
 *   • sends ONE barcode per call (the batch API exists, but a single tracking
 *     number is what a shipment row holds),
 *   • parses the documented `response.items[<barcode>]` shape defensively.
 *
 * Enabling production: register at the Thailand Post developer portal, set
 * `THAILANDPOST_API_TOKEN`. No code change is needed.
 */
import { getPath } from "./parse-utils.js";
import { cleanText, THAILANDPOST_STATUS_KEYWORDS, normalizeEventStatus, safeOccurredAt } from "../normalizer.js";
import { safeFetch } from "../safe-fetch.js";
import { errMalformed, errNotFound, errOfficialAccess } from "./shared.js";
import type { CarrierAdapter, FetchTrackingInput, FetchTrackingResult, TrackedEventStatus } from "../types.js";

const DEFAULT_URL = "https://trackapi.thailandpost.co.th/post/api/v1/track";
const TOKEN = () => (process.env.THAILANDPOST_API_TOKEN ?? "").trim();
const ENDPOINT = () => (process.env.THAILANDPOST_TRACK_URL ?? DEFAULT_URL).trim();

/** ThaiPost barcodes: 13 chars (EMS/registered) or alphanumeric 8–26. */
function validate(trackingNumber: string): boolean {
  return /^[A-Za-z0-9]{8,26}$/.test(trackingNumber.trim());
}

interface ThaiPostEvent {
  barcode?: string;
  status_date?: string;
  status_description?: string;
  status_detail?: string | null;
  location?: string;
  status?: string;
}

export const thailandPostAdapter: CarrierAdapter = {
  code: "THAILANDPOST",
  name: "Thailand Post",
  nameTh: "ไปรษณีย์ไทย",
  numberExamples: ["EE123456789TH"],
  requiresOfficialAccess: true,
  validate,
  async fetch(input: FetchTrackingInput): Promise<FetchTrackingResult> {
    const trackingNumber = input.trackingNumber.trim();
    if (!validate(trackingNumber)) return errMalformed("THAILANDPOST");

    const token = TOKEN();
    if (!token) {
      return errOfficialAccess(
        "THAILANDPOST",
        "THAILANDPOST_API_TOKEN is not configured (free developer-portal token required)",
      );
    }

    const outcome = await safeFetch({
      url: ENDPOINT(),
      method: "POST",
      carrier: "THAILANDPOST",
      trackingNumber,
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: { status: "all", language: "TH", barcode: [trackingNumber] },
    });
    if (!outcome.ok) return { ok: false, error: outcome.error };

    const json = outcome.json;
    // Documented shape: { response: { items: { "<barcode>": [event, ...] } } }
    const bucket =
      getPath(json, "response", "items", trackingNumber) ?? getPath(json, "response", "items") ?? null;
    const rows: ThaiPostEvent[] = Array.isArray(bucket)
      ? (bucket as ThaiPostEvent[])
      : bucket && typeof bucket === "object"
        ? (Object.values(bucket).flat() as ThaiPostEvent[])
        : [];

    if (rows.length === 0) {
      const message = String(getPath(json, "message") ?? getPath(json, "response", "message") ?? "");
      if (/not\s*found|ไม่พบ|invalid/i.test(message)) return errNotFound("THAILANDPOST");
      return errMalformed("THAILANDPOST");
    }

    const events: Array<{
      status: TrackedEventStatus;
      description: string | null;
      location: string | null;
      occurredAt: Date | null;
      originalStatus: string | null;
    }> = [];
    for (const row of rows) {
      const rawDesc = row.status_description ?? row.status_detail ?? row.status ?? null;
      const mapped = normalizeEventStatus(rawDesc, THAILANDPOST_STATUS_KEYWORDS);
      events.push({
        status: mapped.status,
        description: cleanText(rawDesc),
        location: cleanText(row.location ?? null, 200),
        occurredAt: row.status_date ? safeOccurredAt(row.status_date) : null,
        originalStatus: mapped.originalStatus,
      });
    }
    events.sort((a, b) => (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0));

    const latest = events[events.length - 1]!;
    return {
      ok: true,
      originalStatus: latest.originalStatus,
      currentStatus: latest.status,
      events,
      estimatedDeliveryDate: null,
      confirmed: true,
    };
  },
};
