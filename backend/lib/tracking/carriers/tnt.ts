/**
 * TNT Express adapter.
 *
 * VERIFIED against the public endpoint 2026-11-08:
 *   GET https://www.tnt.com/api/v3/shipment?con=<CON>&locale=en_US&searchType=CON&channel=DIRECT
 *   → HTTP 200, structured JSON; unknown numbers return
 *     {"tracker.output":{"notFound":[{...}]}} — not-found handled correctly.
 *
 * Status: PARTIAL. The public endpoint works and is parseable, but no LIVE CON
 * record was available to verify a full tracking chain, and TNT-branded
 * domestic service in Thailand now sits with FedEx. The adapter parses the
 * known `consignments` success shape defensively and reports MALFORMED_RESPONSE
 * (never fake events) when the body is not what we expect.
 */
import { firstArrayByKey, firstDate, firstString, getPath } from "./parse-utils.js";
import { normalizeEventStatus, safeOccurredAt, cleanText, TNT_STATUS_KEYWORDS } from "../normalizer.js";
import { safeFetch } from "../safe-fetch.js";
import { errMalformed, errNotFound } from "./shared.js";
import type {
  CarrierAdapter,
  FetchTrackingInput,
  FetchTrackingResult,
  TrackedEventStatus,
} from "../types.js";

const API_URL = "https://www.tnt.com/api/v3/shipment";

/** TNT CON: 9-ish digits; accept a loose alphanumeric 8–12. */
function validate(trackingNumber: string): boolean {
  return /^[A-Za-z0-9]{8,12}$/.test(trackingNumber.trim());
}

function isNotFoundShape(json: unknown): boolean {
  const notFound = getPath(json, "tracker.output", "notFound");
  return Array.isArray(notFound) && notFound.length > 0;
}

function parseConsignment(node: unknown): FetchTrackingResult | null {
  const rawConsStatus = firstString(node, ["conStatus"], ["statusDesc"]) ?? null;
  const eventsNode = firstArrayByKey(node, ["events", "eventList", "checkpoints"]);
  const events: Array<{
    status: TrackedEventStatus;
    description: string | null;
    location: string | null;
    occurredAt: Date | null;
    originalStatus: string | null;
  }> = [];

  if (Array.isArray(eventsNode)) {
    for (const e of eventsNode) {
      const rawDesc =
        firstString(e, ["eventDesc"], ["description"], ["eventDescription"], ["statusDesc"]) ??
        firstString(e, ["eventName"], ["status"]);
      const locationText = firstString(
        e,
        ["location", "city"],
        ["location", "description"],
        ["location", "name"],
        ["location", "country"],
        ["location"],
      );
      const occurredAt = firstDate(e, ["eventTime"], ["eventDate"], ["eventTimestamp"], ["timestamp"], ["date"]);
      const mapped = normalizeEventStatus(rawDesc ?? (occurredAt ? "in transit" : null), TNT_STATUS_KEYWORDS);
      events.push({
        status: mapped.status,
        description: cleanText(rawDesc),
        location: cleanText(locationText, 200),
        occurredAt: occurredAt ?? safeOccurredAt(undefined),
        originalStatus: mapped.originalStatus,
      });
      events.sort((a, b) => (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0));
    }
  }

  if (events.length === 0 && !rawConsStatus) return null;

  const latest = events[events.length - 1] ?? null;
  const estimated = firstDate(node, ["estimatedDeliveryDate"], ["estimatedDate"], ["expectedDeliveryDate"]);
  return {
    ok: true,
    originalStatus: rawConsStatus ?? null,
    currentStatus: (latest?.status ?? normalizeEventStatus(rawConsStatus, TNT_STATUS_KEYWORDS).status) as TrackedEventStatus,
    events,
    estimatedDeliveryDate: estimated,
    confirmed: true,
  };
}

export const tntExpressAdapter: CarrierAdapter = {
  code: "TNT",
  name: "TNT Express",
  nameTh: "ทีเอ็นที เอ็กซ์เพรส",
  numberExamples: ["123456789"],
  requiresOfficialAccess: false,
  validate,
  async fetch(input: FetchTrackingInput): Promise<FetchTrackingResult> {
    const trackingNumber = input.trackingNumber.trim();
    if (!validate(trackingNumber)) return errMalformed("TNT");

    const url = `${API_URL}?con=${encodeURIComponent(trackingNumber)}&locale=en_US&searchType=CON&channel=DIRECT`;
    const outcome = await safeFetch({
      url,
      method: "GET",
      carrier: "TNT",
      trackingNumber,
      headers: { Accept: "application/json", "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!outcome.ok) return { ok: false, error: outcome.error };

    const { json } = outcome;
    if (isNotFoundShape(json)) return errNotFound("TNT");

    const consignments = firstArrayByKey(json, ["consignments", "shipments", "conDetails"]);
    const parsed = consignments && consignments[0] ? parseConsignment(consignments[0]) : null;
    if (parsed) return parsed;
    return errMalformed("TNT");
  },
};
