/**
 * LATE / UNRECORDABLE PAYMENT — the durable operator incident (audit HIGH #5).
 *
 * WHAT THIS IS FOR
 * ----------------
 * `.ai/context/payment.md` already fixes the policy this module implements and
 * must never contradict:
 *
 *   "a late payment can never resurrect an expired order or reclaim another
 *    customer's stock … records the money on the payment row (which is what
 *    makes it refundable) and logs `manual review/refund required` with the
 *    reason. **No refund is invented in code — an operator decides.**"
 *
 * The order-level half of that sentence is implemented in
 * `routes/stripe.ts::markPaymentSucceeded` and is unchanged. What was missing
 * is the last link: the "logs … with the reason" half existed only as a
 * `console.warn` on a Render log line, and in the sharpest case (a captured
 * charge for an attempt already recorded `failed`, on an order that is STILL
 * payable) it did not even fire — the order moved to `paid` and the stock was
 * committed while the payment row stayed `failed`, so the existing operator
 * refund route refuses it (`PAYMENT_NOT_REFUNDABLE` requires `status = 'paid'`)
 * and nothing anywhere recorded that money existed.
 *
 * So this module adds the ONE missing thing: a durable, deduplicated record an
 * operator can list, read and acknowledge.
 *
 * IT DECIDES NOTHING ABOUT THE MONEY
 * ----------------------------------
 * There is no automatic refund, no reopening of a dead order, and no retry.
 * Those are business decisions, and `.ai/context/payment.md` is explicit that
 * an operator makes them. This module records WHAT to look at; `resolved` is a
 * bookkeeping word and deliberately does not mean "refunded" or "reopened" —
 * `routes/center.ts` refuses to touch the order, the payment, refunds or
 * inventory when an incident is resolved.
 *
 * WHY IT IS SCHEMA-TOLERANT
 * -------------------------
 * `payment_incidents` ships in migration 049, which — exactly like 048 — is
 * NOT applied in production (the Neon quota blocker). The backend may therefore
 * be running against a database that has never heard of this table. A webhook
 * that threw here would answer 500 and make Stripe redeliver a payment that
 * has already been recorded, forever. So a missing table / column is caught,
 * reported ONCE per process (a backend ahead of its database is a deploy
 * condition, not a per-request fault) and swallowed. This is the same posture
 * `lib/payment-reservation.ts` takes for `orders.payment_expires_at`.
 */
import { query } from "../db/index.js";
import { isUndefinedColumnError } from "./payment-reservation.js";

/** Why captured money could not be settled through the normal lifecycle. */
export type LatePaymentReason =
  /** The order itself refused the settlement: cancelled, expired, completed… */
  | "ORDER_NOT_SETTLEABLE"
  /**
   * The order DID move, but the attempt the event named could not be recorded
   * as `paid` (it was already terminal `failed`). The order is `paid`, the
   * stock is committed, and no payment row says the money was taken — so the
   * existing refund route refuses it and the case was previously invisible.
   */
  | "ATTEMPT_NOT_RECORDED";

/** What an operator needs to identify the case. No payload, no secret. */
export interface LatePaymentIncidentInput {
  orderId: string;
  /** The attempt the event resolved to, when one was found. */
  paymentId: string | null;
  providerPaymentIntentId: string | null;
  checkoutSessionId: string | null;
  eventId: string | null;
  reason: LatePaymentReason;
  /** The order status that refused the settlement, for the operator's context. */
  orderStatus: string | null;
  /** From OUR `payments` row — a trusted source, never the provider payload. */
  amount: string | null;
  currency: string | null;
}

/**
 * The deterministic dedupe key.
 *
 * Provider + order + the attempt the event named + the reason. Everything here
 * is already known to the system, and none of it is a timestamp or a random
 * value, so the same condition arriving as ten different events collapses to
 * one row. A different attempt — genuinely different money — gets its own row.
 */
export function buildLatePaymentDedupeKey(input: {
  provider: string;
  orderId: string;
  paymentId: string | null;
  providerPaymentIntentId: string | null;
  reason: string;
}): string {
  const attempt =
    input.paymentId ??
    (input.providerPaymentIntentId ? `pi:${input.providerPaymentIntentId}` : "no-attempt");
  return [input.provider, input.orderId, attempt, input.reason].join(":");
}

/** `42P01` — the relation does not exist (the migration is not applied). */
export function isUndefinedTableError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

let incidentSchemaWarned = false;

/** Say it once per process, name the migration, and never repeat. */
function warnIncidentSchemaMissing(effect: string): void {
  if (incidentSchemaWarned) return;
  incidentSchemaWarned = true;
  console.warn(
    `[payment-incidents] payment_incidents is not present — ${effect}. ` +
      `Apply db/migrations/049_payment_incidents.sql (PRODUCTION BLOCKED until the Neon quota is cleared).`,
  );
}

/**
 * Record — or, if it already exists, confirm — a late / unrecordable payment.
 *
 * IDEMPOTENCY is database-enforced: the INSERT carries
 * `ON CONFLICT (dedupe_key) DO NOTHING`. A read-then-write check would not be
 * idempotent here, because two concurrent deliveries of the same condition
 * would both read "no incident" and both insert.
 *
 * MUST be called INSIDE the caller's transaction, so an incident can never
 * outlive a settlement that then rolled back. Never throws: a failure to
 * record an operator nicety must not cost the customer their payment event.
 *
 * Returns the incident id, or `null` when nothing was recorded (already present,
 * or the table is not there yet).
 */
export async function recordLatePaymentIncident(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> },
  input: LatePaymentIncidentInput,
  provider = "stripe",
): Promise<string | null> {
  const dedupeKey = buildLatePaymentDedupeKey({
    provider,
    orderId: input.orderId,
    paymentId: input.paymentId,
    providerPaymentIntentId: input.providerPaymentIntentId,
    reason: input.reason,
  });

  try {
    const inserted = await client.query(
      `INSERT INTO payment_incidents
         (dedupe_key, provider, order_id, payment_id,
          provider_payment_intent_id, provider_checkout_session_id, event_id,
          reason, order_status, amount, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      [
        dedupeKey,
        provider,
        input.orderId,
        input.paymentId,
        input.providerPaymentIntentId,
        input.checkoutSessionId,
        input.eventId,
        input.reason,
        input.orderStatus,
        input.amount,
        input.currency,
      ],
    );
    return (inserted.rows[0]?.id as string | undefined) ?? null;
  } catch (err) {
    if (isUndefinedTableError(err) || isUndefinedColumnError(err)) {
      warnIncidentSchemaMissing("late payments are logged but not durably queued");
      return null;
    }
    // Anything else is a real fault. It is surfaced and swallowed rather than
    // thrown: the settlement itself has already been decided, and failing the
    // webhook here would make Stripe redeliver a payment we already recorded.
    console.error(
      `[payment-incidents] could not record a late-payment incident for order ${input.orderId}:`,
      err instanceof Error ? err.message : "unknown error",
    );
    return null;
  }
}

/**
 * The same record, written OUTSIDE any transaction.
 *
 * Used by the operator routes, which have no settlement to keep atomic with a
 * write. It shares the schema tolerance so a VelCenter screen still answers on
 * a database that has never had 049 applied — a 500 there would look like a
 * broken dashboard rather than an unapplied migration.
 */
export async function insertLatePaymentIncident(input: LatePaymentIncidentInput): Promise<string | null> {
  return recordLatePaymentIncident(query as never, input);
}
