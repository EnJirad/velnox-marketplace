/**
 * Raw-body preservation for `POST /api/payments/stripe/webhook`.
 *
 * WHY THIS IS ITS OWN MODULE
 * Stripe signs the EXACT bytes it sends, so the handler must verify a signature
 * over a Buffer — never over a re-serialised `JSON.stringify(req.body)`, which
 * cannot match. The guarantee used to be an inline anonymous middleware in
 * `server.ts` holding its own copy of the path test, which had three costs:
 *
 *   • the test suite mirrored the same path test in its own app builder, so a
 *     change to `server.ts` could break production without failing a test;
 *   • a request whose path differed from the literal string (`/…/webhook/`, a
 *     differently-cased path) fell through to `express.json()`, which replaced
 *     the raw bytes with an object. `constructEventAsync` then hashed the
 *     string `"[object Object]"` and the SDK reported "No signatures found
 *     matching the expected signature for payload" — a message that reads like
 *     a *forged event* and hides a *wiring* bug behind it;
 *   • a non-JSON `Content-Type` made `express.raw({ type: "application/json" })`
 *     skip the body entirely, with the same misleading outcome.
 *
 * So the matcher lives here, is exported, and the tests exercise it directly.
 * Two deliberate widening choices, both scoped to this one route:
 *
 *   • the path is matched the way EXPRESS matches the route — case-insensitively
 *     and tolerating a trailing slash — so the raw body is read wherever that
 *     route can actually be reached;
 *   • the content type is NOT used as a gate. This route exists only to verify a
 *     signature over bytes, is never served to a browser, and the declared
 *     `Content-Type` is not part of the signed payload. Buffering whatever
 *     arrived is strictly safer than selecting a parser by header and silently
 *     verifying something the sender never signed.
 *
 * Every other route's body handling (`express.json({ limit: "1mb" })`) is
 * untouched, and this middleware MUST stay mounted before it.
 */
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";

/** The one path whose body must never be JSON-parsed. Matches the route in `routes/stripe.ts`. */
export const STRIPE_WEBHOOK_PATH = "/api/payments/stripe/webhook";

/**
 * Does this request belong to the Stripe webhook route?
 *
 * Mirrors Express's own route matching: the method is case-insensitive, the path
 * comparison is case-insensitive, and a trailing slash is ignored (Express's
 * default `strict routing: false` reaches `/x` from `/x/`). A query string is
 * already excluded because Express's `req.path` carries none.
 */
export function isStripeWebhookRequest(method: string, path: string): boolean {
  if (typeof method !== "string" || method.toUpperCase() !== "POST") return false;
  if (typeof path !== "string") return false;
  const withoutTrailingSlash = path.replace(/\/+$/, "");
  const normalized = (withoutTrailingSlash === "" ? "/" : withoutTrailingSlash).toLowerCase();
  return normalized === STRIPE_WEBHOOK_PATH;
}

/**
 * Mount with `app.use(stripeWebhookRawBody)` BEFORE `express.json()`.
 *
 * On the webhook path it buffers the body and sets `req.body` to a Buffer;
 * every other request passes straight through untouched. `express.json()` will
 * not touch a body this parser already consumed, so the bytes the handler
 * verifies are the bytes Stripe signed.
 */
export const stripeWebhookRawBody: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!isStripeWebhookRequest(req.method, req.path)) {
    next();
    return;
  }
  express.raw({ type: () => true })(req, res, next);
};
