# AI Handoff — audit §42.2, the fourteen findings in full (2026-09-29)

**Archived** (moved 2026-09-29 for edit-headroom housekeeping) from
`.ai/AI_HANDOFF.md` **§42.2 "PROBLEMS — severity ordered"** of the full-system audit
(base commit `2c52bfc`, recorded in §42.1 / §42.3 / §42.4). The handoff keeps a
one-line-per-finding index; this file holds the original write-ups, verbatim.

**Read the statuses in the handoff index, not these paragraphs** — several findings
have been fixed since the audit: #1 and #2 by §43 (`8b89ecf`), #3 and the
center-release leak by §44 (`895cebf`, `3d77254`). #6 remains owner-blocked.

---

### 42.2 PROBLEMS — severity ordered

**CRITICAL #1 — non-variant stock is never CONSUMED on payment.** `backend/routes/stripe.ts` →
`markPaymentSucceeded`, `:426-435`. CURRENT: payment success only does
`UPDATE inventory SET reserved = GREATEST(0, reserved - q)` (`:429`) + `products.sold_count + q` (`:433`);
**nothing anywhere decrements `inventory.quantity`** (the only writer is the seller "set stock" endpoint,
`backend/routes/products.ts:1487-1491`). Availability is `quantity - reserved` (`cart.ts:368, 498, 555,
839`), so a PAID unit becomes sellable again. EXPECTED: a completed sale consumes stock. RISK: unbounded
oversell, `sold_count > quantity`. **A test pins the wrong behaviour:**
`backend/tests/payment-reservation-expiry.test.ts:979` `expect(after.quantity).toBe(50)`; no test asserts
availability as `quantity - reserved`.

**CRITICAL #2 — seller cancellation is a SECOND release path → double release / phantom stock.**
`backend/routes/seller-orders.ts:610-623` (variant `stock = stock + $1` `:616`;
`UPDATE inventory SET reserved = GREATEST(0, reserved - $1)` `:621`). CURRENT: an inline restore that
never sets `orders.inventory_released` and never calls `releaseOrderInventory()`. EXPECTED: every restore
governed by that ONE atomic claim. RISK: cancel an order whose raw status is `pending_payment`/`paid`
(it normalizes to `pending`) while a Stripe session is open → later `checkout.session.expired` →
`markPaymentCanceled` → `releaseOrderInventory` still matches (`status='cancelled'` ∈ `RELEASABLE_STATUSES`,
flag FALSE) → **stock returned twice**; the variant branch has no clamp, so phantom units are possible.

**HIGH #3 — a seller/center can cancel a PAID order: money kept, no refund, no alert.**
`order-fulfillment.ts:161` normalizes `paid → pending`, so `canTransitionOrderStatus` (`seller-orders.ts:576`)
allows `→ cancelled` plus the #2 restore; `payments.status` stays `paid`; no refund and no operator alert.

**HIGH #4 — `payment_intent.payment_failed` is per-ATTEMPT but terminal at ORDER level.**
`markPaymentFailed` (`stripe.ts:447-473`; order guard `:467`) flips the order to `payment_failed` and
releases stock; a later successful retry on the same open session is then refused by
`markPaymentSucceeded`'s guard (`:341-441`) → the order stays `payment_failed` while
`payments.status = 'paid'` and the stock is already released.

**HIGH #5 — a payment arriving after the order died has no auto-refund and no operator queue.** Only
`console.warn('[stripe webhook] payment received for order … that is no longer payable (…) — manual
review/refund required')` (`stripe.ts:392-414`). The order is (correctly) never resurrected, but the
money sits on the payment row with nothing but that log line.

