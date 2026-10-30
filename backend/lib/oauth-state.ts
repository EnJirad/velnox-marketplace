/**
 * OAuth `state` — CSRF nonce + browser binding for the Google redirect flow.
 *
 * ── The vulnerability this module exists to close (Phase 2G H-1) ──────────────
 *
 * The old implementation built the OAuth `state` parameter as
 * `base64url(JSON.stringify({ returnTo }))`. That is user-controlled data
 * wearing the name of a CSRF token: it was never stored, never signed, never
 * compared and never expired, and the callback accepted any Google
 * authorization `code` regardless of `state`. An attacker could complete
 * consent for their own Google account and then make a victim's browser open
 * `/auth/google/callback?code=…&state=…`, handing the victim a valid session
 * for the ATTACKER's account (login CSRF / session swapping). The victim's
 * delivery address, phone and saved payment context would then be entered into
 * the attacker's account, and orders/chat actions would be attributed to the
 * attacker's identity.
 *
 * ── The mechanism ────────────────────────────────────────────────────────────
 *
 *   `state` (the query parameter Google round-trips) is an opaque, 256-bit
 *   `crypto.randomBytes` value. It contains no user data, no timestamp and no
 *   hash of either.
 *
 *   The value is bound to the initiating browser by a short-lived, httpOnly,
 *   `SameSite=Lax` cookie scoped to `/auth`. The cookie carries a signed
 *   envelope `{ n: nonce, r: sanitized returnTo, e: expiry }`, HMAC-SHA256
 *   signed with `OAUTH_STATE_SECRET` (falling back to `JWT_SECRET`) and read
 *   back with `crypto.timingSafeEqual` on SHA-256 digests.
 *
 *   The callback compares the returned `state` against the cookie's nonce,
 *   rejects missing / mismatched / forged / expired values, and the route
 *   consumes (clears) the cookie before validating — so a second callback in
 *   the same browser has no state cookie and is rejected. Single use comes
 *   from that consumption plus Google's own single-use authorization code; the
 *   mechanism is stateless, so it keeps working across backend instances.
 *
 *   `returnTo` is NOT part of the CSRF secret. It travels inside the signed
 *   cookie, is sanitized on the way in and again on the way out, and can only
 *   ever be an internal absolute path — never an external or protocol-relative
 *   destination.
 *
 * Nothing here logs. Callers must log the rejection reason only, never the
 * state value, the cookie value, or the authorization code.
 */

import crypto from "crypto";

/** Name of the temporary state cookie. httpOnly; never readable by JS. */
export const OAUTH_STATE_COOKIE = "velnox_oauth_state";

/**
 * Cookie path. The flow only needs the cookie on `/auth/google/callback`, and
 * scoping it to `/auth` keeps it off every other request. `res.clearCookie`
 * MUST use the same path or the browser keeps the original cookie.
 */
export const OAUTH_STATE_PATH = "/auth";

/** How long a started OAuth flow may take before its state is stale. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** 32 bytes = 256 bits of CSPRNG output, 43 base64url characters. */
const NONCE_BYTES = 32;

/** Longest internal return path accepted. Real routes are far shorter. */
const MAX_RETURN_TO_LENGTH = 512;

/** Internal placeholder origin used to parse and re-serialize a return path. */
const INTERNAL_ORIGIN = "https://velnox.invalid";

export interface OAuthStateStart {
  /** Opaque value sent to Google as `state` and echoed back to the callback. */
  state: string;
  /** Signed, httpOnly cookie value that binds `state` to this browser. */
  cookieValue: string;
  /** Sanitized internal path to land on after a successful sign-in. */
  returnTo: string;
  /** Cookie lifetime in milliseconds. */
  maxAgeMs: number;
}

/**
 * Why a callback was rejected. Loggable: it names a class, never a value.
 */
export type OAuthStateRejection =
  | "missing_state"
  | "missing_cookie"
  | "malformed_cookie"
  | "bad_signature"
  | "expired"
  | "mismatch";

export type OAuthStateValidation =
  | { ok: true; returnTo: string }
  | { ok: false; reason: OAuthStateRejection };

interface StateEnvelope {
  /** nonce — identical to the `state` parameter */
  n: string;
  /** sanitized internal return path */
  r: string;
  /** absolute expiry, epoch milliseconds */
  e: number;
}

/**
 * HMAC key. `OAUTH_STATE_SECRET` exists so state signing can be rotated
 * independently; when it is absent the session secret is used, which keeps the
 * deployment working without a new required variable. A missing secret fails
 * closed: generation throws and verification rejects.
 */
function stateSecret(): string {
  const dedicated = (process.env.OAUTH_STATE_SECRET ?? "").trim();
  if (dedicated) return dedicated;
  return (process.env.JWT_SECRET ?? "").trim();
}

/** True when state signing has a usable key (diagnostics only). */
export function isOAuthStateConfigured(): boolean {
  return stateSecret().length > 0;
}

/**
 * Timing-safe string comparison. Both inputs are hashed to a fixed 32-byte
 * digest first, so the comparison cannot leak either value's length.
 */
