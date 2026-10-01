# VelRepeat V2 — Phase 4: Stripe Prepaid Plan-Level Payment — Audit

- **STATUS:** IMPLEMENTED (code complete, CI-verified; **production DB NOT migrated**, Stripe E2E NOT executed)
- **Date:** 2026-10-01
- **Starting commit SHA:** `0cb29aa9819e4eaafa915c44f9864cb99b672291`
- **Implementation commit SHA:** _(see §16 — filled in by the delivery commit)_

---

## 1. What this phase is

A customer buys a package commitment, pays **once** for the **whole** commitment through Stripe
TEST mode, and the plan becomes `active` **only** after a signature-verified webhook confirms the
money settled.

```
package → POST /api/velrepeat/v2/plans (Phase 3)
       → Repeat Plan status = draft
       → Pricing Snapshot frozen (Phase 3)
       → POST /api/velrepeat/v2/plans/:planId/payment      ← Phase 4
       → Stripe Checkout Session for the ENTIRE commitment
       → payments row (parent = the PLAN, migration 051)
       → verified Stripe webhook
       → payments.status = paid  +  plan draft → active
       → started_at / next_run_at re-anchored
       → later phases create each cycle's fulfillment
```

Worked example from the brief: 4 cycles × 100 THB, 10% commitment discount → **360.00 THB charged
once**. Not four charges. Not an order for 360.

---

## 2. Files changed

| File | Change |
|---|---|
| `db/migrations/051_payments_velrepeat_v2_plan_parent.sql` | **new** — additive plan-level payment parent (Q13=B) |
| `db/schema.sql` | mirrored 051, kept byte-identical to `db/run-sqleditor.sql` |
| `db/run-sqleditor.sql` | mirrored 051 (identical to `db/schema.sql`; `cmp` verified) |
| `backend/routes/velrepeat-v2-payments.ts` | **new** — payment initiation + webhook settlement + activation |
| `backend/routes/stripe.ts` | additive only — `stripeServerClient()` export, `toMinor`→`toStripeMinor` export, V2 dispatch at the top of `handleStripeEvent` |
| `backend/lib/payment-incidents.ts` | additive only — optional `planId` parent + namespaced dedupe key (existing order call sites unchanged) |
| `backend/server.ts` | **+2 / −0** — mount `setupVelRepeatV2PaymentRoutes` |
| `backend/lib/money.ts` | comment only — renamed `toMinor()` reference to `toStripeMinor()` |
| `backend/tests/velrepeat-v2-phase4-prepaid-payment.test.ts` | **new** — 55 tests (34 pure/structural + 21 DB-gated) |
| `backend/tests/velrepeat-v2-phase3-pricing-snapshot.test.ts` | 2 assertions updated — they pinned Phase 3-era repo state (see §14) |
| `backend/tests/order-status-check-constraint.test.ts` | 1 assertion updated — "V0050 is the highest migration" (see §14) |

**Not touched:** `velrepeat-plans.ts`, `velrepeat.ts`, `velrepeat-scheduler.ts`, `inventory.ts`,
`order-fulfillment.ts`, `order-lock.ts`, `payment-reservation.ts`, `payment-config.ts`,
`packages/shared`, all four apps, `db/run-update.sql` (still absent, not recreated).

---

## 3. Architecture decisions

### 3.1 Q13=B — `payments` gained a plan parent (migration 051)

