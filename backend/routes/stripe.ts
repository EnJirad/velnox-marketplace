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
import { commitOrderInventory, releaseOrderInventory } from "../lib/inventory.js";
// The ONE order-row lock. Every transaction below that writes both `orders` and
// `payments`/`refunds` takes it FIRST, so a customer cancellation and a webhook
// take the same two rows in the same order and cannot deadlock (lib/order-lock.ts).
import { lockCheckoutGroupOrderRows, lockOrderRow } from "../lib/order-lock.js";
import { recordLatePaymentIncident, type LatePaymentReason } from "../lib/payment-incidents.js";
// One purchase, N per-shop orders: the group is the payment parent, and its
// member orders settle through the same single-order path a one-shop order uses.
import {
  firstBlockingOrder,
  readGroupOrders,
  readOwnedCheckoutGroup,
  sumGroupOrderTotal,
} from "../lib/checkout-groups.js";
// The ONE order-number generator; stripe.ts used to carry a second, unused copy.
import { generateOrderNumber } from "../lib/order-number.js";
import { selectOrderPaymentRow } from "../lib/payment-reservation.js";
// The VelRepeat V2 prepaid plan-payment dispatcher. It is imported here (and
// only its exported entry point is used) so the webhook stays ONE endpoint with
// ONE signature check, ONE event claim and ONE redelivery policy. The module
// in turn uses this file's `stripeServerClient()` / `sessionConfirmsPayment`,
// so the two modules form a cycle whose references are ALL inside function
// bodies — nothing is read from either module at module-evaluation time.
import { handleVelRepeatV2PaymentEvent } from "./velrepeat-v2-payments.js";
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
  webhookSecretHealth,
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

/**
 * The ONE Stripe client this process uses, for callers outside this module.
 *
 * VelRepeat V2's prepaid PLAN payment (routes/velrepeat-v2-payments.ts) needs
 * the same test-mode client and the same lazy, key-derived caching this module
 * owns. Exporting the accessor keeps that a single client instead of a second
 * configuration: a deployment therefore still has exactly one Stripe
 * credential, one mode decision (`lib/payment-config.ts`) and one key cache.
 *
 * It returns `null` whenever `stripeStatus()` is not usable, so a caller can
 * never reach Stripe with a live key or without a webhook secret. The secret
 * itself is never returned — only the client.
 */
export function stripeServerClient(): Stripe | null {
  return getStripe();
}

/**
 * Expire an open Checkout Session so a stale Stripe URL can never take money for
 * an order that is no longer payable.
 *
 * WHY THIS EXISTS
 * A customer who abandons Stripe leaves an OPEN session (Stripe keeps it ~24 h).
 * If they then cancel the order, the old `checkout.stripe.com` tab — or a
 * bookmarked URL — would still be chargeable, producing a captured payment on a
 * cancelled order. Cancellation therefore closes the provider side first.
 *
 * Best effort by design and never throws: the order is cancelled whether or not
 * Stripe answers, and the webhook stays the only authority on payment state. A
 * session that already completed or expired cannot be expired again, which is a
 * non-event (its own `checkout.session.expired` / `completed` event is handled
 * idempotently and can no longer move a cancelled order). Only the session id —
 * never a secret — reaches the log.
 */
export async function expireStripeCheckoutSession(sessionId: string): Promise<boolean> {
  if (typeof sessionId !== "string" || sessionId.trim() === "") return false;
  const s = getStripe();
  if (!s) return false;
  try {
    await s.checkout.sessions.expire(sessionId);
    return true;
  } catch (err) {
    console.warn(
      `[stripe] could not expire checkout session ${sessionId}:`,
      err instanceof Error ? err.message : "unknown error",
    );
    return false;
  }
}

/**
 * Prove that THIS process can verify a signature it ought to be able to verify.
 *
 * WHY THIS EXISTS
 * When `POST /api/payments/stripe/webhook` answers 400 "Invalid signature" to a
 * real Stripe delivery, two very different causes produce the identical message:
 * the configured `STRIPE_WEBHOOK_SECRET` is not the secret that signed that
 * request, or this runtime/SDK cannot verify a signature at all (a WebCrypto-path
 * defect would reject genuine events and forgeries alike, silently disabling
 * every webhook while still looking like signature enforcement). Nothing outside
 * the deployment can tell those apart, and the second cause is a real code defect
 * that no amount of dashboard inspection would reveal.
 *
 * This check signs a throwaway payload with the DEPLOYED secret and immediately
 * verifies it through the exact call the webhook uses. It makes no Stripe API
 * call, touches no database, and returns no secret and no signature:
 *
 *   verified: true  → the runtime, the SDK and the configured value are
 *                     self-consistent, so a 400 can only mean the value is not
 *                     the secret that signed that particular delivery (an
 *                     endpoint/CLI/account mismatch — a configuration answer).
 *   verified: false → the failure is inside this process (loading the value or
 *                     the signature path) and is a defect to fix in code.
 */
export async function selfTestWebhookSignature(): Promise<{
  attempted: boolean;
  verified: boolean;
  reason: string | null;
}> {
  const s = getStripe();
  const webhookSecret = stripeWebhookSecret();
  if (!s || !webhookSecret) {
    return { attempted: false, verified: false, reason: "stripe_test_mode_not_configured" };
  }

  const payload = JSON.stringify({
    id: "evt_velnox_signature_selftest",
    object: "event",
    type: "velnox.signature_self_test",
    data: { object: {} },
  });

  try {
    // Signed here, one line above — so a failure cannot be a delivery problem.
    //
    // The ASYNC generator, for the same reason the webhook uses
    // `constructEventAsync`: the SDK selects a WebCrypto-backed provider, whose
    // synchronous API throws for every input. Using the sync form here would
    // report a false "this deployment cannot verify signatures" — the mirror of
    // the bug this whole check exists to rule out.
    const header = await s.webhooks.generateTestHeaderStringAsync({ payload, secret: webhookSecret });
    await s.webhooks.constructEventAsync(payload, header, webhookSecret);
    return { attempted: true, verified: true, reason: null };
  } catch (err) {
    // A signature/crypto failure reason, never a secret value.
    return {
      attempted: true,
      verified: false,
      reason: err instanceof Error ? err.message.slice(0, 200) : "signature self-test failed",
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function param(req: Request, key: string): string {
  return (req.params as Record<string, string>)[key] ?? "";
}

/** The one error envelope every /api route in this repo returns. */
function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ success: false, error: { code, message } });
}

/**
 * Money → Stripe minor units. `NaN` when the value is not a usable number.
 *
 * Exported so the VelRepeat V2 plan payment derives its charge the same way an
 * order does (there is one rule for THB ↔ minor units, not two). THB is a
 * two-decimal Stripe currency, so one baht is 100 minor units.
 */
export function toStripeMinor(amount: unknown): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(n * 100);
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
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

