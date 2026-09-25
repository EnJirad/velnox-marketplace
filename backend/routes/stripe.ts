/**
 * Velnox payment endpoints — Stripe TEST MODE only (Card + PromptPay), webhook,
 * refunds, and a Cash-on-Delivery domain model that exists but is DISABLED.
 *
 *   GET    /api/stripe/configured              — Stripe usability + test-mode state
 *   GET    /api/payments/methods               — backend-driven method discovery
 *   POST   /api/stripe/checkout                — create/reuse a Checkout Session
 *   POST   /api/payments/stripe/webhook        — signature-verified, idempotent
 *   GET    /api/stripe/payment-status/:id      — ownership-checked session status
 *   GET    /api/orders/:orderId                — order + payment + refund state
 *   POST   /api/admin/orders/:orderId/refund   — authorized, webhook-confirmed refund
 *
 * Design rules this file implements (payment-foundation brief):
 *
 *   • **Stripe is the authoritative payment event source.** A browser returning
 *     to the success page proves nothing; only the webhook (or Stripe's own API
 *     response to a server-initiated call) moves a payment to `paid`.
 *   • **Amounts are never taken from the client.** The payable amount is
 *     `orders.total_amount`, which checkout computed server-side, and the Stripe
 *     line items are built from `order_items` and reconciled to that total
 *     exactly — a shipping/discount remainder becomes its own line item.
 *   • **Idempotency is database-backed**, not in-memory: one `checkout_requests`
 *     row per (user, scope, request key) plus at most one active Stripe payment
 *     per order (partial unique index). A double-click can therefore never open
 *     two Checkout Sessions, so it can never create two PaymentIntents.
 *   • **COD fails closed.** `COD_ENABLED` defaults to off and a direct API
 *     attempt while it is off is rejected with 403 PAYMENT_METHOD_DISABLED
 *     before any order/payment/shipment/settlement row is touched.
 *   • **Refunds are webhook-confirmed.** Submitting a refund records a `pending`
 *     row; the provider response and the webhook both run the same idempotent
 *     sync, so the final state is never a client claim.
 *
 * No secret is ever logged, returned, or embedded in a response body. Only the
 * test publishable key may reach a browser.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query, withTransaction } from "../db/index.js";
import { releaseOrderInventory } from "../lib/inventory.js";
import { broadcast, CHANNELS } from "../realtime/index.js";
import { userHasPermission } from "../lib/permissions.js";
import { writeAuditLog, auditClientIp } from "../lib/audit-log.js";
import {
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  normalizePaymentMethod,
  stripePaymentMethodType,
  stripeStatus,
  stripeSecretKey,
  stripeWebhookSecret,
  isCodEnabled,
  isCodCustomerSelectable,
  paymentMethodOptions,
  customerSelectablePaymentMethods,
  assertPaymentMethodUsable,
  type PaymentMethodId,
} from "../lib/payment-config.js";
import Stripe from "stripe";

// ─── Stripe client ──────────────────────────────────────────────────────────

/**
 * Lazy Stripe client, keyed by the secret key it was built from.
 *
 * `stripeSecretKey()` returns `null` unless the configured key is a **test**
 * key and the webhook secret is present, so this function can never hand back a
 * client that would reach Stripe with a live credential or in a state where the
 * payment could not be confirmed.
 */
let cachedClient: { key: string; client: Stripe } | null = null;

function getStripe(): Stripe | null {
  const key = stripeSecretKey();
  if (!key) return null;
  if (cachedClient?.key === key) return cachedClient.client;
  const client = new Stripe(key, { apiVersion: "2025-08-27.basil" as never });
  cachedClient = { key, client };
  return client;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function param(req: Request, key: string): string {
  return (req.params as Record<string, string>)[key] ?? "";
}

/** The one error envelope every /api route in this repo returns. */
function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ success: false, error: { code, message } });
}

/** Money → Stripe minor units. `NaN` when the value is not a usable number. */
function toMinor(amount: unknown): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(n * 100);
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/**
 * Generate a human-readable order number like VNX-20260925-AB12CD.
 * Only used when an order somehow has none (stripe.ts historically owned this
 * for online orders; cart.ts owns it for orders it creates).
 */
function generateOrderNumber(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `VNX-${dateStr}-${rand}`;
}

/** Resolve a PaymentIntent's order through metadata, then through the payments row. */
async function orderIdForPaymentIntent(paymentIntent: Stripe.PaymentIntent): Promise<string | null> {
  const fromMetadata = paymentIntent.metadata?.orderId;
  if (typeof fromMetadata === "string" && fromMetadata) return fromMetadata;
  const row = await query(
    `SELECT order_id FROM payments WHERE provider = 'stripe' AND provider_payment_id = $1 LIMIT 1`,
    [paymentIntent.id],
  );
  return row.rows[0]?.order_id ?? null;
}

// ─── Money reconciliation (pure — exported for tests) ──────────────────────

/**
 * Does this Checkout Session actually confirm that money was received?
 *
 * This is the single most important predicate in the PromptPay path. With
 * delayed-notification methods (PromptPay), Stripe fires
 * `checkout.session.completed` while `payment_status` is still `unpaid` — the
 * customer has not yet paid. Treating the event itself as proof of payment would
 * fabricate a success, so ONLY an explicitly `paid` session counts; every other
 * value (`unpaid`, `no_payment_required`, a missing field) must wait for
 * `checkout.session.async_payment_succeeded` / `payment_intent.succeeded`.
 */
export function sessionConfirmsPayment(session: { payment_status?: string | null }): boolean {
  return session.payment_status === "paid";
}

/**
 * Build the Stripe line items for an order such that the charged sum equals
 * `expectedMinor` EXACTLY.
 *
 * `expectedMinor` always comes from `orders.total_amount`, which checkout
 * computed server-side. The request body is never consulted, so a tampered
 * `amount` / `total` / `price` / `quantity` in the payload cannot change what
 * the customer is charged.
 *
 * The order's own item prices are used where they can represent the total; a
 * positive remainder (shipping, fees) becomes its own line item; when the item
 * lines cannot represent the total (a discount makes the remainder negative, or
 * there are no usable lines at all) the whole session collapses to a single line
 * for the authoritative total. Stripe is therefore never asked to charge a sum
 * the backend did not compute.
 */