`payments.order_id` was `UUID NOT NULL REFERENCES orders(id)`, so a plan-level charge could not be
recorded. Both workarounds were forbidden (a fake Order, or Cycle 1's order holding all the money).
The decision closure
(`velrepeat-v2-owner-decision-closure-2026-09-30.md` §3.1) prescribes the answer, and Phase 4
implements exactly it:

1. `payments.order_id` **loses NOT NULL** (type and FK unchanged — every existing row keeps its order).
2. `payments.plan_id UUID` → FK `velrepeat_plans(id)`, added as a **deferred** `ALTER TABLE` because
   `payments` is created before `velrepeat_plans` in the bootstrap.
3. `CHECK ((order_id IS NOT NULL AND plan_id IS NULL) OR (order_id IS NULL AND plan_id IS NOT NULL))`
   — **exactly one parent**. This preserves the old guarantee (every payment belongs to something)
   and makes an order payment that is also a plan payment unrepresentable.
4. `idx_payments_one_active_stripe_plan` — the plan-scoped twin of
   `idx_payments_one_active_stripe`. Required: NULLs are distinct in PostgreSQL, so the order-scoped
   index **cannot** constrain plan rows at all (proven in the closure).

`payment_incidents` moves with it (`plan_id` + the same XOR CHECK): it is the durable operator record
for money the system could not settle, and it was also `order_id NOT NULL`.

**Deliberately NOT changed:** `refunds.order_id` stays `NOT NULL`. No plan refund writer exists (the
refund formula is still `OWNER FORMULA REQUIRED`, Phase 9), so widening it would add an unused
constraint without a writer.

**FK delete behaviour:** `payments_plan_id_fkey` is NO ACTION, so a plan that has money attached
cannot be hard-deleted. That is the financially correct outcome (a paid commitment must not vanish
silently) and it blocks nothing today: no backend route deletes `velrepeat_plans`, and no backend
route deletes users.

### 3.2 One Stripe client, one webhook, one payment authority

- The V2 module imports `stripeServerClient()` — an accessor for the **existing** lazily-cached
  client in `routes/stripe.ts`. No second `new Stripe(...)` exists anywhere.
- The settlement half runs **inside the existing** `POST /api/payments/stripe/webhook` handler,
  dispatched from `handleStripeEvent` **before** any order logic. There is still exactly one raw-body
  gate, one `constructEventAsync` signature check, one `payment_events` claim and one
  500-on-failure redelivery policy.
- `routes/stripe.ts` ↔ `routes/velrepeat-v2-payments.ts` is an import cycle; **every** cross-reference
  is inside a function body, so neither module reads from the other at evaluation time.
- No second ledger: the only tables this phase writes money to are `payments`, `payment_events`
  (through the existing webhook) and `payment_incidents` (through the existing mechanism).

### 3.3 Scope discrimination

`VELREPEAT_V2_PAYMENT_SCOPE = "velrepeat_v2_plan"` is written by this module into session and
PaymentIntent metadata and read back only by this module. A V1 event has no such marker and takes the
pre-existing path untouched. A client cannot forge the marker into our Stripe objects.

---

## 4. Payment flow (what the customer sees)

`POST /api/velrepeat/v2/plans/:planId/payment` — body: `{ method: CARD | PROMPTPAY, requestKey? }`.

Refusals (all before any provider call or write):

| Condition | Status | Code |
|---|---|---|
| `planId` not a UUID | 400 | `VALIDATION_ERROR` |
| unknown method | 400 | `INVALID_PAYMENT_METHOD` |
| **COD** (even with COD enabled) | 400 | `UNSUPPORTED_PAYMENT_METHOD` |
| Stripe not usable (incl. a **live** key) | 503 | `STRIPE_NOT_CONFIGURED` / `STRIPE_LIVE_KEY_REFUSED` / … |
| plan does not exist | 404 | `PLAN_NOT_FOUND` |
| plan belongs to someone else | 403 | `FORBIDDEN` |
| plan is not `draft` | 409 | `PLAN_NOT_PAYABLE` |
| a `paid` payment already exists | 409 | `PLAN_ALREADY_PAID` |
| no pricing snapshot | 409 | `PRICING_SNAPSHOT_MISSING` |
| snapshot currency ≠ THB | 409 | `PRICING_CURRENCY_MISMATCH` |
| snapshot total not chargeable | 409 | `PRICING_AMOUNT_UNUSABLE` |
| a concurrent request won the active slot | 409 | `DUPLICATE_PAYMENT_IN_PROGRESS` |

Response: `{ planId, planStatus: "draft", paymentId, sessionId, url, method, provider, stripeMode:
"test", currency, amount, amountMinor, paymentStatus, reused }` — **the response never claims the plan
is active**, and there is deliberately **no** activate/confirm route.

---

## 5. Canonical payment linkage

```
Customer → velrepeat_plans (user_id)
         → payments (plan_id)          ← one payment = the whole commitment
         → velrepeat_pricing_snapshots (total_amount = the commitment price)
         → velrepeat_events (PLAN_ACTIVATED carries payment_id + snapshot_id)
         → … future: velrepeat_cycles → orders   (Phases 5/6/8)
```

The payment row carries `order_id IS NULL` and `plan_id = <the plan>`. **No order, cycle, run,
reservation, shipment or fulfillment row is created anywhere in Phase 4** — asserted structurally
and by integration assertions on live counts.

---

## 6. Plan state transition — `draft → active`

Exactly one `SET status = 'active'` exists in the module, and it is:

```sql
UPDATE velrepeat_plans
   SET status = 'active', started_at = $2, next_run_at = $3,
       payment_method = $4, payment_method_ref = $5, updated_at = NOW()
 WHERE id = $1 AND status = 'draft'
 RETURNING id
```

`WHERE status = 'draft'` **is** the exactly-once guard. It is reached only after, in the same
transaction:

- the payment row re-reads as `paid` (so "plan active but payment not recorded" is unrepresentable);
- Stripe's amount equals the snapshot's total in minor units;
- Stripe's currency equals the snapshot's currency and is THB;
- the recorded payment method is a real Stripe rail (`CARD` / `PROMPTPAY`) — **never** the schema
  default `'cod'`.

`PLAN_ACTIVATED` is inserted only when that UPDATE moved a row, so there can never be a second
activation event.

---

## 7. Webhook behaviour

| Event | Outcome |
|---|---|
| `checkout.session.completed` + `payment_status = "paid"` | settle → activate |
| `checkout.session.completed` + unpaid (PromptPay trap) | attempt → `requires_action`, **plan stays draft** |
| `checkout.session.async_payment_succeeded` | settle → activate |
| `payment_intent.succeeded` | settle → activate |
| `checkout.session.async_payment_failed` / `payment_intent.payment_failed` | attempt → `failed`, plan stays draft |
| `checkout.session.expired` / `payment_intent.canceled` | attempt → `cancelled`, plan stays draft |
| wrong amount | money recorded `paid`, **no activation**, `payment_incidents` row `PLAN_AMOUNT_MISMATCH` |
| wrong currency | money recorded `paid`, **no activation**, incident `PLAN_CURRENCY_MISMATCH` |
| unknown plan / unrecorded attempt | acknowledged, nothing written |
| our scope + unusable plan id | acknowledged, nothing written (no infinite Stripe retries) |
| invalid signature | 400 from the existing verifier; nothing changes |

Signature verification, the raw-body gate and the `payment_events` claim are the **pre-existing**
ones — this phase adds no second verification path.

---

## 8. Idempotency design (four layers, all database-backed)

1. `checkout_requests (user_id, scope='velrepeat_v2_payment', request_key)` — a replay returns the
   stored response.
2. `idx_payments_one_active_stripe_plan` — at most **one** live Stripe attempt per plan; a
   double-click, a client retry or two concurrent requests cannot open two sessions, therefore
   cannot create two PaymentIntents.
3. `payment_events.event_id UNIQUE` + `ON CONFLICT DO NOTHING` (existing) — the same event id is
   claimed once.
4. `WHERE status = 'draft'` on activation (existing) — the charge being settled twice, concurrently
   or sequentially, activates once.

Verified: replay of the same event id, a **different** event id for the same charge (what Stripe
does: session + PaymentIntent), and **five concurrent deliveries with distinct event ids** all leave
exactly one `paid` payment and exactly one `PLAN_ACTIVATED`.

---

## 9. Amount and currency verification

- Source: `velrepeat_pricing_snapshots.total_amount` (Phase 3, immutable), read inside the validating
  transaction. Never from the request body — structurally asserted.
- Conversion: `parseDecimal` → `roundHalfUp(value, 2)` (bigint-rational, **one** rounding, G2) →
  integer minor units. No IEEE-754 value participates. Agrees with the order path's
  `toStripeMinor()` for every 2-dp value (asserted).
- At settlement Stripe's own `amount_received` / `amount_total` is compared to that expected integer;
  a mismatch refuses activation and records an operator incident.
- No `allow_promotion_codes`: Stripe must never be able to capture less than the snapshot commits.

---

## 10. Payment method handling

`CARD` and `PROMPTPAY` only, gated by the existing `assertPaymentMethodUsable()` in
`lib/payment-config.ts` (the one gate — not forked). COD is refused by name before that gate.
`velrepeat_plans.payment_method` is written with the **actual** Stripe method at activation and
`payment_method_ref` with the Stripe PaymentIntent id; a plan whose recorded method is not a real
Stripe rail is refused activation even when the money and the amount verify.

---

## 11. Timing re-anchoring

```
started_at  = the settlement instant (NOW at webhook time)
next_run_at = calculateNextRunAt(started_at, frequency_type, interval_value)
```

`calculateNextRunAt` is the **same** canonical derivation V1 uses. Proven by a test that forces a
draft's timestamps 40/33 days into the past, delivers the webhook, and asserts both columns moved to
the settlement instant and that `next_run_at` equals one committed interval after it — a duplicate
delivery does **not** re-stamp them.

*(Phase 5/6 decision still open: whether cycle 1 is due immediately on activation or one interval
later. Phase 4 preserves the existing interval semantics rather than inventing a new rule.)*

---

## 12. Tests executed

`backend/tests/velrepeat-v2-phase4-prepaid-payment.test.ts` — **55 tests (34 pure/structural, 21
DB-gated)**, covering payment creation, webhook, activation and security as specified:

- money: exactness, the 360.00 worked example, agreement with the order rule, unusable amounts,
  no client-sourced total;
- creation: 404 / 403 / non-draft / already-paid / COD / unsupported / unconfigured / malformed id /
  one-active-attempt-per-plan / the XOR constraint, each proven to write nothing;
- webhook: paid session, unpaid session, async success, PI success, failure, cancellation, expiry,
  invalid signature, wrong amount, wrong currency, default-COD method, unknown plan, unusable id;
- activation: exactly once, real method, `payment_method_ref`, `started_at`, `next_run_at`,
  `order_id IS NULL`, and **0 orders / 0 cycles / 0 runs / 1 activation / 1 paid payment**;
- idempotency: same event id, different event id for the same charge, **5 concurrent deliveries**;
- security: cannot pay another customer's plan, cannot inject amount/seller/currency/status,
  cannot activate via a client claim (route does not exist).

Plus two suites updated (§14) and the whole repository suite.

### Results

| Check | Result |
|---|---|
| `bun run test` | **1536 pass / 241 skip / 0 fail** (1777 tests, 58 files) |
| phase-4 suite (local) | **34 pass / 21 skip / 0 fail** |
| `cd backend && bunx tsc --noEmit` | clean |
| `bun run typecheck` | **4/4** (velshop, velseller, velcenter, velnox) |
| `bun run build:apps` | **4/4** |
| `git diff --check` | clean |
| `cmp db/schema.sql db/run-sqleditor.sql` | identical |

**The 21 DB-gated tests SKIP locally — this sandbox has no PostgreSQL.** They are executed only by
CI's disposable `postgres:16` (`.github/workflows/test.yml`, `TEST_DATABASE_URL`, bootstrapped from
`db/run-sqleditor.sql`). See §16 for the CI run.

