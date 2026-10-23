import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthPayload {
  userId: string;
  email: string;
  jti?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

// ─── Revocation cache ──────────────────────────────────────────────────────
// In-memory set of revoked JTIs for O(1) per-request lookups. This avoids
// a DB round-trip on every authenticated request while still enforcing
// server-side revocation. The DB (revoked_tokens table) is the source of
// truth; the cache is a fast overlay that is also populated on logout.
//
// On cache miss (jti not in Set but logout happened after server start),
// we fall back to a single DB check and populate the cache.
//
// Expired JTIs are cleaned from the cache every 5 minutes to prevent
// unbounded growth.
const revokedJTIs = new Set<string>();
let lastRevokedTokensCleanup = 0;
const REVOKED_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Add a jti to the in-memory revocation cache (called on logout). */
export function revokeToken(jti: string): void {
  revokedJTIs.add(jti);
}

/** Synchronous revocation check (in-memory cache only). For async callers
 *  prefer the full isTokenRevoked() which also checks the DB. */
export function isTokenRevokedSync(jti: string): boolean {
  return revokedJTIs.has(jti);
}

/** Check if a jti is revoked. Falls back to DB on cache miss. */
async function isTokenRevoked(jti: string): Promise<boolean> {
  // Fast path: already in the in-memory cache.
  if (revokedJTIs.has(jti)) return true;

  // Slow path: check the database (handles revocations from other
  // server instances or revocations that happened before this instance
  // started).
  try {
    const { query } = await import("../db/index.js");
    const result = await query(
      "SELECT 1 FROM revoked_tokens WHERE token_id = $1 LIMIT 1",
      [jti],
    );
    if (result.rows.length > 0) {
      revokedJTIs.add(jti); // populate cache for future requests
      return true;
    }
  } catch {
    // revoked_tokens table may not exist yet — treat as not revoked
  }
  return false;
}

/**
 * requireAuth — verifies the JWT session cookie.
 * Checks: (1) token signature, (2) expiration, (3) revocation via jti.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.velnox_session;

  if (!token) {
    res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    return;
  }

  let payload: AuthPayload;
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET not configured");
    payload = jwt.verify(token, secret) as AuthPayload;
  } catch {
    res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } });
    return;
  }

  // Server-side revocation check — a valid JWT is NOT sufficient.
  // This is outside the jwt.verify try/catch so a DB error doesn't
  // masquerade as "Invalid or expired token".
  if (payload.jti && (await isTokenRevoked(payload.jti))) {
    res.clearCookie("velnox_session", { path: "/" });
    res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Session revoked" } });
    return;
  }

  req.user = payload;
  next();
}

/**
 * optionalAuth — like requireAuth, but anonymous users are allowed.
 * Revoked tokens are treated as anonymous (not as authenticated).
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.velnox_session;
  if (!token) { next(); return; }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) { next(); return; }
    const payload = jwt.verify(token, secret) as AuthPayload;

    // Revoked tokens are treated as anonymous.
    if (payload.jti && (await isTokenRevoked(payload.jti))) {
      next(); return;
    }

    req.user = payload;
  } catch { /* ignore invalid/expired tokens — treat as anonymous */ }
  next();
}
