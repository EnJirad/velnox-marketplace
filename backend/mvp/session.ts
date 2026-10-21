/**
 * MVP session — the ONLY place a session cookie is minted, set or revoked.
 *
 * The MVP deliberately keeps the existing session contract:
 *
 *   • cookie `velnox_session`, httpOnly, SameSite=None, Secure in production,
 *     7-day expiry — a frontend built against the pre-MVP API needs no cookie
 *     change at cutover;
 *   • `MVP_COOKIE_SECURE=true` can only ADD `Secure` (never remove it in
 *     production). It exists for the HTTPS browser E2E: Chromium rejects a
 *     `SameSite=None` cookie that lacks `Secure`, so the local test harness
 *     serves TLS with a self-signed certificate and sets this flag — the exact
 *     cookie the staging deployment already sends over HTTPS;
 *   • JWT payload `{ userId, email, jti }`, so the existing
 *     `middleware/auth.ts#requireAuth` verifies it unchanged (signature, expiry
 *     and `revoked_tokens` lookup all already read the same column names the MVP
 *     schema declares).
 *
 * What is NOT reused is the Google OAuth flow: the MVP schema has no
 * `auth_identities` / `customer_profiles` tables, so provider sign-in is parked
 * (documented in the Phase 3 report). Email + password is the only credential.
 */
import crypto from "node:crypto";
import type { Response } from "express";
import jwt from "jsonwebtoken";
import { query } from "../db/index.js";
import { revokeToken } from "../middleware/auth.js";
import { ApiError, SESSION_COOKIE } from "./http.js";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Fail closed with an explicit configuration error instead of signing with
    // an empty/undefined secret.
    throw new ApiError(503, "AUTH_NOT_CONFIGURED", "Authentication is not configured on this server");
  }
  return secret;
}

/** Mint a session token. The `jti` is what makes server-side revocation possible. */
export function createSessionToken(userId: string, email: string): string {
  const jti = crypto.randomUUID();
  return jwt.sign({ userId, email, jti }, jwtSecret(), { expiresIn: "7d" });
}

/**
 * Whether the session cookie carries `Secure`.
 *
 * Production is always secure; `MVP_COOKIE_SECURE=true` can turn it ON elsewhere
 * (HTTPS test/staging) but there is deliberately no way to turn it off in
 * production — a flag must never be able to weaken the cookie.
 */
export function sessionCookieSecure(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    (process.env.MVP_COOKIE_SECURE ?? "").trim().toLowerCase() === "true"
  );
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: "none",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: "none",
  });
}

/**
 * Revoke the presented token: persist the claim (`revoked_tokens`) and warm the
 * in-process cache so the very next request from this instance is refused
 * without a database round trip.
 *
 * Expiry comes from the token's own `exp`, which keeps the row satisfy
 * `expires_at > revoked_at`. A token without a `jti`/`exp` cannot be revoked by
 * claim, so the caller clears the cookie and the signature is the only thing
 * left — logged explicitly rather than silently ignored.
 */
export async function revokeSessionCookie(res: Response): Promise<boolean> {
  const token = res.req?.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || token.length === 0) {
    clearSessionCookie(res);
    return false;
  }

  let payload: { userId?: string; jti?: string; exp?: number };
  try {
    payload = jwt.verify(token, jwtSecret()) as typeof payload;
  } catch {
    // An expired or forged token needs no revocation row.
    clearSessionCookie(res);
    return false;
  }

  if (!payload.jti || !payload.exp || !payload.userId) {
    clearSessionCookie(res);
    console.warn("[mvp] logout: token has no revocable claim (jti/exp/userId)");
    return false;
  }

  const expiresAt = new Date(payload.exp * 1000);
  if (expiresAt.getTime() <= Date.now()) {
    clearSessionCookie(res);
    return false;
  }

  await query(
    `INSERT INTO revoked_tokens (token_id, user_id, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (token_id) DO NOTHING`,
    [payload.jti, payload.userId, expiresAt],
  );
  revokeToken(payload.jti);
  clearSessionCookie(res);
  return true;
}

/** Tokens whose `expires_at` has passed are dead weight; safe to purge. */
export async function purgeExpiredRevocations(): Promise<number> {
  const result = await query(`DELETE FROM revoked_tokens WHERE expires_at <= NOW()`);
  return result.rowCount ?? 0;
}

export { SESSION_TTL_SECONDS };