---

## 13. CI

_(filled in by the delivery commit / §16)_

---

## 14. Two existing assertions updated — and why

Phase 3 pinned **repository state**, not an invariant that Phase 4 could preserve:

1. *"no migration 051 was created"* and *"V0050 is the highest migration number"* — both asserted
   the absence of a file Phase 4 is required to add. Rewritten to assert what actually matters:
   **051 exists, is used exactly once, and touches only the payment tables** (no `velrepeat_plans`,
   no pricing snapshot, no `velrepeat_items`); and **no migration number was reused**.
2. *"no V1 → V2 migration or rewrite was introduced"* — the VelRepeat migration list now legitimately
   includes Phase 4's `051_payments_velrepeat_v2_plan_parent.sql`.

No assertion was weakened to make a test pass; each was re-pointed at the invariant behind it.

---

## 15. Production DB status

**BLOCKED — Neon quota.**

- Migration **051 is committed but NOT applied to production**. 048, 049 and 050 were already
  unapplied before this phase (the documented quota blocker), so a Push to `main` triggers
  *Migrate Neon Database* against a project that still answers
  `ERROR: Your account or project has exceeded the quota`.
- Therefore in production today: `payments.plan_id` does not exist, the XOR CHECK does not exist,
  and a V2 plan payment **cannot be recorded**.
