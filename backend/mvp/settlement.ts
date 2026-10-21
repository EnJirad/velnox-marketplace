/**
 * MVP payment settlement — the ONLY code that may mark an order paid.
 *
 * TRUST MODEL
 * -----------
 * Nothing a browser does can settle a payment. A redirect to `success_url`
 * proves only that a browser was redirected; it says nothing about money. The
 * single authority is a signature-verified Stripe event, and even that is not
 * trusted blindly:
 *
 *   • the event id is claimed in `payment_events` (UNIQUE) inside the settlement
 *     transaction, so a redelivered or concurrent event cannot settle twice;
 *   • the payment row is located by its Stripe session id and locked;
 *   • the payment's `order_id`, the order's own `total_amount`, the payment's
 *     `amount` and Stripe's `amount_total`/`currency` must all agree — a
 *     mismatch records a failed event and NEVER marks the order paid;
 *   • the order row is locked and must still be `pending_payment`; any other
 *     state means this settlement already happened (or the order was cancelled)
 *     and stock is not touched again;
 *   • stock is committed in the same transaction, so "order paid" and "units
 *     sold" can never disagree.
 *
 * A transient failure (a database error) throws, the transaction rolls back —
 * including the event claim — and the endpoint answers 500 so Stripe retries.
 * A permanent, unmappable event is recorded as `failed` and answered 200, so a
 * bad payload does not retry for three days.
 */
import type Stripe from "stripe";
import type pg from "pg";
import { withTransaction } from "../db/index.js";
import { parseDecimal, roundHalfUp } from "../lib/money.js";
import { writeMvpAudit } from "./audit.js";
import { commitStock, type StockLine } from "./inventory.js";

type Client = pg.PoolClient;

export interface SettleOutcome {
  /** True when this event was already recorded (no work performed). */
  duplicate: boolean;
  /** True when this delivery changed payment/order state. */
  settled: boolean;
  orderId: string | null;
  reason?: string;
}

const PAID_SESSION_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

