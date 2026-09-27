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
- DB: `payments`, `payment_events`, `refunds`, `orders`, `checkout_requests`, `inventory`
- `db/migrations/047_payment_foundation.sql` (+ the two canonical files)
- Tests: `backend/tests/payment-foundation.test.ts`

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/stripe/configured` | `{configured, mode, publishableKey, reason}` — never a secret |
| GET | `/api/payments/methods` | backend-driven discovery; the storefront renders THIS list |
| POST | `/api/stripe/checkout` | `{orderId, method: CARD\|PROMPTPAY, requestKey?}` — requires auth |
| POST | `/api/payments/stripe/webhook` | raw body, `constructEventAsync` signature check |
| GET | `/api/stripe/payment-status/:sessionId` | ownership-checked |
| POST | `/api/admin/orders/:orderId/refund` | `orders.manage` permission |
| GET | `/api/orders/:orderId` | payment + refunds included |

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
DB-backed read `GET /api/shops` answers 200 with rows at the same moment**. That secret therefore
does not point at the database Render uses (§22/§31); re-pointing it at the project Render owns
(and restoring its quota) is an owner action, and until then the DB half of any Stripe
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

Related: `checkout.md`, `customer.md`, `security.md`, `testing.md`, `database.md`.