/**
 * Which PARENT does this charge belong to — a checkout group, or one order?
 *
 * A multi-shop purchase is ONE Stripe charge whose `payments` row hangs off
 * `checkout_group_id`, so `order_idForPaymentIntent` finds nothing for it. This
 * is the read that routes the event to the right settlement shape, and it is
 * deliberately made OUTSIDE every settlement transaction: it is a plain lookup
 * that takes no lock, and putting it inside would place a statement between the
 * order-row lock and the payment write (lib/order-lock.ts).
 *
 * A NULL identifier simply does not match (`= NULL` is NULL), so the other one
 * still can — the same rule `resolvePaymentAttemptRow` follows.
 *
 * WHY THE COLUMN IS READ OUT OF `to_jsonb` — DEPLOY ORDER IS NOT GUARANTEED
 * ------------------------------------------------------------------------
 * `payments.checkout_group_id` is migration 054. A backend that NAMES it can
 * reach production before 054 has been applied there, and a statement naming a
 * missing column fails with `undefined_column` (42703). That is not a degraded
 * read — it is a THROWN ERROR, and it is thrown on the ONE query every single
 * order's settlement runs, before the order or payment row is touched. So on
 * such a database no Stripe event can settle anything, ever: the charge lands,
 * the webhook is claimed, `handleStripeEvent()` throws here, `payment_events`
 * records `failed`, the endpoint answers 500, Stripe redelivers and hits the
 * identical error — while `payments.status` and `orders.status` never move and
 * the storefront keeps offering payment for a purchase that was paid for. That
 * is exactly the production incident this shape produced.
 *
 * `to_jsonb(p) ->> 'checkout_group_id'` is a KEY LOOKUP, so ONE statement reads
 * correctly against both schemas and cannot raise 42703 at all: it yields NULL
 * when the column is absent, exactly as it does when the column exists and is
 * NULL. Same reasoning, same SQL, same module family as `selectOrderPaymentRow`
 * (`lib/payment-reservation.ts`) — a payment read must never be able to stop
 * trading.
 *
 * And NULL is the SAFE answer here, not a silent loss of a feature: the column
 * is what links a payment to a purchase, so on a database without it there are
 * no group payments to route — every charge is a single-order charge, which is
 * precisely the branch that follows. The missing column still needs the
 * reconciler (it is what group checkout writes), so this path says so ONCE per
 * process; nothing is cached, so recovery needs no restart.
 */
async function checkoutGroupIdForAttempt(attempt: PaymentAttemptRef): Promise<string | null> {
  const sessionId = attempt.checkoutSessionId ?? null;
  const intentId = attempt.providerPaymentId ?? null;
  if (!sessionId && !intentId) return null;
  const row = await query(
    `SELECT to_jsonb(p) ->> 'checkout_group_id' AS checkout_group_id,
            to_jsonb(p) ? 'checkout_group_id'  AS has_checkout_group_column
       FROM payments p
      WHERE p.provider_checkout_session_id = $1 OR p.provider_payment_id = $2
      LIMIT 1`,
    [sessionId, intentId],
  );
  // `?` asks whether the KEY exists, whatever its value — so `false` means the
  // COLUMN itself is absent (migration 054 unapplied here), which is a
  // deploy-order condition worth naming once. `true` with a NULL value is the
  // ordinary single-order payment and says nothing.
  if (row.rows[0]?.has_checkout_group_column === false) warnCheckoutGroupColumnMissing();
  return (row.rows[0]?.checkout_group_id as string | undefined) ?? null;
}

/**
 * Say it once per process, name the reconciler, never repeat: a backend ahead of
 * its database is a deploy condition, not a per-delivery fault.
 */
let checkoutGroupColumnWarned = false;

function warnCheckoutGroupColumnMissing(): void {
  if (checkoutGroupColumnWarned) return;
  checkoutGroupColumnWarned = true;
  console.error(
    "[checkout-group] payments.checkout_group_id is missing — apply db/run-sqleditor.sql " +
      "(migration 054). Single-order payments settle normally meanwhile; a MULTI-SHOP " +
      "checkout cannot be paid for until the column exists.",
  );
}

/**
 * Can this database STORE a group payment at all?
 *
 * `checkoutGroupIdForAttempt` answers "does this existing payment belong to a
 * group", which a key lookup can answer on either schema. A WRITE cannot be
 * phrased that way: `INSERT INTO payments (checkout_group_id, …)` NAMES the
 * column, and naming an absent column raises `undefined_column` (42703) — it is
 * not a NULL, it is a thrown error. So the group OPEN path needs to know whether
 * the column exists BEFORE it asks Stripe for money.
 *
 * This is the same deploy-order hazard as the settlement read, one step earlier
 * in the request. Left unhandled it produces exactly the production symptom a
 * customer reports: the order and the `checkout_groups` row are created (both by
 * `POST /api/customer/checkout`, which does NOT need this column), the session
 * is opened at Stripe, and then the INSERT raises 42703 — so the customer is
 * shown "Failed to create checkout session" for an order that exists, with an
 * open Stripe session nobody holds. Retrying opens another one.
 *
 * `pg_attribute` is the catalogue, not the table, so this statement is TRUE even
 * on an empty `payments` — unlike probing a row, which would answer "no" simply
 * because no group payment had been written yet. Result is cached for the
 * process: the column is added by a migration, never by traffic, and
 * `checkoutGroupIdForAttempt` re-detects per call so recovery needs no restart.
 */
let paymentsGroupColumnAvailable: boolean | null = null;

async function paymentsCheckoutGroupColumnExists(): Promise<boolean> {
  if (paymentsGroupColumnAvailable !== null) return paymentsGroupColumnAvailable;
  const row = await query(
    `SELECT EXISTS (
        SELECT 1 FROM pg_attribute
         WHERE attrelid = 'payments'::regclass
           AND attname = 'checkout_group_id'
           AND NOT attisdropped
           AND attnum > 0
     ) AS present`,
  );
  paymentsGroupColumnAvailable = row.rows[0]?.present === true;
  if (!paymentsGroupColumnAvailable) warnCheckoutGroupColumnMissing();
  return paymentsGroupColumnAvailable;
}

/**
 * Reset the cached capability probe. Test-only seam — production has no reason
 * to re-read the catalogue, and caching is what keeps this off the hot path.
 */
export function __resetPaymentsGroupColumnCache(): void {
  paymentsGroupColumnAvailable = null;
  checkoutGroupColumnWarned = false;
}

/**
 * WHY A CHECKOUT SESSION FAILED — one structured line per failure.
 *
 * `catch { fail(res, 500, "STRIPE_ERROR", "Failed to create checkout session") }`
 * throws away every field needed to diagnose it: the Stripe error TYPE, its
 * CODE, the HTTP status, the `request_id` (the only handle Stripe support can
 * use), and the `param` naming the rejected field. Every failure therefore looks
 * identical from the outside, which is how a 42703 from THIS repository and a
 * misconfigured PromptPay rail in the Stripe dashboard became indistinguishable.
 *
 * What is logged is deliberately bounded to correlation identifiers and Stripe's
 * own error envelope:
 *   • never the secret key, the signing secret or any `sk_`/`whsec_`/`pk_` value;
 *   • never card data, a client secret, a customer email/phone or an address;
 *   • `metadata` is reduced to the ids we ourselves put there (order/group/user),
 *     never echoed wholesale.
 * The client still receives only the generic message — `fail()` is unchanged.
 */
