/**
 * MVP payments — Stripe TEST MODE only.
 *
 * Two endpoints, one rule: the browser can ASK to pay, but only Stripe can say
 * that money moved.
 *
 *   POST /api/mvp/orders/:id/payment-session
 *     Creates (or replaces) ONE live Stripe Checkout Session for an unpaid
 *     order. The amount comes from the order row, never from the request.
 *
 *   POST /api/mvp/payments/webhook
 *     Verifies the signature over the RAW body, then hands the event to
 *     `settlement.ts`, which owns every state change.
 *
 * Test-mode-only is enforced by `lib/payment-config.ts`, which refuses a
 * live-looking key, a key with an unrecognized shape, a declared live mode, or
 * a missing webhook secret. There is no fallback and no warning path.
 *
 * The redirect back to the storefront is NOT a payment signal: it only carries a
 * session id a frontend may poll (`GET /api/mvp/orders/:id`) until the webhook
 * has settled the order.
 */
import type { Express, Request, Response } from "express";
import Stripe from "stripe";
import { query, withTransaction } from "../db/index.js";
import { parseDecimal, roundHalfUp } from "../lib/money.js";
import {
  normalizePaymentMethod,
  stripePaymentMethodType,
  stripeSecretKey,
  stripeStatus,
  stripeWebhookSecret,
} from "../lib/payment-config.js";
import {
  ApiError,
  conflict,
  forbidden,
  notFound,
  ok,
  pathUuid,
  requireActiveUser,
  route,
} from "./http.js";
import { settleStripeEvent } from "./settlement.js";

/** A Stripe charge may not exceed 8 digits of minor units. */
const STRIPE_MAX_MINOR = 99_999_999n;

let cached: { key: string; client: Stripe } | null = null;

/**
 * The ONE Stripe client. Keyed by the resolved test secret so a rotated key is
 * never masked by a stale client. Returns `null` when this deployment must not
 * take payments at all.
 */
export function stripeClient(): Stripe | null {
  const key = stripeSecretKey();
  if (!key) return null;
  if (cached?.key === key) return cached.client;
  const client = new Stripe(key, { apiVersion: "2025-08-27.basil" as never });
  cached = { key, client };
  return client;
}

/**
 * Exact decimal → Stripe minor units. Integer arithmetic only.
 *
 * `roundHalfUp(x, 2)` already yields value × 100 (the column stores 2 decimals),
 * so this is a direct conversion — multiplying by 100 again would charge 100×.
 */
export function toStripeMinor(amount: string): number {
  const minor = roundHalfUp(parseDecimal(amount), 2);
  if (minor <= 0n) throw conflict("INVALID_AMOUNT", "Order total must be greater than zero");
  if (minor > STRIPE_MAX_MINOR) throw conflict("INVALID_AMOUNT", "Order total exceeds the Stripe limit");
  return Number(minor);
}

