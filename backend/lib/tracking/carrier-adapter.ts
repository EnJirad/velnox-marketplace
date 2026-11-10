/**
 * Carrier adapter registry — the ONE place that maps a carrier code to its
 * adapter and its display metadata.
 *
 * The contract every adapter implements lives in `types.ts` (`CarrierAdapter`).
 * Adapters are lazily exported as singletons; `registry` drives validation,
 * resolution by code/alias and the admin "carrier health" surface.
 *
 * The public endpoints were verified 2026-11-08:
 *   JT    jtexpress.co.th  → captcha-gated (code 20005)          → BLOCKED
 *   FLASH flashexpress.com  → 5-second anti-bot shield (HTML)     → BLOCKED
 *   SPX   spx.co.th         → internal Shopee-portal API, always  → UNSUPPORTED
 *                            errors for a bare caller (retcode 2)
 *   TNT   tnt.com/api/v3    → public, structured JSON, not-found  → PARTIAL
 *                            handled correctly; real CON untested
 * Each adapter still implements the real call + normalized error handling so
 * it can be switched to a verified/official endpoint by changing the URL —
 * never by inventing data.
 */
import type { CarrierAdapter, CarrierCode } from "./types.js";
import { jtExpressAdapter } from "./carriers/jt.js";
import { flashExpressAdapter } from "./carriers/flash.js";
import { spxExpressAdapter } from "./carriers/spx.js";
import { tntExpressAdapter } from "./carriers/tnt.js";
import { kerryExpressAdapter } from "./carriers/kerry.js";
import { thailandPostAdapter } from "./carriers/thailand-post.js";

const ADAPTERS: readonly CarrierAdapter[] = [
  jtExpressAdapter,
  flashExpressAdapter,
  kerryExpressAdapter,
  thailandPostAdapter,
  spxExpressAdapter,
  tntExpressAdapter,
];

export const CARRIER_ADAPTERS = ADAPTERS;

export const CARRIERS_BY_CODE: ReadonlyMap<CarrierCode, CarrierAdapter> = new Map(
  ADAPTERS.map((a) => [a.code, a]),
);

/** Aliases used when mapping free-text carrier input (seller/legacy) to a code. */
const CARRIER_ALIASES: Record<string, CarrierCode> = {
  jt: "JT",
  "j&t": "JT",
  "j&t express": "JT",
  "jnt": "JT",
  "jt express": "JT",
  เจแอนด์ที: "JT",
  เจแอนด์ทีเอ็กซ์เพรส: "JT",
  flash: "FLASH",
  "flash express": "FLASH",
  flashxpress: "FLASH",
  แฟลช: "FLASH",
  spx: "SPX",
  "spx express": "SPX",
  shopee: "SPX",
  tnt: "TNT",
  "tnt express": "TNT",
  kerry: "KERRY",
  "kerry express": "KERRY",
  kex: "KERRY",
  เคอรี่: "KERRY",
  thailandpost: "THAILANDPOST",
  "thailand post": "THAILANDPOST",
  thaipost: "THAILANDPOST",
  ไปรษณีย์: "THAILANDPOST",
  "ไปรษณีย์ไทย": "THAILANDPOST",
  ems: "THAILANDPOST",
};

/** Resolve a carrier code from free text (case/space-insensitive). */
export function resolveCarrierCode(input: string | null | undefined): CarrierCode | null {
  if (!input) return null;
  const key = input.trim().toLowerCase();
  if ((CARRIERS_BY_CODE as ReadonlyMap<string, CarrierAdapter>).has(key)) return key as CarrierCode;
  return CARRIER_ALIASES[key] ?? null;
}

/** Human display for a carrier code (falls back to the raw label). */
export function carrierName(code: CarrierCode | string | null, th = false): string {
  if (!code) return "";
  const adapter = (CARRIERS_BY_CODE as ReadonlyMap<string, CarrierAdapter>).get(code);
  if (!adapter) return code;
  return th ? adapter.nameTh : adapter.name;
}

/**
 * Report per-carrier integration state for the admin health surface.
 * `verified` is ONLY true when the public endpoint actually answers a live
 * lookup — never claimed from the contract existing.
 */
export function carrierIntegrationStatus(adapter: CarrierAdapter): {
  code: CarrierCode;
  name: string;
  status: "VERIFIED" | "PARTIAL" | "BLOCKED" | "UNSUPPORTED";
  note: string;
} {
  switch (adapter.code) {
    case "TNT":
      return {
        code: adapter.code,
        name: adapter.name,
        status: "PARTIAL",
        note: "Public API answers structured JSON (verified) but no live CON record was tested; TNT-branded domestic service is in FedEx's hands.",
      };
    case "JT":
      return {
        code: adapter.code,
        name: adapter.name,
        status: "BLOCKED",
        note: "Public endpoint captcha-gated (code 20005). Requires official J&T merchant API access.",
      };
    case "FLASH":
      return {
        code: adapter.code,
        name: adapter.name,
        status: "BLOCKED",
        note: "Public endpoint behind a 5-second anti-bot shield (HTML). Requires official Flash Express API access.",
      };
    case "SPX":
      return {
        code: adapter.code,
        name: adapter.name,
        status: "UNSUPPORTED",
        note: "Provided endpoint is an internal Shopee-portal API (CORS-locked) that always errors for a bare caller. Requires official Shopee/SPX API partnership.",
      };
    case "KERRY":
      return {
        code: adapter.code,
        name: adapter.name,
        status: process.env.KERRY_API_KEY ? "PARTIAL" : "BLOCKED",
        note: process.env.KERRY_API_KEY
          ? "Merchant API credentials are configured; verify against a live consignment."
          : "Requires Kerry Express merchant API access (KERRY_API_KEY / KERRY_API_SECRET). No public tracking endpoint exists.",
      };
    case "THAILANDPOST":
      return {
        code: adapter.code,
        name: adapter.name,
        status: process.env.THAILANDPOST_API_TOKEN ? "PARTIAL" : "BLOCKED",
        note: process.env.THAILANDPOST_API_TOKEN
          ? "Developer-portal token configured; verify against a live barcode."
          : "Official Track & Trace API is documented and free-to-register; set THAILANDPOST_API_TOKEN to activate.",
      };
  }
}

/** A shipment's projected carrier data (the shape frontends render). */
export interface CarrierBadge {
  code: string | null;
  name: string;
  nameTh: string;
  requiresOfficialAccess: boolean;
  logoUrl: string | null;
}

/** Public logo URLs — same set the central `/api/tracking/meta` serves. */
export function carrierBadge(code: string | null): CarrierBadge {
  const adapter = code ? (CARRIERS_BY_CODE as ReadonlyMap<string, CarrierAdapter>).get(code) : undefined;
  if (!adapter) {
    return { code: null, name: code ?? "", nameTh: code ?? "", requiresOfficialAccess: false, logoUrl: null };
  }
  return {
    code: adapter.code,
    name: adapter.name,
    nameTh: adapter.nameTh,
    requiresOfficialAccess: adapter.requiresOfficialAccess,
    logoUrl: `/carriers/${adapter.code}.svg`,
  };
}
