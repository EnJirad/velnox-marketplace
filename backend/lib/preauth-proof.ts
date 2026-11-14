/**
 * Pre-authentication proof — the gate in front of `GET /auth/google`.
 *
 * ── The hole this closes ─────────────────────────────────────────────────────
 *
 * Google sign-in starts with a full-page navigation to `GET /auth/google`. That
 * request carries no JSON body, so there is nowhere to put a Turnstile token —
 * which is exactly why the route previously had no challenge at all and anyone
 * could drive the OAuth redirect directly, skipping bot verification entirely.
 *
 * ── The mechanism ────────────────────────────────────────────────────────────
 *
 *   1. The browser solves the Turnstile widget and POSTs the token to
 *      `POST /api/auth/preauth`.
 *   2. The server verifies the token with `verifyTurnstile()` and, only on
 *      success, mints a short-lived ONE-TIME proof:
 *      an HMAC-SHA256 signed envelope `{ n: nonce, e: expiry }` in an httpOnly,
 *      `SameSite=Lax`, `/auth`-scoped cookie (`velnox_preauth`).
 *   3. `GET /auth/google` validates that cookie — signature (timing-safe),
 *      expiry, and presence — then CONSUMES it (clears it) before doing
 *      anything else. No proof, no redirect.
 *
 * ── Why this does not weaken the existing OAuth state flow ───────────────────
 *
 * The proof is an ADDITIONAL precondition. `createOAuthState()` and
 * `validateOAuthState()` are untouched: the 256-bit state nonce, the signed
 * state cookie, the timing-safe comparison, single use and `returnTo`
 * sanitisation all still run exactly as before, after the proof has been
 * checked. A stolen proof cookie alone gets an attacker no session: they still
 * need a fresh Google consent bound to their own state cookie.
 *
 * Nothing here logs. Callers log the rejection reason only.
 */

import crypto from "crypto";

/** Cookie carrying the one-time proof. httpOnly; never readable by JS. */
export const PREAUTH_COOKIE = "velnox_preauth";

/** Scoped to the OAuth routes only — never sent with ordinary API calls. */
export const PREAUTH_COOKIE_PATH = "/auth";

/**
 * Short by design: the customer has to solve the challenge and click Google
 * inside this window. Long enough for a slow phone, too short to be worth
 * stealing.
 */
export const PREAUTH_TTL_MS = 3 * 60 * 1000;

const NONCE_BYTES = 32;

export type PreAuthRejection =
  | "missing_cookie"
  | "malformed_cookie"
  | "bad_signature"
  | "expired";

export type PreAuthValidation =
  | { ok: true; nonce: string }
  | { ok: false; reason: PreAuthRejection };

/**
 * Namespace for the one-time nonce store. Kept here so the minting side and the
 * consuming side can never drift apart.
 */
export const PREAUTH_NONCE_SCOPE = "google_oauth_start";

interface ProofEnvelope {
  /** nonce — random, never reused, carries no user data */
  n: string;
  /** absolute expiry, epoch ms */
  e: number;
}

/**
 * Signing key. `PREAUTH_PROOF_SECRET` lets this be rotated on its own; otherwise
 * it borrows the OAuth-state secret and finally `JWT_SECRET`. A missing key
 * fails closed (generation throws, validation rejects).
 */
function proofSecret(): string {
  const dedicated = (process.env.PREAUTH_PROOF_SECRET ?? "").trim();
  if (dedicated) return dedicated;
  const oauthState = (process.env.OAUTH_STATE_SECRET ?? "").trim();
  if (oauthState) return oauthState;
  return (process.env.JWT_SECRET ?? "").trim();
}

/** Diagnostics only — never exposes the key. */
export function isPreAuthConfigured(): boolean {
  return proofSecret().length > 0;
}

function safeEqual(a: string, b: string): boolean {
  const digestA = crypto.createHash("sha256").update(a, "utf8").digest();
  const digestB = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export interface PreAuthProof {
  /** Value to set in the PREAUTH_COOKIE. */
  cookieValue: string;
  maxAgeMs: number;
  /**
   * The envelope nonce. Callers record it in the one-time store at mint time;
   * it is never sent to the browser except inside the signed cookie.
   */
  nonce: string;
}

/** Mint a proof. Throws when no signing key is configured (fail closed). */
export function createPreAuthProof(
  now: number = Date.now(),
  ttlMs: number = PREAUTH_TTL_MS,
): PreAuthProof {
  const secret = proofSecret();
  if (!secret) {
    throw new Error("Pre-authentication proof secret is not configured");
  }
  const nonce = crypto.randomBytes(NONCE_BYTES).toString("base64url");
  const envelope: ProofEnvelope = { n: nonce, e: now + ttlMs };
  const payload = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  return {
    cookieValue: `${payload}.${sign(payload, secret)}`,
    maxAgeMs: ttlMs,
    nonce,
  };
}

/**
 * Validate a proof cookie. Rejects (never throws on attacker input) when the
 * cookie is absent, malformed, forged or expired.
 */
export function validatePreAuthProof(
  cookieValue: unknown,
  now: number = Date.now(),
): PreAuthValidation {
  const value = typeof cookieValue === "string" ? cookieValue : "";
  if (!value) return { ok: false, reason: "missing_cookie" };

  const secret = proofSecret();
  if (!secret) return { ok: false, reason: "bad_signature" };

  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "malformed_cookie" };
  }
  const [payload, providedSignature] = parts;
  if (!safeEqual(providedSignature, sign(payload, secret))) {
    return { ok: false, reason: "bad_signature" };
  }

  let envelope: ProofEnvelope;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return { ok: false, reason: "malformed_cookie" };
    }
    envelope = decoded as ProofEnvelope;
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

  return { ok: true, nonce };
}

/**
 * Cookie options for SETTING the proof.
 *
 * ── Why SameSite=None in production ─────────────────────────────────────────
 *
 * The proof is minted by `POST /api/auth/preauth` (a `fetch` from the frontend)
 * and read one moment later by `GET /auth/google`.
 *
 * The API lives on `*.onrender.com` and every frontend lives on `*.vercel.app`,
 * so that fetch is a THIRD-PARTY request. With `SameSite=Lax` the browser
 * drops the cookie on a cross-site response, so `/auth/google` never sees a
 * proof and answers `preauth_required` — even though the challenge passed.
 * That is exactly what happened: email login worked (its session cookie already
 * uses `SameSite=None`) while Google login could never start.
 *
 * `None` requires `Secure`, so this is production-only. In development the app
 * and the API share `localhost`, where the request is same-site and `Lax` is
 * both sufficient and compatible with plain http.
 *
 * NOTE for operators: `SameSite=None` is a third-party cookie. Browsers that
 * block third-party cookies outright (Safari ITP, Firefox ETP, Chrome
 * incognito) can still refuse it. Serving the API from the same registrable
 * domain as the site (e.g. `api.velnox.com`) removes the restriction entirely;
 * that is an infrastructure change, not a code one.
 */
export function preAuthCookieOptions(maxAgeMs: number, isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
    maxAge: maxAgeMs,
    path: PREAUTH_COOKIE_PATH,
  };
}

/**
 * Clearing options MUST mirror the set options exactly — path, secure and
 * sameSite — or the browser keeps the original cookie instead of clearing it.
 */
export function clearPreAuthCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
    path: PREAUTH_COOKIE_PATH,
  };
}