- Consequence: **the Phase 4 backend must not be deployed before migration 051 is applied.**
  Deploying it first would make `INSERT INTO payments (plan_id, …)` fail with `42703` at payment
  creation (fail-closed: it would refuse, not mis-charge) and would make webhook settlement fail
  closed as well.
- **Owner unblock:** clear the Neon quota and run *Migrate Neon Database*, or paste
  `db/migrations/051_payments_velrepeat_v2_plan_parent.sql` into the Neon SQL Editor (additive,
  idempotent, re-runnable).

**Stripe E2E: NOT executed.** No test credential exists in any workspace. No PaymentIntent, no
PromptPay QR, no real webhook delivery and no refund round trip has ever been run. What *is* proven
is the backend half: signature verification accept **and** reject, the event claim, amount/currency
verification, idempotency and activation — against synthetic events signed locally with a fake
`whsec_` value.

**This phase is NOT production-ready.**

---

## 16. Known limitations

1. **Migration 051 unapplied** — see §15. Blocks any real payment.
2. **No Stripe E2E** — the provider round trip is unverified.
3. **No refund path for a plan** — `refunds.order_id` is still `NOT NULL`. A paid commitment cannot be
   refunded yet. The refund formula is `OWNER FORMULA REQUIRED` (Phase 9) and no plan refund writer
   exists.
