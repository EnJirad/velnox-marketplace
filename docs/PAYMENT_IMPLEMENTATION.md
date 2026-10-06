# PAYMENT — IMPLEMENTATION REPORT (Phase 25)

Delivered as ONE system: **Payment + Checkout + Order + Inventory + Webhook + State
Machine**, analysed as a whole before anything was changed. Companion documents:
`docs/PAYMENT_CURRENT_STATE.md` (audit), `docs/PAYMENT_TARGET_ARCHITECTURE.md` (design),
`docs/PAYMENT_E2E_CHECKLIST.md` (every test, labelled with its evidence).

---

## 1. Current architecture

One Express backend (`backend/`) over one PostgreSQL (Neon) and Cloudflare R2, with four
Vercel frontends (`apps/velshop`, `apps/velseller`, `apps/velcenter`, `apps/velnox`).
Payment is Stripe Checkout Sessions only; there is no card form, no PAN/CVC anywhere, and
no mock rail. A cart is split **one order per shop** under a `checkout_groups` row, and
the customer is charged **once** for the whole purchase. Google OAuth + JWT httpOnly
cookies; th/en/my.

The payment path as it stood: `POST /api/customer/checkout` (cart → validation → N orders
+ 1 payment row + 1 Stripe session) → Stripe → `POST /api/payments/stripe/webhook`
(signature → `payment_events` claim → `payments` → `orders` → inventory). Full detail,
including the three payment parents (`order_id`, `checkout_group_id`, `plan_id`) under one
authority, is in `PAYMENT_CURRENT_STATE.md`.

## 2. Problems found

Seven defects, all reproduced against a real reconciled database, all the same root cause:
**the payment ledger was addressed by one column (`payments.order_id`) when a purchase's
ledger is addressed by a set.**

| # | Defect | Consequence |
|---|---|---|
| 1 | A paid grouped purchase read as `'unpaid'` | `orders.status='paid'` rendered beside "ยังไม่ชำระ" |
| 2 | Confirm gate found no payment | 409 forever — a seller could never ship a paid order |
| 3 | Release guard found no settled payment | stock of a SOLD order could be handed back |
| 4 | Cancellation gate found no settled payment | a PAID purchase could be cancelled |
| 5 | Expiry sweep saw no live session | it could expire a purchase mid-payment, leaving the session payable |
| 6 | Grouped refund → 23502 (`refunds.order_id NOT NULL`) | webhook 500 → Stripe redelivered forever |
| 7 | Failure/expiry webhook paths were never group-aware | **money taken, nothing sold, no incident** (current-state doc, defect 7) |

Plus the structural finding: the same blind read was hand-written at **24 call sites**
across 8 files.

## 3. Target architecture

Implemented as designed — see `PAYMENT_TARGET_ARCHITECTURE.md`. In one line: the purchase
is addressable **as a set**; amounts are computed by the backend from database rows; the
signature-verified webhook is the only writer of `paid`; and the frontend has no vote on
whether money arrived.

## 4. Payment state machine

`pending → requires_action → processing → paid`, with `failed` / `cancelled` as terminal
branches and `refunded` / `partially_refunded` folded from `refund_status`. Vocabulary is
enforced by the database (`payments_status_check`, migration 055), and at most one live
Stripe payment per purchase is enforced by `idx_payments_one_active_stripe` and its
checkout-group twin.

The fold that readers see is **precedence, not recency**:

```
refunded > partially_refunded > paid > processing > (newest row's status)
```

so a fresh abandoned retry can never mask a captured charge. `foldPaymentRow` is the
same idea for a *row*: a money action gets the captured row, not the newest one.

## 5. Order state machine

`pending` / `pending_payment` → `paid` → `confirmed` → `packing` → `shipped` →
`delivered` → `completed`, with `cancelled` / `payment_failed` / `expired` / `refunded` /
`partially_refunded`. Twelve values, one `CHECK`, one `orders` table.

Enforced rules: payment success makes an order `paid` and **never** advances fulfillment
by itself; a settled payment blocks a cancellation whatever the order row says; the
customer may cancel only from the shared cancelable list; `packing` is not customer
cancelable; `shipped`/`delivered` go through return/refund. Confirm requires a settled
payment (`assertPaymentConfirmedForConfirmation`); cancel is refused with one
(`assertNoSettledPaymentForCancellation`).

