/**
 * VelRepeat V2 — Phase 4: the prepaid PLAN-level Stripe payment and the
 * payment-gated `draft → active` transition.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE IMPLEMENTS, AND NOTHING ELSE
 * ─────────────────────────────────────────────
 *   POST /api/velrepeat/v2/plans/:planId/payment
 *        → open ONE Stripe Checkout Session for the ENTIRE commitment
 *        → record it in the canonical `payments` authority with the PLAN as
 *          its parent (migration 051, `payments.plan_id`)
 *
 *   Stripe webhook (dispatched from the EXISTING `POST /api/payments/stripe/webhook`,
 *   after the existing raw-body + signature + event-claim steps)
 *        → resolve the plan and the attempt THIS event names
 *        → verify amount + currency against the immutable Phase 3 snapshot
 *        → record the money in `payments`
 *        → activate the plan ONCE, re-anchoring `started_at` / `next_run_at`
 *
 * The customer pays ONCE for the whole commitment (Q14). A 4-cycle plan priced
 * at 360 THB charges 360 THB — NOT four charges and NOT an order for 360.
 *
 * OWNER DECISIONS THIS PHASE IS BUILT ON
 * ──────────────────────────────────────
 *   Q-A  `draft → active` only on SERVER-VERIFIED payment success. Never on
 *        session creation, never on a client callback, never on a return from
 *        Stripe, never on a client claim.
 *   Q-B  (Phase 3) seller eligibility — unchanged here.
 *   Q-C  Plan before payment; this phase owns the charge, the settlement, the
 *        payment linkage and the activation.
 *   Q13=B  Plan-level payment linkage INSIDE the one existing payment
 *          authority. One `payments` table, one `payment_events` claim store,
 *          one `payment_incidents` mechanism, one `payment-config.ts` gate.
 *          No second payment system, no parallel ledger.
 *   Q14  ONE canonical Stripe prepaid charge per plan. Not a Subscription, no
 *          per-cycle re-charge, and each cycle stays a future fulfillment
 *          obligation of the paid plan.
 *
 * WHY `payments` HAD TO CHANGE (and why this is not a fake order)
 * ──────────────────────────────────────────────────────────────
 * `payments.order_id` was `UUID NOT NULL REFERENCES orders(id)`, so a
 * plan-level charge could not be recorded at all. The only two workarounds
 * were both forbidden: invent an Order to hold the money, or make Cycle 1's
 * order carry the whole commitment. Migration 051 is the smallest correct
 * additive answer the decision closure asked for
 * (`velrepeat-v2-owner-decision-closure-2026-09-30.md` §3.1): `order_id` keeps
 * its type and its FK but loses NOT NULL, a `plan_id` parent appears, and an
 * "exactly one parent" CHECK preserves the old guarantee that every payment
 * belongs to something. Nothing in this module writes an `orders` row.
 *
 * MONEY IS DERIVED, NEVER ACCEPTED
 * ────────────────────────────────
 * The charged amount is `velrepeat_pricing_snapshots.total_amount` — the
 * immutable pricing snapshot — read inside the same transaction that validates
 * the plan, and converted to minor units through the exact bigint-rational
 * money module. The request body carries a method and a request key; it carries
 * no amount, no currency, no price, no seller and no status, and none of those
 * are read from anywhere else. At settlement the amount and currency Stripe
 * reports are compared against that snapshot; a mismatch records the money,
 * refuses to activate, and raises a durable operator incident.
 *
 * `total_amount` is the TOTAL PREPAID commitment — `cycle_price ×
 * commitment_cycles` — because V2 is prepaid. `cycle_price`, the price of ONE
 * delivery cycle, is a DIFFERENT number whenever the commitment covers more
 * than one cycle, and this module never charges it: a 90.00 THB cycle over a
 * 4-cycle commitment charges 360.00 THB. Both figures are returned to the
 * caller, named, so no UI can mistake one for the other.
 *
 * WHY THIS FILE NEVER CREATES AN ORDER, CYCLE, RESERVATION OR SHIPMENT
 * ────────────────────────────────────────────────────────────────────
 * Phase 4 is payment activation and nothing else. The whole repository's
 * fulfillment/inventory authority (`lib/inventory.ts`,
 * `lib/order-fulfillment.ts`, `jobs/velrepeat-scheduler.ts`) is untouched, and
 * the V1 scheduler cannot see a `draft` plan
 * (`idx_velrepeat_plans_due ... WHERE status = 'active'`), so an activated plan
 * is not fulfilled by anything until a later phase owns that.
 *
 * ONE LOCK ORDER
 * ──────────────
 * `lib/order-lock.ts` fixes the ORDER row as the serialisation point for every
 * order writer. The plan is the equivalent subject here, so every transaction
 * in this file takes `velrepeat_plans ... FOR UPDATE` FIRST and the payment
 * row second — the same discipline, applied to the plan's own subtree.
 */
import type { Express, Request, Response } from "express";
import type { PoolClient } from "pg";
import Stripe from "stripe";

import { query, withTransaction } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { calculateNextRunAt, type FrequencyType } from "../jobs/velrepeat-scheduler.js";
import {
  isNegative,
  isZero,
  makeRational,
  multiply,
  parseDecimal,
  roundHalfUp,
  toMoneyString,
} from "../lib/money.js";
import {
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  assertPaymentMethodUsable,
  normalizePaymentMethod,
  stripePaymentMethodType,
  type PaymentMethodId,
} from "../lib/payment-config.js";
import {
  recordLatePaymentIncident,
  type LatePaymentReason,
} from "../lib/payment-incidents.js";
import { VELREPEAT_CURRENCY } from "../lib/velrepeat-pricing.js";
import {
  sessionConfirmsPayment,
  stripeServerClient,
} from "./stripe.js";

// ═══════════════════════════════════════════════════════════════════════════
// 1. Scope marker — how a V2 charge is told apart from a V1 order charge
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Written into Stripe metadata by this module and read back only by this
 * module. It is the discriminator that lets ONE webhook endpoint serve two
 * payment subjects: an event carrying this marker is a plan charge, and one
 * without it is an order charge and follows the pre-existing path untouched.
 *
 * The value is a constant in THIS file. It is never read from a request body,
 * so a client cannot make its own event look like a plan payment — and
 * conversely, a client cannot make a plan payment look like an order one,
 * because the marker exists only in metadata this backend wrote.
 */
export const VELREPEAT_V2_PAYMENT_SCOPE = "velrepeat_v2_plan";

/** The Stripe event types this module acts on. Anything else is not ours. */
const V2_EVENT_TYPES = new Set<string>([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
]);

