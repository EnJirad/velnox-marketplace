/**
 * Flash Express adapter.
 *
 * VERIFIED against the public endpoint 2026-11-08:
 *   POST https://www.flashexpress.com/webApi/tools/tracking  body { search }
 *   → a 5-second "Browser security check" anti-bot HTML shield, not JSON.
 *
 * Status: BLOCKED. The website is protected by an anti-bot challenge; a
 * server-to-server call gets HTML, and bypassing the shield would violate the
 * provider's terms. Production requires an official Flash Express B2B/open API
 * contract. The adapter performs the real call, detects the HTML shield, and
 * parses JSON defensively if an open endpoint ever answers.
 */
import { firstArrayByKey, firstDate, firstString, getPath } from "./parse-utils.js";
import { normalizeEventStatus, cleanText, safeOccurredAt, FLASH_STATUS_KEYWORDS } from "../normalizer.js";
import { safeFetch } from "../safe-fetch.js";
import { errBlocked, errMalformed, errNotFound, looksLikeHtml } from "./shared.js";
import type { CarrierAdapter, FetchTrackingInput, FetchTrackingResult, TrackedEventStatus } from "../types.js";

const API_URL = "https://www.flashexpress.com/webApi/tools/tracking";

/** Flash waybills are mostly pure digits (~10–16) or FX + digits. */
function validate(trackingNumber: string): boolean {
  const t = trackingNumber.trim();
  return /^\d{10,16}$/.test(t) || /^[A-Za-z]{1,3}\d{8,15}$/.test(t);
}

function retcode(json: unknown): number | null {
  const v = getPath(json, "retcode") ?? getPath(json, "code");
  return typeof v === "number" ? v : null;
}

function parseTracking(json: unknown): FetchTrackingResult | null {
  const node = getPath(json, "data") ?? json;
  const list = firstArrayByKey(node, ["tracking", "trackingList", "list", "details", "info"]) ?? [];
  const events: Array<{
    status: TrackedEventStatus;
    description: string | null;
    location: string | null;
    occurredAt: Date | null;
    originalStatus: string | null;
  }> = [];

  for (const d of list) {
    const rawDesc = firstString(d, ["remark"], ["desc"], ["description"], ["statusDesc"], ["stateDesc"]);
    const rawLoc = firstString(d, ["areaName"], ["facilityName"], ["location"], ["currentCity"]);
    const rawTime = firstString(d, ["opTime"], ["time"], ["date"], ["occurredAt"]);
    const occurredAt = rawTime ? safeOccurredAt(rawTime) : null;
    const mapped = normalizeEventStatus(rawDesc, FLASH_STATUS_KEYWORDS);
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
  const rawStatus = firstString(node, ["status"], ["stateDesc"]) ?? latest.originalStatus;
  const estimated = firstDate(node, ["estimatedDeliveryDate"], ["expectArrivalDate"], ["predicted"]);

  return {
    ok: true,
    originalStatus: rawStatus ?? null,
    currentStatus: latest.status,
    events,
    estimatedDeliveryDate: estimated,
    confirmed: true,
  };
}

export const flashExpressAdapter: CarrierAdapter = {
  code: "FLASH",
  name: "Flash Express",
  nameTh: "แฟลช เอ็กซ์เพรส",
  numberExamples: ["1234567890123"],
  requiresOfficialAccess: true,
  validate,
  async fetch(input: FetchTrackingInput): Promise<FetchTrackingResult> {
    const trackingNumber = input.trackingNumber.trim();
    if (!validate(trackingNumber)) return errMalformed("FLASH");

    const outcome = await safeFetch({
      url: API_URL,
      method: "POST",
      carrier: "FLASH",
      trackingNumber,
      body: { search: trackingNumber },
    });
    if (!outcome.ok) return { ok: false, error: outcome.error };

    // HTML shield ⇒ blocked. Never attempt to run their challenge JS.
    if (looksLikeHtml(outcome.text)) {
      return errBlocked("FLASH", "website anti-bot shield returned HTML");
    }

    const { json } = outcome;
    const code = retcode(json);
    if (code !== null && code !== 0 && code !== 1 && code !== 200) {
      return errNotFound("FLASH");
    }
    const parsed = parseTracking(json);
    if (parsed) return parsed;
    return errMalformed("FLASH");
  },
};
