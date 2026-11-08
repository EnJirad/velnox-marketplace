/**
 * Shared adapter result builders — every carrier returns the SAME normalized
 * shapes, so the service and the UI never see carrier-specific errors.
 */
import type { CarrierError, FetchTrackingResult, TrackingErrorCode } from "../types.js";

export function carrierErr(code: TrackingErrorCode, message: string, retryable = false): CarrierError {
  return { code, message, retryable };
}

export const errNotFound = (carrier: string): FetchTrackingResult => ({
  ok: false,
  error: carrierErr("NOT_FOUND", `${carrier} has no record for this tracking number`, false),
});

export const errBlocked = (carrier: string, reason: string): FetchTrackingResult => ({
  ok: false,
  error: carrierErr("BLOCKED", `${carrier} blocked the request${reason ? `: ${reason}` : ""}`, false),
});

export const errUnsupported = (carrier: string, reason: string): FetchTrackingResult => ({
  ok: false,
  error: carrierErr("UNSUPPORTED", `${carrier} cannot be reached through a supported public endpoint${reason ? `: ${reason}` : ""}`, false),
});

export const errOfficialAccess = (carrier: string, reason: string): FetchTrackingResult => ({
  ok: false,
  error: carrierErr("OFFICIAL_ACCESS_REQUIRED", `${carrier} requires official API access${reason ? `: ${reason}` : ""}`, false),
});

export const errMalformed = (carrier: string): FetchTrackingResult => ({
  ok: false,
  error: carrierErr("MALFORMED_RESPONSE", `${carrier} returned an unexpected response shape`, false),
});

export const errInvalid = (carrier: string): FetchTrackingResult => ({
  ok: false,
  error: carrierErr("INVALID_TRACKING_NUMBER", `The tracking number does not match ${carrier}'s format`, false),
});

/** True when the body is HTML (anti-bot shield / captcha page instead of JSON). */
export function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 2000).toLowerCase();
  return head.includes("<html") || head.includes("<!doctype") || head.includes("<script");
}