function eventMetadata(object: unknown): Record<string, unknown> | null {
  const metadata = (object as { metadata?: unknown } | null)?.metadata;
  if (typeof metadata !== "object" || metadata === null) return null;
  return metadata as Record<string, unknown>;
}

/**
 * Is this Stripe event a VelRepeat V2 plan payment?
 *
 * A predicate over (event type, our own scope marker) only — it reads nothing
 * the customer or a browser controls, and it is total: an event that is not
 * ours is simply not ours.
 */
export function isVelRepeatV2PaymentEvent(event: Stripe.Event): boolean {
  if (!V2_EVENT_TYPES.has(event.type)) return false;
  const metadata = eventMetadata(event.data?.object);
  return metadata?.scope === VELREPEAT_V2_PAYMENT_SCOPE;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Refusals — one typed error, the same shape Phase 3 uses
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every refusal this module can make. A typed error carries the HTTP status
 * and the API code, so the purchase path is testable without an HTTP server
 * and ONE refusal aborts everything the caller was doing.
 */
export class RepeatPlanPaymentError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RepeatPlanPaymentError";
    this.status = status;
    this.code = code;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Exact money — the commitment total → Stripe minor units
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert a snapshot total into Stripe minor units, exactly.
 *
 * G2 is honoured literally: the value is parsed as a bigint-rational decimal
 * and rounded ONCE to two decimals (half-up, the same rule `money.ts` uses
 * everywhere). `roundHalfUp(value, 2)` returns the amount already scaled by
 * 10^2 — which is precisely Stripe's minor unit for a two-decimal currency like
 * THB — so no second rounding and no float touches it. A commitment can
 * therefore never be charged one satang away from what the customer was shown.
 *
 * `null` means "not payable" — a malformed, zero or negative total. The caller
 * must fail closed on it rather than charge something.
 */
export function planTotalToStripeMinor(total: unknown): number | null {
  let value;
  try {
    value = parseDecimal(typeof total === "string" ? total : String(total));
  } catch {
    return null;
  }
  if (isNegative(value) || isZero(value)) return null;
  const minor = roundHalfUp(value, 2);
  // Stripe accepts integers; anything beyond MAX_SAFE_INTEGER is not a value a
  // checkout session can carry, and Phase 3 already refuses such commitments.
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. The immutable commitment — what the customer must pay
// ═══════════════════════════════════════════════════════════════════════════

export interface PlanCommitment {
  readonly planId: string;
  readonly userId: string;
  readonly status: string;
  readonly frequencyType: FrequencyType;
  readonly intervalValue: number;
  readonly currency: string;
  readonly snapshotId: string;
  /** The price of ONE delivery cycle. Reported, never charged. */
  readonly cyclePrice: string | null;
  /** `cycle_price × commitment_cycles` — the authoritative prepaid total. */
  readonly totalAmount: string;
  readonly amountMinor: number;
}

/**
 * THE COMMITMENT COVERAGE GUARD — the one check that stops this phase from
 * charging the wrong amount.
 *
 * WHAT IT CATCHES
 * The canonical pricing pipeline ends `… → Cycle Price → Total Prepaid`
 * (`velrepeat-v2-contract-2026-09-30.md:75`), and the plan total is
 * "`cycle price × commitment`" (decision closure `:130`). The Phase 3 engine
 * currently freezes only the CYCLE PRICE: `total_amount` is the composition's
 * price after the commitment rules, with NO multiplication by
 * `commitment_cycles`. For a 100 THB cycle at a 10% commitment discount over 4
 * cycles it writes `total_amount = 90.00` where the commitment the customer
 * bought is `360.00`.
 *
 * Charging that snapshot as-is would take a quarter of the money the customer
 * agreed to pay — and it would be silent, because the number on the row is a
 * perfectly well-formed snapshot total.
 *
 * WHY A GUARD AND NOT A SILENT FIX
 * The formula was not in doubt; the engine that produces `total_amount` was
 * wrong, and changing the money an approved, CI-verified phase produces was an
 * owner decision. That decision has now been taken (migration 052 + the pricing
 * engine), and the snapshot carries `cycle_price` and the commitment
 * `total_amount` separately — so the writer now satisfies this guard by
 * construction. The guard REMAINS as the settlement-time proof that the row
 * this process is about to charge really does cover every cycle, whatever
 * wrote it: a corrupt or hand-edited snapshot is still refused. Single-cycle
 * commitments are unaffected — the guard is exactly satisfied when
 * `commitment_cycles = 1`.
 *
 * The arithmetic is exact: Phase 3 stored the UNROUNDED per-cycle final as
 * `metadata.final_price_exact`, so the expected total is that value times the
 * cycle count with ONE rounding at the end (G2) — no float, no drift.
 */
export function assertCommitmentCoversEveryCycle(snapshot: {
  readonly totalAmount: string;
  readonly commitmentCycles: number;
  readonly finalPriceExact: string | null;
}): void {
  const cycles = snapshot.commitmentCycles;
  if (!Number.isInteger(cycles) || cycles <= 0) {
    throw new RepeatPlanPaymentError(
      409,
      "COMMITMENT_TOTAL_UNVERIFIED",
      "This plan's commitment size cannot be verified, so it cannot be paid.",
    );
  }
  if (snapshot.finalPriceExact === null) {
    throw new RepeatPlanPaymentError(
      409,
      "COMMITMENT_TOTAL_UNVERIFIED",
      "This plan's committed total cannot be verified, so it cannot be paid.",
    );
  }
  const perCycle = parseDecimal(snapshot.finalPriceExact);
  const expectedTotal = toMoneyString(multiply(perCycle, makeRational(BigInt(cycles), 1n)));
  if (expectedTotal !== toMoneyString(parseDecimal(snapshot.totalAmount))) {
    throw new RepeatPlanPaymentError(
      409,
      "COMMITMENT_TOTAL_UNVERIFIED",
      "This plan's committed total does not cover every prepaid cycle, so it cannot be paid.",
    );
  }
}

/** Read the Phase 3 snapshot fields the coverage guard needs. */
export async function readCommitmentSnapshot(
  client: PoolClient,
  planId: string,
): Promise<{
  id: string;
  currency: string;
  cyclePrice: string | null;
  totalAmount: string;
  commitmentCycles: number;
  finalPriceExact: string | null;
}> {
  const result = await client.query(
    `SELECT id, currency, cycle_price, total_amount, commitment_cycles, metadata
       FROM velrepeat_pricing_snapshots
      WHERE plan_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [planId],
  );
  const row = result.rows[0];
  if (!row) return null as never;
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const exact = metadata.final_price_exact;
  return {
    id: String(row.id),
    currency: String(row.currency ?? "").toUpperCase(),
    cyclePrice: row.cycle_price == null ? null : String(row.cycle_price),
    totalAmount: String(row.total_amount),
    commitmentCycles: Number(row.commitment_cycles),
    finalPriceExact: typeof exact === "string" && exact.trim() !== "" ? exact.trim() : null,
  };
}

/**
 * Load the plan and the ONE amount it may ever be charged, under the plan
 * row lock.
 *
 * `expectedUserId` is checked IMMEDIATELY after the plan is read and BEFORE the
 * snapshot is read or any pricing guard runs. That ordering is deliberate: a
 * pricing refusal (no snapshot, wrong currency, a commitment that does not
 * cover its cycles) is a fact about ANOTHER CUSTOMER'S PLAN, so answering 403
 * first is what keeps it from becoming an oracle.
 *
 * The amount comes from the newest pricing snapshot and from nowhere else:
 * the client's body, the plan's own columns and the live catalog are all
 * irrelevant to it. A snapshot whose currency is not the committed currency, or
 * whose total cannot be represented in minor units, is refused — the same
 * fail-closed posture Phase 3 takes when pricing is unusable.
 */
export async function loadPayableCommitment(
  client: PoolClient,
  planId: string,
  expectedUserId?: string,
): Promise<PlanCommitment> {
  const planResult = await client.query(
    `SELECT id, user_id, status, frequency_type, interval_value, currency
       FROM velrepeat_plans WHERE id = $1 FOR UPDATE`,
    [planId],
  );
  const plan = planResult.rows[0];
  if (!plan) {
    throw new RepeatPlanPaymentError(404, "PLAN_NOT_FOUND", "Plan not found");
  }
  // Ownership FIRST — before any pricing state is read, let alone refused.
  if (expectedUserId !== undefined && String(plan.user_id) !== expectedUserId) {
    throw new RepeatPlanPaymentError(403, "FORBIDDEN", "This plan is not yours.");
  }

  // The newest snapshot is the commitment of record. Phase 3 writes exactly
  // one per plan; ordering is defensive so a future re-quote cannot silently
  // change what an existing draft is charged.
  const snapshot = await readCommitmentSnapshot(client, planId);
  if (!snapshot) {
    throw new RepeatPlanPaymentError(
      409,
      "PRICING_SNAPSHOT_MISSING",
      "This plan has no pricing snapshot and cannot be paid.",
    );
  }

  // REFUSE rather than charge a quarter of a commitment (see the guard's
  // documentation). This is the check that makes it impossible for the Phase 3
  // per-cycle snapshot to be charged as if it were the whole commitment.
  assertCommitmentCoversEveryCycle(snapshot);

  const snapshotCurrency = snapshot.currency;
  const planCurrency = String(plan.currency ?? "").toUpperCase();
  if (snapshotCurrency !== VELREPEAT_CURRENCY || planCurrency !== snapshotCurrency) {
    throw new RepeatPlanPaymentError(
      409,
      "PRICING_CURRENCY_MISMATCH",
      "This plan's committed currency cannot be charged.",
    );
  }

  const amountMinor = planTotalToStripeMinor(snapshot.totalAmount);
  if (amountMinor === null) {
    throw new RepeatPlanPaymentError(
      409,
      "PRICING_AMOUNT_UNUSABLE",
      "This plan's committed total cannot be charged.",
    );
  }

  return {
    planId: String(plan.id),
    userId: String(plan.user_id),
    status: String(plan.status),
    frequencyType: String(plan.frequency_type) as FrequencyType,
    intervalValue: Number(plan.interval_value),
    currency: snapshotCurrency,
    snapshotId: snapshot.id,
    cyclePrice: snapshot.cyclePrice,
    totalAmount: snapshot.totalAmount,
    amountMinor,
  };
}

/**
 * The ONE rule a plan must still be a `draft` to be charged, expressed as a
 * refusal so it cannot be forgotten at a call site.
 */
export function assertPayableDraft(commitment: PlanCommitment): void {
  if (commitment.status !== "draft") {
    throw new RepeatPlanPaymentError(
      409,
      "PLAN_NOT_PAYABLE",
      "This plan is not awaiting payment.",
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Method handling — Card + PromptPay only, never COD
// ═══════════════════════════════════════════════════════════════════════════

/** The prepaid rails this phase supports. COD is deliberately not one of them. */
export const V2_PREPAID_METHODS: readonly PaymentMethodId[] = [
  PAYMENT_METHOD.CARD,
  PAYMENT_METHOD.PROMPTPAY,
];

/**
 * Parse and gate the requested method.
 *
 * COD is refused HERE, by name, before the generic guard runs — so a V2 plan
 * can never reach a COD pseudo-payment, and so the answer says why rather than
 * leaking a provider error. `velrepeat_plans.payment_method` also carries a
 * schema default of `'cod'`, which is exactly why §8 refuses to activate a plan
 * whose recorded method is not a real Stripe rail.
 */
export function parsePrepaidMethod(raw: unknown): PaymentMethodId {
  const method = normalizePaymentMethod(raw ?? PAYMENT_METHOD.CARD);
  if (!method) {
    throw new RepeatPlanPaymentError(
      400,
      "INVALID_PAYMENT_METHOD",
      "Unsupported payment method.",
    );
  }
  if (!V2_PREPAID_METHODS.includes(method)) {
    throw new RepeatPlanPaymentError(
      400,
      "UNSUPPORTED_PAYMENT_METHOD",
      "A prepaid repeat plan can only be paid by card or PromptPay.",
    );
  }
  const gate = assertPaymentMethodUsable(method);
  if (!gate.ok) {
    throw new RepeatPlanPaymentError(gate.status, gate.code, gate.message);
  }
  return method;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Payment creation — one Checkout Session for the whole commitment
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The server-generated metadata carried by the Checkout Session AND its
 * PaymentIntent.
 *
 * One definition, used by both, so the two objects can never disagree about
 * which plan they belong to. Every value is either a constant or something
 * this backend resolved from its own rows — the plan id from the URL, the user
 * id from the verified session, the method from the gate above. Nothing is
 * read from the request body, and no money is described: the amount is
 * re-derived from the immutable snapshot at settlement, so a metadata value
 * could not move money even if it were tampered with.
 */
export function buildPlanStripeMetadata(input: {
  readonly planId: string;
  readonly userId: string;
  readonly method: PaymentMethodId;
}): Stripe.MetadataParam {
  return {
    scope: VELREPEAT_V2_PAYMENT_SCOPE,
    planId: input.planId,
    userId: input.userId,
    method: input.method,
    provider: "stripe",
    mode: "test",
  };
}

/** The single line item: the commitment itself, never a per-cycle amount. */
export function buildPlanLineItem(opts: {
  readonly amountMinor: number;
  readonly currency: string;
  readonly name: string;
}): Stripe.Checkout.SessionCreateParams.LineItem {
  return {
    quantity: 1,
    price_data: {
      currency: opts.currency.toLowerCase(),
      unit_amount: opts.amountMinor,
      product_data: {
        name: opts.name.slice(0, 200),
        description: "Prepaid repeat plan commitment",
      },
    },
  };
}

interface ActiveAttempt {
  readonly id: string;
  readonly providerCheckoutSessionId: string | null;
  readonly providerPaymentId: string | null;
  readonly method: string | null;
  readonly status: string;
}

/** The live attempt for this plan, if one exists. */
async function loadActiveAttempt(
  client: PoolClient,
  planId: string,
): Promise<ActiveAttempt | null> {
  const result = await client.query(
    `SELECT id, provider_checkout_session_id, provider_payment_id, method, status
       FROM payments
      WHERE plan_id = $1
        AND provider = 'stripe'
        AND status IN ('pending', 'requires_action')
      ORDER BY created_at DESC
      LIMIT 1`,
    [planId],
  );
  const row = result.rows[0];
  return row
    ? {
        id: String(row.id),
        providerCheckoutSessionId: row.provider_checkout_session_id ?? null,
        providerPaymentId: row.provider_payment_id ?? null,
        method: row.method ?? null,
        status: String(row.status),
      }
    : null;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export interface PlanPaymentSession {
  readonly planId: string;
  readonly paymentId: string;
  readonly sessionId: string;
  readonly url: string | null;
  readonly method: PaymentMethodId;
  readonly currency: string;
  /** The discounted price of ONE delivery cycle. Reported for display only. */
  readonly cyclePrice: string | null;
  /** THE amount charged: the whole prepaid commitment. */
  readonly amount: string;
  readonly amountMinor: number;
  readonly status: string;
  readonly reused: boolean;
}

/**
 * Open (or hand back) the prepaid Checkout Session for a draft plan.
 *
 * ORDER OF OPERATIONS — validation under the plan lock, then the provider call,
 * then the write. A database lock is never held across a network call, and a
 * provider session is never created for a plan this system refused.
 *
 * IDEMPOTENCY IS DATABASE-BACKED, exactly like the order path:
 *   • `checkout_requests` (user, scope, request key) replays a stored response;
 *   • `idx_payments_one_active_stripe_plan` allows at most ONE live Stripe
 *     attempt per PLAN, so a double-click, a client retry or two concurrent
 *     requests cannot open two sessions — and therefore cannot create two
 *     PaymentIntents.
 * A live session for the SAME method is reused; one for a DIFFERENT method is
 * expired and replaced, never handed back, because returning it would charge a
 * rail the customer did not choose.
 */
async function openPlanPaymentSession(
  userId: string,
  planId: string,
  method: PaymentMethodId,
  requestKey: string | null,
): Promise<PlanPaymentSession> {
  const stripe = stripeServerClient();
  if (!stripe) {
    throw new RepeatPlanPaymentError(
      503,
      "STRIPE_NOT_CONFIGURED",
      "Card and PromptPay payments are not available right now.",
    );
  }

  // ── Validation under the plan lock ───────────────────────────────────────
  const existing = await withTransaction(async (client) => {
    // Ownership is settled inside the loader, before any pricing state is read.
    const commitment = await loadPayableCommitment(client, planId, userId);
    assertPayableDraft(commitment);

    const paid = await client.query(
      `SELECT id FROM payments WHERE plan_id = $1 AND status = 'paid' LIMIT 1`,
      [planId],
    );
    if (paid.rows.length > 0) {
      throw new RepeatPlanPaymentError(
        409,
        "PLAN_ALREADY_PAID",
        "This plan has already been paid.",
      );
    }

    const attempt = await loadActiveAttempt(client, planId);
    return { commitment, attempt };
  });

  const { commitment, attempt } = existing;
  const amountMinor = commitment.amountMinor;

  // ── Reuse an open session for the SAME method ───────────────────────────
  if (attempt && attempt.providerCheckoutSessionId) {
    try {
      const open = await stripe.checkout.sessions.retrieve(attempt.providerCheckoutSessionId);
      if (open.status === "open" && open.url && open.metadata?.method === method) {
        return {
          planId,
          paymentId: attempt.id,
          sessionId: open.id,
          url: open.url,
          method,
          currency: commitment.currency,
          cyclePrice: commitment.cyclePrice,
          amount: commitment.totalAmount,
          amountMinor,
          status: attempt.status,
          reused: true,
        };
      }
      if (open.status === "open") {
        await stripe.checkout.sessions.expire(open.id).catch(() => {
          /* best effort: the row is retired below either way */
        });
      }
    } catch (err) {
      console.warn(
        `[velrepeat-v2] could not retrieve session ${attempt.providerCheckoutSessionId}:`,
        err instanceof Error ? err.message : "unknown error",
      );
    }
    // Terminal for that attempt — clear it so a fresh session can take the slot.
    await query(
      `UPDATE payments
          SET status = 'failed',
              failure_code = 'SESSION_NOT_REUSABLE',
              failure_message = 'The previous checkout session is no longer open.',
              updated_at = NOW()
        WHERE id = $1 AND status IN ('pending', 'requires_action')`,
      [attempt.id],
    );
  }

  // ── Create the session ──────────────────────────────────────────────────
  // No `allow_promotion_codes`: a discount applied by Stripe would make the
  // captured amount differ from the immutable snapshot, which is precisely the
  // mismatch settlement refuses. The snapshot is the only price that exists.
  const frontendUrl = process.env.VITE_VELSHOP_URL || "https://velshop.vercel.app";
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: [stripePaymentMethodType(method)!],
    line_items: [
      buildPlanLineItem({
        amountMinor,
        currency: commitment.currency,
        name: "VelRepeat prepaid plan",
      }),
    ],
    success_url: `${frontendUrl}/velrepeat?velrepeat_v2_payment=success&plan=${planId}`,
    cancel_url: `${frontendUrl}/velrepeat?velrepeat_v2_payment=cancel&plan=${planId}`,
    metadata: buildPlanStripeMetadata({ planId, userId, method }),
    // The PaymentIntent carries the same pointer, so `payment_intent.*` events
    // resolve to the plan without a session lookup.
    payment_intent_data: {
      metadata: buildPlanStripeMetadata({ planId, userId, method }),
    },
  });

  const intentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  // ── Record the attempt (race-safe) ──────────────────────────────────────
  let paymentId: string;
  try {
    const inserted = await query(
      `INSERT INTO payments
         (plan_id, provider, method, status, amount, currency,
          provider_checkout_session_id, provider_payment_id, metadata)
       VALUES ($1, 'stripe', $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id`,
      [
        planId,
        method,
        PAYMENT_STATUS.REQUIRES_ACTION,
        Number(commitment.totalAmount),
        commitment.currency,
        session.id,
        intentId,
        JSON.stringify({
          stripeMode: "test",
          method,
          scope: VELREPEAT_V2_PAYMENT_SCOPE,
          snapshot_id: commitment.snapshotId,
          commitment_cycles: null,
          requestKey,
        }),
      ],
    );
    paymentId = String(inserted.rows[0]?.id);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // A concurrent request won the active slot. Hand back ITS session when it
    // is open and was opened for this method; never fabricate a success.
    const winner = await query(
      `SELECT id, provider_checkout_session_id
         FROM payments
        WHERE plan_id = $1
          AND provider = 'stripe'
          AND status IN ('pending', 'requires_action')
        ORDER BY created_at DESC
        LIMIT 1`,
      [planId],
    );
    const winnerSessionId = winner.rows[0]?.provider_checkout_session_id ?? null;
    if (winnerSessionId && winnerSessionId !== session.id) {
      try {
        const winnerSession = await stripe.checkout.sessions.retrieve(winnerSessionId);
        if (
          winnerSession.status === "open" &&
          winnerSession.url &&
          winnerSession.metadata?.method === method
        ) {
          await stripe.checkout.sessions.expire(session.id).catch(() => {
            /* best effort */
          });
          return {
            planId,
            paymentId: String(winner.rows[0].id),
            sessionId: winnerSession.id,
            url: winnerSession.url,
            method,
            currency: commitment.currency,
            cyclePrice: commitment.cyclePrice,
            amount: commitment.totalAmount,
            amountMinor,
            status: PAYMENT_STATUS.REQUIRES_ACTION,
            reused: true,
          };
        }
      } catch {
        /* fall through to the conflict below */
      }
    }
    await stripe.checkout.sessions.expire(session.id).catch(() => {
      /* best effort */
    });
    throw new RepeatPlanPaymentError(
      409,
      "DUPLICATE_PAYMENT_IN_PROGRESS",
      "Your payment is being prepared. Please try again.",
    );
  }

  console.log(
    `[velrepeat-v2] prepaid session ${session.id} opened for plan ${planId} ` +
      `(${method}, ${commitment.currency} ${commitment.totalAmount}, snapshot ${commitment.snapshotId}, test mode)`,
  );

  return {
    planId,
    paymentId,
    sessionId: session.id,
    url: session.url,
    method,
    currency: commitment.currency,
    cyclePrice: commitment.cyclePrice,
    amount: commitment.totalAmount,
    amountMinor,
    status: PAYMENT_STATUS.REQUIRES_ACTION,
    reused: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Settlement — the webhook is the only writer of `paid` and of `active`
// ═══════════════════════════════════════════════════════════════════════════

/** What a Stripe event asserts about the charge, reduced to what we verify. */
export interface PlanChargeEvent {
  readonly eventId: string;
  readonly outcome: "succeeded" | "failed" | "canceled" | "awaiting_payment";
  readonly planId: string;
  readonly sessionId: string | null;
  readonly intentId: string | null;
  /** Stripe's own amount in minor units, or null when the event carries none. */
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  const nested = (value as { id?: unknown } | null)?.id;
  return typeof nested === "string" && nested ? nested : null;
}

/**
 * The amount Stripe says it took, in minor units, from whichever field the
 * object carries.
 *
 * `amount_received` (a PaymentIntent) is the money actually captured and
 * outranks the authorized `amount`; a Checkout Session reports `amount_total`.
 * Whatever the field, it is STRIPE's number — it exists to be compared against
 * our snapshot, and it is never used as the price.
 */
function resolveAmountMinor(object: {
  amount_received?: unknown;
  amount_total?: unknown;
  amount?: unknown;
}): number | null {
  for (const candidate of [object.amount_received, object.amount_total, object.amount]) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return null;
}

/**
 * Reduce a Stripe event to the plan charge it asserts.
 *
 * The two deliberate rules:
 *   • `checkout.session.completed` with `payment_status !== "paid"` is NOT a
 *     settlement. With PromptPay Stripe completes the session while the money
 *     is still on its way; treating the event as proof of payment would
 *     fabricate a success. It becomes `awaiting_payment` instead, and the plan
 *     stays `draft`.
 *   • the amount and currency are taken from STRIPE's own fields, because the
 *     point of the comparison is to check Stripe against our snapshot.
 */
export function readPlanChargeEvent(event: Stripe.Event): PlanChargeEvent | null {
  const metadata = eventMetadata(event.data?.object);
  const planId = metadata?.planId;
  if (!isUuid(planId)) return null;

  const object = event.data.object as {
    payment_intent?: unknown;
    amount_total?: unknown;
    amount_received?: unknown;
    amount?: unknown;
    currency?: unknown;
    payment_status?: string;
    last_payment_error?: { code?: string; message?: string };
  };

  // WHICH identifier the object carries depends on the object: a Checkout
  // Session IS the session and points at its PaymentIntent, while a
  // PaymentIntent IS the intent and carries no session. Reading the intent id
  // from `payment_intent` on a `payment_intent.*` event would yield null and
  // the attempt could never be resolved — so the event would be acknowledged
  // and the plan would silently never activate.
  const isCheckoutEvent = event.type.startsWith("checkout.");
  const sessionId = isCheckoutEvent ? (idOf(object) ?? null) : null;
  const intentId = isCheckoutEvent ? idOf(object.payment_intent) : idOf(object);
  const currency = typeof object.currency === "string" ? object.currency.toUpperCase() : null;
  const failureCode = object.last_payment_error?.code ?? null;
  const failureMessage = object.last_payment_error?.message ?? null;

  switch (event.type) {
    case "checkout.session.completed": {
      if (!sessionConfirmsPayment(object as { payment_status?: string | null })) {
        return {
          eventId: event.id,
          outcome: "awaiting_payment",
          planId,
          sessionId,
          intentId,
          amountMinor: null,
          currency,
          failureCode: null,
          failureMessage: null,
        };
      }
      return {
        eventId: event.id,
        outcome: "succeeded",
        planId,
        sessionId,
        intentId,
        amountMinor: resolveAmountMinor(object),
        currency,
        failureCode: null,
        failureMessage: null,
      };
    }
    case "checkout.session.async_payment_succeeded":
    case "payment_intent.succeeded":
      return {
        eventId: event.id,
        outcome: "succeeded",
        planId,
        sessionId,
        intentId,
        amountMinor: resolveAmountMinor(object),
        currency,
        failureCode: null,
        failureMessage: null,
      };
    case "checkout.session.async_payment_failed":
    case "payment_intent.payment_failed":
      return {
        eventId: event.id,
        outcome: "failed",
        planId,
        sessionId,
        intentId,
        amountMinor: null,
        currency,
        failureCode: failureCode ?? "PAYMENT_FAILED",
        failureMessage: failureMessage ?? "The payment did not complete.",
      };
    case "checkout.session.expired":
    case "payment_intent.canceled":
      return {
        eventId: event.id,
        outcome: "canceled",
        planId,
        sessionId,
        intentId,
        amountMinor: null,
        currency,
        failureCode: null,
        failureMessage: null,
      };
    default:
      return null;
  }
}

/** The payment row this event is about — scoped to the plan, never to an order. */
async function resolvePlanAttempt(
  client: PoolClient,
  planId: string,
  charge: PlanChargeEvent,
): Promise<{ id: string; method: string | null; provider: string; amount: string; currency: string; status: string } | null> {
  if (charge.sessionId || charge.intentId) {
    const exact = await client.query(
      `SELECT id, method, provider, amount, currency, status
         FROM payments
        WHERE plan_id = $1
          AND provider = 'stripe'
          AND (provider_checkout_session_id = $2 OR provider_payment_id = $3)
        ORDER BY created_at DESC
        LIMIT 1`,
      [planId, charge.sessionId, charge.intentId],
    );
    if (exact.rows[0]) {
      const row = exact.rows[0];
      return {
        id: String(row.id),
        method: row.method ?? null,
        provider: String(row.provider),
        amount: String(row.amount),
        currency: String(row.currency),
        status: String(row.status),
      };
    }
  }
  return null;
}

export interface SettlementResult {
  readonly outcome:
    | "activated"
    | "already_active"
    | "awaiting_payment"
    | "attempt_not_recorded"
    | "attempt_failed"
    | "attempt_canceled"
    | "rejected_amount"
    | "rejected_currency"
    | "rejected_method"
    | "rejected_state";
  readonly paymentId: string | null;
  readonly planId: string | null;
}

/** Is this a real Stripe rail we may record on the plan? */
function isPrepaidStripeMethod(method: string | null): method is PaymentMethodId {
  return method === PAYMENT_METHOD.CARD || method === PAYMENT_METHOD.PROMPTPAY;
}

/**
 * Apply one verified Stripe event to one plan, atomically.
 *
 * EVERY invariant this phase promises is decided here, inside ONE transaction:
 *   • the money is recorded in the canonical `payments` row, and only the
 *     attempt THIS event names is touched, so a late failure cannot take down
 *     a different, still-open session;
 *   • the plan moves `draft → active` only when the payment row reads `paid`,
 *     the amount equals the immutable snapshot, the currency is the committed
 *     one, and the recorded method is a real Stripe rail — never the schema's
 *     default `'cod'`;
 *   • the transition is `WHERE status = 'draft'`, so a redelivery, a
 *     concurrent delivery or a client retry activates exactly once;
 *   • `started_at` and `next_run_at` are re-anchored to the settlement instant
 *     using the SAME `calculateNextRunAt` V1 uses, so the draft's creation
 *     timestamp cannot decide when the first cycle is due;
 *   • nothing here creates an order, a cycle, a reservation, a shipment or a
 *     fulfillment row. If any of those existed, this transaction would be
 *     wrong — they belong to Phase 5/6.
 *
 * Anything unverifiable is refused and recorded for an operator instead. The
 * money is still written on the payment row — that is what makes it refundable
 * — but the plan is never activated on a doubt.
 */
export async function settlePlanCharge(charge: PlanChargeEvent): Promise<SettlementResult> {
  return withTransaction(async (client) => {
    // PLAN ROW FIRST — the plan is this path's serialisation point, mirroring
    // the order-lock contract for orders (see lib/order-lock.ts).
    const planResult = await client.query(
      `SELECT id, status, frequency_type, interval_value FROM velrepeat_plans
        WHERE id = $1 FOR UPDATE`,
      [charge.planId],
    );
    const plan = planResult.rows[0];
    if (!plan) {
      console.warn(
        `[velrepeat-v2] ${charge.eventId} names plan ${charge.planId}, which does not exist — ignored`,
      );
      return { outcome: "attempt_not_recorded", paymentId: null, planId: null };
    }

    const attempt = await resolvePlanAttempt(client, charge.planId, charge);
    if (!attempt) {
      // A verified event for a charge this system has no row for. Nothing is
      // invented and nothing is activated — a redelivery cannot change that —
      // but it IS money this system cannot account for, so it becomes a durable
      // operator incident (deduplicated, so any number of redeliveries leaves
      // exactly one row) rather than a Render log line and nothing else.
      await recordLatePaymentIncident(client, {
        orderId: null,
        planId: charge.planId,
        paymentId: null,
        providerPaymentIntentId: charge.intentId,
        checkoutSessionId: charge.sessionId,
        eventId: charge.eventId,
        reason: "PLAN_ATTEMPT_NOT_RECORDED",
        orderStatus: String(plan.status),
        amount: null,
        currency: charge.currency,
      });
      console.warn(
        `[velrepeat-v2] ${charge.eventId} has no recorded payment attempt for plan ${charge.planId} — recorded for manual review`,
      );
      return { outcome: "attempt_not_recorded", paymentId: null, planId: charge.planId };
    }

    // ── Non-settlement outcomes: the attempt moves, the plan never does ─────
    if (charge.outcome === "awaiting_payment") {
      await client.query(
        `UPDATE payments SET status = 'requires_action', updated_at = NOW()
          WHERE id = $1 AND status NOT IN ('paid', 'failed', 'cancelled')`,
        [attempt.id],
      );
      return { outcome: "awaiting_payment", paymentId: attempt.id, planId: charge.planId };
    }

    if (charge.outcome === "failed" || charge.outcome === "canceled") {
      const terminal = charge.outcome === "failed" ? "failed" : "cancelled";
      await client.query(
        `UPDATE payments
            SET status = $2,
                failure_code = $3,
                failure_message = $4,
                updated_at = NOW()
          WHERE id = $1 AND status NOT IN ('paid', 'failed', 'cancelled')`,
        [
          attempt.id,
          terminal,
          (charge.failureCode ?? "PAYMENT_CANCELED").slice(0, 120),
          (charge.failureMessage ?? "The payment did not complete.").slice(0, 500),
        ],
      );
      // The plan stays `draft`: an abandoned attempt is not a plan transition.
      return {
        outcome: charge.outcome === "failed" ? "attempt_failed" : "attempt_canceled",
        paymentId: attempt.id,
        planId: charge.planId,
      };
    }

    // ── Settlement ─────────────────────────────────────────────────────────
    const snapshot = await readCommitmentSnapshot(client, charge.planId);
    if (!snapshot) {
      throw new RepeatPlanPaymentError(
        409,
        "PRICING_SNAPSHOT_MISSING",
        "This plan has no pricing snapshot and cannot be settled.",
      );
    }
    // The SAME coverage guard the creation path runs. A settlement must not be
    // able to activate a plan whose committed total does not cover every cycle
    // just because the row was written by something other than this endpoint.
    // It is caught here, refused, and recorded — never thrown, because Stripe
    // cannot fix bad data by redelivering.
    let coverageRefusal: string | null = null;
    try {
      assertCommitmentCoversEveryCycle(snapshot);
    } catch (error) {
      if (!(error instanceof RepeatPlanPaymentError)) throw error;
      coverageRefusal = error.code;
    }
    const expectedMinor = planTotalToStripeMinor(snapshot.totalAmount);
    const snapshotCurrency = snapshot.currency;

    const amountMatches = expectedMinor !== null && charge.amountMinor === expectedMinor;
    const currencyMatches =
      charge.currency !== null && snapshotCurrency === VELREPEAT_CURRENCY && charge.currency === snapshotCurrency;

    // Record the money FIRST, in every case — a captured charge is a fact, and
    // the row is what makes it refundable and visible to an operator. Whether
    // the plan may then activate is decided separately.
    await client.query(
      `UPDATE payments
          SET status = 'paid',
              paid_at = COALESCE(paid_at, NOW()),
              provider_payment_id = COALESCE($2, provider_payment_id),
              failure_code = NULL,
              failure_message = NULL,
              updated_at = NOW()
        WHERE id = $1 AND status NOT IN ('failed', 'cancelled')`,
      [attempt.id, charge.intentId ?? charge.sessionId],
    );

    const refusal = await refuseUnverifiedCharge(client, {
      charge,
      attempt,
      planStatus: String(plan.status),
      snapshotId: snapshot.id,
      amountMatches,
      currencyMatches,
      coverageRefusal,
    });
    if (refusal) return refusal;

    // ── The one transition this phase owns ──────────────────────────────────
    if (String(plan.status) === "active") {
      // A duplicate delivery of a charge already settled. Nothing is written a
      // second time and no second activation event is produced.
      return { outcome: "already_active", paymentId: attempt.id, planId: charge.planId };
    }
    if (String(plan.status) !== "draft") {
      await recordLatePaymentIncident(client, {
        orderId: null,
        planId: charge.planId,
        paymentId: attempt.id,
        providerPaymentIntentId: charge.intentId,
        checkoutSessionId: charge.sessionId,
        eventId: charge.eventId,
        reason: "PLAN_NOT_ACTIVATABLE",
        orderStatus: String(plan.status),
        amount: attempt.amount,
        currency: attempt.currency,
      });
      return { outcome: "rejected_state", paymentId: attempt.id, planId: charge.planId };
    }

    const startedAt = new Date();
    const nextRunAt = calculateNextRunAt(
      startedAt,
      String(plan.frequency_type) as FrequencyType,
      Number(plan.interval_value),
    );

    // `status = 'draft'` is the exactly-once guard. The payment row is
    // re-read here rather than trusted from the UPDATE above, so "plan active
    // but canonical payment not recorded" is not representable.
    const paymentState = await client.query(
      `SELECT status FROM payments WHERE id = $1`,
      [attempt.id],
    );
    if (paymentState.rows[0]?.status !== PAYMENT_STATUS.PAID) {
      return { outcome: "rejected_state", paymentId: attempt.id, planId: charge.planId };
    }

    const activated = await client.query(
      `UPDATE velrepeat_plans
          SET status = 'active',
              started_at = $2,
              next_run_at = $3,
              payment_method = $4,
              payment_method_ref = $5,
              updated_at = NOW()
        WHERE id = $1 AND status = 'draft'
        RETURNING id`,
      [
        charge.planId,
        startedAt.toISOString(),
        nextRunAt.toISOString(),
        attempt.method,
        charge.intentId ?? charge.sessionId,
      ],
    );
    if ((activated.rowCount ?? 0) === 0) {
      return { outcome: "already_active", paymentId: attempt.id, planId: charge.planId };
    }

    await client.query(
      `INSERT INTO velrepeat_events (plan_id, event_type, metadata)
       VALUES ($1, 'PLAN_ACTIVATED', $2::jsonb)`,
      [
        charge.planId,
        JSON.stringify({
          payment_id: attempt.id,
          provider: "stripe",
          mode: "test",
          method: attempt.method,
          provider_payment_id: charge.intentId ?? null,
          checkout_session_id: charge.sessionId,
          snapshot_id: snapshot.id,
          amount: attempt.amount,
          currency: attempt.currency,
          commitment_cycles: null,
          event_id: charge.eventId,
          started_at: startedAt.toISOString(),
          next_run_at: nextRunAt.toISOString(),
        }),
      ],
    );

    console.log(
      `[velrepeat-v2] plan ${charge.planId} activated by verified payment ${attempt.id} ` +
        `(${attempt.currency} ${attempt.amount}, ${attempt.method})`,
    );
    return { outcome: "activated", paymentId: attempt.id, planId: charge.planId };
  });
}

/**
 * The refusals that must never activate a plan, recorded for an operator
 * instead. Money is already on the payment row; nothing here invents a refund,
 * re-opens anything, or writes a plan transition.
 */
async function refuseUnverifiedCharge(
  client: PoolClient,
  input: {
    readonly charge: PlanChargeEvent;
    readonly attempt: { id: string; method: string | null; amount: string; currency: string };
    readonly planStatus: string;
    readonly snapshotId: string;
    readonly amountMatches: boolean;
    readonly currencyMatches: boolean;
    readonly coverageRefusal: string | null;
  },
): Promise<SettlementResult | null> {
  const { charge, attempt, planStatus, amountMatches, currencyMatches } = input;

  const reason: LatePaymentReason | null = input.coverageRefusal
    ? "PLAN_NOT_ACTIVATABLE"
    : !amountMatches
      ? "PLAN_AMOUNT_MISMATCH"
      : !currencyMatches
        ? "PLAN_CURRENCY_MISMATCH"
        : attempt.method === null || !isPrepaidStripeMethod(attempt.method)
          ? "PLAN_NOT_ACTIVATABLE"
          : null;

  if (!reason) return null;

  await recordLatePaymentIncident(client, {
    orderId: null,
    planId: charge.planId,
    paymentId: attempt.id,
    providerPaymentIntentId: charge.intentId,
    checkoutSessionId: charge.sessionId,
    eventId: charge.eventId,
    reason,
    orderStatus: planStatus,
    amount: attempt.amount,
    currency: attempt.currency,
  });

  console.error(
    `[velrepeat-v2] REFUSED activation of plan ${charge.planId}: ${reason} ` +
      `(payment ${attempt.id}, expected snapshot ${input.snapshotId}` +
      `${input.coverageRefusal ? `, ${input.coverageRefusal}` : ""}). ` +
      "Money recorded; manual review required.",
  );

  return {
    outcome: input.coverageRefusal
      ? "rejected_state"
      : !amountMatches
        ? "rejected_amount"
        : !currencyMatches
          ? "rejected_currency"
          : "rejected_method",
    paymentId: attempt.id,
    planId: charge.planId,
  };
}

/**
 * Dispatch one verified Stripe event to the plan path.
 *
 * Returns `true` when the event belonged to this module (whether it settled,
 * was refused, or was deliberately ignored), so the caller knows not to fall
 * through to the order logic. Everything else is the order path's business.
 */
export async function handleVelRepeatV2PaymentEvent(event: Stripe.Event): Promise<boolean> {
  if (!isVelRepeatV2PaymentEvent(event)) return false;

  const charge = readPlanChargeEvent(event);
  if (!charge) {
    // Our marker with an unusable plan reference. Acknowledged without acting:
    // redelivering it cannot make a malformed identifier valid, and throwing
    // would make Stripe retry forever.
    console.warn(
      `[velrepeat-v2] ${event.id} (${event.type}) carries our scope but no usable plan reference — ignored`,
    );
    return true;
  }

  const result = await settlePlanCharge(charge);
  if (
    result.outcome === "rejected_amount" ||
    result.outcome === "rejected_currency" ||
    result.outcome === "rejected_method" ||
    result.outcome === "rejected_state"
  ) {
    // Acknowledged, NOT settled: the payment event itself was processed
    // correctly, and refusing activation is the decision. Stripe must not
    // redeliver a verified charge because the backend declined to honour it.
    return true;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Routes — the minimum the frontend needs, and nothing that activates
// ═══════════════════════════════════════════════════════════════════════════

/** Map a refusal onto the repository's canonical error envelope. */
function fail(res: Response, error: unknown): void {
  if (error instanceof RepeatPlanPaymentError) {
    res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  console.error(
    "[velrepeat-v2] unexpected payment failure:",
    error instanceof Error ? error.message : String(error),
  );
  res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "Could not complete the request" },
  });
}

export function setupVelRepeatV2PaymentRoutes(app: Express): void {
  /**
   * POST /api/velrepeat/v2/plans/:planId/payment
   *
   * The ONLY endpoint the frontend calls. It returns Stripe Checkout
   * information and never a plan status change: activation happens only when
   * the webhook verifies a settled charge. There is deliberately NO
   * "confirm"/"activate" route — a client must not be able to move a plan.
   */
  app.post("/api/velrepeat/v2/plans/:planId/payment", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const planId = String(req.params.planId ?? "");
      if (!isUuid(planId)) {
        throw new RepeatPlanPaymentError(400, "VALIDATION_ERROR", "planId must be a UUID");
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const method = parsePrepaidMethod(body.method ?? body.paymentMethod);
      const rawKey = typeof body.requestKey === "string" ? body.requestKey.trim() : "";
      const requestKey = rawKey ? rawKey.slice(0, 200) : null;

      // ── Idempotency layer 1: the request key ─────────────────────────────
      // Same store, same shape as the order checkout keys (`order_id` is
      // nullable precisely so a key can belong to a plan), one scope of its
      // own so a plan key can never collide with an order key.
      if (requestKey) {
        const claim = await query(
          `INSERT INTO checkout_requests (user_id, scope, request_key)
           VALUES ($1, 'velrepeat_v2_payment', $2)
           ON CONFLICT (user_id, scope, request_key) DO NOTHING
           RETURNING id`,
          [userId, requestKey],
        );
        if (claim.rows.length === 0) {
          const previous = await query(
            `SELECT response FROM checkout_requests
              WHERE user_id = $1 AND scope = 'velrepeat_v2_payment' AND request_key = $2`,
            [userId, requestKey],
          );
          const stored = previous.rows[0]?.response;
          if (stored && typeof stored === "object") {
            res.json({ success: true, data: stored });
            return;
          }
          throw new RepeatPlanPaymentError(
            409,
            "DUPLICATE_PAYMENT_IN_PROGRESS",
            "Your payment is being prepared. Please wait a moment.",
          );
        }
      }

      const session = await openPlanPaymentSession(userId, planId, method, requestKey);

      if (requestKey) {
        await query(
          `UPDATE checkout_requests SET order_id = NULL, response = $2::jsonb
            WHERE user_id = $3 AND scope = 'velrepeat_v2_payment' AND request_key = $4`,
          [planId, JSON.stringify(session), userId, requestKey],
        ).catch(() => {
          // The response snapshot is an optimisation; failing to store it must
          // not fail a payment the customer can already complete.
        });
      }

      res.status(session.reused ? 200 : 201).json({
        success: true,
        data: {
          planId: session.planId,
          // The plan is NOT active here and the response never claims it is.
          planStatus: "draft",
          paymentId: session.paymentId,
          sessionId: session.sessionId,
          url: session.url,
          method: session.method,
          provider: "stripe",
          stripeMode: "test",
          currency: session.currency,
          // Both figures, explicitly named, so no caller can mistake the
          // per-cycle price for the amount being charged. They are equal only
          // when the commitment is a single delivery.
          cyclePrice: session.cyclePrice,
          totalPrepaidAmount: session.amount,
          amountMinor: session.amountMinor,
          paymentStatus: session.status,
          reused: session.reused,
        },
      });
    } catch (error) {
      fail(res, error);
    }
  });
}