**HIGH #6 — PRODUCTION BLOCKED: migration 048 is unapplied, so Part 2 is INERT in production.**
`Migrate Neon Database` dies on the Neon provider quota (`ERROR: Your account or project has exceeded the
quota. Upgrade your plan to increase limits.` — runs `36454467112`, `36454465288`, `36437470328`,
`36371800184`; the one-off `diag-neon-schema` probe `36449336393` too), so production Neon has **neither
`payment_expires_at` nor `reservation_policy`**. The code is schema-tolerant by design (checkout does not
break), but no deadline is written, the sweep self-disables and no countdown can render — **never report
Part 2 as PASS in production**. Confirming read also needs an owner/admin session: `GET /api/_diag/schema`
→ **401 `UNAUTHORIZED`** (`backend/middleware/diag-guard.ts`, `DIAG_ALLOWED_ROLES = ["owner","admin"]`).
Owner action: clear the quota → apply 048 (§37's four statements or the Migrate Neon workflow) → place a
NEW order.

**MEDIUM #7 — the payment-success path ignores variants.** `stripe.ts:426-429` selects only `product_id`
and adjusts `inventory.reserved` for every item, while `releaseOrderInventory`
(`backend/lib/inventory.ts:155-167`) correctly distinguishes `variant_id`; `GREATEST(0, …)` hides the
mismatch, and the update can steal a hold belonging to another order.

**MEDIUM #8 — two overlapping urgency contracts coexist.** `paymentReservationPhase()` /
`PAYMENT_RESERVATION_URGENT_MS = 3 min` AND `paymentReservationTone()` / `PAYMENT_RESERVATION_YELLOW_MS
= 15 min` / `RED_MS = 5 min` live in the SAME file (`packages/shared/src/lib/commerce.ts:783-898`), and
both `MyOrders.tsx` (`:163`, `:391-396`) and `ShopOrderDetail.tsx` (`:302-303`, `:511`) call both. §38
documented only the 3-minute model; the GREEN/YELLOW/RED tiers of §39 match the code. EXPECTED: ONE
urgency authority.

**MEDIUM #9 — `orders.status` has no CHECK constraint** (`db/schema.sql:376`) while sibling tables have
one; any string is storable, so every consumer must normalize (`getOrderStatusMeta()`,
`normalizeOrderStatusToFulfillment()`).

**MEDIUM #10 — VelRepeat is a second order-creation path that bypasses the guards.**
`backend/jobs/velrepeat-scheduler.ts:267-350` inserts `orders.status='pending'` plus a `payments` row with
method `'cod'` directly — skipping the fail-closed `payment-config` — increments `sold_count` at CREATION
(not at settlement) and reserves stock that can never be committed (COD never reaches
`markPaymentSucceeded`), so the hold lasts until cancellation.

**MEDIUM #11 — inventory-row deadlock.** Order creation locks inventory rows in cart-item order
(`cart.ts:1027-1034`); two checkouts with opposite item orderings can AB-BA deadlock → PostgreSQL aborts
one → a generic **500 `CHECKOUT_FAILED`** instead of a 409.

**LOW #12** `"failed"` is dead in `RELEASABLE_STATUSES` (`inventory.ts:73`) — nothing writes it. **#13**
`inventory-race` is 4 pass / 8 skip locally, so concurrency evidence exists **only in CI** (LOCAL tier).
**#14** settlement is per shop/order row, so one multi-shop checkout can end partially paid / partially
expired.

---

## §42.1 What was checked, and the result

*Archived 2026-09-29 for edit headroom. The 18-row audit table; the architecture verdicts that
follow it stayed inline in the handoff because the housekeeping rule keeps "§42's verdicts".
Rows 8, 10 and 12 have since been resolved (#1/#2 by §43, #3 by §44); rows 15, 16 and 17 are
still BLOCKED and are restated in the handoff's §45.*

| # | Checked | How | Result |
|---|---|---|---|
| 1 | Repo sync | `git fetch` / `git rev-parse` | ✅ local fast-forwarded 34 commits to `2c52bfc` |
| 2 | Backend suite (sandbox) | `NODE_ENV=test bun test backend/tests` | ✅ **850 pass / 154 skip / 0 fail** (1004 tests, 46 files) |
| 3 | CI on the audited SHA | Actions run `36551376766` | ✅ **1002 pass / 2 skip / 0 fail** (disposable `postgres:16`, no repo secrets) |
| 4 | Backend types | `bunx tsc --noEmit` (backend) | ✅ exit 0 |
| 5 | App types | `bun run typecheck` | ✅ 4/4 apps exit 0 |
| 6 | i18n parity | `bun run i18n:check` | ✅ th = en = my = **1414** |
| 7 | Hygiene | `git diff --check` · `bun run lint` | ✅ clean · ⚠️ `lint` is a placeholder ("Lint not yet configured") — no real linter exists |
| 8 | Sources of truth | source read | ⚠️ PARTIAL — reservation ✅ one, payment ✅ one, order state ✅ one; **inventory ❌ two release paths and `quantity` never consumed (#1, #2)** |
| 9 | Races: payment×cancel, payment×expiry, cancel×expiry, payment×payment, expiry×expiry | source + suites + CI | ✅ exactly-one-wins holds on all five |
| 10 | Race: seller-cancel release × webhook release | source | ❌ **FAIL — double release (#2)** |
| 11 | Stripe surface | source (`stripe.ts`) | ✅ 11 event types, signature via `constructEventAsync` + raw-body middleware, unverifiable → 503, per-event idempotency claim |
| 12 | Production schema | `Migrate Neon Database` logs + `/api/_diag/schema` | ❌ **PRODUCTION BLOCKED — migration 048 never applied (#6)** |
| 13 | Production payment config | `GET /api/stripe/configured` · `GET /api/payments/methods` | ✅ PRODUCTION VERIFIED — `{configured:true, mode:"test", webhookConfigured:true, webhookSecretHealth.present:true}`, `["CARD","PROMPTPAY"]`, **COD disabled**, THB |
| 14 | Production health | `GET /api/health` | ✅ PRODUCTION VERIFIED — 200 |
| 15 | Real Stripe E2E (PaymentIntent / PromptPay QR / webhook / refund) | — | ⛔ **BLOCKED** — no `STRIPE_*` keys, no `DATABASE_URL`, no session; never executed from this workspace |
| 16 | Browser E2E of `/orders`, `/cart`, seller order pages | — | ⛔ **BLOCKED** — no signed-in session; layout pinned by contract tests only |
| 17 | DB-gated suites locally | `bun test backend/tests` | ⚠️ SKIPPED locally (no `postgres`/`psql`/`docker`, no `TEST_DATABASE_URL`); the fail-closed guard refuses a production URL — proven: `NODE_ENV=test DATABASE_URL=…neon.tech… bun test backend/tests` → `REFUSING TEST AGAINST PRODUCTION DATABASE`, exit 2. These cases DO run in CI (#3) |
| 18 | Migration numbering + schema drift | `migration-numbering` / `schema-drift` suites | ✅ PASS — `db/schema.sql` and `db/run-sqleditor.sql` byte-identical (`diff` empty); head `048` |

## §42.3 Cancellation matrix (read from source — no invented cells)

*Archived 2026-09-29. Since the move, `paid` × seller/center reads "cancel now refused 409 ✅ (#3 fixed,
§44)" and `cancelled` × Stripe webhook no longer has a double release (§43 #2).*

| `orders.status` | customer cancel | reservation sweep | Stripe webhook | seller / center |
|---|---|---|---|---|
| `pending` | ✅ → `cancelled` + release | ✅ → `expired` + release | → `paid` / `payment_failed` / `cancelled` | → `confirmed`, `cancelled` |
| `pending_payment` | ✅ same | ✅ same | same | same |
| `paid` | ❌ 409 `ORDER_ALREADY_PAID` | ❌ blocked (`paid`/`processing`) | cannot move it | → `confirmed`; cancel now refused 409 ✅ (#3 fixed, §44) |
| `confirmed` | ✅ → `cancelled` + release | ❌ | cannot move it; release refused (`confirmed` ∉ `RELEASABLE_STATUSES`) | → `packing`, `cancelled` |
| `packing` | ❌ 400 `INVALID_STATUS` | ❌ | — | → `shipped` (needs a shipment) |
| `shipped` / `delivered` / `completed` | ❌ | ❌ | — | next fulfilment step only |
| `cancelled` | ⏹ 200 `alreadyFinal`, no release | ❌ | **release claim still matches ⚠️ (#2)** | — |
| `payment_failed` | ⏹ `alreadyFinal` | ❌ | — | `confirmed` blocked (payment not confirmed) |
| `expired` | ⏹ `alreadyFinal` | ❌ | — | — |
| `refunded` | ❌ | ❌ | refund sync (`syncRefundFromStripe`) | — |

## §42.4 Race verdicts

*Archived 2026-09-29. Both ❌ verdicts have since been fixed: the seller-cancel × webhook double release
by §43 #2, and the `paid → cancelled` transition by §44 #3.*

✅ **payment × cancel** (guarded claim + lock-order-first) · ✅ **payment × expiry** (exactly-one-wins via
the `NOT EXISTS (SELECT 1 FROM payments … status IN ('paid','processing'))` guard) · ✅ **cancel ×
expiry** · ✅ **payment × payment** (`idx_payments_one_active_stripe` + `checkout_requests` +
`payment_events`) · ✅ **expiry × expiry** (the DB claim is the only gate). ❌ **seller-cancel release ×
webhook release** — #2, the one double-release left (fixed in §43). Lock discipline ✅ (see 42.1 verdict 5).
Impossible transition **`paid → cancelled`** — refused 409 since §44.

## §42.5 Recommended next actions (owner-priority order)

*Archived 2026-09-29. Items 1–4 are now DONE or owner-blocked: 2 and 3 by §43, 4 by §44 (refused);
1 is still the owner-blocked migration 048. The current open list is §44's "Still open".*

1. **Apply migration 048** — unblocks Part 2 in production (owner action on the Neon quota).
2. **Fix stock consumption on settlement (#1)** and the test that pins the wrong behaviour.
3. ~~**Route the seller cancellation restore through `releaseOrderInventory()` (#2).**~~ ✅ §43
4. ~~**Decide the `paid`-order cancellation policy** (#3).~~ ✅ **refused** (§44, 409 — a refund stays an
   owner-side flow; the operator surface for it is still to come).
5. **Give late/refused payments an operator surface** instead of a `console.warn` (#4, #5).
6. **Add the `orders.status` CHECK (#9)** and collapse the two urgency contracts (#8).
7. **Remove the VelRepeat order-creation bypass (#10)** and the inventory-row deadlock (#11).