## 6. Checkout flow

The eighteen-step flow in the target doc, implemented end to end. Two properties worth
naming:

- **Server-derived scope.** A request that names only an `orderId` (which is what the
  storefront's resume button sends) has its purchase derived **from the order row**
  (`readOrderPurchaseScope`). A grouped purchase therefore cannot be steered into the
  single-order branch — the hole that would have charged one shop's 700.00 beside a live
  group charge of 1500.00.
- **One charge, N orders.** The Stripe session is created once for the purchase, priced
  from the member order rows, with `checkoutGroupId` in both `metadata` and
  `payment_intent_data.metadata`.

## 7. Webhook flow

The eleven-step sequence in the target doc. Every failure/expiry case
(`checkout.session.async_payment_failed`, `checkout.session.expired`,
`payment_intent.payment_failed`, `payment_intent.canceled`) now takes a **group branch
first**, resolved by `checkoutGroupIdForAttempt`, and terminates the whole purchase
through `terminateCheckoutGroup`. `settleCheckoutGroup` returns the payment row id and the
group amount and, when it finds no payable order to settle, records a durable
late-payment incident (`recordLatePaymentIncident`) instead of leaving captured money
unaccounted for.

## 8. Idempotency strategy

Three layers, each described in the target doc §6: `payment_events.event_id UNIQUE` +
`ON CONFLICT DO NOTHING`; a request-key store scoped `checkout` vs `payment`; and guarded
`UPDATE`s that claim terminal transitions. The customer-visible guarantee: paying once
cannot reduce stock twice, create a second order, or send a second confirmation.

## 9. Inventory strategy

`available = quantity − reserved` is the only thing checkout guards on;
`reserveInventoryStock()` decrements availability atomically; a sale commits
`quantity`/`reserved`/`sold_count` exactly once; every release path converges on
`releaseOrderInventory()` with its atomic claim. The release guard's `NOT EXISTS` now uses
the covering set — the defect that would have returned the stock of a sold order. The
reservation sweep terminates a purchase as ONE unit and refuses while any covering payment
row is settled or in flight.

## 10. Refund strategy

Admin-initiated, Stripe-confirmed, webhook-reconciled (`syncRefundFromStripe`). The
payment lookup goes through the covering set, so a grouped charge's refund is found from
either member order; a full refund updates every member order; and `refunds` now
represents both parents. `payments.refunded_amount` / `refund_status` are the money truth;
the order status shows `refunded` / `partially_refunded`. The database refuses a refund
with no parent (`refunds_parent_check`).

## 11. Multi-vendor strategy

Reused, not rebuilt: `checkout_groups` + one `orders` row per shop. What changed is that
the purchase became addressable as a set for **every** money operation — reads,
confirmation, cancellation, expiry, refund — and that terminating a purchase is one
function (`terminateCheckoutGroup`) with one definition of "this purchase is over":
lock every member order in id order, read the settled status under the lock and refuse if
anything is settled, claim each order, release each order's stock through the ONE release
path, and void the charge last. A second call claims nothing and moves nothing.

## 12. Database changes

Migration `db/migrations/055_group_payment_refund_parent.sql` (mirrored in
`db/schema.sql` and `db/run-sqleditor.sql`):

| Change | Why |
|---|---|
| `refunds.order_id` → nullable (guarded on `is_nullable='NO'`) | a grouped charge's refund has no single order |
| `refunds.checkout_group_id UUID REFERENCES checkout_groups(id) ON DELETE SET NULL` | the second legitimate parent |
| `idx_refunds_checkout_group` (partial) | refund lookup by group |
| `refunds_parent_check CHECK (order_id IS NOT NULL OR checkout_group_id IS NOT NULL)` | a refund must name its parent, enforced by the DB |
| `payments_status_check` on the 7 written values | the vocabulary becomes a database rule |

`payments_status_check` is added **conditionally**: the migration counts offending rows
and raises a NOTICE (`velnox: payments_status_check NOT added - N row(s) …`) instead of
aborting under `ON_ERROR_STOP`. That divergence from the fail-loud style of 050 is
deliberate and documented in the file header: production cannot be inspected from this
workspace, and a constraint that cannot be added must not take down the updater.

Reconciler pin updated in `db/verify-reconciler.sh`: the canonical object counts grew by
exactly the objects above — `66|243|255|652` → `66|244|258|653`
(+1 column, +1 index, +3 constraints), re-measured on a fresh run.

**Note on `db/run-update.sql`:** the task brief lists it as a required sync target, but
`AGENTS.md` rule 4 states it must **never** be recreated. Only `db/schema.sql`,
`db/run-sqleditor.sql` and the new migration were written. `db/run-update.sql` remains
absent, as the standing rule requires.

## 13. API changes

No route was added, removed or renamed. Existing contracts were made correct:

| Route | Change |
|---|---|
| `GET /api/customer/orders` | `payment_status` / `payment_method` now resolve the covering set |
| `GET /api/customer/orders/:id` | same for `payment_status`; `payments[]` through `coveringPaymentsForOrder`; `paymentMethod` from the newest covering row |
| `PATCH /api/customer/orders/:id/cancel` | a grouped purchase terminates as ONE unit; responses additionally carry `checkoutGroupId` and `orderIds`; the same 409 codes (`ORDER_ALREADY_PAID`, `PAYMENT_IN_PROGRESS`) |
| `POST /api/stripe/checkout` | purchase scope derived server-side from the order; failure/expiry dispatch is group-aware |
| `POST /api/payments/stripe/webhook` | failure/expiry cases take a group branch first; `settleCheckoutGroup` records a late-payment incident; `syncRefundFromStripe` handles a grouped refund |
| `POST /api/admin/orders/:orderId/refund` | the captured row is chosen through the fold; the refund row names both parents |
| `GET /api/orders/:orderId` | payment resolved through the covering set (settled row first); refunds include group refunds |
| `GET /api/seller/orders`, `GET /api/seller/orders/:id` | payment status through the ONE SQL fragment |
| VelCenter orders | same fragment |

Response shapes are additive: existing fields keep their names and meaning.

## 14. Frontend changes

One file: `apps/velshop/src/pages/ShopCheckoutSuccess.tsx`. The payment line was hidden
whenever the backend sent `payment: null` — which is how a paid multi-shop purchase
rendered with no payment line at all. It is now always shown while the customer is
awaiting payment, with the existing `checkoutSuccess.verifyingPayment` copy when the
backend genuinely has no payment row yet. **The frontend decides nothing about money:**
the status label comes from the backend's own `payment.status`, and a settled order with
no payment row is treated as an incident to show, not to paper over. No other frontend
file was touched; `ResumePaymentButton` (which sends only `orderId`) is safe unchanged
because the backend now derives the scope. No new i18n keys — parity stays at
th=1496 / en=1496 / my=1496.

## 15. Environment variables

| Variable | Where | Required for |
|---|---|---|
| `STRIPE_SECRET_KEY` | backend only | creating sessions, refunds, verifying the SDK's client |
| `STRIPE_WEBHOOK_SECRET` | backend only | webhook signature verification (a blank secret cannot silently pass) |
| `STRIPE_PUBLISHABLE_KEY` | backend → browser | the publishable key only; never a secret |
| `DATABASE_URL` | backend | the payment authority (Neon) |
| `TEST_DATABASE_URL` | test runner only | DB-gated tests; refuses to run against a production-looking database |
| COD flag (literal `true`/`1`) | backend | enables the COD rail; **fails closed** when absent |

`STRIPE_*` names are read in `backend/lib/payment-config.ts:160-162`.

## 16. Stripe configuration

Stripe Checkout Sessions as the default architecture; one lazily created client
(`getStripe()`); test-mode-only guard; the payment method is mapped from the validated
server-side method (`CARD` → `card`, `PROMPTPAY` → `promptpay`, `COD` → no Stripe rail)
rather than being hardcoded; amount and currency come from the database rows. Card data,
PAN and CVC never reach this application. A signature self-test exists so a deployment
that cannot verify signatures is detected instead of quietly rejecting every webhook.

## 17. Test results

| Check | Result |
|---|---|
| `bun --filter @velnox/backend typecheck` | **exit 0** |
| `bun run typecheck` (velshop, velseller, velcenter, velnox) | **exit 0** (4/4) |
| `bun run build:apps` | **exit 0** (4/4) |
| `bun test backend/tests` against a freshly reconciled disposable DB | **2011 pass / 2 skip / 0 fail**, 2013 tests, 69 files, 14 785 expect() calls |
| `backend/tests/checkout-group-payment-visibility.test.ts` (new) | **18/18 pass** (6 pure + 12 DB-gated) |
| `bun run db:verify` | **exit 0 — 52 PASS, "RECONCILER PROOF: ALL SCENARIOS PASSED"** |
| `bun run i18n:check` | **exit 0** — th=1496 en=1496 my=1496, parity |
| `git diff --check` | clean |
| `bun run lint` | **not configured** in this repo (`"lint": "echo 'Lint not yet configured'"`) — reported, not claimed |

The 2 skips are the R2 upload-authz HTTP tests, which need R2 credentials that this
workspace does not have. They are unrelated to payment.

Five pre-existing source-shape tests failed after the change because they pinned the OLD
blind SQL verbatim (`checkout-group-sql-scope`, `checkout-payment-flow`,
`customer-order-cancel`, `dead-order-status-failed`) plus one that hardcoded the test
database's name. Each was updated to pin the NEW correct architecture — including a
strictly stronger assertion: the cancel contract now checks that a grouped refusal is
decided under the member-order locks *and* returns before the provider session is closed
or any socket event is published. No assertion was weakened, skipped or deleted.

## 18. Known limitations

1. **No real Stripe TEST-mode end-to-end run was performed.** This workspace has no
   `STRIPE_SECRET_KEY`, no `STRIPE_PUBLISHABLE_KEY`, no `STRIPE_WEBHOOK_SECRET`
   (`freebuff-env list` → `{"files":{}}`), no browser and no test account. Every
   verification in Phase 19 is therefore a **DB-level simulation with prototype-spied
   Stripe sessions against a real PostgreSQL** — real transactions, real constraints,
   real race gates, real webhook dispatch — but never a round trip through Stripe's
   servers. See `PAYMENT_E2E_CHECKLIST.md`.
2. **Production Neon is unreachable from this workspace.** Migration 055 could not be
   read against production or applied to it; object counts were measured only on freshly
   built databases, and `payments_status_check` is therefore added conditionally.
3. **Seller payouts and persisted commission do not exist** (audit §18/§19) — unchanged
   by this task, and out of its scope; they are listed as production requirements.
4. **Partial refunds are supported in the data model and the webhook reconciler, but not
   offered as a seller-facing initiation flow.**
5. **The four Vercel frontends and the Render backend could not be exercised as deployed
   services** — no deployment credentials. All verification is repository-level plus
   local process-level.

## 19. Remaining production requirements

1. Set the Stripe keys in the backend environment
   (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, test mode
   first) and register the webhook endpoint for
   `POST /api/payments/stripe/webhook`.
2. Apply migration 055 to production — via `db/run-sqleditor.sql` (the reconciler) or the
   migration file — then confirm the two new constraints exist and re-run the count
   assertion.
3. Run the real Stripe TEST-mode E2E (card + PromptPay-async) on a deployed environment
   and re-label the BLOCKED rows in `PAYMENT_E2E_CHECKLIST.md`.
4. Reconcile historical rows: any payment captured while orders were `expired` —
   the silent case in defect 7 — should be found and refunded or re-sold deliberately.
   The durable incident recorded by `recordLatePaymentIncident` is the query to start
   from (`payment_incidents`).
5. Decide and implement seller payout (Stripe Connect or an internal ledger) and persist
   commission per order.

---

## Verification artifacts

- New logic: `backend/lib/payment-attempt.ts` (490 lines), 
  `backend/lib/checkout-group-lifecycle.ts` (200 lines).
- New proof: `backend/tests/checkout-group-payment-visibility.test.ts` (539 lines).
- New schema: `db/migrations/055_group_payment_refund_parent.sql`.
- The audit's root cause was reproduced **before** the fix and re-proved **after** it, on
  a real database, by asserting that the OLD blind subquery returns `'unpaid'` while the
  order row says `paid` — the regression stays visible in the test suite so it cannot
  come back silently.
