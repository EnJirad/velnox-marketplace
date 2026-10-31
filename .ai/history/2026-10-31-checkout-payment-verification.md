# Checkout → Order → Payment verification (2026-10-31)

**Commit verified:** `fc6174160aba943385d24d7ebb7ddb57f31d1b35` (`origin/main == local HEAD`, branch `main`,
working tree clean).

**Scope:** verification only. No source, schema, Chat, or configuration change. Nothing was committed as
part of the verification itself.

**Verdict:** **PARTIAL** — the code paths and the automated suites pass; real Stripe TEST-mode E2E could not
be executed in this environment (no test-mode keys, no disposable database on the device).

---

## 1. How this was tested

| Layer | Method | Evidence |
|---|---|---|
| Repository state | `git fetch`, `git rev-parse`, `git status` | `HEAD == origin/main == fc61741`, clean tree |
| Production Stripe config | `GET /api/stripe/configured?selfTest=1` (read-only, no secrets returned) | `configured:true`, `mode:"test"`, `webhookConfigured:true`, `webhookSignatureSelfTest.verified:true` |
| Payment method discovery | `GET /api/payments/methods` | `CARD` + `PROMPTPAY` enabled, **`COD` enabled:false / customerSelectable:false** |
| Automated tests | `bun test backend/tests/<file>.test.ts` per file (21 files) | **335 pass / 168 skip / 0 fail** |
| Static checks | `bun run typecheck`, `bunx tsc -p backend`, `bun run build:apps`, `bun run i18n:check`, `git diff --check` | 4/4 · PASS · 4/4 · 1265/1265/1265 · clean |
| CI (full suite on this SHA) | GitHub Actions run `41145382171` (`Tests`) | **success — 1458 pass / 2 skip / 0 fail**, 74 files |

`TEST_DATABASE_URL` is absent on the device, so every DB-gated case **skipped** locally (168 tests). They are
*not* counted as passing; CI runs them against a disposable PostgreSQL and its run on this exact SHA is green.

### Environment variables (names only — no values were read or printed)

| Variable | Local | Note |
|---|---|---|
| `STRIPE_SECRET_KEY` | absent | E2E impossible without a **test-mode** key |
| `STRIPE_PUBLISHABLE_KEY` | absent | — |
| `STRIPE_WEBHOOK_SECRET` | absent | — |
| `STRIPE_MODE` | absent | — |
| `TEST_DATABASE_URL` | absent | 168 DB-gated tests skip |
| `COD_ENABLED` | absent (default off) | COD stays disabled |

Production runtime (probed read-only) reports `mode:"test"` with a `pk_test_…` publishable key and a webhook
secret whose self-test verifies — so the deployed rail is test-mode only, as designed.

---

## 2. Per-file test results (local execution)

| File | pass | skip | fail |
|---|---:|---:|---:|
| payment-foundation | 67 | 2 | 0 |
| payment-reservation-policy | 11 | 0 | 0 |
| payment-reservation-expiry | 38 | 22 | 0 |
| payment-cancellation-race | 4 | 21 | 0 |
| stripe-webhook-raw-body | 13 | 0 | 0 |
| webhook-resilience | 10 | 0 | 0 |
| checkout-payment-flow | 38 | 4 | 0 |
| checkout-test-payment-rail | 10 | 0 | 0 |
| checkout-group-payment-visibility | 6 | 12 | 0 |
| checkout-group-session-open | 7 | 13 | 0 |
| checkout-group-sql-scope | 6 | 9 | 0 |
| buy-now-checkout | 5 | 10 | 0 |
| multi-shop-checkout | 4 | 13 | 0 |
| inventory-settlement | 2 | 12 | 0 |
| late-payment-incidents | 10 | 8 | 0 |
| payment-attempt-identity | 7 | 6 | 0 |
| payment-webhook-schema-lag | 4 | 8 | 0 |
| customer-order-cancel | 23 | 14 | 0 |
| dead-order-status-failed | 26 | 4 | 0 |
| order-state-projection | 10 | 10 | 0 |
| reservation-urgency-contracts | 34 | 0 | 0 |
| **Total** | **335** | **168** | **0** |

Skips are the `hasTestDatabase()`-gated describes/cases; the structural halves of those same files ran.

---

## 3. Code paths traced (verified against the implementation, not comments)

| Stage | Location |
|---|---|
| Cart/Buy-Now → checkout request | `backend/routes/cart.ts:703` (`POST /api/customer/checkout`) |
| Address snapshot is server-built | `cart.ts:706–708` |
| Buy-Now vs cart exclusivity | `cart.ts:714–766` |
| Payment-method guard (COD fails closed) | `cart.ts:767–772`, `backend/lib/payment-config.ts:349–371`, `:387` |
| Multi-shop group creation | `cart.ts:1052` (`INSERT INTO checkout_groups`), `:1063` |
| Order row + group link | `cart.ts:116` |
| Inventory reservation | `cart.ts:1138` → `backend/lib/inventory.ts` |
| Payment request idempotency | `backend/routes/stripe.ts:736` (`ON CONFLICT (user_id, scope, request_key)`), `:2108–2132` |
| Reservation expiry refusal | `stripe.ts:2225` (`PAYMENT_RESERVATION_EXPIRED`), `:2509–2512` (`paymentExpiresAt`) |
| Stripe session creation | `stripe.ts:2053`, method mapping `:905` |
| Webhook (raw body + signature) | `stripe.ts:2546`, `constructEventAsync` `:217` |
| PromptPay delayed confirmation | `stripe.ts:1773` (`checkout.session.async_payment_succeeded`) |
| Payment → order settlement | `stripe.ts:1053` (`markPaymentSucceeded`) under `backend/lib/order-lock.ts` |
| Refund (covering set, idempotent) | `stripe.ts:2713`, `:2731–2738`, `:2754`, `:1620` |
| Expiry sweep | `backend/jobs/payment-reservation-scheduler.ts` |

**Defects proven:** none.

---

## 4. What remains unverified (and why)

| Item | Status | Blocker |
|---|---|---|
| Card success against real Stripe test mode | **BLOCKED** | no `sk_test_…` / `pk_test_…` in the environment |
| PromptPay QR + confirmation | **BLOCKED** | same, plus a real async payment event |
| Webhook delivery from Stripe (not self-test) | **NOT RUN** | requires a publicly reachable endpoint + configured endpoint secret |
| Refund executed against Stripe | **BLOCKED** | same credentials |
| DB-gated cases in this environment | **BLOCKED** | no `TEST_DATABASE_URL` (168 tests) |
| Browser UI checkout walkthrough | **NOT RUN** | no authenticated two-party session |

**Unblock checklist:** Stripe **test-mode** keys, a webhook secret for an endpoint pointing at the backend,
and a disposable PostgreSQL (`TEST_DATABASE_URL`). COD must stay off.

---

## 5. Risks recorded

| # | Severity | Item | Impact | Minimal fix |
|---|---|---|---|---|
| 1 | P3 | `.env.example` lists no `STRIPE_*` variables | a new developer cannot run the payment suites locally | add the variable *names* (no values) + a note on the disposable DB |
| 2 | P3 | production runs Stripe **test mode** | real customers cannot pay until live keys are configured | product decision, documented as TEST-MODE-ONLY |
| 3 | P3 | `schema_migrations` has 0 rows | no ledger proving which migration was applied | start recording, or retire the table |
| 4 | Info | multi-shop charges hang off the group (`order_id IS NULL`) | a naive `WHERE order_id = $1` refund query would 404 | keep the existing `coveringPaymentsForOrder` path |
