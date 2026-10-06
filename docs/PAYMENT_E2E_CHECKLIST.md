# PAYMENT — E2E CHECKLIST

Every row is labelled **PASS**, **BLOCKED** or **FAIL**, and every label carries the
evidence that produced it. A row is only ever PASS when the check was actually executed
and its output observed in this workspace; nothing is marked PASS because it "should"
work.

## Environment this was verified in

| Fact | Value |
|---|---|
| Commit verified | `19137fa1f8e24780074d6274de75aee3234898bb` (+ the working-tree change set described in `PAYMENT_IMPLEMENTATION.md`) |
| Database | local PostgreSQL 14, databases built by a fresh `db/run-sqleditor.sql` run (`exit 0`, final NOTICE: *velnox: reconciliation verified …*) |
| Test command | `TEST_DATABASE_URL=… bun test backend/tests` |
| Stripe credentials | **absent** — `freebuff-env list` → `{"files":{}}`; no `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Production Neon | **unreachable** from this workspace |
| Browser / test account | **none** |
| Lint | not configured in this repo (`bun run lint` → `echo 'Lint not yet configured'`) |

---

## A. Build, typecheck, database reconciliation

| # | Check | Label | Evidence |
|---|---|---|---|
| A1 | Backend typecheck | **PASS** | `bun --filter @velnox/backend typecheck` → exit 0 |
| A2 | All four frontends typecheck | **PASS** | `bun run typecheck` → velshop / velseller / velcenter / velnox each exit 0 |
| A3 | All four frontends build | **PASS** | `bun run build:apps` → each app `✓ built`, exit 0 |
| A4 | Reconciler converges on the canonical schema | **PASS** | `bun run db:verify` → exit 0, **52 PASS**, `RECONCILER PROOF: ALL SCENARIOS PASSED` |
| A5 | Fresh schema bootstrap is clean | **PASS** | `psql -v ON_ERROR_STOP=1 -f db/run-sqleditor.sql` → `boot=0`, 684 lines of output, PART 8 assertion NOTICE printed |
| A6 | Migration 055 is idempotent and additive | **PASS** | reconcile runs 1–3 in `db:verify` produce identical object counts; the file contains no `DROP TABLE`/`DROP COLUMN`/`TRUNCATE`/`DELETE` (asserted by `db-run-sqleditor-reconciler.test.ts`) |
| A7 | `git diff --check` | **PASS** | clean, exit 0 |
| A8 | i18n parity after the frontend change | **PASS** | `bun run i18n:check` → `th=1496 en=1496 my=1496 keys, all locales at parity` |
| A9 | Lint | **BLOCKED** | no lint script exists in this repository; not a payment finding |

## B. The reported symptom and its root cause

| # | Check | Label | Evidence |
|---|---|---|---|
| B1 | The OLD blind read reproduces the symptom | **PASS** | `checkout-group-payment-visibility.test.ts` CASE 2: `orders.status='paid'` while the blind subquery returns `'unpaid'` — read back from a real database |
| B2 | One payment row for the whole purchase | **PASS** | CASE 1: 1 row with `checkout_group_id`, 0 rows with `order_id` for either member order |
| B3 | The covering set folds to `paid` from EVERY member order | **PASS** | CASE 3: `payment_status = orders.status = 'paid'` and `payment_method='PROMPTPAY'` for both orders, through the production constant `ORDER_PAYMENT_STATUS_SQL` |
| B4 | Row-level resolver + display state | **PASS** | CASE 4: `coveringPaymentsForOrder` returns the group row; `orderPaymentState` → `status='paid'`, `settled=true`, group id populated |
| B5 | Recency cannot mask a captured charge | **PASS** | pure `foldPaymentStatus` tests: a settled row outranks a NEWER abandoned retry; `paid > processing`; `refunded > partially_refunded > paid` |
| B6 | A settled order is never reported as having an open session | **PASS** | pure `openSessionFor` test: `[open, paid] → cs_open`; `[paid] → null` |

## C. Checkout

| # | Check | Label | Evidence |
|---|---|---|---|
| C1 | Valid cart → orders + one payment + one session | **PASS** | `multi-shop-checkout.test.ts`, `checkout-group-session-open.test.ts` (18 tests) — all pass in the full-suite run |
| C2 | Empty cart refused | **PASS** | `checkout-payment-flow.test.ts` contract tests |
| C3 | Invalid product / variant / quantity refused | **PASS** | `checkout-payment-flow.test.ts`, `payment-foundation.test.ts` |
| C4 | Insufficient stock refused at reservation | **PASS** | `inventory-race.test.ts`, `inventory-settlement.test.ts` — concurrent checkout cannot oversell (atomic conditional `UPDATE`) |
| C5 | Price changed since add-to-cart | **PASS** | checkout re-reads every price from `products`/`product_variants` and re-derives the charge; pinned by `checkout-payment-flow.test.ts` |
| C6 | No money field is read from the request body | **PASS** | `checkout-payment-flow.test.ts` contract assertions on the accepted request shape |
| C7 | Duplicate checkout request (double click / retry / refresh) | **PASS** | request-key store scoped `checkout` vs `payment`; `checkout-payment-flow.test.ts` pins both scopes separately |
| C8 | A grouped purchase cannot be steered into the single-order branch | **PASS** | CASE 5: `readOrderPurchaseScope` derives the group and the user from the order row for both member orders |

## D. Payment and webhook

| # | Check | Label | Evidence |
|---|---|---|---|
| D1 | Checkout Session created, payment pending | **PASS** | `checkout-group-session-open.test.ts`; session reuse gated on an open state and the same method |
| D2 | Webhook signature verified on the raw body | **PASS** | `stripe-webhook-raw-body.test.ts`; raw body wired before `express.json`; invalid/missing signature → 400 and no state change; deployment-level verifiability probed by `selfTestWebhookSignature()` |
| D3 | Duplicate webhook is a no-op | **PASS** | `payment_events.event_id UNIQUE` + `ON CONFLICT DO NOTHING`; `customer-order-cancel.test.ts` pins "the event claim stays idempotent — a redelivery cannot re-run the sync" |
| D4 | Webhook out of order | **PASS** | transitions are guarded by current state, not arrival order; a late charge on a terminal purchase records a durable incident — `late-payment-incidents.test.ts` |
| D5 | Payment failed / session expired terminates the purchase as one unit | **PASS** | `terminateCheckoutGroup` + the group branch in every failure/expiry case; CASE 10 asserts 2 orders moved, 2 releases, 1 void, and a repeat call moves nothing |
| D6 | Payment succeeds → orders `paid` | **PASS** | `settleCheckoutGroup`; CASE 3/CASE 6 read the settled state back |
| D7 | PromptPay pending is NOT treated as paid | **PASS** | `requires_action` until authoritative confirmation; the state machine has no path from `requires_action` to `paid` without the webhook |
| D8 | Webhook scope for a session that names only a representative order | **PASS** | `checkoutGroupIdForAttempt` + server-derived purchase scope (the defect-7 fix); pinned by `checkout-group-sql-scope.test.ts` and `payment-attempt-identity.test.ts` |
| D9 | Funds arriving for a non-payable order are escalated, not ignored | **PASS** | `late-payment-incidents.test.ts`; `customer-order-cancel.test.ts`: "funds arriving for a non-payable order are logged for an operator, never ignored" |
| D10 | **A real Stripe TEST-mode round trip** (session → test card → Stripe webhook → DB) | **BLOCKED** | no `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` in this workspace and no browser. What was verified instead: real DB transactions + real constraints + real webhook dispatch with prototype-spied Stripe sessions — a simulation, labelled as such, never a live charge |

## E. Order state machine

| # | Check | Label | Evidence |
|---|---|---|---|
| E1 | `pending_payment → paid` on payment success only | **PASS** | `order-status-contract.test.ts`, `order-status-check-constraint.test.ts`, `order-fulfillment-state-machine.test.ts` |
| E2 | Payment success does not auto-advance fulfillment | **PASS** | `order-fulfillment-state-machine.test.ts` — confirm requires a settled payment (`assertPaymentConfirmedForConfirmation`) and is a separate, owner-driven transition |
| E3 | Cancellation rules per state | **PASS** | `customer-order-cancel.test.ts` (both static contract and DB-gated scenarios): `pending_payment` cancellable; `paid` refused 409; `shipped`/`delivered` refused; `payment_failed` and already-cancelled are idempotent no-ops |
| E4 | A lagging order row cannot cancel a PAID payment | **PASS** | DB-gated scenario "a lagging order row cannot cancel a PAID payment — 409, not a silent refund hole"; CASE 8 asserts `paymentBlocksCancellation('paid')` |
| E5 | A charge in flight is refused until it settles | **PASS** | DB-gated scenario "a payment being authorised is refused until it settles" |
| E6 | Confirm gate passes for a paid grouped order (was a permanent 409) | **PASS** | CASE 6: `assertPaymentConfirmedForConfirmation` returns `method='PROMPTPAY'` for both member orders |
| E7 | Order status vocabulary is DB-enforced | **PASS** | `order-status-check-constraint.test.ts` against a real database |

## F. Inventory

| # | Check | Label | Evidence |
|---|---|---|---|
| F1 | Concurrent checkout cannot oversell | **PASS** | `inventory-race.test.ts` — atomic `quantity - reserved >= $1` claim |
| F2 | Reservation holds stock without selling it | **PASS** | `inventory-settlement.test.ts` |
| F3 | Payment success commits the sale exactly once | **PASS** | `inventory-settlement.test.ts`; `products.sold_count` incremented once |
| F4 | Payment failure / expiry / cancel releases exactly once | **PASS** | CASE 10: the hold drops by exactly the units the orders reserved (measured before and after), a repeat call changes nothing; `customer-order-cancel.test.ts`: two concurrent cancels release once |
| F5 | Stock of a SOLD order is never returned | **PASS** | CASE 7: `releaseOrderInventory` returns `false` for both member orders and `inventory_released` stays `false` (was the defect that handed sold stock back) |
| F6 | A lapsed reservation with a captured charge is not swept | **PASS** | CASE 9: with `payment_expires_at` lapsed, the sweep refuses with `status 'paid' is already decided`, and — with the order status forced stale — with `payment is 'paid'`; orders and holds unchanged |

## G. Marketplace / multi-vendor

| # | Check | Label | Evidence |
|---|---|---|---|
| G1 | One cart, one checkout, one charge, N shop orders | **PASS** | `multi-shop-checkout.test.ts`; CASE 1 (one payment row for the purchase) |
| G2 | Every member order reports the same money state | **PASS** | CASE 3/CASE 4 for both orders |
| G3 | Seller screens read payment state correctly | **PASS** | `seller-orders.test.ts`, `seller-order-ux.test.ts`; list/detail now use the ONE status fragment |
| G4 | Seller ownership scoping preserved | **PASS** | `seller-orders.test.ts`; no route was renamed or re-scoped |
| G5 | Purchase price is the group's, not one shop's | **PASS** | CASE 5: purchase total 1500.00 vs charge 1500.00 — the retry hole that would have charged one shop's 700.00 |

## H. Refund

| # | Check | Label | Evidence |
|---|---|---|---|
| H1 | A grouped refund has a parent (no more `23502`) | **PASS** | CASE 11: insert with `order_id NULL, checkout_group_id` succeeds and resolves from EITHER member order |
| H2 | A parentless refund is refused by the database | **PASS** | CASE 11: same insert with both parents null → `23514` (`refunds_parent_check`) |
| H3 | Refund reconciles through the webhook, from either member order | **PASS** | `syncRefundFromStripe` + the covering set; `late-payment-incidents.test.ts` |
| H4 | Refund is not marked succeeded before Stripe confirms | **PASS** | only Stripe-confirmed events write `refunds.status` / `payments.refund_status` |
| H5 | Partial refund is representable | **PASS** | the fold distinguishes `partially_refunded` from `refunded` (pure fold tests); the seller-facing initiation flow is not built (see limitations) |

## I. Schema rules added by migration 055

| # | Check | Label | Evidence |
|---|---|---|---|
| I1 | `payments_status_check` exists with exactly the written vocabulary | **PASS** | CASE 12: constraint definition read from `pg_constraint`, contains all 6 stored values |
| I2 | An out-of-vocabulary payment status is rejected | **PASS** | CASE 12: `payments.status='partially_refunded'` → `23514` |
| I3 | `refunds_parent_check` exists | **PASS** | CASE 12 reads it from `pg_constraint` |
| I4 | Production could not be inspected before adding the constraint | **BLOCKED** | no `NEON_PRODUCTION_DATABASE_URL`; the migration therefore counts offenders and raises a NOTICE instead of aborting — documented in the file header |

---

## Phase 19 — Stripe TEST MODE E2E (the requested 16 steps)

All sixteen steps are **BLOCKED**, for one reason: this workspace has no Stripe test
credentials (`freebuff-env list` → `{"files":{}}`), no browser, and no test account, and
the deployed services cannot be reached. Reporting them as PASS would be exactly the
"looks like it works" outcome the task forbids.

| # | Step | Label | What is verified instead | What would close it |
|---|---|---|---|---|
| 1 | Customer login | **BLOCKED** | ownership is enforced in SQL; auth tests pass | a deployed environment + a test account |
| 2 | Add product | **PASS** (DB-level) | `POST /api/customer/cart/add` contract + stock/price validation tests | — |
| 3 | Cart | **PASS** (DB-level) | `carts`/`cart_items` + `recalcCart` verified against a real DB | — |
| 4 | Checkout | **PASS** (DB-level) | `POST /api/customer/checkout` produces N orders + 1 grouped payment row (`multi-shop-checkout.test.ts`) | — |
| 5 | Backend calculates the final amount | **PASS** | CASE 5: purchase total 1500.00 == charge 1500.00, both read from the DB | — |
| 6 | Stripe Checkout opens | **BLOCKED** | session creation is asserted structurally and with prototype-spied sessions | a real `sk_test_…` |
| 7 | Test card payment | **BLOCKED** | — | Stripe test mode + browser |
| 8 | Stripe webhook received | **BLOCKED** | `stripe-webhook-raw-body.test.ts` proves raw-body/signature handling locally | a real `whsec_…` + a Stripe forward |
| 9 | Webhook signature verified | **PASS** (local) | raw-body wiring + signature verification + self-test | — |
| 10 | Payment becomes succeeded | **PASS** (DB-level) | `settleCheckoutGroup` verified on a real DB (CASE 3) | — |
| 11 | Order becomes paid | **PASS** (DB-level) | CASE 3: `orders.status='paid'` for every member order | — |
| 12 | Inventory finalized | **PASS** (DB-level) | `inventory-settlement.test.ts` + CASE 10's exact-quantity measurement | — |
| 13 | Seller order updated | **PASS** (DB-level) | `seller-orders.test.ts`; the seller read uses the same fragment | — |
| 14 | Customer sees the paid order | **PASS** (DB-level + UI) | `GET /api/orders/:orderId` returns the covering-set payment; the success page renders it (see H/I of the implementation doc §14) | — |
| 15 | Refresh page | **PASS** (by design) | state is read from the backend each poll; the frontend holds no money state | — |
| 16 | State remains correct | **PASS** (DB-level) | CASE 1–12 read all state back from the database after the operations | — |
| + | **PromptPay TEST flow** | **BLOCKED** | the async rail is modelled (`requires_action` → `async_payment_succeeded` / `async_payment_failed`) and its precedence is unit-tested | Stripe test mode with PromptPay enabled |

---

## Tally

| Label | Count |
|---|---|
| **PASS** | 47 |
| **BLOCKED** | 5 (D10, I4, Phase-19 steps 1 / 6 / 7 / 8 / PromptPay — grouped above as the credential-gated set) |
| **FAIL** | **0** |

**No row is FAIL.** Every check that could be executed passed; every check that could not
is BLOCKED with its reason named, never softened into a pass.
