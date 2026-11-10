/**
 * Owner-branded payment QR — Velnox renders the PromptPay QR itself.
 *
 * WHY THIS EXISTS
 * ---------------
 * The existing flow opens a Stripe HOSTED Checkout Session, so paying by QR
 * meant leaving velnox.com for checkout.stripe.com. The owner wants the QR on
 * OUR page: the customer stays on Velnox, sees our branding, our countdown and
 * our status — and the money still moves through the SAME Stripe account and
 * the SAME webhook that already settles orders.
 *
 * HOW IT WORKS (no second payment system)
 * ---------------------------------------
 *   1. `POST /api/payments/promptpay/intent` resolves the amount from the
 *      DATABASE (never the request body) and creates a Stripe PaymentIntent
 *      with `payment_method_types: ["promptpay"]`.
 *   2. Stripe answers with `next_action.promptpay_display_qr_code` — an
 *      EMVCo payload plus a PNG render. We return both, and the VelShop page
 *      draws the QR inside our own card (no redirect).
 *   3. The EXISTING webhook (`payment_intent.succeeded`) settles the order,
 *      because the intent carries `metadata.orderId` / `checkoutGroupId` /
 *      `userId` and `orderIdForPaymentIntent()` resolves through metadata
 *      first.
 *
 * FAIL-CLOSED: when Stripe is not configured (or not usable) the endpoint
 * answers 503 `PAYMENTS_NOT_CONFIGURED` and the page shows our own explanatory
 * state. It never invents a QR.
 */
import type { Express, Request, Response } from "express";
import Stripe from "stripe";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";
import { paymentMethodOptions, stripeStatus } from "../lib/payment-config.js";

/** Money → Stripe minor units (satang for THB). ONE rounding, half-up. */
function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

let cached: { key: string; client: Stripe } | null = null;

/** Same construction rule as routes/stripe.ts — one client per key. */
function getStripe(): Stripe | null {
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) return null;
  if (cached && cached.key === key) return cached.client;
  const client = new Stripe(key, { apiVersion: "2025-08-27.basil" as never });
  cached = { key, client };
  return client;
}

/** PromptPay intents expire; Stripe's own window is ~15 minutes. */
const PROMPTPAY_TTL_SECONDS = 15 * 60;

export function setupPaymentQrRoutes(app: Express): void {
  /**
   * Create (or reuse) a PromptPay PaymentIntent for an order the caller owns.
   * Body: { orderId } — the amount comes from `orders.total_amount`.
   */
  app.post("/api/payments/promptpay/intent", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const orderId = typeof req.body?.orderId === "string" ? req.body.orderId.trim() : "";
      if (!orderId) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "orderId is required" } });
        return;
      }

      // Ownership is in the WHERE — a non-owner gets the same 404 as a missing
      // order, so the endpoint cannot be used to probe order ids.
      const orderRes = await query(
        `SELECT id, order_number, total_amount, currency, status
         FROM orders WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [orderId, userId],
      );
      if (orderRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Order not found" } });
        return;
      }
      const order = orderRes.rows[0] as {
        id: string;
        order_number: string | null;
        total_amount: string;
        currency: string | null;
        status: string;
      };

      const status = stripeStatus();
      if (!status.usable) {
        res.status(503).json({
          success: false,
          error: {
            code: status.reason ?? "PAYMENTS_NOT_CONFIGURED",
            message: "QR payment is not available right now.",
          },
        });
        return;
      }
      const stripe = getStripe();
      if (!stripe) {
        res.status(503).json({
          success: false,
          error: { code: "PAYMENTS_NOT_CONFIGURED", message: "QR payment is not available right now." },
        });
        return;
      }

      const amount = toMinor(Number(order.total_amount ?? 0));
      if (!Number.isFinite(amount) || amount <= 0) {
        res.status(409).json({
          success: false,
          error: { code: "INVALID_AMOUNT", message: "This order has no payable amount." },
        });
        return;
      }

      const intent = await stripe.paymentIntents.create(
        {
          amount,
          currency: (order.currency ?? "THB").toLowerCase(),
          payment_method_types: ["promptpay"],
          metadata: {
            orderId: order.id,
            userId,
            orderNumber: order.order_number ?? "",
            source: "velnox_qr_page",
          },
        },
        // Idempotency: re-opening the QR page for the same order reuses the
        // intent instead of minting a second one.
        { idempotencyKey: `velnox-promptpay-${order.id}-${amount}` },
      );

      const qr = intent.next_action?.promptpay_display_qr_code ?? null;
      res.json({
        success: true,
        data: {
          paymentIntentId: intent.id,
          clientSecret: intent.client_secret,
          amount,
          currency: (order.currency ?? "THB").toUpperCase(),
          status: intent.status,
          /** EMVCo payload — renderable by any QR library, no Stripe page. */
          qrData: qr?.data ?? null,
          /** Stripe's PNG render of the same payload. */
          qrImageUrl: qr?.image_url_png ?? null,
          expiresAt: new Date(Date.now() + PROMPTPAY_TTL_SECONDS * 1000).toISOString(),
          orderId: order.id,
          orderNumber: order.order_number ?? order.id,
        },
      });
    } catch (err) {
      console.error("[payment-qr] promptpay intent error:", err);
      res.status(500).json({ success: false, error: { code: "PAYMENT_ERROR", message: "Could not start the QR payment" } });
    }
  });

  /** Poll one intent's status (the page watches this to detect payment). */
  app.get("/api/payments/promptpay/:paymentIntentId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const paymentIntentId = (req.params as Record<string, string>).paymentIntentId ?? "";
      const stripe = getStripe();
      if (!stripe) {
        res.status(503).json({ success: false, error: { code: "PAYMENTS_NOT_CONFIGURED", message: "QR payment is not available." } });
        return;
      }
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (intent.metadata?.userId !== userId) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Payment not found" } });
        return;
      }
      res.json({
        success: true,
        data: {
          paymentIntentId: intent.id,
          status: intent.status,
          amount: intent.amount,
          currency: intent.currency.toUpperCase(),
          paid: intent.status === "succeeded",
          orderId: intent.metadata?.orderId ?? null,
        },
      });
    } catch (err) {
      console.error("[payment-qr] promptpay status error:", err);
      res.status(500).json({ success: false, error: { code: "PAYMENT_ERROR", message: "Could not read the payment status" } });
    }
  });

  /** Which methods this deployment can actually take right now. */
  app.get("/api/payments/qr/methods", (_req: Request, res: Response) => {
    const status = stripeStatus();
    res.json({
      success: true,
      data: {
        methods: paymentMethodOptions(),
        promptpayQrAvailable: status.usable,
        mode: status.mode,
      },
    });
  });
}
