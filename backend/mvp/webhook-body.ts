/**
 * Raw-body preservation for `POST /api/mvp/payments/webhook`.
 *
 * Stripe signs the EXACT bytes it sends, so the handler must verify a signature
 * over a Buffer — never over a re-serialised `JSON.stringify(req.body)`, which
 * cannot match and would report "No signatures found matching the expected
 * signature for payload", a message that reads like a forged event while the
 * real bug is the wiring.
 *
 * Two deliberate choices, scoped to this one route:
 *
 *   • the path is matched the way EXPRESS matches a route — case-insensitively
 *     and tolerating a trailing slash — so the raw body is read wherever the
 *     route can actually be reached;
 *   • the content type is NOT a gate. The declared header is not part of the
 *     signed payload, and buffering whatever arrived is strictly safer than
 *     selecting a parser by header and silently verifying something else.
 *
 * Must be mounted BEFORE `express.json()` in `server.ts`, and before
 * `express.json()` in any test app builder.
 */
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";

export const MVP_STRIPE_WEBHOOK_PATH = "/api/mvp/payments/webhook";

/** Normalise a route path the way Express matches it. */
function normalizePath(path: string): string {
  const withoutTrailingSlash = path.replace(/\/+$/, "");
  return (withoutTrailingSlash === "" ? "/" : withoutTrailingSlash).toLowerCase();
}

/**
 * Does this request belong to the payment-webhook route?
 *
 * Mirrors Express's own matching: method case-insensitive, path
 * case-insensitive, trailing slash ignored. A query string is already excluded
 * because `req.path` carries none.
 */
export function isMvpWebhookRequest(method: string, path: string): boolean {
  if (typeof method !== "string" || method.toUpperCase() !== "POST") return false;
  if (typeof path !== "string") return false;
  return normalizePath(path) === normalizePath(MVP_STRIPE_WEBHOOK_PATH);
}

/** Buffer the webhook body; every other request passes straight through. */
export const mvpWebhookRawBody: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!isMvpWebhookRequest(req.method, req.path)) {
    next();
    return;
  }
  express.raw({ type: () => true })(req, res, next);
};