function safeEqual(a: string, b: string): boolean {
  const digestA = crypto.createHash("sha256").update(a, "utf8").digest();
  const digestB = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Normalize a requested post-login destination to a safe INTERNAL path.
 *
 * Only an absolute path on the app's own origin is allowed. Everything else
 * (absolute URLs, protocol-relative `//host`, backslash tricks, control
 * characters, `javascript:`/`data:` schemes, oversized input) collapses to
 * `/`. Query strings and fragments are preserved because legitimate routes
 * such as `/products?page=2` and `/shop#reviews` use them.
 */
export function sanitizeReturnTo(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  const value = raw.trim();
  if (!value || value.length > MAX_RETURN_TO_LENGTH) return "/";
  // Must be a path, not an absolute or protocol-relative URL. A leading `//`
  // is treated as protocol-relative by browsers; `/\host` is too.
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";

  try {
    const url = new URL(value, INTERNAL_ORIGIN);
    if (url.origin !== INTERNAL_ORIGIN) return "/";
    const normalized = `${url.pathname}${url.search}${url.hash}`;
    if (!normalized.startsWith("/") || normalized.startsWith("//")) return "/";
    if (normalized.length > MAX_RETURN_TO_LENGTH) return "/";
    return normalized;
  } catch {
    return "/";
  }
}

/**
 * Start a flow: mint an opaque nonce, bind it to a signed cookie, and keep the
 * (sanitized) return path out of the `state` parameter.
 *
 * `now` / `ttlMs` are injectable so tests can cover expiry deterministically.
 */
export function createOAuthState(
  rawReturnTo: unknown,
  now: number = Date.now(),
  ttlMs: number = OAUTH_STATE_TTL_MS,
): OAuthStateStart {
  const secret = stateSecret();
  if (!secret) {
    // Fail closed. The backend refuses to start without JWT_SECRET, so this is
    // a misconfiguration guard, not a normal path.
    throw new Error("OAuth state signing secret is not configured");
  }

  // The CSRF token: 256 bits from the platform CSPRNG. Nothing user-controlled
  // (returnTo, email, user id, time) is mixed in or derivable from it.
  const state = crypto.randomBytes(NONCE_BYTES).toString("base64url");

  const envelope: StateEnvelope = {
    n: state,
    r: sanitizeReturnTo(rawReturnTo),
    e: now + ttlMs,
  };
  const payload = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  const cookieValue = `${payload}.${sign(payload, secret)}`;

  return { state, cookieValue, returnTo: envelope.r, maxAgeMs: ttlMs };
}

/**
 * Validate the callback's `state` against the initiating browser's cookie.
 *
 * Rejects, in order: absent `state`, absent cookie (different browser or a
 * consumed flow), malformed envelope, bad signature, expired envelope, and a
 * nonce mismatch. Never throws on attacker-controlled input.
 */
export function validateOAuthState(
  input: { returnedState?: unknown; cookieValue?: unknown },
  now: number = Date.now(),
): OAuthStateValidation {
  const returnedState = typeof input.returnedState === "string" ? input.returnedState : "";
  const cookieValue = typeof input.cookieValue === "string" ? input.cookieValue : "";

  if (!returnedState) return { ok: false, reason: "missing_state" };
  if (!cookieValue) return { ok: false, reason: "missing_cookie" };

  const secret = stateSecret();
  if (!secret) return { ok: false, reason: "bad_signature" };

  const parts = cookieValue.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "malformed_cookie" };
  }

  const [payload, providedSignature] = parts;
  if (!safeEqual(providedSignature, sign(payload, secret))) {
    return { ok: false, reason: "bad_signature" };
  }

  let envelope: StateEnvelope;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return { ok: false, reason: "malformed_cookie" };
    }
    envelope = decoded as StateEnvelope;
  } catch {
    return { ok: false, reason: "malformed_cookie" };
  }

  const nonce = typeof envelope.n === "string" ? envelope.n : "";
  const expiresAt = typeof envelope.e === "number" && Number.isFinite(envelope.e)
    ? envelope.e
    : NaN;
  if (!nonce || !Number.isFinite(expiresAt)) {
    return { ok: false, reason: "malformed_cookie" };
  }

  if (expiresAt <= now) return { ok: false, reason: "expired" };

  // Constant-time comparison of the browser-bound nonce and the value Google
  // echoed back. A request without the cookie can never reach this line.
  if (!safeEqual(returnedState, nonce)) {
    return { ok: false, reason: "mismatch" };
  }

  // Re-sanitize: the cookie is signed, but the envelope is still data.
  return { ok: true, returnTo: sanitizeReturnTo(envelope.r) };
}

/** Cookie options for SETTING the temporary state cookie. */
export function oauthStateCookieOptions(maxAgeMs: number, isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    // The callback is a top-level GET navigation from accounts.google.com, so
    // Lax is sent while still refusing cross-site subresource requests.
    sameSite: "lax" as const,
    maxAge: maxAgeMs,
    path: OAUTH_STATE_PATH,
  };
}

/**
 * Cookie options for CLEARING the state cookie. Must mirror the set options
 * (path especially) or the browser keeps the original cookie.
 */
export function clearOAuthStateCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: OAUTH_STATE_PATH,
  };
}
