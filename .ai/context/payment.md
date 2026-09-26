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
  BLOCKED in any workspace without test credentials** — see `.ai/AI_HANDOFF.md` §16/§18.
  Never report it as passed without an executed round trip.

## Unblock (owner actions)

Add in Settings → Environment: `STRIPE_SECRET_KEY` (`sk_test_…`),
`STRIPE_PUBLISHABLE_KEY` (`pk_test_…`), `STRIPE_WEBHOOK_SECRET` (`whsec_…`), optionally
`STRIPE_MODE=test`, and `TEST_DATABASE_URL` pointing at a disposable PostgreSQL
(`psql "$TEST_DATABASE_URL" -f db/run-sqleditor.sql`). `.env.example` does not document
`STRIPE_*` / `COD_*` yet and agent tooling cannot edit it — add them by hand.

Related: `checkout.md`, `customer.md`, `security.md`, `testing.md`, `database.md`.
