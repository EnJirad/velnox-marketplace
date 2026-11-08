/**
 * J&T Express (Thailand) adapter.
 *
 * VERIFIED against the public endpoint 2026-11-08:
 *   POST https://websiteapi.jtexpress.co.th/jts-tha-website-api/api/v2/track/orderTrack
 *   body { billCode, lang, phoneVerify }
 *   → HTTP 200 JSON, but for a bare caller it answers
 *     {"code":20005,"msg":"验证码不正确", ...} — captcha-gated.
 *
 * Status: BLOCKED. The merchant-facing open API is captcha-protected and the
 * task forbids bypassing it; production therefore needs official J&T merchant
 * API credentials (and their signing scheme). This adapter still performs the
 * real call and parses a successful shape defensively, so enabling official
 * access is a URL/key change, never new code and never invented events.
 *
 * phoneVerify is a SECRET-handling field: it is sent in the request body only,
 * never written to logs, never stored, never echoed in any response.
 */
import { firstArrayByKey, firstDate, firstString, getPath } from "./parse-utils.js";
import { normalizeEventStatus, safeOccurredAt, cleanText, JT_STATUS_KEYWORDS } from "../normalizer.js";
import { safeFetch } from "../safe-fetch.js";
import { errBlocked, errMalformed, errNotFound } from "./shared.js";
import type {
  CarrierAdapter,
  FetchTrackingInput,
  FetchTrackingResult,
  TrackedEventStatus,
} from "../types.js";

const API_URL = "https://websiteapi.jtexpress.co.th/jts-tha-website-api/api/v2/track/orderTrack";

/** J&T TH waybills: "TH" + digits, total ~15, or bare digits 12–16. */
function validate(trackingNumber: string): boolean {
  const t = trackingNumber.trim();
  return /^TH\d{10,15}$/i.test(t) || /^\d{12,16}$/.test(t);
}

function codeOf(json: unknown): number | null {
  const v = getPath(json, "code");
  return typeof v === "number" ? v : null;
}

function parseDetails(json: unknown, trackingNumber: string): FetchTrackingResult | null {
  // The website API nests the list under data.details (each: desc, facilityName, time).
  const node = getPath(json, "data");
  const details = firstArrayByKey(node, ["details", "trackList", "tracks", "list"]) ?? [];
  const events: Array<{
    status: TrackedEventStatus;
    description: string | null;
    location: string | null;
    occurredAt: Date | null;
    originalStatus: string | null;
  }> = [];

  for (const d of details) {
    const rawDesc = firstString(d, ["desc"], ["details"], ["remark"], ["statusDesc"], ["context"]);
    const rawLoc = firstString(d, ["facilityName"], ["warehouseName"], ["opOrgName"], ["location"]);
    const rawTime = firstString(d, ["time"], ["opTime"], ["acceptTime"], ["date"]);
    const occurredAt = rawTime ? safeOccurredAt(rawTime) : null;
    const mapped = normalizeEventStatus(rawDesc, JT_STATUS_KEYWORDS);
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
  const estimated = firstDate(node, ["estimatedDeliveryDate"], ["expectTime"]);
  const rawStatus = firstString(node, ["status"], ["lastStatus"]) ?? latest.originalStatus;
  return {
    ok: true,
    originalStatus: rawStatus ?? null,
    currentStatus: latest.status,
    events,
    estimatedDeliveryDate: estimated,
    confirmed: true,
  };
}

export const jtExpressAdapter: CarrierAdapter = {
  code: "JT",
  name: "J&T Express",
  nameTh: "เจแอนด์ที เอ็กซ์เพรส",
  numberExamples: ["TH123456789012345"],
  requiresOfficialAccess: true,
  validate,
  async fetch(input: FetchTrackingInput): Promise<FetchTrackingResult> {
    const trackingNumber = input.trackingNumber.trim();
    if (!validate(trackingNumber)) return errMalformed("JT");

    const outcome = await safeFetch({
      url: API_URL,
      method: "POST",
      carrier: "JT",
      trackingNumber,
      body: {
        billCode: trackingNumber,
        lang: "en-US",
        // phoneVerify is sent ONLY here. It is never logged, stored or returned.
        phoneVerify: input.phone ?? "",
      },
    });
    if (!outcome.ok) return { ok: false, error: outcome.error };

    const { json } = outcome;
    const code = codeOf(json);
    // 20005 = captcha/verification required. 200xx = provider-side refusal.
    if (code !== null && code !== 0 && code !== 200) {
      const msg = firstString(json, ["msg"], ["message"]) ?? "unknown";
      if (code === 20005) return errBlocked("JT", "captcha / phone verification required");
      if (Number.isInteger(code) && code < 0) return errNotFound("JT");
      return { ok: false, error: { code: "OFFICIAL_ACCESS_REQUIRED", message: `J&T refused the lookup (code ${code})`, retryable: false } };
    }
    const parsed = parseDetails(json, trackingNumber);
    if (parsed) return parsed;
    return errMalformed("JT");
  },
};