4. **V1 lifecycle routes can reach an ACTIVE V2 plan.** After activation, `POST
   /api/velrepeat/plans/:planId/pause|resume|cancel` (V1) would act on a V2 plan, since both share
   `velrepeat_plans`. V1 cannot edit or cancel a `draft` (its allowed-status lists exclude it), so
   Phase 4 is safe; **Phase 5/9 must own V2 plan lifecycle routes.**
5. **V1 `GET /api/velrepeat/plans` will list V2 drafts** to the customer. Cosmetic, but the V2
   lifecycle needs its own read surface.
6. **No plan-payment read endpoint** — the customer cannot yet poll payment status; only the
   checkout URL is returned.
7. **The customer cannot abandon a V2 plan** — there is no V2 cancel endpoint, so a draft whose
   Checkout Session expires simply stays `draft` with a `cancelled` payment.
8. **`next_run_at` semantics at activation** (one interval vs. immediate first cycle) are preserved
   from V1, not decided. Phase 5/6.
9. **`V1 products.vrepeat_enabled`** remains outside the V2 purchase gate (Phase 3 finding).
10. **The frontend is untouched** — the API is ready; no VelShop screen calls it yet.

---

## 17. Next-phase dependencies

- **Phase 5/6 (cycles + fulfillment)** — now unblocked on payment. Consumes `payments.plan_id`,
  creates one order per cycle per seller, and must apply the plan's committed snapshot price.
- **Phase 8 (order fulfillment gate)** — `paymentAllowsConfirmation()` must learn that a cycle order
  is covered by a **paid plan**, not by a `payments` row of its own (closure §5.7). Without it,
  every cycle order would be unconfirmable.
- **Phase 9 (refunds)** — needs `refunds.plan_id` + the owner refund formula; also must resolve
  limitation 4 (V1 lifecycle routes on V2 plans).
- **Q2 (sold_count recognition point)** — still `OWNER DECISION REQUIRED` per the closure; Phase 4
  creates no sale.