function logCheckoutSessionFailure(args: {
  stage: string;
  orderId: string | null;
  checkoutGroupId: string | null;
  method: string;
  currency: string | null;
  amountMinor: number | null;
  sessionId: string | null;
  err: unknown;
}): void {
  const { stage, orderId, checkoutGroupId, method, currency, amountMinor, sessionId, err } = args;
  const e = (err ?? {}) as {
    type?: unknown;
    code?: unknown;
    statusCode?: unknown;
    status?: unknown;
    requestId?: unknown;
    param?: unknown;
    message?: unknown;
  };
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  // Stripe's `statusCode` is a NUMBER and `pg`'s `code` is a string, so a
  // string-only coercion silently dropped the HTTP status from every Stripe
  // failure — precisely the field requirement 3 asks for.
  const scalar = (v: unknown): string | null => {
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return str(v);
  };

  const detail: Record<string, unknown> = {
    failure_stage: stage,
    provider: "stripe",
    occurred_at: new Date().toISOString(),
    order_id: orderId,
    checkout_group_id: checkoutGroupId,
    method,
    currency,
    amount_minor: Number.isFinite(amountMinor as number) ? amountMinor : null,
    stripe_session_id: sessionId,
    provider_error_type: str(e.type),
    provider_error_code: scalar(e.code),
    provider_http_status: scalar(e.statusCode) ?? scalar(e.status),
    provider_request_id: str(e.requestId),
    provider_error_param: str(e.param),
    provider_error_message: str(e.message),
  };

  // One line, JSON, so a log search can filter on provider_request_id and get
  // exactly the Stripe-side log for that one call.
  console.error(`[stripe] checkout_session_failed ${JSON.stringify(detail)}`);
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
    const unitAmount = toStripeMinor(item.price);
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
  const paid = toStripeMinor(paidAmount);
  const refunded = toStripeMinor(alreadyRefunded ?? 0);
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

/**
 * WHICH payment attempt an incoming Stripe event is about.
 *
 * Stripe names the attempt in every event it sends — a PaymentIntent event
 * carries `payment_intent.id`, a Checkout Session event carries `session.id` —
 * and `payments` stores both (`provider_payment_id`,
 * `provider_checkout_session_id`). Carrying that identity through to the write
 * is what keeps one attempt's event from landing on another attempt's row.
 */
interface PaymentAttemptRef {
  /** Stripe PaymentIntent id, when the event is a PaymentIntent event. */
  providerPaymentId?: string | null;
  /** Stripe Checkout Session id, when the event is a Checkout Session event. */
  checkoutSessionId?: string | null;
}

/** The minimum a SQL runner needs for the resolver: a transaction client or the pool. */
type SqlRunner = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

/**
 * Resolve the ONE `payments` row an event is about.
 *
 * WHY — an order legitimately has SEVERAL payment rows: `POST /api/stripe/checkout`
 * retires the previous attempt (`SESSION_NOT_REUSABLE`) and opens a new one on
 * the same order whenever the customer re-opens checkout or switches rail, and
 * Stripe keeps delivering events for the retired session afterwards. The three
 * sync writers used to ignore that and pick "the newest non-terminal row", so a
 * LATE event about a dead attempt landed on the live one — failing a session the
 * customer was about to pay, and freeing the stock, or recording captured money
 * against an attempt that was never charged. A failure/success is a property of
 * an ATTEMPT, so the row is found BY the identifier the event carries.
 *
 * The newest-row heuristic survives ONLY as the fallback for an event that names
 * no stored attempt (a legacy row, or one written without an identifier), so
 * nothing that resolves today changes behaviour.
 *
 * `excludeTerminal` is the status a FALLBACK must skip: a success must not
 * settle an attempt already recorded as failed, and a failure must not touch one
 * already recorded as paid. It is applied again on the caller's outer UPDATE, so
 * the guard holds for the exactly-resolved row too.
 *
 * MUST be called inside the caller's transaction, under `lockOrderRow`.
 */
async function resolvePaymentAttemptRow(
  client: SqlRunner,
  orderId: string,
  attempt: PaymentAttemptRef,
  excludeTerminal: "paid" | "failed",
): Promise<string | null> {
  const intentId = attempt.providerPaymentId ?? null;
  const sessionId = attempt.checkoutSessionId ?? null;

  if (intentId || sessionId) {
    // A NULL parameter compares as NULL, so an absent identifier simply does
    // not match — the other one still can.
    const exact = await client.query(
      `SELECT id FROM payments
        WHERE order_id = $1 AND provider = 'stripe'
          AND (provider_payment_id = $2 OR provider_checkout_session_id = $3)
        LIMIT 1`,
      [orderId, intentId, sessionId],
    );
    if (exact.rows[0]) return exact.rows[0].id as string;
  }

  const fallback = await client.query(
    `SELECT id FROM payments
      WHERE order_id = $1 AND provider = 'stripe' AND status <> $2
      ORDER BY created_at DESC LIMIT 1`,
    [orderId, excludeTerminal],
  );
  return (fallback.rows[0]?.id as string | undefined) ?? null;
}

/**
 * Open ONE Stripe Checkout Session that settles a whole checkout group.
 *
 * Mirrors the single-order path step for step — same method guard, same
 * server-derived amount, same one-active-session rule, same response shape —
 * with the group as the payment parent:
 *
 *   • ownership — the group is read through `readOwnedCheckoutGroup`, so a
 *     group id belonging to another account is a plain 404;
 *   • amount — re-derived from the member ORDER rows, never from the client and
 *     never from the group's stored total;
 *   • payability — EVERY order must still be `pending`/`pending_payment`,
 *     unreleased and inside its reservation window. One shop having lapsed
 *     closes the whole purchase, because the customer pays once;
 *   • exactly one charge — `idx_payments_one_active_stripe_group` plus the
 *     race handling below mean a retry returns the existing session instead of
 *     opening a second one.
 */
async function openCheckoutGroupSession(args: {
  res: Response;
  userId: string;
  groupId: string;
  method: PaymentMethodId;
  requestKey: string | null;
  rememberResponse: (data: unknown, orderId?: string | null) => Promise<void>;
  stripe: Stripe;
}): Promise<void> {
  const { res, userId, groupId, method, requestKey, rememberResponse, stripe } = args;

  const group = await readOwnedCheckoutGroup(groupId, userId);
  if (!group) {
    fail(res, 404, "NOT_FOUND", "Checkout not found");
    return;
  }

  // ── Idempotency layer 1: the request key, claimed HERE ────────────────
  // This used to live only on the single-order path, below the group dispatch
  // in the route — so a multi-shop purchase, the exact flow that failed in
  // production, had NO request-key idempotency at all. Two clicks of "pay" each
  // opened their own Stripe session; the partial unique index let one INSERT
  // win and expired the loser's session after the fact. Recoverable, but it
  // spends a real provider call per double-click and shows the customer a
  // "try again" for a payment that was in fact already being prepared.
  //
  // Claimed AFTER the group is verified as existing and owned, so a bogus group
  // id cannot burn a key, and BEFORE any Stripe call, so the loser of a
  // double-click never reaches the provider.
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

  // ── Can this database record a group payment? ─────────────────────────
  // A group charge is written as `INSERT INTO payments (checkout_group_id, …)`,
  // which NAMES the column (migration 054 §3). On a database where 054 has not
  // been applied that INSERT raises 42703. Asking Stripe first would leave an
  // OPEN session at Stripe that this backend cannot attach to any payment row —
  // a live checkout URL for a purchase nothing can ever settle, which is the
  // worst outcome available here. So the capability is checked FIRST and the
  // customer is refused before any money-moving call is made.
  //
  // This is a deploy-order condition, not a customer error, so the status is 503
  // (retryable by definition) and the log names the reconciler.
  if (!(await paymentsCheckoutGroupColumnExists())) {
    logCheckoutSessionFailure({
      stage: "group_column_missing",
      orderId: null,
      checkoutGroupId: groupId,
      method,
      currency: null,
      amountMinor: null,
      sessionId: null,
      err: new Error(
        "payments.checkout_group_id is absent — the group payment row cannot be written",
      ),
    });
    fail(
      res,
      503,
      "CHECKOUT_GROUP_UNAVAILABLE",
      "Payment for this multi-shop checkout is temporarily unavailable. Please try again shortly.",
    );
    return;
  }

  const orders = await readGroupOrders({ query: (sql, params) => query(sql, params) }, groupId);
  if (orders.length === 0) {
    fail(res, 400, "INVALID_ORDER_GROUP", "This checkout has no orders to pay.");
    return;
  }
  // The group's representative order — the earliest one — stands in wherever a
  // single order id is structurally required (Stripe metadata, the countdown).
  const representative = orders[0]!;

  // One shop's lapsed reservation must not be paid around: the customer pays
  // once for the purchase, so the purchase is only open while all of it is.
  const blocking = firstBlockingOrder(orders);
  if (blocking) {
    fail(
      res,
      400,
      "INVALID_STATUS",
      `This checkout can no longer be paid (order ${blocking.order_number || blocking.id} is '${blocking.status}'). Please place a new order.`,
    );
    return;
  }

  const { total, currency } = await sumGroupOrderTotal(
    { query: (sql, params) => query(sql, params) },
    groupId,
  );
  if (!/^[A-Z]{3}$/.test(currency)) {
    fail(res, 400, "INVALID_CURRENCY", "The order currency is not usable for payment.");
    return;
  }
  if (method === PAYMENT_METHOD.PROMPTPAY && currency !== "THB") {
    fail(res, 400, "CURRENCY_UNSUPPORTED", "PromptPay is only available for THB orders.");
    return;
  }
  const expectedMinor = toStripeMinor(total);
  if (!Number.isFinite(expectedMinor) || expectedMinor <= 0) {
    fail(res, 400, "INVALID_AMOUNT", "The order total is not payable.");
    return;
  }

  // Line items across EVERY order in the purchase, so the Stripe total and the
  // charged total are the same figure derived from the same rows.
  const itemsResult = await query(
    `SELECT oi.order_id, oi.product_name_snapshot, oi.product_name,
            oi.image_url_snapshot, oi.quantity, oi.price
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.checkout_group_id = $1
      ORDER BY oi.order_id ASC, oi.created_at ASC`,
    [groupId],
  );
  const lineItems = buildCheckoutLineItems(
    itemsResult.rows,
    expectedMinor,
    currency,
    `Velnox order ${groupId.slice(0, 8)}`,
  );

  const frontendUrl = process.env.VITE_VELSHOP_URL || "https://velshop.vercel.app";
  const nowSeconds = Math.floor(Date.now() / 1000);

  // ── Reuse the live session for this purchase, if any ──────────────────
  const activePayment = await query(
    `SELECT id, provider_checkout_session_id
       FROM payments
      WHERE checkout_group_id = $1 AND provider = 'stripe'
        AND status IN ('pending', 'requires_action')
      ORDER BY created_at DESC LIMIT 1`,
    [groupId],
  );
  if (activePayment.rows.length > 0) {
    const activeSessionId: string | null = activePayment.rows[0].provider_checkout_session_id ?? null;
    if (activeSessionId) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(activeSessionId);
        // Only reuse a session opened for the SAME rail — otherwise the customer
        // would be charged through a method they did not choose.
        if (existing.status === "open" && existing.url && existing.metadata?.method === method) {
          const data = {
            checkoutGroupId: groupId,
            orderIds: orders.map((o) => o.id),
            orderNumbers: orders.map((o) => o.order_number).filter((n): n is string => Boolean(n)),
            sessionId: existing.id,
            url: existing.url,
            method,
            provider: "stripe",
            stripeMode: "test",
            amount: expectedMinor / 100,
            currency,
            expiresAt: existing.expires_at,
            paymentExpiresAt: representative.payment_expires_at
              ? new Date(representative.payment_expires_at).getTime()
              : null,
            reused: true,
          };
          await rememberResponse(data, representative.id);
          res.json({ success: true, data });
          return;
        }
      } catch {
        /* fall through to the conflict below */
      }
    }
    fail(res, 409, "DUPLICATE_PAYMENT_IN_PROGRESS", "Your payment is being prepared. Please try again.");
    return;
  }

  // Stage-instrumented: a failure between here and the INSERT below is the one
  // case that leaves an OPEN Stripe session with no payment row pointing at it.
  // The group id, method, amount and Stripe's request_id make that recoverable
  // from logs alone; without them it is an orphan nobody can find.
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: [stripePaymentMethodType(method)!],
      line_items: lineItems,
      // The return page reads `order=<id>`; it is given the group's representative
      // order so a multi-shop purchase lands on a real, readable order instead of
      // an empty page. `group` is kept alongside it so the storefront can say how
      // many shops the purchase spans — and it is NEVER used to decide payment
      // state, which the return page reads back from the server.
      success_url: `${frontendUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}&group=${groupId}&order=${representative.id}`,
      cancel_url: `${frontendUrl}/checkout/cancel?group=${groupId}&order=${representative.id}`,
      metadata: {
        // `checkoutGroupId` is what the webhook fans out on. `orderId` is the
        // group's earliest order, kept only so an event that predates this
        // contract (or an operator looking at Stripe metadata) still has a pointer.
        checkoutGroupId: groupId,
        orderId: representative.id,
        userId,
        method,
        provider: "stripe",
        mode: "test",
      },
      payment_intent_data: { metadata: { checkoutGroupId: groupId, userId, method } },
      customer_creation: "always",
      allow_promotion_codes: true,
      ...(nowSeconds > 0 ? {} : {}),
    });
  } catch (err) {
    // Stripe refused to open the session — nothing exists at Stripe, so there is
    // no orphan to clean up. Recorded with the request_id that identifies this
    // exact call in Stripe's own logs.
    logCheckoutSessionFailure({
      stage: "group_session_create",
      orderId: representative.id,
      checkoutGroupId: groupId,
      method,
      currency,
      amountMinor: expectedMinor,
      sessionId: null,
      err,
    });
    throw err;
  }

  const intentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  let paymentId: string | null = null;
  try {
    const inserted = await query(
      `INSERT INTO payments
         (checkout_group_id, provider, method, status, amount, currency,
          provider_checkout_session_id, provider_payment_id, metadata)
       VALUES ($1, 'stripe', $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id`,
      [
        groupId,
        method,
        PAYMENT_STATUS.REQUIRES_ACTION,
        expectedMinor / 100,
        currency,
        session.id,
        intentId,
        JSON.stringify({ stripeMode: "test", method, group: true }),
      ],
    );
    paymentId = inserted.rows[0]?.id ?? null;
  } catch (err) {
    if (!isUniqueViolation(err)) {
      // A session EXISTS at Stripe right now and nothing points at it. That is
      // the one unrecoverable shape in this handler, so the session id is logged
      // explicitly — an operator must be able to expire it from the Stripe
      // dashboard by id. The error's own code/param say whether this was the
      // schema (42703) or something else.
      logCheckoutSessionFailure({
        stage: "group_payment_insert",
        orderId: representative.id,
        checkoutGroupId: groupId,
        method,
        currency,
        amountMinor: expectedMinor,
        sessionId: session.id,
        err,
      });
      // Close the session we are about to abandon: an open session nobody holds
      // is a payable URL for a charge this backend cannot settle. Expiring it is
      // best-effort and never masks the original error.
      await stripe.checkout.sessions.expire(session.id).catch(() => {
        /* best-effort: the failure above is what must be reported */
      });
      throw err;
    }
    // A concurrent request won the active slot. Close OUR session (which the
    // customer is never shown) and let the caller retry onto the winner.
    await stripe.checkout.sessions.expire(session.id).catch(() => {});
    fail(res, 409, "DUPLICATE_PAYMENT_IN_PROGRESS", "Your payment is being prepared. Please try again.");
    return;
  }

  // Every order in the purchase moves to `pending_payment` together, so the
  // storefront renders one consistent state for the whole checkout.
  await query(
    `UPDATE orders SET status = 'pending_payment', updated_at = NOW()
      WHERE checkout_group_id = $1 AND status = 'pending'`,
    [groupId],
  );

  const data = {
    checkoutGroupId: groupId,
    orderIds: orders.map((o) => o.id),
    orderNumbers: orders.map((o) => o.order_number).filter((n): n is string => Boolean(n)),
    sessionId: session.id,
    url: session.url,
    method,
    provider: "stripe",
    stripeMode: "test",
    amount: expectedMinor / 100,
    currency,
    paymentId,
    expiresAt: session.expires_at,
    paymentExpiresAt: representative.payment_expires_at
      ? new Date(representative.payment_expires_at).getTime()
      : null,
    reused: false,
  };
  await rememberResponse(data, representative.id);

  console.log(
    `[stripe] checkout session ${session.id} opened for checkout group ${groupId} ` +
      `(${orders.length} orders, ${method}, ${currency} ${expectedMinor / 100}, test mode)`,
  );
  res.json({ success: true, data });
}