export function setupMvpPaymentRoutes(app: Express): void {
  // ── Configuration status (public, secret-free) ───────────────────────────
  app.get("/api/mvp/payments/status", (_req: Request, res: Response) => {
    const status = stripeStatus();
    ok(res, {
      usable: status.usable,
      mode: status.mode,
      publishableKey: status.publishableKey,
      reason: status.reason,
      methods: status.usable ? ["CARD", "PROMPTPAY"] : [],
    });
  });

  // ── Open a payment session ───────────────────────────────────────────────
  app.post(
    "/api/mvp/orders/:id/payment-session",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const user = req.sessionUser!;
      const orderId = pathUuid(req.params.id);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const method = normalizePaymentMethod(body.method ?? "CARD");
      if (method !== "CARD" && method !== "PROMPTPAY") {
        throw new ApiError(400, "INVALID_PAYMENT_METHOD", "Only card and PromptPay are available");
      }
      const stripeMethod = stripePaymentMethodType(method)!;

      // Order authorization/state is checked BEFORE provider configuration, so a
      // caller who does not own the order always gets 404 and a paid order always
      // gets 409 — neither depends on whether Stripe happens to be configured.
      const order = await query(
        `SELECT id, user_id, status, total_amount, currency, payment_expires_at
           FROM orders WHERE id = $1 AND user_id = $2`,
        [orderId, user.id],
      );
      const row = order.rows[0] as
        | {
            id: string;
            status: string;
            total_amount: string;
            currency: string;
            payment_expires_at: string | null;
          }
        | undefined;
      if (!row) throw notFound("ORDER_NOT_FOUND", "Order not found");
      if (row.status !== "pending_payment") {
        throw conflict(
          row.status === "cancelled" ? "ORDER_CANCELLED" : "ORDER_ALREADY_PAID",
          "This order is not awaiting payment",
        );
      }
      if (row.payment_expires_at && new Date(row.payment_expires_at).getTime() <= Date.now()) {
        throw conflict("PAYMENT_WINDOW_EXPIRED", "The payment window for this order has expired");
      }

      const stripe = stripeClient();
      if (!stripe) {
        const status = stripeStatus();
        throw new ApiError(
          503,
          status.reason ?? "STRIPE_NOT_CONFIGURED",
          "Card and PromptPay payments are not available right now",
        );
      }

      const minor = toStripeMinor(row.total_amount);
      const payment = await withTransaction(async (client) => {
        // Exactly ONE live Stripe session per order (`idx_payments_one_active_stripe`).
        // A retry REPLACES the previous one instead of opening a second payable
        // URL — the old session is cancelled so it cannot be paid later.
        await client.query(
          `UPDATE payments
              SET status = 'cancelled', updated_at = NOW(), failure_message = 'replaced_by_new_session'
            WHERE order_id = $1 AND provider = 'stripe' AND status IN ('pending', 'requires_action')`,
          [orderId],
        );
        const inserted = await client.query(
          `INSERT INTO payments (order_id, provider, status, amount, currency, method)
           VALUES ($1, 'stripe', 'pending', $2, $3, $4)
           RETURNING id`,
          [orderId, row.total_amount, row.currency.trim(), method.toLowerCase()],
        );
        return inserted.rows[0] as { id: string };
      });

      const frontendUrl = process.env.VITE_VELSHOP_URL || "https://velshop.vercel.app";
      try {
        const session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            payment_method_types: [stripeMethod],
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: row.currency.trim().toLowerCase(),
                  unit_amount: minor,
                  product_data: { name: `Velnox order ${orderId}` },
                },
              },
            ],
            client_reference_id: orderId,
            metadata: { orderId, paymentId: payment.id, method },
            success_url: `${frontendUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}&order=${orderId}`,
            cancel_url: `${frontendUrl}/checkout/cancel?order=${orderId}`,
          },
          // A retried request must not create a second session for the same
          // payment row; Stripe deduplicates on this key.
          { idempotencyKey: `mvp-session-${payment.id}` },
        );

        await query(
          `UPDATE payments SET provider_checkout_session_id = $2, status = 'requires_action', updated_at = NOW()
            WHERE id = $1`,
          [payment.id, session.id],
        );

        ok(res, {
          paymentId: payment.id,
          sessionId: session.id,
          url: session.url,
          mode: "test",
        });
      } catch (err) {
        await query(
          `UPDATE payments SET status = 'failed', failure_code = 'SESSION_CREATE_FAILED',
                  failure_message = $2, updated_at = NOW()
            WHERE id = $1`,
          [payment.id, err instanceof Error ? err.message.slice(0, 200) : "session create failed"],
        ).catch(() => undefined);
        console.error("[mvp][stripe] session create failed:", {
          orderId,
          message: err instanceof Error ? err.message : String(err),
        });
        throw new ApiError(502, "PAYMENT_SESSION_FAILED", "Could not start the payment session");
      }
    }),
  );

  // ── Webhook ──────────────────────────────────────────────────────────────
  // `backend/mvp/webhook-body.ts` buffers this path before `express.json()`, so
  // `req.body` here is the exact bytes Stripe signed.
  app.post(
    "/api/mvp/payments/webhook",
    route(async (req: Request, res: Response) => {
      const secret = stripeWebhookSecret();
      const stripe = stripeClient();
      if (!secret || !stripe) {
        throw new ApiError(503, "WEBHOOK_NOT_CONFIGURED", "Payments are not configured");
      }

      const raw = req.body as unknown;
      if (!Buffer.isBuffer(raw) && typeof raw !== "string") {
        console.error(
          "[mvp][stripe] raw body unavailable — the raw-body middleware must be mounted before express.json()",
        );
        throw new ApiError(500, "RAW_BODY_MISSING", "Webhook body was not preserved");
      }

      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string" || signature.length === 0) {
        throw new ApiError(400, "SIGNATURE_MISSING", "Missing Stripe signature");
      }

      let event: Stripe.Event;
      try {
        // Async form: the SDK's WebCrypto verifier is async-only outside Node,
        // and the sync call throws for every event there.
        event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
      } catch (err) {
        console.error(
          "[mvp][stripe] signature verification failed:",
          err instanceof Error ? err.message : "invalid signature",
        );
        throw new ApiError(400, "INVALID_SIGNATURE", "Invalid signature");
      }

      const outcome = await settleStripeEvent(event);
      ok(res, { received: true, ...outcome });
    }),
  );

  // ── Buyer-facing guard: never claim a payment from the redirect ──────────
  app.get(
    "/api/mvp/orders/:id/payment-status",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const user = req.sessionUser!;
      const orderId = pathUuid(req.params.id);
      const result = await query(
        `SELECT o.id, o.status, o.paid_at,
                (SELECT p.status FROM payments p WHERE p.order_id = o.id
                  ORDER BY p.created_at DESC LIMIT 1) AS payment_status
           FROM orders o
          WHERE o.id = $1 AND o.user_id = $2`,
        [orderId, user.id],
      );
      const row = result.rows[0] as
        | { id: string; status: string; paid_at: string | null; payment_status: string | null }
        | undefined;
      if (!row) throw notFound("ORDER_NOT_FOUND", "Order not found");
      // Deliberately reports the SERVER's state; `session_id` in the URL is not
      // accepted as evidence of anything.
      ok(res, {
        orderId: row.id,
        orderStatus: row.status,
        paymentStatus: row.payment_status,
        paidAt: row.paid_at,
        settled: row.paid_at !== null,
      });
    }),
  );
}

export { forbidden };
