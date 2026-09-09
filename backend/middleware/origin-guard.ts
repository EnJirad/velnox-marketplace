import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * CSRF / cross-site-request defense via Origin validation.
 *
 * WHY:
 *   Sessions are cookie-based (SameSite=None; Secure) because the API
 *   (velnox-api.onrender.com) and the frontends (velnox.com subdomains)
 *   are cross-site. CORS already prevents cross-origin browsers from
 *   *reading* responses, but a state-changing cross-site request can
 *   still be *sent* with cookies. The Origin header — set by browsers on
 *   all state-changing requests — lets us reject any request whose origin
 *   is not an allowlisted Velnox frontend.
 *
 *   This is the simplest robust defense for this architecture (no token
 *   plumbing, no double-submit cookie) and it cannot break:
 *     • Google OAuth — the flow uses GET redirects (never checked),
 *     • WebSocket — the /ws upgrade is a GET,
 *     • server-to-server clients (Stripe webhook) — they send no Origin
 *       header, which is accepted,
 *     • local dev — dev origins are allowlisted like the CORS config.
 *
 * RULES:
 *   • Safe methods (GET/HEAD/OPTIONS) are never checked.
 *   • Requests WITHOUT an Origin header are accepted (non-browser
 *     clients; browsers always send Origin on cross-origin state-changing
 *     requests and on same-origin fetch POSTs).
 *   • Requests WITH an Origin not in the allowlist → 403.
 */

export function createOriginGuard(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }

    const origin = req.headers.origin;
    // No Origin → non-browser client (curl, Stripe webhook, mobile app).
    if (!origin) {
      next();
      return;
    }

    if (allowed.has(origin)) {
      next();
      return;
    }

    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Untrusted origin" },
    });
  };
}