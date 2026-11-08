/**
 * SPX Express adapter.
 *
 * VERIFIED against the public endpoint 2026-11-08:
 *   GET https://spx.co.th/shipment/order/open/order/get_order_info?spx_tn=…&language_code=en
 *   → HTTP 200 JSON, but ALWAYS
 *     {"retcode":2, "message":"retcode:-2023002 … GetLogisticOrderIndexMap: ref record not unique …"}
 *     for a bare caller. The endpoint is CORS-locked to `lpop-portal.ssc.shopee.com`
 *     — an internal Shopee-portal API, not a public tracking endpoint.
 *
 * Status: UNSUPPORTED. There is no supported direct public tracking endpoint
 * (using an internal portal API would violate provider terms). Production needs
 * an official Shopee/SPX API partnership. The adapter still performs the real
 * call so a change of endpoint is one constant, and parses JSON defensively in
 * case an authorised endpoint ever answers.
 */
import { firstArrayByKey, firstDate, firstString, getPath } from "./parse-utils.js";
import { normalizeEventStatus, cleanText, safeOccurredAt, SPX_STATUS_KEYWORDS } from "../normalizer.js";
import { safeFetch } from "../safe-fetch.js";
import { errBlocked, errMalformed, errNotFound, errUnsupported, looksLikeHtml } from "./shared.js";
import type { CarrierAdapter, FetchTrackingInput, FetchTrackingResult, TrackedEventStatus } from "../types.js";

const API_URL = "https://spx.co.th/shipment/order/open/order/get_order_info";

/** SPX / Shopee waybills: mostly pure digits 12–16. */
function validate(trackingNumber: string): boolean {
  return /^\d{12,16}$/.test(trackingNumber.trim());
}

function retcode(json: unknown): number | null {
  const v = getPath(json, "retcode") ?? getPath(json, "code");
  return typeof v === "number" ? v : null;
}

function parseTracking(json: unknown): FetchTrackingResult | null {
  const node = getPath(json, "data") ?? json;
  // get_order_info success shape is Shopee's: data.tracking / data.order / data.shipping...
  const list = firstArrayByKey(node, ["tracking", "trackingList", "records", "checkpoints", "order"]) ?? [];
  const events: Array<{
    status: TrackedEventStatus;
    description: string | null;
    location: string | null;
    occurredAt: Date | null;
    originalStatus: string | null;
  }> = [];

  for (const d of list) {
    const rawDesc = firstString(d, ["description"], ["remark"], ["statusDesc"], ["message"], ["desc"]);
    const rawLoc = firstString(d, ["location"], ["city"], ["areaName"], ["warehouseName"]);
    const rawTime = firstString(d, ["timestamp"], ["time"], ["opTime"], ["date"], ["fdate"]);
    const occurredAt = rawTime ? safeOccurredAt(rawTime) : null;
    const mapped = normalizeEventStatus(rawDesc, SPX_STATUS_KEYWORDS);
    events.push({
      status: mapped.status,
      description: cleanText(rawDesc),
      location: cleanText(rawLoc, 200),
      occurredAt,
      originalStatus: mapped.originalStatus,
    });
  }
  events.sort((a, b) => (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0));

  if (events.length === 0) return null;
  const latest = events[events.length - 1]!;
  const rawStatus = firstString(node, ["status"], ["shipmentStatus"]) ?? latest.originalStatus;
  const estimated = firstDate(node, ["estimatedDeliveryDate"], ["expectedDeliveryDate"], ["deliveryDate"]);

  return {
    ok: true,
    originalStatus: rawStatus ?? null,
    currentStatus: latest.status,
    events,
    estimatedDeliveryDate: estimated,
    confirmed: true,
  };
}

export const spxExpressAdapter: CarrierAdapter = {
  code: "SPX",
  name: "SPX Express",
  nameTh: "เอสพีเอ็กซ์ เอ็กซ์เพรส",
  numberExamples: ["1234567891234"],
  requiresOfficialAccess: true,
  validate,
  async fetch(input: FetchTrackingInput): Promise<FetchTrackingResult> {
    const trackingNumber = input.trackingNumber.trim();
    if (!validate(trackingNumber)) return errMalformed("SPX");

    const url = `${API_URL}?spx_tn=${encodeURIComponent(trackingNumber)}&language_code=en`;
    const outcome = await safeFetch({
      url,
      method: "GET",
      carrier: "SPX",
      trackingNumber,
      headers: { Accept: "application/json" },
    });
    if (!outcome.ok) return { ok: false, error: outcome.error };
    if (looksLikeHtml(outcome.text)) {
      return errBlocked("SPX", "endpoint returned an HTML shield");
    }

    const { json } = outcome;
    const code = retcode(json);
    if (code !== null && code !== 0) {
      const msg = firstString(json, ["message"], ["detail"]) ?? "";
      // The known internal-portal failure speaks for every bare caller.
      if (code === 2 || /internal|logisticorder|portal/i.test(msg)) {
        return errUnsupported("SPX", "the provided endpoint is an internal Shopee-portal API (retcode " + code + ")");
      }
      return errNotFound("SPX");
    }
    const parsed = parseTracking(json);
    if (parsed) return parsed;
    return errMalformed("SPX");
  },
};
