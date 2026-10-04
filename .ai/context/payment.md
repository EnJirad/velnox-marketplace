# PAYMENT — Stripe (TEST MODE ONLY), Card + PromptPay, COD OFF

## Purpose

Take money for an order through Stripe Checkout, reconcile the result from
webhooks, and keep order / payment / inventory state honest. **Stripe TEST MODE
ONLY** — a live-looking secret key is refused, never used.

## Source Locations

- `backend/lib/payment-config.ts` — the ONE decision point (mode, method discovery, COD flags, guard)
- `backend/routes/stripe.ts` — checkout, webhook, payment status, refund, order detail
- `backend/routes/cart.ts` — `POST /api/customer/checkout` (order creation) + same method guard
- `apps/velshop/src/pages/ShopCheckout.tsx` — storefront; renders only backend-enabled methods
- `backend/lib/payment-reservation.ts` — the ONE fixed 30-minute reservation policy (the window +
  the audited `reservation_policy` written on the order)
- `backend/jobs/payment-reservation-scheduler.ts` — the expiry sweep (`expired` + release + session close)
- DB: `payments`, `payment_events`, `refunds`, `orders`, `checkout_requests`, `inventory`
- `db/migrations/047_payment_foundation.sql`, `db/migrations/048_payment_reservation.sql`
  (+ the two canonical files)