export function buildCheckoutLineItems(
  items: ReadonlyArray<{
    product_name_snapshot?: string | null;
    product_name?: string | null;
    image_url_snapshot?: string | null;
    quantity?: unknown;
    price?: unknown;
  }>,
  expectedMinor: number,
  currency: string,
  orderLabel: string,
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const code = currency.toLowerCase();
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  let lineItemsMinor = 0;

  for (const item of items) {
    const unitAmount = toMinor(item.price);
    const quantity = Number(item.quantity);
    if (!Number.isFinite(unitAmount) || unitAmount <= 0) continue;
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    lineItems.push({
      price_data: {
        currency: code,
        product_data: {
          name: item.product_name_snapshot || item.product_name || "Product",
          ...(item.image_url_snapshot ? { images: [item.image_url_snapshot] } : {}),
        },
        unit_amount: unitAmount,
      },
      quantity,
    });
    lineItemsMinor += unitAmount * quantity;
  }

  const remainder = expectedMinor - lineItemsMinor;
  if (lineItems.length === 0 || remainder < 0) {
    return [
      {
        price_data: {
          currency: code,
          product_data: { name: `Order ${orderLabel}` },
          unit_amount: expectedMinor,
        },
        quantity: 1,
      },
    ];
  }
  if (remainder > 0) {
    lineItems.push({
      price_data: {
        currency: code,
        product_data: { name: "Shipping & fees" },
        unit_amount: remainder,
      },
      quantity: 1,
    });
  }
  return lineItems;
}

/**
 * The amount still refundable on a payment, in minor units.
 *
 * Never negative, so an over-refund cannot be produced by arithmetic on a
 * already-fully-refunded payment. The caller still compares the REQUESTED
 * amount against this value and refuses anything larger.
 */
export function refundableMinorFor(paidAmount: unknown, alreadyRefunded: unknown): number {
  const paid = toMinor(paidAmount);
  const refunded = toMinor(alreadyRefunded ?? 0);
  if (!Number.isFinite(paid) || !Number.isFinite(refunded)) return 0;
  return Math.max(0, paid - refunded);
}

// ─── Payment / order synchronization ────────────────────────────────────────
//
// Payment and Order are separate domains with separate lifecycles. These
// helpers are the ONLY place the two are moved together, so a contradictory
// pair (Order = paid while Payment = failed) cannot be produced by normal
// processing: the order guard only accepts a pre-payment status, and the
// payment guard never overwrites a `paid` row with a failure.

interface SyncResult {
  orderId: string;
  moved: boolean;
  inventoryReleased: boolean;
}

/** Payment succeeded → Payment `paid`, Order `paid`, stock committed. */
async function markPaymentSucceeded(
  orderId: string,
  providerPaymentId: string | null,
): Promise<SyncResult> {
  return withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE orders SET status = 'paid', updated_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'pending_payment')`,
      [orderId],
    );

    await client.query(
      `UPDATE payments
          SET status = 'paid',
              paid_at = COALESCE(paid_at, NOW()),
              updated_at = NOW(),
              failure_code = NULL,
              failure_message = NULL,
              provider_payment_id = COALESCE($2, provider_payment_id)
        WHERE id = (
          SELECT id FROM payments
           WHERE order_id = $1 AND provider = 'stripe' AND status <> 'failed'
           ORDER BY created_at DESC LIMIT 1
        )`,
      [orderId, providerPaymentId],
    );

    const moved = (updated.rowCount ?? 0) > 0;
    if (moved) {
      // Reserved stock becomes sold stock exactly once, because only the
      // request that actually moved the order reaches here.
      const items = await client.query(
        `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
        [orderId],
      );
      for (const item of items.rows) {
        await client.query(
          `UPDATE inventory SET reserved = GREATEST(0, reserved - $1) WHERE product_id = $2`,
          [item.quantity, item.product_id],
        );
        await client.query(
          `UPDATE products SET sold_count = sold_count + $1 WHERE id = $2`,
          [item.quantity, item.product_id],
        );
      }
    }

    return { orderId, moved, inventoryReleased: false };
  });
}

/** Payment failed → Payment `failed`, Order `payment_failed`, stock released. */
async function markPaymentFailed(
  orderId: string,
  failureCode: string,
  failureMessage: string,
): Promise<SyncResult> {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE payments
          SET status = 'failed', failure_code = $2, failure_message = $3, updated_at = NOW()
        WHERE id = (
          SELECT id FROM payments
           WHERE order_id = $1 AND provider = 'stripe' AND status <> 'paid'
           ORDER BY created_at DESC LIMIT 1
        )`,
      [orderId, failureCode.slice(0, 120), failureMessage.slice(0, 500)],
    );

    const updated = await client.query(
      `UPDATE orders SET status = 'payment_failed', updated_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'pending_payment')`,
      [orderId],
    );
    const released = await releaseOrderInventory(client, orderId);
    return { orderId, moved: (updated.rowCount ?? 0) > 0, inventoryReleased: released };
  });
}

/**
 * Payment abandoned (session expired / intent canceled) → Payment `canceled`,
 * Order `cancelled`, stock released.
 */
async function markPaymentCanceled(orderId: string, reason: string): Promise<SyncResult> {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE payments
          SET status = 'cancelled', failure_code = $2, failure_message = $3, updated_at = NOW()
        WHERE id = (
          SELECT id FROM payments
           WHERE order_id = $1 AND provider = 'stripe' AND status <> 'paid'
           ORDER BY created_at DESC LIMIT 1
        )`,
      [orderId, "PAYMENT_CANCELED", reason.slice(0, 500)],
    );

    const updated = await client.query(
      `UPDATE orders SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status IN ('pending_payment', 'pending')`,
      [orderId],
    );
    const released = await releaseOrderInventory(client, orderId);
    return { orderId, moved: (updated.rowCount ?? 0) > 0, inventoryReleased: released };
  });
}

/**
 * Apply one Stripe refund to Velnox state.
 *
 * Idempotent by construction: the `refunds` row is keyed by the provider refund
 * id, `refunded_amount` is **recomputed** from the succeeded refund rows rather
 * than incremented, and the order only becomes `refunded` on a full refund.
 * Running this from the API response and again from the webhook is therefore
 * safe, and neither path trusts a client.
 */