/**
 * Payment succeeded → Payment `paid`, Order `paid`, stock committed.
 *
 * The SINGLE-ORDER authority, deliberately left as one function with one
 * transaction and one order-row lock. A checkout group does NOT come through
 * here: `settleCheckoutGroup` is its own writer (one charge, N orders, N locks
 * taken before any `payments` write), and the webhook picks between them from
 * the payment's own `checkout_group_id`. Routing inside this transaction would
 * have meant a group read sitting between the lock and the payment write — the
 * exact ordering `lib/order-lock.ts` forbids.
 */
async function markPaymentSucceeded(
  orderId: string,
  attempt: PaymentAttemptRef,
  eventId: string | null = null,
): Promise<SyncResult> {
  return withTransaction(async (client) => {
    // ORDER ROW FIRST (lib/order-lock.ts). The order row is the single
    // serialisation point for settlement, cancellation and expiry; taking it
    // before `payments` means a concurrent cancel and this delivery queue behind
    // one lock in one order instead of forming an AB-BA deadlock.
    await lockOrderRow(client, orderId);

    const updated = await client.query(
      `UPDATE orders SET status = 'paid', updated_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'pending_payment')
         AND inventory_released = FALSE`,
      [orderId],
    );

    // The row THIS event is about, not merely the newest one: a captured charge
    // must be recorded against the attempt that was actually charged, because
    // that row is what a refund is later built from.
    const attemptRowId = await resolvePaymentAttemptRow(client, orderId, attempt, "failed");

    // Read that row's status BEFORE touching it, so the warning below can tell
    // "this delivery is the one that recorded the money" from a repeat of an
    // already-paid row (Stripe fires checkout.session.completed and
    // payment_intent.succeeded for the same charge — a duplicate must not warn).
    const priorPayment = attemptRowId
      ? await client.query(`SELECT status FROM payments WHERE id = $1`, [attemptRowId])
      : { rows: [] as Array<{ status: string }> };
    const priorPaymentStatus: string | null = priorPayment.rows[0]?.status ?? null;

    let attemptRecorded = false;
    if (attemptRowId) {
      // `status <> 'failed'` is the terminal guard, now on the outer UPDATE, so
      // it protects the resolved row itself: a success can never resurrect an
      // attempt already recorded as failed, and a repeat re-stamps nothing
      // (`paid_at = COALESCE(paid_at, NOW())`).
      const attemptWrite = await client.query(
        `UPDATE payments
            SET status = 'paid',
                paid_at = COALESCE(paid_at, NOW()),
                updated_at = NOW(),
                failure_code = NULL,
                failure_message = NULL,
                provider_payment_id = COALESCE($2, provider_payment_id)
          WHERE id = $1 AND status <> 'failed'`,
        [attemptRowId, attempt.providerPaymentId ?? null],
      );
      attemptRecorded = (attemptWrite.rowCount ?? 0) > 0;
    }

    const moved = (updated.rowCount ?? 0) > 0;

    // ── Normal settlement ────────────────────────────────────────────────
    // `moved` means the order was still payable and its stock is now committed
    // through the ONE settlement authority. `attemptRecorded` means the money
    // is recorded against the attempt that was actually charged — which is the
    // row a refund is later built from, and the row the operator refund route
    // requires (`status = 'paid'`).
    //
    // `!moved && priorPaymentStatus === 'paid'` is a DUPLICATE delivery of a
    // charge already settled — Stripe fires `checkout.session.completed` AND
    // `payment_intent.succeeded` for one charge. Nothing is wrong, so nothing
    // is reported; treating it as an incident would bury the real cases.
    const duplicateDelivery = !moved && priorPaymentStatus === "paid";

    // Everything else is money received that this system could not safely
    // settle, and it becomes a durable operator incident (HIGH #5). The old
    // `!moved && priorPaymentStatus !== 'paid'` warning covered only the FIRST
    // half — so the sharpest case, where the order DID move but the attempt
    // could not be recorded (it was already `failed`), was completely silent
    // while the order went to `paid` and the stock was committed.
    const lateReason: LatePaymentReason | null = duplicateDelivery
      ? null
      : !moved
        ? "ORDER_NOT_SETTLEABLE"
        : !attemptRecorded
          ? "ATTEMPT_NOT_RECORDED"
          : null;

    if (lateReason) {
      // Read the order + the amount from OUR rows: a trusted source, never the
      // provider payload, and never a number the client could have influenced.
      // `selectOrderPaymentRow` tolerates a database older than this backend
      // (`orders.payment_expires_at` is migration 048, unapplied in production),
      // so this read cannot abort the transaction with `undefined_column` —
      // which would make Stripe redeliver a payment already recorded.
      const row = await selectOrderPaymentRow(
        (sql, params) => client.query(sql, params),
        orderId,
      );
      const attemptRow = attemptRowId
        ? (
            await client.query(
              `SELECT amount, currency FROM payments WHERE id = $1`,
              [attemptRowId],
            )
          ).rows[0]
        : null;
      const reservationExpired =
        row?.payment_expires_at !== null &&
        row?.payment_expires_at !== undefined &&
        new Date(row.payment_expires_at).getTime() <= Date.now();
      const why = reservationExpired
        ? "its payment reservation had already expired and the stock was released"
        : `the order status is '${row?.status ?? "unknown"}'`;

      // The durable record. Deduplicated on provider + order + attempt +
      // reason, so any number of redeliveries leaves exactly one row. It is
      // written INSIDE this transaction, so it can never outlive a settlement
      // that rolled back — and it never throws, because a webhook that failed
      // here would be redelivered forever for an operator nicety.
      await recordLatePaymentIncident(client, {
        orderId,
        paymentId: attemptRowId,
        providerPaymentIntentId: attempt.providerPaymentId ?? null,
        checkoutSessionId: attempt.checkoutSessionId ?? null,
        eventId,
        reason: lateReason,
        orderStatus: (row?.status as string | undefined) ?? null,
        amount: attemptRow?.amount != null ? String(attemptRow.amount) : null,
        currency: (attemptRow?.currency as string | undefined) ?? null,
      });

      // Order id, status and reason only: no payload, no signature, no
      // customer or payment identifier, no secret.
      console.warn(
        `[stripe webhook] payment received for order ${orderId} that is no longer payable (${why}) — manual review/refund required`,
      );
    }
    if (moved) {
      // Reserved stock becomes SOLD stock exactly once — only the request that
      // actually moved the order reaches here. The consumption itself lives in
      // lib/inventory.ts (the ONE settlement authority, mirror image of
      // releaseOrderInventory): non-variant lines drop `quantity` AND
      // `reserved` (the hold becomes a completed sale) and variant lines stay
      // decremented where checkout already took them; `sold_count` increments
      // once per unit. Running it in THIS transaction is what makes
      // "money recorded" and "stock consumed" a single atomic step.
      await commitOrderInventory(client, orderId);
    }

    return { orderId, moved, inventoryReleased: false };
  });
}