- Tests: `backend/tests/payment-foundation.test.ts`, `payment-reservation-policy.test.ts`,
  `payment-reservation-expiry.test.ts`

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/stripe/configured` | `{configured, mode, publishableKey, reason}` — never a secret |
| GET | `/api/payments/methods` | backend-driven discovery; the storefront renders THIS list |
| POST | `/api/stripe/checkout` | `{orderId, method: CARD\|PROMPTPAY, requestKey?}` — requires auth. Refuses an order whose reservation window lapsed with **400 `PAYMENT_RESERVATION_EXPIRED`** BEFORE any session is created; the response carries `paymentExpiresAt` (ms) |
| POST | `/api/payments/stripe/webhook` | raw body, `constructEventAsync` signature check |
| GET | `/api/stripe/payment-status/:sessionId` | ownership-checked |
| POST | `/api/admin/orders/:orderId/refund` | `orders.manage` permission |
| GET | `/api/orders/:orderId` | payment + refunds included |

## Payment reservation window — FIXED 30 minutes (do not weaken)

An unpaid order holds its reserved stock for **exactly 30 minutes**
(`orders.payment_expires_at = created_at + 30 min`, `backend/lib/payment-reservation.ts`), not
forever and NOT a variable window. The duration is a constant on purpose: it must not depend on
popularity, product views or clicks, sales velocity, demand or behaviour signals — those belong to
VelRepeat. `orders.reservation_policy` still records the policy that produced a deadline
(`version: "v2"`, `reservationMinutes: 30`, `reason`); a `version: "v1"` row is a legacy risk-based
window (15–60 min, superseded). COD gets no window at all (nothing online is waited on). The deadline
is the backend's promise:

- `POST /api/stripe/checkout` refuses a lapsed window with **400 `PAYMENT_RESERVATION_EXPIRED`**
  **before** the Stripe session is created, so a charge is never started for an order the sweep is
  releasing in the same second;
- the Stripe session is created with `expires_at` = the deadline where Stripe allows it (its own
  bound is 30 min – 24 h), and closed explicitly by the sweep otherwise;
- once expired, the order is `expired` (terminal) and its stock is back on the shelf through
  `releaseOrderInventory()` — exactly once, even under concurrent sweeps;
- a `paid`/`processing` payment blocks the expiry, so a live or captured charge is never expired;
- **a late payment can never resurrect an expired order or reclaim another customer's stock:**
  `markPaymentSucceeded` requires a pre-payment status AND `inventory_released = FALSE`, records the
  money on the payment row (which is what makes it refundable) and logs
  `manual review/refund required` with the reason. No refund is invented in code — an operator
  decides.

### Storefront contract (presentation only)

- **One rule, both surfaces.** `paymentReservationPhase()`
  (`packages/shared/src/lib/commerce.ts`) returns `active` / `urgent` (the last
  `PAYMENT_RESERVATION_URGENT_MS` = 3 min — the documented `02:13` case) / `expired` / `none`, and
  `MyOrders.tsx` + `ShopOrderDetail.tsx` both read it, so an order can never look active on one
  surface and expired on the other. The list counts down per order and refetches when the tab
  becomes visible or a window lapses; the order page shows the clock as its hero. A paid, cancelled
  or shipped order shows NO countdown; a lapsed one shows the expired notice, never `-00:23`.
- **The clock never decides anything.** The frontend must not compute an expiry independently, and
  no status may ever be written from it — the backend deadline + the guarded writes are the source
  of truth (that is also why `GET /api/customer/orders` and `…/orders/:orderId` expose
  `paymentExpiresAt` in ms; the read is schema-tolerant, so a database without the column simply
  reports no window).
- **Pay again = choose the method AGAIN.** `ResumePaymentButton` always opens a chooser built from
  `GET /api/payments/methods` (never a hard-coded rail list), PRESELECTS the recorded rail and
  continues with the one the customer picks; a missing session URL is an error, never a redirect.
- **The only writer of `paid` is still the Stripe webhook.** Nothing in the reservation, countdown
  or chooser may mark an order paid.

## Rules (do not weaken)

- **Test mode only.** `classifyStripeSecretKey()` accepts `sk_/rk_test_`; live **and**
  unrecognized values are refused. `STRIPE_MODE` disagreeing with the key → refused.
  A missing `STRIPE_WEBHOOK_SECRET` means "payment unavailable" (no fallback).
- **The charge is DERIVED, never accepted.** `buildCheckoutLineItems()` builds the
  Stripe lines from `orders.total_amount` + currency; a shipping/fee remainder becomes
  its own line, a discount collapses to one line for the authoritative total. A client
  `amount` / `price` / `quantity` cannot move money.
- **Idempotency is DATABASE-BACKED** (no in-memory Map):
  - `checkout_requests` `UNIQUE (user_id, scope, request_key)` — checkout and payment
    keys share one store; a replay returns the stored response (`duplicate: true`).
  - partial unique index `idx_payments_one_active_stripe` — at most one live Stripe
    attempt per order.
  - `payment_events` claimed with `INSERT … ON CONFLICT (event_id) DO NOTHING`; a
    duplicate is acknowledged without re-running; a `failed` event is re-armed so
    Stripe's retry re-processes; a throwing handler returns **500** (redelivery).
- **Method switching is safe.** An open session for a *different* method is expired,
  never handed back; a race winner is reused only when `metadata.method` matches, else
  our own session is expired and the caller gets **409 `DUPLICATE_PAYMENT_IN_PROGRESS`**
  — never a fabricated success.
- **PromptPay is delayed-notification.** `checkout.session.completed` with
  `payment_status != "paid"` does **not** mark an order paid. Only
  `async_payment_succeeded` / `payment_intent.succeeded` / a `paid` session do
  (`sessionConfirmsPayment`).
- **A cancelled order can never become paid.** `markPaymentSucceeded` only moves orders from
  `pending`/`pending_payment`, so a `cancelled` order stays cancelled even if a verified
  success event arrives (funds are still recorded on the payment row — that is what makes the
  case refundable — and logged for an operator). Customer cancellation also **expires the
  abandoned Checkout Session first** (`expireStripeCheckoutSession()`), so the old Stripe tab
  cannot charge an order that is no longer payable. The cancel endpoint itself is documented
  in `checkout.md`; its rule is `orderCustomerCancelability()` in `packages/shared`.
- **One lock order — the ORDER row is locked FIRST, by every writer.**
  `backend/lib/order-lock.ts` defines the contract: any transaction that writes more than one
  of `{orders, payments, refunds, order_items}` opens with
  `SELECT … FROM orders WHERE id = $1 FOR UPDATE`. Cancellation (`cart.ts`), settlement
  (`markPaymentSucceeded`), failure/expiry webhooks (`markPaymentFailed`,
  `markPaymentCanceled`), the refund sync and the reservation sweep all obey it. It matters
  because those transactions used to take the two rows in OPPOSITE orders (cancel =
  `orders` → `payments`; the failure/cancel handlers = `payments` → `orders`), which is an
  AB-BA deadlock PostgreSQL breaks by aborting one side — a 500 on the customer's cancel, or
  a `failed` event Stripe must redeliver, with the winner decided by lock timing rather than
  by the business rule. The cancel route ALSO re-reads the payment state **under** that lock
  (`paymentBlocksCancellation` → `paid`/`processing` still refuse with `ORDER_ALREADY_PAID` /
  `PAYMENT_IN_PROGRESS`), so its money gate is authoritative instead of a read-then-write
  check. Pinned by `backend/tests/payment-cancellation-race.test.ts` (structural contract +
  forced-interleave probes, including a `FOR UPDATE NOWAIT` read of `payments` that fails
  with `55P03` if any path locks the rows in the wrong order).
- **Order ↔ payment are separate lifecycles.** Payment states: `pending`,
  `requires_action`, `processing`, `paid`, `failed`, `cancelled`, plus
  `refunded_amount` / `refund_status`. Paired transitions only: `paid`→`paid`,
  `failed`→`payment_failed`, expired/canceled→`cancelled`, full refund→`refunded`;
  reserved stock is released exactly once.
- **Refunds are webhook-confirmed.** Submit records `pending` and calls Stripe with a
  deterministic idempotency key (`velnox-refund-…`); final state comes from the provider
  + `charge.refunded` / `refund.updated|failed`, which **recompute** `refunded_amount`
  from succeeded rows (`refundableMinorFor` is never negative). Over-refund is rejected
  before Stripe is called. A duplicate request matching a `pending`/`succeeded` refund
  replays it.
- **COD fails closed.** `COD_ENABLED` / `COD_CUSTOMER_SELECTABLE` default off; only the
  literal `true`/`1` counts (`"yes"`, `"'true'"`, empty, misspelled stay off), and
  customer-selectable can never be true while the rail is off. `method=COD` →
  **403 `PAYMENT_METHOD_DISABLED`** before any order/payment/shipment/settlement write,
  independently of Stripe's state.
- The secret key never leaves server-side callers; only a **test** publishable key can
  reach a browser.

## Verification

- `bun test backend/tests/payment-foundation.test.ts` — config, live-key refusal, COD
  fail-closed, webhook signature reject **and** accept, COD bypass 403, line-item
  reconciliation, refundable arithmetic, PromptPay unpaid-session trap, secret-leak
  checks; plus two DB-gated suites (webhook duplicate delivery, refused COD writes
  nothing) that need `TEST_DATABASE_URL` (`.ai/context/testing.md`).
- CI `.github/workflows/test.yml` runs them against a disposable `postgres:16`.
- **Stripe E2E (real PaymentIntent / PromptPay QR / webhook delivery / refund) is
  BLOCKED in any workspace without test credentials.** Never report it as passed
  without an executed round trip. TASK 006/007/008 records (2026-09-25/26): the
  credential gate (`freebuff-env list` → `{"files":{}}`) is unchanged, and the app's
  own `stripeStatus()` still reports
  `{"usable":false,"mode":null,"reason":"STRIPE_NOT_CONFIGURED"}` with COD off —
  **no PaymentIntent, PromptPay QR, webhook delivery or refund has ever been
  executed**. Executed and passing instead: live-key refusal, fail-closed COD flags,
  webhook signature reject **and** accept, webhook duplicate delivery
  (`payment_events` claim), and the DB-gated *a refused COD attempt writes nothing*.
  Still **CODE VERIFIED only → BLOCKED**: checkout request-key replay, the
  `idx_payments_one_active_stripe` single-active-session race, method switching,
  inventory/stock transitions, and order↔payment sync. **Production payment
  readiness: NOT CLAIMED.** Full records:
  [`.ai/history/archive/AI_Handoff-2026-09-26-stripe-e2e-tasks.md`](../history/archive/AI_Handoff-2026-09-26-stripe-e2e-tasks.md)
  (handoff §18 stub).

## Unblock (owner actions)

Add `STRIPE_SECRET_KEY` (`sk_test_…`), `STRIPE_PUBLISHABLE_KEY` (`pk_test_…`),
`STRIPE_WEBHOOK_SECRET` (`whsec_…`), optionally `STRIPE_MODE=test`, and
`TEST_DATABASE_URL` pointing at a disposable PostgreSQL
(`psql "$TEST_DATABASE_URL" -f db/run-sqleditor.sql`).

As of **2026-09-27** the names and the sandbox webhook setup (endpoint path + the 11
handled event types + the CLI-vs-endpoint secret rule below) are documented in
`INSTALLATION.md` §4 and its *Backend (ALL secrets)* reference table, and in
`docs/ENVIRONMENT.md`. **`.env.example` still lacks the Stripe/COD lines:** that file is
in the agent tooling's protected set ("Sensitive files cannot be changed"), so adding
them there is an owner edit by hand.

## Webhook signature — the boundary that decides 400 vs 2xx

`POST /api/payments/stripe/webhook` verifies `STRIPE_WEBHOOK_SECRET` over the **raw
bytes**, so every 400 in the Render log means that request did not verify. Three
distinct causes produce the *same* Stripe message ("No signatures found matching the
expected signature for payload"). Separate them in this order:

1. **The request did not come from the endpoint.** `stripe listen --forward-to
   <production-url>` signs with its own **per-session** secret, so forwarding to
   production ALWAYS 400s unless the production secret is that session's secret — which
   the rules forbid. A CLI 400 is therefore **expected** and is *not* evidence of a
   defect. The authoritative test is a real delivery to the `velpay` endpoint
   (Dashboard → Developers → Webhooks → recent deliveries → `2xx`); `stripe trigger
   <type>` **without** `--forward-to` also delivers to the configured endpoint.
2. **The value is not that endpoint's secret** — a leftover CLI session secret, a secret
   from a deleted/recreated endpoint or another account, or a value pasted with its
   wrapping quotes still on it. Render's variable is unreadable from the sandbox, so
   this is checked by **shape, never by value**: `GET /api/stripe/configured` →
   `webhookSecretHealth` (`shapeUsable: false` = every delivery 400s while
   `webhookConfigured` still reads `true`).
3. **The raw body was lost** — a wiring regression, not a signature one: if
   `express.json()` parsed the body first, the SDK hashes a re-serialised object and
   EVERY genuine delivery 400s while the endpoint still looks like it enforces
   signatures. `backend/middleware/stripe-raw-body.ts` owns that gate (mounted before
   `express.json()` in `server.ts`), `backend/tests/stripe-webhook-raw-body.test.ts`
   exercises the real middleware (not a copy), and the handler answers
   `500 "Webhook body was not preserved for signature verification"` — never the
   misleading 400 — when the body is not raw.

**DB read verdict (2026-09-27).** `payment_events` is the delivery record — a row exists only
*after* a delivery passed verification — so it is the one place that settles whether the
signature boundary is the problem. It cannot be read from the sandbox or from CI: the only URL
available there (`NEON_DATABASE_URL`) is refused with `ERROR: Your account or project has
exceeded the quota` on **3/3** psql steps (Actions run `36336902638`), **while production's own
DB-backed read `GET /api/shops` answers 200 with rows at the same moment**.

**Proven by data, 2026-10-04.** That secret is not merely refused — it points at a
*different database*. The Actions database holds **1** shop (`5d56f6f8…/eloop`); the live host
serves **2** (`26d65318…/home-tech`, `91f4b9bf…/velnox-support`). Disjoint sets, so the quota
error was never the finding — it was a symptom of the wrong target. It is also why
migration `054` could be "successfully applied" while production still raised `42P01` on
`checkout_groups`. Full evidence and the fix are in `database.md` § Migration Workflow. Until
the secret is re-pointed at the project Render owns, the DB half of any Stripe or schema
investigation stays unverified.

Checks that prove things about the **deployment**, in the order they become available:

* `GET /api/stripe/configured` returning `webhookSecretHealth` proves the host is
  running this revision (the field did not exist before it).
* `GET /api/stripe/configured?selfTest=1` → `webhookSignatureSelfTest.verified: true`
  signs a throwaway payload with the deployed secret and verifies it through the same
  SDK call the webhook uses, so it rules out (3) and any WebCrypto/runtime defect
  without revealing anything. `verified: false` is a code defect; `verified: true`
  with a 400 on a real endpoint delivery is cause (2) — an owner-side value fix.
* The handler logs `webhook_received` → `signature verified` → `claimed — dispatching`
  → `processed`, each with elapsed ms, so Render's log names the last stage that
  completed. No secret, signature, payload, token or cookie is ever logged.

## Stripe Connect / marketplace payout — **MISSING**

This repository has **no Stripe Connect implementation**: no connected account, no
`accountLink`/onboarding, no `transfer_data` / `application_fee` / `on_behalf_of`, no
seller↔Stripe account mapping, no KYC state, no Stripe payout. The customer is charged
through the platform's own Stripe account; seller amounts are **internal accounting only**
(`commissions`, `settlements`, `backend/lib/seller-stats.ts`). `payouts.process` was
deliberately removed from the permission catalog because no payout endpoint, table or
screen exists (`backend/lib/permissions.ts:28-29`, guarded by `center-rbac.test.ts`).

**`CHECKOUT READY` never implies `MARKETPLACE PAYOUT READY`.** Building Connect is out of
scope until an owner asks for it.

## Order status vs payment status — two concepts, two renderings

`orders.status` (free text, written by the Stripe routes and the seller) and `orders.payment_status`
are different things and must stay separately readable on the customer's order screens:

* **Order status text** comes from the dictionaries via `orderStatusI18nKey()` + the `orderStatus`
  namespace (th/en/my, all 11 statuses + `unknown`). `ORDER_STATUS_META.label` is Thai-only and is
  the **seller-side fallback** — never render it in VelShop. Tokens (`meta.badge` / `meta.dot`) stay
  shared, and `getPaymentStatusBadge()` resolves the payment pill for any status the API returns.
* **Payability** is decided by ONE shared rule, `orderStripePayability()`: only `pending` /
  `pending_payment` with a live window and a Stripe rail (`CARD` / `PROMPTPAY`). `payment_failed`,
  `expired`, `cancelled`, `refunded` and COD orders get **no** pay button — for `payment_failed` the
  sweep already released the stock, so the page shows the failure notice (and "buy again") rather
  than a deadline or a retry the backend would refuse.
* **"Cancel order" is not "leaving Stripe"**: the cancel button follows `orderCustomerCancelability()`
  and the server's guarded cancel; abandoning the hosted checkout leaves the order unpaid with its
  ORIGINAL `payment_expires_at` (nothing client-side may reset or extend it).

The window itself is FIXED 30 minutes (see *Payment reservation window* above) and the backend remains
its only enforcer.

Related: `checkout.md`, `customer.md`, `security.md`, `testing.md`, `database.md`.

## Countdown not visible in production (2026-09-28) — diagnose before adding timers

Reported as "the 30-minute countdown exists in source but customers never see it". Every link was
traced; only one is broken, and it is **not** in application code.

| # | Link | Result |
|---|------|--------|
| 1 | order creation → `orders.payment_expires_at` | `applyPaymentReservationPolicy()` — the **ONE** writer, inside the checkout transaction; skips on `isUndefinedColumnError` (deploy-order guard) |
| 2 | `GET /api/customer/orders` → `paymentExpiresAt` | mapped (`cart.ts`, `SELECT o.*` + `new Date(r.payment_expires_at).getTime()`), pinned to 2 occurrences by test |
| 3 | `GET /api/customer/orders/:id` → `paymentExpiresAt` | same mapping, ms, `null` when the row has no window |
| 4 | client object → `StoreOrder.paymentExpiresAt?: number \| null` | survives the transformation (no stripping layer) |
| 5 | `paymentReservationState(order, now)` | +30 min → `hasWindow true`, `expired false`, `1 800 000`, `30:00` · +29 min → `1 740 000` · +10 s → `urgent` · −1 s → `expired`, `0`, `00:00` (never negative) · `null` → `none` (no clock) |
| 6 | status gate | `PAYABLE_ORDER_STATUSES = pending \| pending_payment`; `paid`/`payment_failed`/… → `none` |
| 7 | `MyOrders` / `ShopOrderDetail` | per-card countdown at the bottom-left; ONE `setInterval(…, 1000)` per page, cleared on unmount, refetched on `visibilitychange`; the gate is the phase only — **never** the payment method |
| 8 | **production database** | ❌ **root cause** — no `orders.payment_expires_at` |

**Evidence for (8).** `Migrate Neon Database` run `36371800184` (2026-09-28 02:57Z) and `36437470328`
(14:38Z) both failed with `psql: … ERROR: Your account or project has exceeded the quota`; the last
**successful** migrate was 2026-09-25 17:29Z, before 048 existed (048 is dated 2026-09-28). The
read-only probe added by `chore(ci): probe the production reservation columns` hit the identical quota
at 16:12Z (run `36449336393`). With the column absent: the guard skips the write, `SELECT o.*` simply
omits it → `paymentExpiresAt: null` → `phase "none"` → nothing to render, **no error anywhere**.
That silence (the §37 deploy-order net working as intended) is exactly why it looked like a frontend
bug. So the countdown code, the API contract and the deployed frontend are all fine — the runtime
clock simply has no deadline to count down from.

**Ruled out with runtime evidence.** The deployed Vercel bundle for `velshop.vercel.app` contains
§39's markers (`orderDetail.paymentFailedTitle`, `orderDetail.shipTo`, `aria-current`, the Thai
`ชำระเงินอีกครั้ง`), so production is running the countdown code, not an older build. CI on
`9442e2a`: **920 pass / 0 fail / 2 skip**, including the new
"the reservation deadline must reach the screen (regression)" cases in `order-ux-polish.test.ts`.

**One-line check (owner, Neon SQL Editor — read-only):**

```sql
SELECT column_name, COALESCE(data_type, 'MISSING (048 not applied)') AS state
FROM (VALUES ('payment_expires_at'), ('reservation_policy')) AS want(column_name)
LEFT JOIN information_schema.columns c
       ON c.table_name = 'orders' AND c.column_name = want.column_name;
```

**Fix (owner):** clear the Neon quota → run Actions *Migrate Neon Database*, or paste
`db/migrations/048_payment_reservation.sql` (additive, idempotent) into the SQL Editor → **place a
NEW order**. Orders created before the column exists keep `NULL` forever by design (no window was
ever taken), so they will never show a countdown — do not treat that as a bug.

Once the column exists nothing else needs changing: the writer, the reads, both pages and the sweep
are already deployed and CI-verified.

Related: `checkout.md`, `database.md`, `testing.md`.