async function syncRefundFromStripe(
  stripeRefund: Stripe.Refund,
  orderIdHint: string | null,
): Promise<{ orderId: string; refundedAmount: number; refundStatus: string | null } | null> {
  const intentId =
    typeof stripeRefund.payment_intent === "string"
      ? stripeRefund.payment_intent
      : (stripeRefund.payment_intent?.id ?? null);

  let payment: { id: string; order_id: string; amount: string } | null = null;
  if (intentId) {
    const byIntent = await query(
      `SELECT id, order_id, amount FROM payments
        WHERE provider = 'stripe' AND provider_payment_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [intentId],
    );
    payment = byIntent.rows[0] ?? null;
  }
  if (!payment && orderIdHint) {
    const byOrder = await query(
      `SELECT id, order_id, amount FROM payments
        WHERE provider = 'stripe' AND order_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [orderIdHint],
    );
    payment = byOrder.rows[0] ?? null;
  }
  if (!payment) {
    console.warn(`[stripe webhook] refund ${stripeRefund.id} does not match a recorded payment — ignored`);
    return null;
  }

  const status = stripeRefund.status;
  if (status !== "succeeded") {
    // A pending/failed refund is recorded but must never move money state.
    const failedReason = stripeRefund.failure_reason ?? (status === "canceled" ? "refund canceled" : null);
    await query(
      `UPDATE refunds
          SET status = $2, failure_reason = COALESCE($3, failure_reason), updated_at = NOW()
        WHERE provider_refund_id = $1`,
      [stripeRefund.id, status === "failed" || status === "canceled" ? "failed" : "pending", failedReason],
    );
    return null;
  }

  const amount = Number(stripeRefund.amount) / 100;
  let resolvedStatus: string | null = null;

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO refunds
         (order_id, payment_id, provider, provider_refund_id, amount, reason, status, refunded_at)
       VALUES ($1, $2, 'stripe', $3, $4, $5, 'succeeded', NOW())
       ON CONFLICT (provider_refund_id) DO UPDATE
         SET status = 'succeeded',
             refunded_at = COALESCE(refunds.refunded_at, NOW()),
             failure_reason = NULL,
             updated_at = NOW()`,
      [payment!.order_id, payment!.id, stripeRefund.id, amount, stripeRefund.reason ?? null],
    );

    // Recompute, never increment — a replayed event must not double-count.
    const totals = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS refunded
         FROM refunds WHERE payment_id = $1 AND status = 'succeeded'`,
      [payment!.id],
    );
    const refundedTotal = Number(totals.rows[0]?.refunded ?? 0);
    const paidAmount = Number(payment!.amount);
    const refundStatus =
      refundedTotal >= paidAmount ? "refunded" : refundedTotal > 0 ? "partially_refunded" : null;
    resolvedStatus = refundStatus;

    await client.query(
      `UPDATE payments SET refunded_amount = $2, refund_status = $3, updated_at = NOW() WHERE id = $1`,
      [payment!.id, refundedTotal, refundStatus],
    );

    // A full refund is terminal for the order; a partial refund leaves the order
    // in its fulfilment state and is represented on the payment row.
    if (refundStatus === "refunded") {
      await client.query(
        `UPDATE orders SET status = 'refunded', updated_at = NOW() WHERE id = $1 AND status <> 'refunded'`,
        [payment!.order_id],
      );
    }
  });

  console.log(
    `[stripe webhook] refund ${stripeRefund.id} synced — order ${payment.order_id} payment ${payment.id} ${status}`,
  );
  return { orderId: payment.order_id, refundedAmount: amount, refundStatus: resolvedStatus };
}

// ─── Webhook event handling ─────────────────────────────────────────────────

/**
 * Apply one verified Stripe event.
 *
 * Throwing from here marks the event `failed` and answers 500 so Stripe retries
 * — a sync that did not happen must never be acknowledged as if it did.
 */
