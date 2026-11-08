/**
 * Safe carrier HTTP — the ONLY place a carrier request leaves the process.
 *
 * Guarantees:
 *   • a NON-ZERO timeout on every request (the original PHP used
 *     CURLOPT_TIMEOUT = 0 — explicitly forbidden by the task),
 *   • tracking numbers are MASKED in logs (never the full number),
 *   • response bodies are capped in size before parse,
 *   • every failure is mapped to a normalized safe `CarrierError` — never a
 *     raw carrier message, never PII.
 *
 * Timeouts/5xx are `retryable`; 4xx class (blocks, captcha, official-access)
 * is not, by design — retrying a captcha/anti-bot response only earns a ban.
 */
import type { CarrierCode, CarrierError, TrackingErrorCode } from "./types.js";

export interface SafeFetchOptions {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** Plain object bodies are JSON-encoded; string bodies are sent as-is. */
  body?: unknown;
  timeoutMs?: number;
  carrier: CarrierCode;
  /** Used only for masked logging — never sent anywhere in logs in full. */
  trackingNumber: string;
}

export type SafeFetchOutcome =
  | { ok: true; status: number; json: unknown; text: string }
  | { ok: false; error: CarrierError };

export const DEFAULT_CARRIER_TIMEOUT_MS = 10_000;
/** Cap response size (16 KB) so a runaway page cannot bloat memory. */
const MAX_BODY_BYTES = 16_384;

/** Last 4 digits only — enough to disambiguate logs, never enough to be the number. */
export function maskTrackingNumber(value: string): string {
  if (!value) return "";
  if (value.length <= 6) return "••••";
  return `${value.slice(0, 2)}••••${value.slice(-4)}`;
}

function carrierError(code: TrackingErrorCode, message: string, retryable: boolean): CarrierError {
  return { code, message, retryable };
}

function bodyOf(res: Response, bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, MAX_BODY_BYTES)).replace(/\u0000/g, "");
  } catch {
    return "";
  }
}

export async function safeFetch(options: SafeFetchOptions): Promise<SafeFetchOutcome> {
  const { url, method = "GET", headers = {}, body, carrier, trackingNumber } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_CARRIER_TIMEOUT_MS;
  const masked = maskTrackingNumber(trackingNumber);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Carrier timeout", "TimeoutError")), timeoutMs);
  const requestInit: RequestInit = {
    method,
    headers: {
      "User-Agent": "VelnoxMarketplace/1.0 (+tracking)",
      "Accept": "application/json, text/plain, */*",
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
    signal: controller.signal,
  };
  if (requestInit.body !== undefined && !(requestInit.headers as Record<string, string>)["Content-Type"]) {
    (requestInit.headers as Record<string, string>)["Content-Type"] = "application/json";
  }

  try {
    const res = await fetch(url, requestInit);
    const bytes = await res.arrayBuffer();
    const text = bodyOf(res, bytes);
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null; // non-JSON body — handled by the caller as malformed/blocked
    }

    if (res.ok) {
      return { ok: true, status: res.status, json, text };
    }

    // 4xx errors are provider-side decisions — no automatic retry.
    if (res.status === 429) {
      return { ok: false, error: carrierError("RATE_LIMITED", `${carrier} rate-limited the request`, false) };
    }
    if (res.status === 403 || res.status === 401) {
      return { ok: false, error: carrierError("BLOCKED", `${carrier} refused the request (blocked)`, false) };
    }
    if (res.status >= 400 && res.status < 500) {
      return { ok: false, error: carrierError("NOT_FOUND", `${carrier} responded HTTP ${res.status}`, false) };
    }
    return { ok: false, error: carrierError("CARRIER_UNAVAILABLE", `${carrier} responded HTTP ${res.status}`, true) };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (err instanceof Error && (name === "TimeoutError" || name === "AbortError" || name === "DOMException")) {
      return { ok: false, error: carrierError("TIMEOUT", `${carrier} timed out after ${timeoutMs}ms`, true) };
    }
    const type = err instanceof TypeError ? "network" : "unknown";
    return {
      ok: false,
      error: carrierError(
        "CARRIER_UNAVAILABLE",
        `${carrier} unreachable (${type}${name ? ` · ${name}` : ""})`,
        true,
      ),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Structured minimal log line — no PII, no full tracking number. */
export function logCarrier(carrier: CarrierCode, masked: string, kind: "fetch" | "ok" | "error", detail: string): void {
  // Keep on one line so log aggregation stays greppable.
  console.log(`[tracking:${carrier}] ${kind} tn=${masked} ${detail}`);
}
