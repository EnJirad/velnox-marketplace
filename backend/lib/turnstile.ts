/**
 * Cloudflare Turnstile — the ONE server-side verification utility.
 *
 * Every authentication entry point calls `verifyTurnstile()`. Before this
 * module the siteverify call was copy-pasted into two endpoints, `member-login`
 * had no verification at all, and `GET /auth/google` could be reached directly
 * with no challenge whatsoever.
 *
 * ── Fail-closed rules (the whole point of this file) ─────────────────────────
 *
 *   missing secret in PRODUCTION      → reject (`TURNSTILE_NOT_CONFIGURED`)
 *   missing secret in DEVELOPMENT     → skip, and say so (`skipped: true`)
 *   empty / whitespace / "bypass"     → reject (`TURNSTILE_REQUIRED`)
 *   Cloudflare says success:false     → reject, with Cloudflare's error codes
 *   hostname not in the allowlist     → reject (`TURNSTILE_HOSTNAME_MISMATCH`)
 *   action mismatch                   → reject (`TURNSTILE_ACTION_MISMATCH`)
 *   same token twice                  → reject (`TURNSTILE_REPLAYED`)
 *   request hangs past the timeout    → reject (`TURNSTILE_TIMEOUT`)
 *   network/DNS failure               → reject (`TURNSTILE_UNAVAILABLE`)
 *
 * A rejection here never throws: the caller gets `{ ok: false, code, reason }`
 * and decides the HTTP status. Nothing in this file logs the token or secret.
 *
 * ── Trusted hostnames ────────────────────────────────────────────────────────
 *
 * The allowlist is derived from SERVER configuration only — `TURNSTILE_HOSTNAMES`
 * when set, otherwise the hosts of `CORS_ORIGINS` plus the three frontend URLs.
 * The `Host`/`Origin` header of the incoming request is never trusted, because
 * an attacker controls it.
 */

import crypto from "crypto";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare's own ceiling for a siteverify round trip before we give up. */
const VERIFY_TIMEOUT_MS = 5_000;

/**
 * Timeout in ms. `TURNSTILE_TIMEOUT_MS` lets a deployment tighten it (a slow
 * verify is a failed login) and lets the test suite exercise the abort path
 * without waiting five seconds.
 */