const FAILED_SESSION_EVENTS = new Set([
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

function sessionOf(event: Stripe.Event): Stripe.Checkout.Session {
  return event.data.object as Stripe.Checkout.Session;
}

async function markEvent(
  client: Client,
  eventId: string,
  status: "processed" | "failed",
  error: string | null = null,
): Promise<void> {
  await client.query(
    `UPDATE payment_events
        SET status = $2, error = $3, processed_at = NOW(), updated_at = NOW()
      WHERE event_id = $1`,
    [eventId, status, error],
  );
}

/**
 * Verify that Stripe's amount and currency describe THIS order's total.
 *
 * `payments.amount` is `NUMERIC(12,2)`; Stripe reports minor units. Both are
 * converted with the same exact rounding rule (`lib/money.ts`) and compared as
 * integers — never as floats.
 */
export function amountMatches(
  paymentAmount: string,
  orderTotal: string,
  orderCurrency: string,
  sessionAmountTotal: number | null | undefined,
  sessionCurrency: string | null | undefined,
): boolean {
  if (typeof sessionAmountTotal !== "number" || !Number.isInteger(sessionAmountTotal)) return false;
  if (typeof sessionCurrency !== "string") return false;
  const normalizedOrderCurrency = orderCurrency.trim().toUpperCase();
  if (sessionCurrency.toUpperCase() !== normalizedOrderCurrency) return false;

  // `roundHalfUp(x, 2)` already returns the value in MINOR units (value × 100),
  // so it must not be multiplied by 100 a second time.
  const paymentMinor = roundHalfUp(parseDecimal(paymentAmount), 2);
  const orderMinor = roundHalfUp(parseDecimal(orderTotal), 2);
  if (paymentMinor !== orderMinor) return false;
  return paymentMinor === BigInt(sessionAmountTotal);
}

interface PaymentRow {
  id: string;
  order_id: string;
  status: string;
  amount: string;
  currency: string;
}

interface OrderRow {
  id: string;
  status: string;
  total_amount: string;
  currency: string;
}

async function settlePaidSession(
  client: Client,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): Promise<SettleOutcome> {
  const paymentResult = await client.query(
    `SELECT id, order_id, status, amount, currency
       FROM payments
      WHERE provider_checkout_session_id = $1
      FOR UPDATE`,
    [session.id],
  );
  let payment = paymentResult.rows[0] as PaymentRow | undefined;

  // Fallback: the session metadata names the payment row. Used only when the
  // session id lookup finds nothing (e.g. a session created before the id was
  // persisted); the order/amount checks below still decide everything.
  const metadataPaymentId = session.metadata?.paymentId;
  if (!payment && typeof metadataPaymentId === "string" && metadataPaymentId) {
    const byId = await client.query(
      `SELECT id, order_id, status, amount, currency FROM payments WHERE id = $1 FOR UPDATE`,
      [metadataPaymentId],
    );
    payment = byId.rows[0] as PaymentRow | undefined;
  }

  if (!payment) {
    await markEvent(client, event.id, "failed", "payment row not found for session");
    console.error("[mvp][stripe] settlement could not map session to a payment", {
      eventId: event.id,
      sessionId: session.id,
    });
    return { duplicate: false, settled: false, orderId: null, reason: "PAYMENT_NOT_FOUND" };
  }

  const orderResult = await client.query(
    `SELECT id, status, total_amount, currency FROM orders WHERE id = $1 FOR UPDATE`,
    [payment.order_id],
  );
  const order = orderResult.rows[0] as OrderRow | undefined;
  if (!order) {
    await markEvent(client, event.id, "failed", "order row not found for payment");
    return { duplicate: false, settled: false, orderId: null, reason: "ORDER_NOT_FOUND" };
  }

  if (
    !amountMatches(
      payment.amount,
      order.total_amount,
      order.currency,
      session.amount_total,
      session.currency,
    )
  ) {
    await markEvent(client, event.id, "failed", "amount or currency mismatch");
    await writeMvpAudit(client, null, "PAYMENT_MISMATCH", "payment", payment.id, {
      orderId: order.id,
      eventId: event.id,
      sessionId: session.id,
      sessionAmountTotal: session.amount_total,
      sessionCurrency: session.currency,
    });
    console.error("[mvp][stripe] settlement refused: amount/currency mismatch", {
      eventId: event.id,
      paymentId: payment.id,
      orderId: order.id,
    });
    return { duplicate: false, settled: false, orderId: order.id, reason: "AMOUNT_MISMATCH" };
  }

  // Already settled? A different event (e.g. `checkout.session.completed`
  // followed by `async_payment_succeeded`) must not commit stock twice.
  if (order.status !== "pending_payment") {
    if (order.status === "cancelled") {
      await writeMvpAudit(client, null, "PAYMENT_AFTER_CANCELLATION", "payment", payment.id, {
        orderId: order.id,
        eventId: event.id,
      });
      await markEvent(client, event.id, "processed");
      return {
        duplicate: false,
        settled: false,
        orderId: order.id,
        reason: "ORDER_CANCELLED",
      };
    }
    await markEvent(client, event.id, "processed");
    return { duplicate: false, settled: false, orderId: order.id, reason: "ALREADY_SETTLED" };
  }

  const intentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  await client.query(
    `UPDATE payments
        SET status = 'paid',
            paid_at = NOW(),
            provider_payment_intent_id = COALESCE(provider_payment_intent_id, $2),
            updated_at = NOW()
      WHERE id = $1 AND status <> 'paid'`,
    [payment.id, intentId],
  );

  const items = await client.query(
    `SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1`,
    [order.id],
  );
  await commitStock(
    client,
    (items.rows as Array<{ product_id: string; variant_id: string | null; quantity: number }>).map(
      (row): StockLine => ({
        productId: row.product_id,
        variantId: row.variant_id,
        quantity: row.quantity,
      }),
    ),
  );

  const updated = await client.query(
    `UPDATE orders
        SET status = 'paid', paid_at = NOW(), payment_reference = $2, updated_at = NOW()
      WHERE id = $1 AND status = 'pending_payment'
      RETURNING id`,
    [order.id, intentId ?? session.id],
  );
  if (updated.rowCount !== 1) {
    // The row lock above makes this unreachable; throwing rolls back the payment
    // and stock writes rather than leaving a half-settled order.
    throw new Error(`order ${order.id} left pending_payment under lock`);
  }

  await writeMvpAudit(client, null, "PAYMENT_SETTLED", "payment", payment.id, {
    orderId: order.id,
    eventId: event.id,
    sessionId: session.id,
    amount: payment.amount,
    currency: payment.currency,
  });
  await markEvent(client, event.id, "processed");

  return { duplicate: false, settled: true, orderId: order.id };
}

async function markSessionFailed(
  client: Client,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): Promise<SettleOutcome> {
  const status = event.type === "checkout.session.expired" ? "cancelled" : "failed";
  const updated = await client.query(
    `UPDATE payments
        SET status = $2, updated_at = NOW(), failure_message = $3
      WHERE provider_checkout_session_id = $1
        AND status IN ('pending', 'requires_action', 'processing')
      RETURNING id, order_id`,
    [session.id, status, event.type],
  );
  await markEvent(client, event.id, "processed");
  const row = updated.rows[0] as { id: string; order_id: string } | undefined;
  return {
    duplicate: false,
    settled: false,
    orderId: row?.order_id ?? null,
    reason: row ? "PAYMENT_FAILED" : "NO_ACTIVE_PAYMENT",
  };
}

/**
 * Settle one signature-verified Stripe event.
 *
 * The caller MUST have verified the signature over the raw request body before
 * calling this (see `payments.ts`).
 */
export async function settleStripeEvent(event: Stripe.Event): Promise<SettleOutcome> {
  return withTransaction(async (client) => {
    const claim = await client.query(
      `INSERT INTO payment_events (provider, event_id, event_type, payload, status)
       VALUES ('stripe', $1, $2, $3::jsonb, 'processing')
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      [event.id, event.type, JSON.stringify(event.data.object)],
    );

    if (claim.rowCount === 0) {
      // Either a duplicate delivery or a concurrent one that is still holding
      // the row. Either way this delivery must not settle anything.
      return { duplicate: true, settled: false, orderId: null, reason: "DUPLICATE_EVENT" };
    }

    if (PAID_SESSION_EVENTS.has(event.type)) {
      const session = sessionOf(event);
      if (session.payment_status !== "paid") {
        // Completed but not paid (e.g. a delayed PromptPay confirmation): keep
        // the payment awaiting confirmation; the async success event settles it.
        await client.query(
          `UPDATE payments
              SET status = CASE WHEN status = 'pending' THEN 'processing' ELSE status END,
                  updated_at = NOW()
            WHERE provider_checkout_session_id = $1
              AND status IN ('pending', 'requires_action')`,
          [session.id],
        );
        await markEvent(client, event.id, "processed");
        return {
          duplicate: false,
          settled: false,
          orderId: null,
          reason: "AWAITING_PAYMENT_CONFIRMATION",
        };
      }
      return settlePaidSession(client, event, session);
    }

    if (FAILED_SESSION_EVENTS.has(event.type)) {
      return markSessionFailed(client, event, sessionOf(event));
    }

    // Every other event type is acknowledged and recorded, but changes nothing:
    // the MVP has no refund workflow and no second order axis to update.
    await markEvent(client, event.id, "processed");
    return { duplicate: false, settled: false, orderId: null, reason: "IGNORED_EVENT_TYPE" };
  });
}