async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    // ── Checkout Session ────────────────────────────────────────────────────
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (!orderId) {
        console.warn(`[stripe webhook] ${event.id} checkout.session.completed with no orderId — ignored`);
        return;
      }
      // Delayed-notification methods (PromptPay) complete the session while it
      // is still UNPAID. Marking the order paid here would be a fabricated
      // success, so only a `paid` session is authoritative.
      if (!sessionConfirmsPayment(session)) {
        await query(
          `UPDATE payments SET status = 'requires_action', updated_at = NOW()
            WHERE id = (
              SELECT id FROM payments
               WHERE order_id = $1 AND provider = 'stripe' AND status <> 'paid'
               ORDER BY created_at DESC LIMIT 1
            )`,
          [orderId],
        );
        console.log(
          `[stripe webhook] order ${orderId} session ${session.id} completed but unpaid (${session.payment_status}) — awaiting payment`,
        );
        return;
      }
      const intentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null);
      const result = await markPaymentSucceeded(orderId, intentId ?? session.id);
      if (result.moved) {
        broadcast(CHANNELS.ORDER_UPDATED, "order:updated", { orderId, to: "paid" });
      }
      return;
    }

    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (!orderId) return;
      const intentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null);
      const result = await markPaymentSucceeded(orderId, intentId ?? session.id);
      if (result.moved) {
        broadcast(CHANNELS.ORDER_UPDATED, "order:updated", { orderId, to: "paid" });
      }
      return;
    }

    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (!orderId) return;
      const result = await markPaymentFailed(orderId, "ASYNC_PAYMENT_FAILED", "The delayed payment did not complete.");
      if (result.moved) {
        broadcast(CHANNELS.ORDER_UPDATED, "order:updated", { orderId, to: "payment_failed" });
      }
      return;
    }

    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (!orderId) return;
      const result = await markPaymentCanceled(orderId, `Checkout session ${session.id} expired.`);
      if (result.moved) {
        broadcast(CHANNELS.ORDER_UPDATED, "order:updated", { orderId, to: "cancelled" });
      }
      return;
    }

    // ── PaymentIntent ───────────────────────────────────────────────────────
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const orderId = await orderIdForPaymentIntent(paymentIntent);
      if (!orderId) {
        console.warn(`[stripe webhook] ${event.id} payment_intent.succeeded has no resolvable order — ignored`);
        return;
      }
      const result = await markPaymentSucceeded(orderId, paymentIntent.id);
      if (result.moved) {
        broadcast(CHANNELS.ORDER_UPDATED, "order:updated", { orderId, to: "paid" });
      }
      return;
    }

    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const orderId = await orderIdForPaymentIntent(paymentIntent);
      if (!orderId) return;
      const code = paymentIntent.last_payment_error?.code ?? "PAYMENT_FAILED";
      const message = paymentIntent.last_payment_error?.message ?? "The payment was declined.";
      const result = await markPaymentFailed(orderId, code, message);
      if (result.moved) {
        broadcast(CHANNELS.ORDER_UPDATED, "order:updated", { orderId, to: "payment_failed" });
      }
      return;
    }

    case "payment_intent.canceled": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const orderId = await orderIdForPaymentIntent(paymentIntent);
      if (!orderId) return;
      const result = await markPaymentCanceled(orderId, "The payment was canceled.");
      if (result.moved) {
        broadcast(CHANNELS.ORDER_UPDATED, "order:updated", { orderId, to: "cancelled" });
      }
      return;
    }

    // ── Refunds ─────────────────────────────────────────────────────────────
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const orderIdHint = charge.metadata?.orderId ?? null;
      const refunds = charge.refunds?.data ?? [];
      for (const refund of refunds) {
        await syncRefundFromStripe(refund, orderIdHint);
      }
      return;
    }

    case "refund.created":
    case "refund.updated":
    case "refund.failed": {
      const refund = event.data.object as Stripe.Refund;
      await syncRefundFromStripe(refund, null);
      return;
    }

    default:
      // Only the events this implementation can act on are handled. Everything
      // else is stored for the audit trail and ignored — no handler is invented
      // for an event nothing consumes.
      console.log(`[stripe webhook] unhandled event type ${event.type} — recorded only`);
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export function setupStripeRoutes(app: Express): void {
  // ── GET /api/stripe/configured ──────────────────────────────────────────
  // Backward-compatible shape, extended with the mode and the *publishable*
  // key only — a secret key is never exposed here or anywhere else.
  app.get("/api/stripe/configured", (_req: Request, res: Response) => {
    const status = stripeStatus();
    res.json({
      success: true,
      data: {
        configured: status.usable,
        mode: status.mode,
        publishableKey: status.publishableKey,
        webhookConfigured: status.webhookConfigured,
        reason: status.reason,
      },
    });
  });

  // ── GET /api/payments/methods ───────────────────────────────────────────
  // Backend-driven payment-method discovery. The storefront renders what this
  // returns instead of hardcoding a list, so a method that is disabled here
  // cannot appear as a selectable option in the UI.
  app.get("/api/payments/methods", (_req: Request, res: Response) => {
    const status = stripeStatus();
    res.json({
      success: true,
      data: {
        paymentMethods: customerSelectablePaymentMethods(),
        methods: paymentMethodOptions(),
        currency: "THB",
        stripe: {
          configured: status.usable,
          mode: status.mode,
          publishableKey: status.publishableKey,
          webhookConfigured: status.webhookConfigured,
        },
        cod: {
          enabled: isCodEnabled(),
          customerSelectable: isCodCustomerSelectable(),
        },
      },
    });
  });

  // ── POST /api/stripe/checkout ───────────────────────────────────────────
  // Opens (or reuses) a Stripe Checkout Session for an existing order.
  //
  // The order must already exist with a pre-payment status; it is created by
  // POST /api/customer/checkout from the authoritative cart prices. Everything
  // this endpoint sends to Stripe is derived from the database, never from the
  // request body.
  app.post("/api/stripe/checkout", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const body = (req.body ?? {}) as Record<string, unknown>;

      const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
      if (!orderId) {
        fail(res, 400, "VALIDATION_ERROR", "orderId is required");
        return;
      }

      // A missing method keeps the historical default (card) so an older client
      // is not broken; an unrecognized one is a hard 400 rather than a guess.
      const rawMethod = body.method ?? body.paymentMethod;
      const method: PaymentMethodId | null =
        rawMethod === undefined || rawMethod === null || rawMethod === ""
          ? PAYMENT_METHOD.CARD
          : normalizePaymentMethod(rawMethod);
      if (!method) {
        fail(res, 400, "INVALID_PAYMENT_METHOD", "Unsupported payment method.");
        return;
      }

      // The method guard runs BEFORE anything provider-related, so a disabled
      // method is refused with its own code no matter what state Stripe is in.
      // This is what makes a direct `method=COD` call fail with
      // 403 PAYMENT_METHOD_DISABLED instead of leaking a provider error, and it
      // happens before any order, payment, shipment, or settlement write.
      const gate = assertPaymentMethodUsable(method);
      if (!gate.ok) {
        fail(res, gate.status, gate.code, gate.message);
        return;
      }

      const s = getStripe();
      if (!s) {
        const status = stripeStatus();
        fail(res, 503, status.reason ?? "STRIPE_NOT_CONFIGURED", "Card and PromptPay payments are not available right now.");
        return;
      }

      // ── Order: existence, ownership, payable status ─────────────────────
      const orderResult = await query(
        `SELECT id, user_id, order_number, status, total_amount, currency
           FROM orders WHERE id = $1`,
        [orderId],
      );
      if (orderResult.rows.length === 0) {
        fail(res, 404, "NOT_FOUND", "Order not found");
        return;
      }
      const order = orderResult.rows[0];
      if (order.user_id !== userId) {
        fail(res, 403, "FORBIDDEN", "Not your order");
        return;
      }
      if (!["pending", "pending_payment"].includes(order.status)) {
        fail(res, 400, "INVALID_STATUS", `Order status '${order.status}' cannot be paid`);
        return;
      }

      // ── Amount: authoritative, server-side, reconciled ──────────────────
      const currency = String(order.currency || "THB").toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        fail(res, 400, "INVALID_CURRENCY", "The order currency is not usable for payment.");
        return;
      }
      // PromptPay is a THB-only rail at Stripe. Refuse rather than silently
      // charging through a different rail than the customer chose.
      if (method === PAYMENT_METHOD.PROMPTPAY && currency !== "THB") {
        fail(res, 400, "CURRENCY_UNSUPPORTED", "PromptPay is only available for THB orders.");
        return;
      }

      const expectedMinor = toMinor(order.total_amount);
      if (!Number.isFinite(expectedMinor) || expectedMinor <= 0) {
        fail(res, 400, "INVALID_AMOUNT", "The order total is not payable.");
        return;
      }

      const itemsResult = await query(
        `SELECT product_name_snapshot, product_name, image_url_snapshot, quantity, price
           FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
        [orderId],
      );

      const lineItems = buildCheckoutLineItems(
        itemsResult.rows,
        expectedMinor,
        currency,
        order.order_number || orderId,
      );

      // ── Idempotency layer 1: the request key ────────────────────────────
      // One durable row per (user, scope, request key). A retry with the same
      // key replays the stored response instead of opening a second session.
      const rawKey = typeof body.requestKey === "string" ? body.requestKey.trim() : "";
      const requestKey = rawKey ? rawKey.slice(0, 200) : null;

      const rememberResponse = async (data: unknown) => {
        if (!requestKey) return;
        await query(
          `UPDATE checkout_requests SET order_id = $1, response = $2::jsonb
            WHERE user_id = $3 AND scope = 'payment' AND request_key = $4`,
          [orderId, JSON.stringify({ ...(data as object), paymentRequest: true, method }), userId, requestKey],
        ).catch(() => {
          // The response snapshot is an optimisation; failing to store it must
          // not fail a payment the customer can already complete.
        });
      };

      if (requestKey) {
        const claim = await query(
          `INSERT INTO checkout_requests (user_id, scope, request_key) VALUES ($1, 'payment', $2)
           ON CONFLICT (user_id, scope, request_key) DO NOTHING
           RETURNING id`,
          [userId, requestKey],
        );
        if (claim.rows.length === 0) {
          const previous = await query(
            `SELECT response FROM checkout_requests
              WHERE user_id = $1 AND scope = 'payment' AND request_key = $2`,
            [userId, requestKey],
          );
          const stored = previous.rows[0]?.response;
          if (stored && typeof stored === "object") {
            res.json({ success: true, data: stored });
            return;
          }
          // Claimed but unfinished — never open a competing session.
          fail(res, 409, "DUPLICATE_PAYMENT_IN_PROGRESS", "Your payment is being prepared. Please wait a moment.");
          return;
        }
      }

      // ── Idempotency layer 2: reuse the live session for this order ──────
      // The partial unique index allows at most one active Stripe payment per
      // order, so this is also what makes concurrent requests safe.
      const activePayment = await query(
        `SELECT id, provider_checkout_session_id
           FROM payments
          WHERE order_id = $1 AND provider = 'stripe' AND status IN ('pending', 'requires_action')
          ORDER BY created_at DESC LIMIT 1`,
        [orderId],
      );

      if (activePayment.rows.length > 0) {
        const activeRow = activePayment.rows[0];
        const activeSessionId: string | null = activeRow.provider_checkout_session_id ?? null;
        let reusable = false;
        if (activeSessionId) {
          try {
            const existing = await s.checkout.sessions.retrieve(activeSessionId);
            const sameMethod = existing.metadata?.method === method;
            if (existing.status === "open" && existing.url && sameMethod) {
              const data = {
                orderId,
                orderNumber: order.order_number || "",
                sessionId: existing.id,
                url: existing.url,
                method,
                provider: "stripe",
                stripeMode: "test",
                amount: expectedMinor / 100,
                currency,
                expiresAt: existing.expires_at,
                reused: true,
              };
              await rememberResponse(data);
              res.json({ success: true, data });
              return;
            }
            // An OPEN session for a DIFFERENT method must never be reused.
            // Handing back its URL would charge the method the customer did not
            // choose while the response claimed the one they did — and because
            // the partial unique index still saw that row as active, the new
            // session could not be inserted either, so the wrong session won by
            // default. Abandon it explicitly instead.
            if (existing.status === "open") {
              await s.checkout.sessions.expire(existing.id).catch(() => {
                // Best-effort: even if Stripe refuses to expire it, the row is
                // marked failed below, so nothing points the customer at it.
              });
              console.log(
                `[stripe] order ${orderId} abandoned an open '${existing.metadata?.method ?? "unknown"}' session in favour of ${method}`,
              );
            }
            reusable = false;
          } catch (err) {
            console.warn(
              `[stripe] could not retrieve session ${activeSessionId} for order ${orderId}:`,
              err instanceof Error ? err.message : "unknown",
            );
          }
        }
        if (!reusable) {
          // Terminal for that attempt — clear it so a fresh session may be
          // created under the same unique index.
          await query(
            `UPDATE payments
                SET status = 'failed', failure_code = 'SESSION_NOT_REUSABLE',
                    failure_message = 'The previous checkout session is no longer open.',
                    updated_at = NOW()
              WHERE id = $1`,
            [activeRow.id],
          );
        }
      }

      // ── Create the Checkout Session ─────────────────────────────────────
      const frontendUrl = process.env.VITE_VELSHOP_URL || "https://velshop.vercel.app";
      const session = await s.checkout.sessions.create({
        mode: "payment",
        payment_method_types: [stripePaymentMethodType(method)!],
        line_items: lineItems,
        success_url: `${frontendUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}&order=${orderId}`,
        cancel_url: `${frontendUrl}/checkout/cancel?order=${orderId}`,
        metadata: {
          orderId,
          userId,
          orderNumber: order.order_number || "",
          method,
          provider: "stripe",
          mode: "test",
        },
        // The PaymentIntent carries the same pointer so payment_intent.* events
        // resolve to the order without a session lookup.
        payment_intent_data: { metadata: { orderId, userId, method } },
        customer_creation: "always",
        allow_promotion_codes: true,
      });

      const intentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null);

      // ── Persist the payment row (race-safe) ─────────────────────────────
      let paymentId: string | null = null;
      try {
        const inserted = await query(
          `INSERT INTO payments
             (order_id, provider, method, status, amount, currency,
              provider_checkout_session_id, provider_payment_id, metadata)
           VALUES ($1, 'stripe', $2, $3, $4, $5, $6, $7, $8::jsonb)
           RETURNING id`,
          [
            orderId,
            method,
            PAYMENT_STATUS.REQUIRES_ACTION,
            expectedMinor / 100,
            currency,
            session.id,
            intentId,
            JSON.stringify({ stripeMode: "test", method, requestKey }),
          ],
        );
        paymentId = inserted.rows[0]?.id ?? null;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // A concurrent request won the race and already owns the active slot.
        // Return ITS session and discard ours, so exactly one session stays open.
        const winner = await query(
          `SELECT provider_checkout_session_id FROM payments
            WHERE order_id = $1 AND provider = 'stripe' AND status IN ('pending', 'requires_action')
            ORDER BY created_at DESC LIMIT 1`,
          [orderId],
        );
        const winnerSessionId: string | null = winner.rows[0]?.provider_checkout_session_id ?? null;
        if (winnerSessionId && winnerSessionId !== session.id) {
          try {
            const winnerSession = await s.checkout.sessions.retrieve(winnerSessionId);
            // Only hand back the winner when it is open AND was opened for the
            // method this request asked for. Otherwise the customer would be
            // charged by a rail they did not select.
            if (
              winnerSession.status === "open" &&
              winnerSession.url &&
              winnerSession.metadata?.method === method
            ) {
              await s.checkout.sessions.expire(session.id).catch(() => {
                // Best-effort cleanup; a leftover open session is unusable
                // because the customer is only ever shown the winner's URL.
              });
              const data = {
                orderId,
                orderNumber: order.order_number || "",
                sessionId: winnerSession.id,
                url: winnerSession.url,
                method,
                provider: "stripe",
                stripeMode: "test",
                amount: expectedMinor / 100,
                currency,
                expiresAt: winnerSession.expires_at,
                reused: true,
              };
              await rememberResponse(data);
              res.json({ success: true, data });
              return;
            }
          } catch {
            /* fall through to the conflict below */
          }
        }
        // The race winner is unusable for this method or state. Never fabricate
        // a success: discard our own session and ask the client to retry.
        await s.checkout.sessions.expire(session.id).catch(() => {
          /* best-effort cleanup */
        });
        console.warn(`[stripe] concurrent checkout for order ${orderId} could not reuse the winning session`);
        fail(res, 409, "DUPLICATE_PAYMENT_IN_PROGRESS", "Your payment is being prepared. Please try again.");
        return;
      }

      await query(
        `UPDATE orders SET status = 'pending_payment', updated_at = NOW()
          WHERE id = $1 AND status IN ('pending', 'pending_payment')`,
        [orderId],
      );

      const data = {
        orderId,
        orderNumber: order.order_number || "",
        sessionId: session.id,
        url: session.url,
        method,
        provider: "stripe",
        stripeMode: "test",
        amount: expectedMinor / 100,
        currency,
        paymentId,
        expiresAt: session.expires_at,
        reused: false,
      };
      await rememberResponse(data);

      console.log(
        `[stripe] checkout session ${session.id} opened for order ${orderId} (${method}, ${currency} ${expectedMinor / 100}, test mode)`,
      );
      res.json({ success: true, data });
    } catch (err) {
      console.error("[stripe] checkout error:", err instanceof Error ? err.message : "unknown error");
      fail(res, 500, "STRIPE_ERROR", "Failed to create checkout session");
    }
  });

  // ── POST /api/payments/stripe/webhook ──────────────────────────────────
  // NOTE: raw body is wired in server.ts BEFORE express.json, which signature
  // verification requires. Never move this route behind the JSON parser.
  app.post("/api/payments/stripe/webhook", async (req: Request, res: Response) => {
    try {
      const s = getStripe();
      const webhookSecret = stripeWebhookSecret();

      if (!s || !webhookSecret) {
        // Without a verifiable test-mode configuration this endpoint cannot
        // distinguish a real Stripe event from a forgery, so it refuses rather
        // than acknowledging events it cannot validate.
        console.warn("[stripe webhook] Stripe test mode is not configured — refusing webhook");
        res.status(503).json({ error: "Stripe webhook is not configured" });
        return;
      }

      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string" || signature === "") {
        res.status(400).json({ error: "Missing stripe-signature header" });
        return;
      }

      let event: Stripe.Event;
      try {
        // `constructEventAsync`, not `constructEvent`: the Stripe SDK selects a
        // WebCrypto-backed verifier whose API is async-only outside Node, and
        // the synchronous call THROWS there for every event — including ones
        // with a perfect signature, which would silently disable every webhook.
        // The async form works in both runtimes.
        event = await s.webhooks.constructEventAsync(req.body, signature, webhookSecret);
      } catch (err) {
        // The failure reason is a signature mismatch, not a secret value.
        console.error("[stripe webhook] signature verification failed:", err instanceof Error ? err.message : "invalid signature");
        res.status(400).json({ error: "Invalid signature" });
        return;
      }

      // ── Idempotency: claim the event atomically ────────────────────────
      // A UNIQUE event_id plus INSERT ... ON CONFLICT DO NOTHING means two
      // concurrent deliveries cannot both claim the event, so a duplicate can
      // never produce two order transitions, two refunds, or two settlements.
      const claim = await query(
        `INSERT INTO payment_events (provider, event_id, event_type, payload, status)
         VALUES ('stripe', $1, $2, $3::jsonb, 'processing')
         ON CONFLICT (event_id) DO NOTHING
         RETURNING id`,
        [event.id, event.type, JSON.stringify(event.data.object)],
      );

      if (claim.rows.length === 0) {
        const prior = await query(`SELECT id, status FROM payment_events WHERE event_id = $1`, [event.id]);
        const row = prior.rows[0];
        if (!row) {
          // Vanishingly unlikely (the row was removed mid-flight). Re-insert.
          await query(
            `INSERT INTO payment_events (provider, event_id, event_type, payload, status)
             VALUES ('stripe', $1, $2, $3::jsonb, 'processing')
             ON CONFLICT (event_id) DO NOTHING`,
            [event.id, event.type, JSON.stringify(event.data.object)],
          );
        } else if (row.status === "failed") {
          // A previous delivery died mid-processing and Stripe is retrying.
          // Re-arm the claim so the retry actually re-runs the sync.
          const rearmed = await query(
            `UPDATE payment_events SET status = 'processing', error = NULL, updated_at = NOW()
              WHERE id = $1 AND status = 'failed'
              RETURNING id`,
            [row.id],
          );
          if (rearmed.rows.length === 0) {
            console.log(`[stripe webhook] duplicate event ${event.id} (${event.type}) — already handled`);
            res.status(200).json({ received: true, duplicate: true });
            return;
          }
        } else {
          console.log(`[stripe webhook] duplicate event ${event.id} (${event.type}) — already claimed`);
          res.status(200).json({ received: true, duplicate: true });
          return;
        }
      }

      try {
        await handleStripeEvent(event);
        await query(
          `UPDATE payment_events SET status = 'processed', updated_at = NOW() WHERE event_id = $1`,
          [event.id],
        );
        console.log(`[stripe webhook] processed ${event.type} (${event.id})`);
        res.status(200).json({ received: true });
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 500) : "unknown error";
        console.error(`[stripe webhook] failed processing ${event.type} (${event.id}):`, message);
        await query(
          `UPDATE payment_events SET status = 'failed', error = $2, updated_at = NOW() WHERE event_id = $1`,
          [event.id, message],
        ).catch(() => {
          /* the failure record is best-effort; the 500 below still triggers a retry */
        });
        // 500 (not a silent 200) so Stripe redelivers: a payment sync that did
        // not happen must never look like it did.
        res.status(500).json({ error: "Webhook processing failed" });
      }
      return;
    } catch (err) {
      console.error("[stripe webhook] error:", err instanceof Error ? err.message : "unknown error");
      res.status(500).json({ error: "Webhook error" });
      return;
    }
  });

  // ── POST /api/admin/orders/:orderId/refund ─────────────────────────────
  // Refunds are a staff action, authorized by the VelCenter `orders.manage`
  // permission — the same boundary that already governs order status changes.
  // A customer can never refund an arbitrary payment.
  app.post("/api/admin/orders/:orderId/refund", requireAuth, async (req: Request, res: Response) => {
    try {
      const s = getStripe();
      if (!s) {
        const status = stripeStatus();
        fail(res, 503, status.reason ?? "STRIPE_NOT_CONFIGURED", "Refunds are unavailable while Stripe is not configured.");
        return;
      }

      const actorId = req.user!.userId;
      if (!(await userHasPermission(actorId, "orders.manage"))) {
        fail(res, 403, "FORBIDDEN", "orders.manage permission required");
        return;
      }

      const orderId = param(req, "orderId");
      const body = (req.body ?? {}) as Record<string, unknown>;

      const paymentResult = await query(
        `SELECT id, order_id, status, amount, currency, refunded_amount, refund_status, provider_payment_id
           FROM payments
          WHERE order_id = $1 AND provider = 'stripe'
          ORDER BY created_at DESC LIMIT 1`,
        [orderId],
      );
      if (paymentResult.rows.length === 0) {
        fail(res, 404, "NOT_FOUND", "No Stripe payment exists for this order.");
        return;
      }

      const payment = paymentResult.rows[0];
      if (payment.status !== "paid") {
        // A refund is only possible against captured money.
        fail(res, 409, "PAYMENT_NOT_REFUNDABLE", `A payment with status '${payment.status}' cannot be refunded.`);
        return;
      }
      if (!payment.provider_payment_id) {
        fail(res, 409, "PAYMENT_NOT_REFUNDABLE", "The provider payment reference is missing, so a refund cannot be issued.");
        return;
      }

      const alreadyRefundedMinor = toMinor(payment.refunded_amount ?? 0);
      const refundableMinor = refundableMinorFor(payment.amount, payment.refunded_amount ?? 0);
      if (refundableMinor <= 0) {
        fail(res, 409, "NOTHING_TO_REFUND", "This payment has already been fully refunded.");
        return;
      }

      let requestedMinor = refundableMinor;
      if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
        requestedMinor = toMinor(body.amount);
      }
      if (!Number.isFinite(requestedMinor) || !Number.isInteger(requestedMinor) || requestedMinor <= 0) {
        fail(res, 400, "VALIDATION_ERROR", "amount must be a positive number.");
        return;
      }
      if (requestedMinor > refundableMinor) {
        // Over-refund is rejected before Stripe is called.
        fail(res, 400, "REFUND_EXCEEDS_REFUNDABLE", "The refund amount exceeds the refundable amount.");
        return;
      }

      // Duplicate-refund short circuit. A request that exactly matches an
      // in-flight or already-succeeded refund for this payment REPLAYS the
      // provider refund instead of issuing another one.
      //
      // This matters because `payments.refunded_amount` only counts
      // `succeeded` rows: while a refund is still pending confirmation, a retry
      // or a double-click sees the same refundable position and would otherwise
      // look like a legitimately new refund. Together with the deterministic
      // Stripe idempotency key below, money can only ever move once per
      // (payment, cumulative position, amount).
      const duplicate = await query(
        `SELECT id, provider_refund_id, status, amount
           FROM refunds
          WHERE payment_id = $1 AND amount = $2 AND status IN ('pending', 'succeeded')
          ORDER BY created_at DESC
          LIMIT 1`,
        [payment.id, requestedMinor / 100],
      );
      if (duplicate.rows.length > 0) {
        const existing = duplicate.rows[0];
        res.json({
          success: true,
          data: {
            orderId,
            paymentId: payment.id,
            refundId: existing.id,
            providerRefundId: existing.provider_refund_id,
            // The provider's last known refund status; our record stays
            // `pending` until synced refund rows prove the money moved.
            providerStatus: existing.status === "succeeded" ? "succeeded" : "pending",
            amount: Number(existing.amount),
            currency: payment.currency,
            refundableRemaining: (refundableMinor - requestedMinor) / 100,
            refundedAmount: Number(payment.refunded_amount ?? 0),
            refundStatus: payment.refund_status ?? null,
            duplicate: true,
          },
        });
        return;
      }

      const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 200) : null;

      // Stripe-level idempotency: the key is derived from the payment and the
      // cumulative position, so a retry of THIS request replays the same refund
      // while a genuinely new refund still gets a fresh key.
      const idempotencyKey = `velnox-refund-${payment.id}-${alreadyRefundedMinor}-${requestedMinor}`;

      const stripeRefund = await s.refunds.create(
        {
          payment_intent: payment.provider_payment_id,
          amount: requestedMinor,
          ...(reason ? { metadata: { orderId, reason } } : { metadata: { orderId } }),
        },
        { idempotencyKey },
      );

      // Recorded as `pending` first — a submitted request is not a completed
      // refund. When Stripe's own response already reports success we run the
      // same idempotent sync the webhook runs, using the PROVIDER's answer (not
      // the caller's) to advance the state.
      const inserted = await query(
        `INSERT INTO refunds
           (order_id, payment_id, provider, provider_refund_id, amount, reason, status, requested_by)
         VALUES ($1, $2, 'stripe', $3, $4, $5, 'pending', $6)
         ON CONFLICT (provider_refund_id) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [orderId, payment.id, stripeRefund.id, requestedMinor / 100, reason, actorId],
      );

      if (stripeRefund.status === "succeeded" || stripeRefund.status === "pending") {
        await syncRefundFromStripe(stripeRefund, orderId).catch((err) => {
          console.error(
            `[stripe] refund ${stripeRefund.id} sync deferred to webhook:`,
            err instanceof Error ? err.message : "unknown",
          );
        });
      }

      const after = await query(
        `SELECT refunded_amount, refund_status FROM payments WHERE id = $1`,
        [payment.id],
      );

      await writeAuditLog(
        actorId,
        "ORDER_REFUND",
        "order",
        orderId,
        {
          paymentId: payment.id,
          refundId: inserted.rows[0]?.id ?? null,
          providerRefundId: stripeRefund.id,
          amount: requestedMinor / 100,
          currency: payment.currency,
          reason,
          providerStatus: stripeRefund.status,
        },
        auditClientIp(req),
      );

      res.json({
        success: true,
        data: {
          orderId,
          paymentId: payment.id,
          refundId: inserted.rows[0]?.id ?? null,
          providerRefundId: stripeRefund.id,
          // The provider's status; our own record stays `pending` until the
          // synced refund rows prove the money moved.
          providerStatus: stripeRefund.status,
          amount: requestedMinor / 100,
          currency: payment.currency,
          refundableRemaining: (refundableMinor - requestedMinor) / 100,
          refundedAmount: Number(after.rows[0]?.refunded_amount ?? 0),
          refundStatus: after.rows[0]?.refund_status ?? null,
        },
      });
      return;
    } catch (err) {
      console.error("[stripe] refund error:", err instanceof Error ? err.message : "unknown error");
      fail(res, 500, "STRIPE_ERROR", "Failed to issue the refund");
      return;
    }
  });

  // ── GET /api/stripe/payment-status/:sessionId ──────────────────────────
  // Ownership-checked: a session id is a bearer-ish handle, so knowing one must
  // not expose another customer's order.
  app.get("/api/stripe/payment-status/:sessionId", requireAuth, async (req: Request, res: Response) => {
    try {
      const s = getStripe();
      const sessionId = param(req, "sessionId");

      if (!s) {
        fail(res, 503, "STRIPE_NOT_CONFIGURED", "Stripe not configured");
        return;
      }
      if (!sessionId) {
        fail(res, 400, "VALIDATION_ERROR", "sessionId is required");
        return;
      }

      const session = await s.checkout.sessions.retrieve(sessionId);
      const orderId = typeof session.metadata?.orderId === "string" ? session.metadata.orderId : null;

      if (orderId) {
        const owner = await query(`SELECT user_id FROM orders WHERE id = $1`, [orderId]);
        if (owner.rows.length === 0 || owner.rows[0].user_id !== req.user!.userId) {
          fail(res, 403, "FORBIDDEN", "Not your order");
          return;
        }
      } else if (session.metadata?.userId && session.metadata.userId !== req.user!.userId) {
        fail(res, 403, "FORBIDDEN", "Not your payment session");
        return;
      }

      res.json({
        success: true,
        data: {
          status: session.status,
          paymentStatus: session.payment_status,
          orderId,
          amountTotal: session.amount_total,
          currency: session.currency,
        },
      });
    } catch (err) {
      console.error("[stripe] payment-status error:", err instanceof Error ? err.message : "unknown error");
      fail(res, 500, "STRIPE_ERROR", "Failed to retrieve payment status");
    }
  });

  // ── GET /api/orders/:orderId ────────────────────────────────────────────
  // Order + items + the payment/refund state the success page polls. Note this
  // reports what the DATABASE knows; the caller never has to trust the browser
  // redirect to decide whether a payment succeeded.
  app.get("/api/orders/:orderId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const orderId = param(req, "orderId");

      const orderResult = await query(
        `SELECT o.*, sh.name AS shop_name, sh.slug AS shop_slug
           FROM orders o
           LEFT JOIN shops sh ON o.shop_id = sh.id
          WHERE o.id = $1`,
        [orderId],
      );
      if (orderResult.rows.length === 0) {
        fail(res, 404, "NOT_FOUND", "Order not found");
        return;
      }

      const order = orderResult.rows[0];
      if (order.user_id !== userId) {
        fail(res, 403, "FORBIDDEN", "Not your order");
        return;
      }

      const [itemsResult, paymentResult, refundsResult] = await Promise.all([
        query(
          `SELECT oi.*, sh.name AS shop_name
             FROM order_items oi
             LEFT JOIN shops sh ON oi.shop_id = sh.id
            WHERE oi.order_id = $1
            ORDER BY oi.created_at ASC`,
          [orderId],
        ),
        query(`SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`, [orderId]),
        query(
          `SELECT id, amount, status, reason, created_at, refunded_at
             FROM refunds WHERE order_id = $1 ORDER BY created_at ASC`,
          [orderId],
        ),
      ]);

      const payment = paymentResult.rows[0] ?? null;

      res.json({
        success: true,
        data: {
          id: order.id,
          orderNumber: order.order_number || order.id,
          status: order.status,
          subtotal: parseFloat(order.subtotal || order.total_amount || 0),
          shippingFee: parseFloat(order.shipping_fee || 0),
          discount: parseFloat(order.discount || 0),
          total: parseFloat(order.total_amount || 0),
          currency: order.currency,
          shopName: order.shop_name,
          shopSlug: order.shop_slug,
          items: itemsResult.rows.map((r: Record<string, unknown>) => ({
            id: r.id,
            productId: r.product_id,
            productName: r.product_name_snapshot || r.product_name || "",
            variantName: r.variant_name_snapshot,
            imageUrl: r.image_url_snapshot,
            quantity: r.quantity,
            price: parseFloat(String(r.price)),
            subtotal: parseFloat(String(r.subtotal ?? 0)),
            shopId: r.shop_id,
            shopName: r.shop_name,
          })),
          payment: payment
            ? {
                id: payment.id,
                provider: payment.provider,
                method: payment.method,
                status: payment.status,
                amount: parseFloat(payment.amount),
                currency: payment.currency,
                paidAt: payment.paid_at,
                refundedAmount: parseFloat(payment.refunded_amount ?? 0),
                refundStatus: payment.refund_status,
                failureCode: payment.failure_code,
                failureMessage: payment.failure_message,
              }
            : null,
          refunds: refundsResult.rows.map((r: Record<string, unknown>) => ({
            id: r.id,
            amount: parseFloat(String(r.amount)),
            status: r.status,
            reason: r.reason,
            createdAt: r.created_at,
            refundedAt: r.refunded_at,
          })),
          createdAt: order.created_at,
          updatedAt: order.updated_at,
        },
      });
    } catch (err) {
      console.error("[orders] detail error:", err instanceof Error ? err.message : "unknown error");
      fail(res, 500, "DB_ERROR", "Failed to fetch order");
    }
  });
}

/** Exported for tests: the reconciler that guarantees the charged sum. */
export const __testOnly = { toMinor, orderNumber: generateOrderNumber };