/**
 * Settle every order of a checkout group from ONE paid session.
 *
 * Each order is claimed with the same `status IN ('pending','pending_payment')
 * AND inventory_released = FALSE` guard and the same row lock as a single-order
 * payment, so:
 *
 *   • an order already paid or cancelled is skipped, never re-paid;
 *   • a duplicate webhook delivery re-runs the guard, moves nothing, and is
 *     reported as a duplicate rather than charged twice;
 *   • stock is committed once per order, through the ONE settlement authority.
 *
 * Orders are locked together, in `id ASC`, by ONE statement
 * (`lockCheckoutGroupOrderRows`) that is the transaction's first — so two
 * concurrent deliveries take the same rows in the same sequence instead of
 * deadlocking, and no partial lock is ever held across the payment write.
 */
async function settleCheckoutGroup(
  groupId: string,
  attempt: PaymentAttemptRef,
): Promise<SyncResult> {
  return withTransaction(async (client) => {
    // ORDER ROWS FIRST — all N of them, in one statement, before anything is
    // written through `payments`. Same rule, same reason as `lockOrderRow`: the
    // order rows are the serialisation point for settlement, cancellation and
    // expiry, so a concurrent cancellation of ANY shop's order queues behind
    // this instead of forming an AB-BA cycle.
    const locked = await lockCheckoutGroupOrderRows(client, groupId);
    if (locked.length === 0) {
      return { orderId: groupId, moved: false, inventoryReleased: false };
    }

    // The payment row IS the attempt here: a group payment is not scoped to one
    // order, so it is marked by its own session/intent, not resolved per order.
    const paymentWrite = await client.query(
      `UPDATE payments
        SET status = 'paid',
            paid_at = COALESCE(paid_at, NOW()),
            updated_at = NOW(),
            failure_code = NULL,
            failure_message = NULL,
            provider_payment_id = COALESCE($2, provider_payment_id)
      WHERE checkout_group_id = $1 AND status <> 'failed'
        AND ($3::text IS NULL OR provider_checkout_session_id = $3)
      RETURNING id`,
      [groupId, attempt.providerPaymentId ?? null, attempt.checkoutSessionId ?? null],
    );
  if ((paymentWrite.rowCount ?? 0) === 0) {
    const prior = await client.query(
      `SELECT status FROM payments WHERE checkout_group_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [groupId],
    );
    if (prior.rows[0]?.status === "paid") {
      // Duplicate delivery of an already-settled charge: nothing is wrong.
      return { orderId: groupId, moved: false, inventoryReleased: false };
    }
  }

  const settled: string[] = [];
    for (const order of locked) {
      const updated = await client.query(
        `UPDATE orders SET status = 'paid', updated_at = NOW()
          WHERE id = $1 AND status IN ('pending', 'pending_payment')
            AND inventory_released = FALSE`,
        [order.id],
      );
      if ((updated.rowCount ?? 0) === 0) continue;
      await commitOrderInventory(client, order.id);
      settled.push(order.id);
    }

    // One realtime message per order — the storefront subscribes per order, and
    // a customer watching three shops must see all three settle.
    for (const orderId of settled) {
      broadcast(CHANNELS.ORDER_UPDATED, "order:updated", { orderId, to: "paid" });
    }

    console.log(
      `[stripe] checkout group ${groupId} settled from session ${attempt.checkoutSessionId ?? "?"}: ` +
        `${settled.length}/${locked.length} orders paid`,
    );

    return { orderId: groupId, moved: settled.length > 0, inventoryReleased: false };
  });
}


/** Payment failed → Payment `failed`, Order `payment_failed`, stock released. */
async function markPaymentFailed(
  orderId: string,
  attempt: PaymentAttemptRef,
  failureCode: string,
  failureMessage: string,
): Promise<SyncResult> {
  return withTransaction(async (client) => {
    // ORDER ROW FIRST. This handler used to touch `payments` before `orders`,
    // which inverted the lock order against the cancellation route (orders →
    // payments) and made the two deadlock-able. The order row is taken first
    // here too, so every writer shares one order (lib/order-lock.ts).
    await lockOrderRow(client, orderId);

    // The row THIS event is about. A late failure for a retired attempt must
    // never fail the customer's still-open session, and must never take the
    // order down with it.
    const attemptRowId = await resolvePaymentAttemptRow(client, orderId, attempt, "paid");
    let attemptFailed = false;
    if (attemptRowId) {
      // `status NOT IN ('paid','failed','cancelled')` is the ATTEMPT guard: the
      // row must still be OPEN for this to be a failure of it. It keeps a
      // duplicate delivery from re-asserting a failure, and keeps captured money
      // from being overwritten — whichever attempt either event names.
      const rowWrite = await client.query(
        `UPDATE payments
            SET status = 'failed', failure_code = $2, failure_message = $3, updated_at = NOW()
          WHERE id = $1 AND status NOT IN ('paid', 'failed', 'cancelled')`,
        [attemptRowId, failureCode.slice(0, 120), failureMessage.slice(0, 500)],
      );
      attemptFailed = (rowWrite.rowCount ?? 0) > 0;
    }

    // THE ORDER MOVES BECAUSE THIS ATTEMPT FAILED — not because "some failure
    // happened for this order". Tying the order transition to the attempt is
    // what stops a late failure for a dead attempt from flipping a live order to
    // `payment_failed` and releasing stock the customer is still inside the
    // window for. A failure we cannot attribute to an open attempt of THIS
    // order moves nothing, and is left visible in the log for an operator.
    if (!attemptFailed) {
      return { orderId, moved: false, inventoryReleased: false };
    }

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
async function markPaymentCanceled(
  orderId: string,
  attempt: PaymentAttemptRef,
  reason: string,
): Promise<SyncResult> {
  return withTransaction(async (client) => {
    // ORDER ROW FIRST — same reason as markPaymentFailed above: this path runs
    // concurrently with the customer's own cancel for exactly the same order
    // (“the buyer pressed cancel while the session expired”), so the two must
    // not take `orders`/`payments` in opposite orders (lib/order-lock.ts).
    await lockOrderRow(client, orderId);

    // Attempt-scoped for the same reason: an expired session says nothing about
    // a different session the customer still has open.
    const attemptRowId = await resolvePaymentAttemptRow(client, orderId, attempt, "paid");
    let attemptCanceled = false;
    if (attemptRowId) {
      // Same ATTEMPT guard as the failure path: the row must still be OPEN.
      const rowWrite = await client.query(
        `UPDATE payments
            SET status = 'cancelled', failure_code = $2, failure_message = $3, updated_at = NOW()
          WHERE id = $1 AND status NOT IN ('paid', 'failed', 'cancelled')`,
        [attemptRowId, "PAYMENT_CANCELED", reason.slice(0, 500)],
      );
      attemptCanceled = (rowWrite.rowCount ?? 0) > 0;
    }

    // The order is cancelled because THIS attempt was abandoned, never because
    // some other session's session expired.
    if (!attemptCanceled) {
      return { orderId, moved: false, inventoryReleased: false };
    }

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
    // ORDER ROW FIRST, for the same reason as the settlement and cancellation
    // paths: this transaction writes `refunds`, `payments` and (on a full refund)
    // the order itself, so it must enter the same lock order as every other
    // order writer (lib/order-lock.ts).
    await lockOrderRow(client, payment!.order_id);

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
  // ── VelRepeat V2 prepaid PLAN payments ─────────────────────────────────
  // Dispatched FIRST, before any order logic. A V2 plan charge carries its own
  // scope marker and its own parent (`payments.plan_id`), so it is NOT an order
  // payment: letting it fall through would find no `metadata.orderId`, log
  // "no resolvable order" and silently drop a verified commitment payment.
  //
  // The marker is only ever written by our own session-creation code, and only
  // events carrying it divert — every V1 event takes exactly the path it took
  // before this module existed.
  if (await handleVelRepeatV2PaymentEvent(event)) return;

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
        // Attempt-scoped like every other payment-row write: a completed-but-
        // unpaid session must not move a DIFFERENT session's row.
        const awaitingRowId = await resolvePaymentAttemptRow(
          // Outside the sync transaction: the pool-level runner, adapted.
          { query: (sql: string, params?: unknown[]) => query(sql, params) },
          orderId,
          { checkoutSessionId: session.id },
          "paid",
        );
        if (awaitingRowId) {
          await query(
            `UPDATE payments SET status = 'requires_action', updated_at = NOW()
              WHERE id = $1 AND status <> 'paid'`,
            [awaitingRowId],
          );
        }
        console.log(
          `[stripe webhook] order ${orderId} session ${session.id} completed but unpaid (${session.payment_status}) — awaiting payment`,
        );
        return;
      }
      const intentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null);
      const attempt: PaymentAttemptRef = {
        providerPaymentId: intentId,
        checkoutSessionId: session.id,
      };
      // ONE purchase is paid as ONE charge: if this session belongs to a
      // checkout group, it settles every per-shop order in it. The branch is
      // taken from the payment's own `checkout_group_id`, never from the
      // representative `orderId` in metadata.
      const groupId = await checkoutGroupIdForAttempt(attempt);
      if (groupId) {
        await settleCheckoutGroup(groupId, attempt);
        return;
      }
      const result = await markPaymentSucceeded(orderId, attempt, event.id);
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
      const attempt: PaymentAttemptRef = {
        providerPaymentId: intentId,
        checkoutSessionId: session.id,
      };
      const groupId = await checkoutGroupIdForAttempt(attempt);
      if (groupId) {
        await settleCheckoutGroup(groupId, attempt);
        return;
      }
      const result = await markPaymentSucceeded(orderId, attempt, event.id);
      if (result.moved) {
        broadcast(CHANNELS.ORDER_UPDATED, "order:updated", { orderId, to: "paid" });
      }
      return;
    }

    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (!orderId) return;
      const asyncIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null);
      const result = await markPaymentFailed(
        orderId,
        { providerPaymentId: asyncIntentId, checkoutSessionId: session.id },
        "ASYNC_PAYMENT_FAILED",
        "The delayed payment did not complete.",
      );
      if (result.moved) {
        broadcast(CHANNELS.ORDER_UPDATED, "order:updated", { orderId, to: "payment_failed" });
      }
      return;
    }

    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (!orderId) return;
      const result = await markPaymentCanceled(
        orderId,
        { checkoutSessionId: session.id },
        `Checkout session ${session.id} expired.`,
      );
      if (result.moved) {
        broadcast(CHANNELS.ORDER_UPDATED, "order:updated", { orderId, to: "cancelled" });
      }
      return;
    }

    // ── PaymentIntent ───────────────────────────────────────────────────────
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const attempt: PaymentAttemptRef = { providerPaymentId: paymentIntent.id };
      // A group charge carries no `metadata.orderId`, so the group branch must
      // be taken BEFORE the order lookup or the event would be dropped as
      // unresolvable.
      const groupId = await checkoutGroupIdForAttempt(attempt);
      if (groupId) {
        await settleCheckoutGroup(groupId, attempt);
        return;
      }
      const orderId = await orderIdForPaymentIntent(paymentIntent);
      if (!orderId) {
        console.warn(`[stripe webhook] ${event.id} payment_intent.succeeded has no resolvable order — ignored`);
        return;
      }
      const result = await markPaymentSucceeded(orderId, attempt, event.id);
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
      const result = await markPaymentFailed(
        orderId,
        { providerPaymentId: paymentIntent.id },
        code,
        message,
      );
      if (result.moved) {
        broadcast(CHANNELS.ORDER_UPDATED, "order:updated", { orderId, to: "payment_failed" });
      }
      return;
    }

    case "payment_intent.canceled": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const orderId = await orderIdForPaymentIntent(paymentIntent);
      if (!orderId) return;
      const result = await markPaymentCanceled(
        orderId,
        { providerPaymentId: paymentIntent.id },
        "The payment was canceled.",
      );
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
  app.get("/api/stripe/configured", async (req: Request, res: Response) => {
    const status = stripeStatus();
    res.json({
      success: true,
      data: {
        configured: status.usable,
        mode: status.mode,
        publishableKey: status.publishableKey,
        webhookConfigured: status.webhookConfigured,
        reason: status.reason,
        // Shape-only report on STRIPE_WEBHOOK_SECRET (`whsec_` prefix, a coarse
        // length bucket, wrapping quotes, interior whitespace) — no character of
        // the value is derivable from it. It separates "the signing secret was
        // pasted wrong" from "the endpoint sent the wrong thing" without Render
        // dashboard access, which is otherwise a dead end: `webhookConfigured`
        // is true for a value that can never verify anything.
        webhookSecretHealth: webhookSecretHealth(),
        // Opt-in so the hot path stays pure. Answers "can this deployment verify
        // ANY signature?" — see selfTestWebhookSignature().
        ...(req.query.selfTest === "1"
          ? { webhookSignatureSelfTest: await selfTestWebhookSignature() }
          : {}),
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
    // Declared OUTSIDE the try so the catch below can always correlate a failure
    // with the customer-visible identifiers, whatever stage threw. They are
    // assigned from the same request fields the handler uses, so they can never
    // disagree with the values the rest of the route acted on.
    let failureOrderId: string | null = null;
    let failureGroupId: string | null = null;
    let failureMethod: string | null = null;
    let failureCurrency: string | null = null;
    let failureAmountMinor: number | null = null;
    try {
      const userId = req.user!.userId;
      const body = (req.body ?? {}) as Record<string, unknown>;

      const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
      const checkoutGroupId =
        typeof body.checkoutGroupId === "string" ? body.checkoutGroupId.trim() : "";
      if (!orderId && !checkoutGroupId) {
        fail(res, 400, "VALIDATION_ERROR", "orderId or checkoutGroupId is required");
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
      failureMethod = method;
      failureOrderId = orderId || null;
      failureGroupId = checkoutGroupId || null;

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

      // ── Idempotency layer 1: the request key ────────────────────────────
      // One durable row per (user, scope, request key). A retry with the same
      // key replays the stored response instead of opening a second session.
      //
      // The group path CLAIMS the key inside `openCheckoutGroupSession`, not
      // here: the key must not be claimed before the group is known to exist
      // and be owned by this user, or a bogus group id would burn the key. The
      // single-order path keeps its claim below, after the order is validated
      // for the same reason. Both paths share `rememberResponse`, so a replayed
      // response is served from either one.
      const rawKey = typeof body.requestKey === "string" ? body.requestKey.trim() : "";
      const requestKey = rawKey ? rawKey.slice(0, 200) : null;

      const rememberResponse = async (data: unknown, responseOrderId?: string | null) => {
        if (!requestKey) return;
        // A group request carries NO `orderId` (the group IS the subject), so
        // attributing the snapshot to the empty string threw a uuid parse error
        // and the whole snapshot was silently dropped — leaving the claimed key
        // permanently 'claimed but unfinished', i.e. a replay could never be
        // served. The group path passes its representative order instead.
        const orderRef = responseOrderId ?? orderId;
        if (!orderRef) return;
        await query(
          `UPDATE checkout_requests SET order_id = $1, response = $2::jsonb
            WHERE user_id = $3 AND scope = 'payment' AND request_key = $4`,
          [orderRef, JSON.stringify({ ...(data as object), paymentRequest: true, method }), userId, requestKey],
        ).catch(() => {
          // The response snapshot is an optimisation; failing to store it must
          // not fail a payment the customer can already complete.
        });
      };

      // ── CHECKOUT GROUP: one charge for a multi-shop purchase ────────────
      // A checkout spanning N shops is ONE customer purchase: ONE Stripe
      // session, ONE charge covering the SUM of the N orders. Before this,
      // payment was taken against a single order id, so a three-shop cart was
      // charged for one shop only and the other orders expired unpaid.
      //
      // It is dispatched HERE, before the single-order lookup, because a group
      // request carries no `orderId` at all and the lookup below parses one.
      //
      // Everything money-bearing stays server-side: the group is read through
      // the OWNER scope, the amount is re-derived from the member order rows,
      // and the session is settled only by the signature-verified webhook
      // (`settleCheckoutGroup`). No client figure is trusted.
      if (checkoutGroupId) {
        await openCheckoutGroupSession({
          res,
          userId,
          groupId: checkoutGroupId,
          method,
          requestKey,
          rememberResponse,
          stripe: s,
        });
        return;
      }

      // ── Order: existence, ownership, payable status ─────────────────────
      // Read through `selectOrderPaymentRow`, which tolerates a database older
      // than this backend. Naming `payment_expires_at` directly made the deploy
      // order fatal: production logged `[stripe] checkout error: column
      // "payment_expires_at" does not exist` (2026-09-28) and NO order could get
      // a Checkout Session. Without the column the read reports no window, which
      // is the legacy-row case handled directly below.
      const order = await selectOrderPaymentRow((sql, params) => query(sql, params), orderId);
      if (!order) {
        fail(res, 404, "NOT_FOUND", "Order not found");
        return;
      }
      if (order.user_id !== userId) {
        fail(res, 403, "FORBIDDEN", "Not your order");
        return;
      }
      if (!["pending", "pending_payment"].includes(order.status)) {
        fail(res, 400, "INVALID_STATUS", `Order status '${order.status}' cannot be paid`);
        return;
      }

      // ── Payment reservation: is the customer still inside the window? ────
      // The deadline written at order creation (lib/payment-reservation.ts) is
      // the customer-facing promise, not the moment the expiry sweep happens to
      // run. Refusing here keeps a payment from being accepted for an order the
      // sweep is releasing in the same second — and "continue payment after the
      // window" answers a clear 400 instead of opening a session on an order
      // that is about to be terminal.
      const reservationExpiresAt = order.payment_expires_at
        ? new Date(order.payment_expires_at).getTime()
        : null;
      if (reservationExpiresAt !== null && reservationExpiresAt <= Date.now()) {
        fail(
          res,
          400,
          "PAYMENT_RESERVATION_EXPIRED",
          "The payment window for this order has expired. Please place a new order.",
        );
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

      const expectedMinor = toStripeMinor(order.total_amount);
      if (!Number.isFinite(expectedMinor) || expectedMinor <= 0) {
        fail(res, 400, "INVALID_AMOUNT", "The order total is not payable.");
        return;
      }
      failureCurrency = currency;
      failureAmountMinor = expectedMinor;

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

      // Stripe's own bounds for a session's `expires_at` are 30 min – 24 h from
      // now, applied to the reservation deadline resolved above.
      const nowSeconds = Math.floor(Date.now() / 1000);
      const sessionExpiresAt = reservationExpiresAt
        ? Math.min(
            Math.max(Math.floor(reservationExpiresAt / 1000), nowSeconds + 30 * 60),
            nowSeconds + 24 * 60 * 60,
          )
        : undefined;
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
        // Stripe bounds a session's own expiry to 30 min – 24 h from creation,
        // while the reservation window may be shorter (MIN is 10 min). The
        // session is therefore asked to close as soon as Stripe allows and never
        // later than the deadline; when the window is shorter than Stripe's
        // minimum, the expiry sweep closes the session explicitly at the
        // deadline (jobs/payment-reservation-scheduler.ts). The ORDER row — not
        // the session — is the source of truth either way.
        ...(sessionExpiresAt ? { expires_at: sessionExpiresAt } : {}),
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
                paymentExpiresAt: reservationExpiresAt,
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
        // `expiresAt` stays the SESSION's expiry (epoch seconds, unchanged
        // contract). `paymentExpiresAt` is the reservation deadline in ms — the
        // window the order page counts down, and the value the backend enforces.
        expiresAt: session.expires_at,
        paymentExpiresAt: reservationExpiresAt,
        reused: false,
      };
      await rememberResponse(data);

      console.log(
        `[stripe] checkout session ${session.id} opened for order ${orderId} (${method}, ${currency} ${expectedMinor / 100}, test mode)`,
      );
      res.json({ success: true, data });
    } catch (err) {
      // The outer catch covers everything from the order read to the session
      // write, so it cannot know which step failed on its own. What it always
      // knows is the identifiers the customer and the order share, so the
      // failure is recorded with them plus Stripe's own error envelope (type,
      // code, HTTP status, `param`, `request_id`). Without `request_id` a
      // production 500 here is unactionable: Stripe support cannot find the call
      // and neither can we. Never the secret key, card data or the payload.
      logCheckoutSessionFailure({
        stage: "checkout_session_open",
        orderId: failureOrderId,
        checkoutGroupId: failureGroupId,
        method: failureMethod ?? "unknown",
        currency: failureCurrency,
        amountMinor: failureAmountMinor,
        sessionId: null,
        err,
      });
      fail(res, 500, "STRIPE_ERROR", "Failed to create checkout session");
    }
  });

  // ── POST /api/payments/stripe/webhook ──────────────────────────────────
  // NOTE: raw body is wired in server.ts BEFORE express.json, which signature
  // verification requires. Never move this route behind the JSON parser.
  app.post("/api/payments/stripe/webhook", async (req: Request, res: Response) => {
    // ── Stage timing ───────────────────────────────────────────────────
    // Every stage of this handler (signature, idempotency claim, event
    // dispatch, state writes) runs BEFORE the response is written, so a stall
    // is otherwise invisible: the caller only ever reports a timeout. These
    // lines name the last stage that COMPLETED and its elapsed time, which is
    // what identifies where a request stopped. Deliberately minimal and
    // secret-free — an event id/type and milliseconds only. Never the payload,
    // the signature, a secret key, the signing secret, a client secret, an
    // access token, a cookie, or any customer/payment field.
    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;
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

      // ── Stage: raw body ────────────────────────────────────────────────
      // Stripe signs the exact bytes it sends, so verification over anything but
      // those bytes cannot succeed. If the body was JSON-parsed first (the
      // raw-body middleware and this route drifting apart) or never arrived,
      // answering "Invalid signature" would describe a wiring bug as a forged
      // event — so the two are reported differently. See
      // middleware/stripe-raw-body.ts.
      const rawBody = req.body as unknown;
      if (!Buffer.isBuffer(rawBody) && typeof rawBody !== "string") {
        console.error(
          "[stripe webhook] raw body unavailable — refusing before signature verification. " +
            "The raw-body middleware must be mounted before express.json() for this route " +
            "(middleware/stripe-raw-body.ts).",
        );
        res.status(500).json({ error: "Webhook body was not preserved for signature verification" });
        return;
      }

      // Stage: a signed request reached the handler. No event id exists yet (the
      // payload is not parsed until the signature is verified), so this names the
      // body's kind and size only — never the payload, the signature, or a secret.
      const bodyBytes = Buffer.isBuffer(rawBody)
        ? rawBody.length
        : Buffer.byteLength(rawBody as string, "utf8");
      console.log(
        `[stripe webhook] webhook_received body=${Buffer.isBuffer(rawBody) ? "buffer" : "string"} bytes=${bodyBytes} signature=present (+${elapsed()}ms)`,
      );

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
        //
        // This one message has two causes that look identical from outside: the
        // configured signing secret is not the secret that signed THIS request,
        // or the request did not come from the configured endpoint at all —
        // `stripe listen --forward-to` signs with a per-session secret of its
        // own, which by design is not the endpoint's secret, and the CLI secret
        // must never be copied into production to make forwarding pass.
        // `GET /api/stripe/configured?selfTest=1` reports the signing secret's
        // shape and whether this deployment can verify any signature at all,
        // which separates those from a defect in this process.
        console.error(
          "[stripe webhook] signature_verification_failed:",
          err instanceof Error ? err.message : "invalid signature",
        );
        res.status(400).json({ error: "Invalid signature" });
        return;
      }
      console.log(`[stripe webhook] ${event.type} (${event.id}) signature verified (+${elapsed()}ms)`);

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

      console.log(`[stripe webhook] ${event.type} (${event.id}) claimed — dispatching (+${elapsed()}ms)`);

      try {
        await handleStripeEvent(event);
        await query(
          `UPDATE payment_events SET status = 'processed', updated_at = NOW() WHERE event_id = $1`,
          [event.id],
        );
        console.log(`[stripe webhook] processed ${event.type} (${event.id}) (+${elapsed()}ms)`);
        res.status(200).json({ received: true });
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 500) : "unknown error";
        console.error(`[stripe webhook] failed processing ${event.type} (${event.id}) (+${elapsed()}ms):`, message);
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
      console.error(`[stripe webhook] error (+${elapsed()}ms):`, err instanceof Error ? err.message : "unknown error");
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

      const alreadyRefundedMinor = toStripeMinor(payment.refunded_amount ?? 0);
      const refundableMinor = refundableMinorFor(payment.amount, payment.refunded_amount ?? 0);
      if (refundableMinor <= 0) {
        fail(res, 409, "NOTHING_TO_REFUND", "This payment has already been fully refunded.");
        return;
      }

      let requestedMinor = refundableMinor;
      if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
        requestedMinor = toStripeMinor(body.amount);
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
export const __testOnly = { toMinor: toStripeMinor, orderNumber: generateOrderNumber };
