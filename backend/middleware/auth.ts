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

/**
 * requireAuth — verifies the JWT session cookie.
 * Only checks token signature — does NOT check the revoked_tokens table
 * (that check lives in /api/auth/me to avoid an extra DB query on every request).
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.velnox_session;

  if (!token) {
    res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    return;
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET not configured");

    const payload = jwt.verify(token, secret) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.velnox_session;
  if (!token) { next(); return; }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) { next(); return; }
    const payload = jwt.verify(token, secret) as AuthPayload;
    req.user = payload;
  } catch { /* ignore invalid tokens */ }
  next();
}
