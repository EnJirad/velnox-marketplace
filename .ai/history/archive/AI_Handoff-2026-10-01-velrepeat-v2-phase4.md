## 60. VelRepeat **V2 Phase 4 — Stripe prepaid plan-level payment** (2026-10-01)

**Implemented** (base `0cb29aa`): `POST /api/velrepeat/v2/plans/:planId/payment` in the new
`backend/routes/velrepeat-v2-payments.ts` opens ONE Stripe Checkout Session for the whole commitment;
settlement runs inside the **existing** `/api/payments/stripe/webhook` (dispatched from
`handleStripeEvent` before any order logic) via `VELREPEAT_V2_PAYMENT_SCOPE` metadata. Same Stripe
client, same `payment-config` gate, same `payments` table, no second ledger.

**Q13=B solved by migration `051_payments_velrepeat_v2_plan_parent.sql`** (additive, idempotent):
`payments.order_id` loses NOT NULL, `payments.plan_id` FK → `velrepeat_plans(id)`, CHECK **exactly one
parent**, plus `idx_payments_one_active_stripe_plan` (the order-scoped index cannot constrain NULL
`order_id` rows). `payment_incidents` gets the same rule. `refunds.order_id` stays NOT NULL (no plan
refund writer; formula still OWNER FORMULA REQUIRED). No fake order, no Cycle-1 money.

**Money** = `velrepeat_pricing_snapshots.total_amount` → `parseDecimal` + one `roundHalfUp(_,2)` →
integer minor units (agrees with the order path's `toStripeMinor`, asserted). Never from the body.
`allow_promotion_codes` is NOT set. **Activation** = one `SET status='active' … WHERE id=$1 AND
status='draft'`, reached only after the payment row re-reads `paid` AND amount/currency verify AND the
recorded method is a real Stripe rail (never the schema default `'cod'`). `started_at` = settlement
instant, `next_run_at` = `calculateNextRunAt(started_at, …)`; a duplicate delivery does not re-stamp
them. **0 orders, 0 cycles, 0 reservations, 0 fulfillment.**

**Verified:** locally 1538 pass / 0 fail, backend tsc 0, typecheck 4/4, build:apps 4/4. **CI
`36898374341` on `e9d5ed9`: SUCCESS — 1779 pass / 2 skip / 0 fail** on the disposable `postgres:16`, so
all 23 DB-gated phase-4 tests really executed. Four iterations, **each failure a real finding** — two
production bugs no local run could reach: `payment_intent.*` events never resolved their attempt
(Stripe puts the intent id on `object.id`, not `object.payment_intent`, so the plan silently never
activated), and the pricing guards ran BEFORE the ownership check, answering 409 to a non-owner.
**PRODUCTION DB: APPLIED** — CI run `36890776967` applied 048–**051** (`schema_migrations` id 67,
2026-10-01 16:17 UTC); `034_velrepeat_v2` was already there. **Stripe E2E NOT executed** (no test
credential anywhere). **NOT production-ready**
Audit: `.ai/tasks/audits/velrepeat-v2-phase4-stripe-prepaid-2026-10-01.md`.

> **RESOLVED in §61.** The blocker this section carried — Phase 3 froze the CYCLE PRICE, not the
> TOTAL PREPAID, so `total_amount` held 90.00 where a 4-cycle commitment was 360.00, and multi-cycle
> plans were unpayable — is an owner decision, now approved, implemented and merged in §61. The
> `assertCommitmentCoversEveryCycle` guard is KEPT as a settlement-time proof.

**Carried into later phases:** V1 `pause/resume/cancel` + `GET /api/velrepeat/plans` can now reach an
**active** V2 plan (they cannot touch a `draft`) → V2 lifecycle routes are Phase 5/9 work. Phase 8 must
teach `paymentAllowsConfirmation()` that a cycle order is covered by a paid **plan** (closure §5.7), or
no cycle order can ever be confirmed. Phase 9 needs `refunds.plan_id` + the owner refund formula.

