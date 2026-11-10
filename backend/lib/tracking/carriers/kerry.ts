/**
 * Kerry Express (Thailand) adapter.
 *
 * STATUS: **OFFICIAL ACCESS REQUIRED.** Kerry has no public, contract-free
 * tracking endpoint — the customer-facing tracker is an HTML page and the
 * merchant API (`api.kerryexpress.com`) is issued per account with a merchant
 * code + secret. This adapter is therefore written against the *shape* the
 * merchant API documents, and it refuses to pretend:
 *
 *   • without `KERRY_API_KEY` (+ optional `KERRY_API_SECRET`) every lookup
 *     returns `OFFICIAL_ACCESS_REQUIRED` — never a fabricated status;
 *   • with the credentials present it calls `KERRY_TRACK_URL` (defaults to the
 *     documented base) and parses the response defensively.
 *
 * Getting production access: apply for a Kerry Express merchant/e-commerce
 * account, receive the API key + endpoint for your account, then set the three
 * env vars. No code change is needed.
 */
import { firstArrayByKey, firstDate, firstString } from "./parse-utils.js";
import { cleanText, KERRY_STATUS_KEYWORDS, normalizeEventStatus, safeOccurredAt } from "../normalizer.js";
import { safeFetch } from "../safe-fetch.js";
import { errMalformed, errNotFound, errOfficialAccess } from "./shared.js";
import type { CarrierAdapter, FetchTrackingInput, FetchTrackingResult, TrackedEventStatus } from "../types.js";

const DEFAULT_URL = "https://api.kerryexpress.com/rest/track";
const API_KEY = () => (process.env.KERRY_API_KEY ?? "").trim();
const API_SECRET = () => (process.env.KERRY_API_SECRET ?? "").trim();
const ENDPOINT = () => (process.env.KERRY_TRACK_URL ?? DEFAULT_URL).trim();

/** Kerry TH waybills: letters+digits, e.g. `KEXTH0123456789` or 12–20 alnum. */
function validate(trackingNumber: string): boolean {
  return /^[A-Za-z0-9]{10,24}$/.test(trackingNumber.trim());
}

export const kerryExpressAdapter: CarrierAdapter = {
  code: "KERRY",
  name: "Kerry Express",
  nameTh: "เคอรี่ เอ็กซ์เพรส",
  numberExamples: ["KEXTH0123456789"],
  requiresOfficialAccess: true,
  validate,
  async fetch(input: FetchTrackingInput): Promise<FetchTrackingResult> {
    const trackingNumber = input.trackingNumber.trim();
    if (!validate(trackingNumber)) return errMalformed("KERRY");

    const key = API_KEY();
    if (!key) {
      // Fail closed and honestly — no fake events.
      return errOfficialAccess("KERRY", "KERRY_API_KEY is not configured (merchant API access required)");
    }

    const url = `${ENDPOINT()}?track=${encodeURIComponent(trackingNumber)}`;
    const outcome = await safeFetch({
      url,
      method: "GET",
      carrier: "KERRY",
      trackingNumber,
      headers: {
        Accept: "application/json",
        "x-api-key": key,
        ...(API_SECRET() ? { "x-api-secret": API_SECRET() } : {}),
      },
    });
    if (!outcome.ok) return { ok: false, error: outcome.error };

    const json = outcome.json;
    const rows = firstArrayByKey(json, ["data", "tracking", "trackings", "events", "details"]) ?? [];
    if (rows.length === 0) {
      const status = firstString(json, ["status"], ["result"], ["message"]);
      if (status && /not\s*found|invalid|no\s*data/i.test(status)) return errNotFound("KERRY");
      return errMalformed("KERRY");
    }

    const events: Array<{
      status: TrackedEventStatus;
      description: string | null;
      location: string | null;
      occurredAt: Date | null;
      originalStatus: string | null;
    }> = [];
    for (const row of rows) {
      const rawDesc = firstString(row, ["status"], ["statusDescription"], ["description"], ["remark"]);
      const rawLoc = firstString(row, ["location"], ["branch"], ["city"], ["facility"]);
      const rawTime = firstString(row, ["timestamp"], ["date"], ["datetime"], ["updated_at"]);
      const mapped = normalizeEventStatus(rawDesc, KERRY_STATUS_KEYWORDS);
      events.push({
        status: mapped.status,
        description: cleanText(rawDesc),
        location: cleanText(rawLoc, 200),
        occurredAt: rawTime ? safeOccurredAt(rawTime) : null,
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
      estimatedDeliveryDate: firstDate(json, ["estimatedDeliveryDate"], ["eta"]),
      confirmed: true,
    };
  },
};