function verifyTimeoutMs(): number {
  const raw = Number(process.env.TURNSTILE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : VERIFY_TIMEOUT_MS;
}

/**
 * Replay cache. Cloudflare tokens are single-use at their edge, but relying on
 * that alone means a token that Cloudflare happens to accept twice (retry,
 * clock skew, an edge that lost state) is accepted twice here too. This is
 * defence in depth, bounded and swept so it cannot grow without limit.
 */
const REPLAY_TTL_MS = 5 * 60 * 1000;
const REPLAY_MAX_ENTRIES = 5_000;
const seenTokens = new Map<string, number>();

function sweepReplayCache(now: number): void {
  for (const [key, expiresAt] of seenTokens) {
    if (expiresAt <= now) seenTokens.delete(key);
  }
  // Hard cap: drop the oldest insertions first (Map keeps insertion order).
  while (seenTokens.size > REPLAY_MAX_ENTRIES) {
    const oldest = seenTokens.keys().next();
    if (oldest.done) break;
    seenTokens.delete(oldest.value);
  }
}

/** Test seam — clears the replay cache so cases do not leak into each other. */
export function resetTurnstileReplayCache(): void {
  seenTokens.clear();
}

export type TurnstileFailureCode =
  | "TURNSTILE_REQUIRED"
  | "TURNSTILE_INVALID"
  | "TURNSTILE_EXPIRED"
  | "TURNSTILE_REPLAYED"
  | "TURNSTILE_HOSTNAME_MISMATCH"
  | "TURNSTILE_ACTION_MISMATCH"
  | "TURNSTILE_TIMEOUT"
  | "TURNSTILE_UNAVAILABLE"
  | "TURNSTILE_NOT_CONFIGURED";

export interface TurnstileVerification {
  ok: boolean;
  code?: TurnstileFailureCode;
  /** Loggable explanation — never contains the token or the secret. */
  reason?: string;
  /**
   * True only when verification was deliberately skipped because no secret is
   * configured AND the process is not production. Callers must never treat
   * this as "verified".
   */
  skipped?: boolean;
}

export interface VerifyTurnstileInput {
  /** The token the browser obtained from the widget. */
  token: unknown;
  /**
   * Expected action name. When provided, Cloudflare's echoed `action` must
   * match exactly. Set per entry point so a token minted for the login form
   * cannot be replayed against registration.
   */
  action?: string;
  /** Caller IP, forwarded to Cloudflare as `remoteip`. */
  remoteIp?: string;
  /** Injectable for tests. */
  now?: number;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Secret is read at call time — never snapshotted at import. */
function turnstileSecret(): string {
  return (process.env.TURNSTILE_SECRET_KEY ?? "").trim();
}

/**
 * Hosts Cloudflare is allowed to have served the challenge for.
 *
 * Server-side configuration only: an attacker-supplied Host header must never
 * be able to widen this list.
 */
export function trustedHostnames(): string[] {
  const explicit = (process.env.TURNSTILE_HOSTNAMES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (explicit.length > 0) return explicit;

  const derived = new Set<string>();
  const pushOrigin = (raw: string | undefined) => {
    if (!raw) return;
    try {
      const host = new URL(raw.trim()).hostname.toLowerCase();
      if (host) derived.add(host);
    } catch {
      // Not a URL — ignore rather than guess.
    }
  };

  for (const origin of (process.env.CORS_ORIGINS ?? "").split(",")) pushOrigin(origin);
  pushOrigin(process.env.VITE_VELSHOP_URL);
  pushOrigin(process.env.VITE_VELSELLER_URL);
  pushOrigin(process.env.VITE_VELCENTER_URL);
  pushOrigin(process.env.VITE_VELNOX_URL);

  return [...derived];
}

/**
 * A token that can never be a real Turnstile response.
 *
 * `"bypass"` is listed explicitly: the previous frontend returned that literal
 * string whenever no site key was configured, and a server that merely checked
 * "is the field non-empty" would have accepted it.
 */
function looksLikeRealToken(token: string): boolean {
  const value = token.trim();
  if (!value) return false;
  if (value.toLowerCase() === "bypass") return false;
  if (value.toLowerCase() === "null" || value.toLowerCase() === "undefined") return false;
  // Real tokens are long opaque strings; this is a shape sanity check only —
  // Cloudflare remains the authority on validity.
  return value.length >= 20;
}

interface SiteverifyResponse {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
  challenge_ts?: string;
}

/**
 * Verify one Turnstile token against Cloudflare.
 *
 * Never throws. Every failure path returns a code the caller can map to an
 * HTTP response; every failure path is closed (no "assume valid" branch).
 */
export async function verifyTurnstile(
  input: VerifyTurnstileInput,
): Promise<TurnstileVerification> {
  const now = input.now ?? Date.now();
  const secret = turnstileSecret();

  // ── 1. Configuration gate ────────────────────────────────────────────────
  if (!secret) {
    if (isProduction()) {
      // Requirement: production must never skip verification.
      console.error("[turnstile] TURNSTILE_SECRET_KEY is not configured — refusing authentication");
      return {
        ok: false,
        code: "TURNSTILE_NOT_CONFIGURED",
        reason: "verification is not configured on the server",
      };
    }
    // Development only. Explicit, logged, and reported to the caller so the
    // UI never claims a challenge succeeded when none happened.
    console.warn("[turnstile] no secret configured — verification skipped (development only)");
    return { ok: true, skipped: true, reason: "no secret configured (development)" };
  }

  // ── 2. Token shape gate ──────────────────────────────────────────────────
  const token = typeof input.token === "string" ? input.token : "";
  if (!looksLikeRealToken(token)) {
    return { ok: false, code: "TURNSTILE_REQUIRED", reason: "a challenge token is required" };
  }

  // ── 3. Replay gate ───────────────────────────────────────────────────────
  sweepReplayCache(now);
  const tokenKey = crypto.createHash("sha256").update(token, "utf8").digest("hex");
  if (seenTokens.has(tokenKey)) {
    return { ok: false, code: "TURNSTILE_REPLAYED", reason: "this challenge was already used" };
  }

  // ── 4. Cloudflare round trip (timeout-bounded, network-fail-closed) ──────
  const body = new URLSearchParams({ secret, response: token });
  if (input.remoteIp) body.set("remoteip", input.remoteIp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), verifyTimeoutMs());

  let payload: SiteverifyResponse;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        code: "TURNSTILE_UNAVAILABLE",
        reason: `siteverify answered ${response.status}`,
      };
    }
    payload = (await response.json()) as SiteverifyResponse;
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      code: aborted ? "TURNSTILE_TIMEOUT" : "TURNSTILE_UNAVAILABLE",
      reason: aborted ? "siteverify timed out" : "siteverify could not be reached",
    };
  } finally {
    clearTimeout(timer);
  }

  // ── 5. Cloudflare's verdict ──────────────────────────────────────────────
  if (payload.success !== true) {
    const codes = Array.isArray(payload["error-codes"]) ? payload["error-codes"] : [];
    const expired = codes.some((c) => /timeout-or-duplicate|expired/i.test(c));
    return {
      ok: false,
      code: expired ? "TURNSTILE_EXPIRED" : "TURNSTILE_INVALID",
      reason: codes.length > 0 ? codes.join(",") : "challenge rejected",
    };
  }

  // ── 6. Hostname gate ─────────────────────────────────────────────────────
  const allowed = trustedHostnames();
  const returnedHost = typeof payload.hostname === "string" ? payload.hostname.toLowerCase() : "";
  if (allowed.length > 0) {
    if (!returnedHost || !allowed.includes(returnedHost)) {
      return {
        ok: false,
        code: "TURNSTILE_HOSTNAME_MISMATCH",
        reason: "the challenge was solved on a different site",
      };
    }
  } else if (isProduction()) {
    // No allowlist in production means we cannot prove where the challenge was
    // solved, which is the same as not checking. Fail closed.
    console.error("[turnstile] no trusted hostnames configured — refusing authentication");
    return {
      ok: false,
      code: "TURNSTILE_NOT_CONFIGURED",
      reason: "trusted hostnames are not configured on the server",
    };
  }

  // ── 7. Action gate ───────────────────────────────────────────────────────
  // Only enforced when Cloudflare echoed an action back: a widget configured
  // without one cannot be checked, and rejecting that case would break every
  // existing deployment during rollout. When an action IS present it must be
  // the one this application expects.
  if (input.action && typeof payload.action === "string" && payload.action !== "") {
    if (payload.action !== input.action) {
      return {
        ok: false,
        code: "TURNSTILE_ACTION_MISMATCH",
        reason: "the challenge was solved for a different form",
      };
    }
  }

  // ── 8. Accept, and remember the token so it cannot be used again ─────────
  seenTokens.set(tokenKey, now + REPLAY_TTL_MS);
  return { ok: true };
}

/**
 * Map a verification failure to the HTTP status the caller should send.
 * Kept here so all three entry points answer identically.
 */
export function turnstileStatusFor(code: TurnstileFailureCode): number {
  switch (code) {
    case "TURNSTILE_REQUIRED":
    case "TURNSTILE_INVALID":
    case "TURNSTILE_EXPIRED":
    case "TURNSTILE_REPLAYED":
    case "TURNSTILE_HOSTNAME_MISMATCH":
    case "TURNSTILE_ACTION_MISMATCH":
      return 400;
    case "TURNSTILE_TIMEOUT":
    case "TURNSTILE_UNAVAILABLE":
      return 503;
    case "TURNSTILE_NOT_CONFIGURED":
      return 503;
    default:
      return 400;
  }
}
