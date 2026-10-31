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

---

# Phase 2I addendum — real E2E attempt (2026-10-31)

**SHA re-checked:** `905835e78409f47138201dcda7617c63096e6dee` (`HEAD == origin/main`, branch `main`,
working tree clean before this addendum). The previous SHA was still current.

## Environment readiness (names/shapes only — no values read or printed)

| Variable | Result |
|---|---|
| `STRIPE_SECRET_KEY` | **ABSENT** |
| `STRIPE_PUBLISHABLE_KEY` | **ABSENT** |
| `STRIPE_WEBHOOK_SECRET` | **ABSENT** |
| `STRIPE_MODE` | **ABSENT** |
| `TEST_DATABASE_URL` | **ABSENT** |
| `COD_ENABLED` / `COD_CUSTOMER_SELECTABLE` | ABSENT (default off) |

Per the phase rules, the real payment tests **stopped here**. No credential was guessed and none was pasted.

## What was still executed safely

| Check | Result |
|---|---|
| 21 payment/checkout test files, run individually | **335 pass / 168 skip / 0 fail** (skips = `hasTestDatabase()`) |
| Full backend suite | **1100 pass / 370 skip / 8 fail** — the 8 are the Termux-only `test database guard` subprocess probes (`process.execPath` is Android's `linker64`); they pass on CI |
| Root typecheck | **4/4** |
| Backend `tsc --noEmit` | **PASS** |
| `build:apps` | **4/4** |
| `i18n:check` | **1265/1265/1265** |
| `git diff --check` | clean |
| Production `GET /api/stripe/configured?selfTest=1` (read-only) | `configured:true`, `mode:"test"`, `webhookConfigured:true`, `webhookSecretHealth` all true, **`webhookSignatureSelfTest.verified:true`**, publishable key shape `pk_test_*` |
| Production `GET /api/payments/methods` | `["CARD","PROMPTPAY"]`, `cod:{enabled:false, customerSelectable:false}` |
| Production webhook, unsigned/forged signature | `POST /api/payments/stripe/webhook` with a bogus `stripe-signature` → **HTTP 400** (signature rejected before any state change) |

## Scenarios not executed (and why)

| Scenario | Status | Blocker |
|---|---|---|
| Card payment via real Stripe test session | **BLOCKED** | no `sk_test_…` / `pk_test_…` |
| PromptPay QR + async confirmation | **BLOCKED** | same |
| Real webhook delivery from Stripe (incl. duplicate delivery) | **BLOCKED** | no configured Stripe endpoint secret for an account here |
| Payment failure + retry with same/new request key | **BLOCKED** | requires a real session to fail |
| Reservation expiry against a live clock + session close | **BLOCKED** | DB-gated (`TEST_DATABASE_URL` absent) |
| Customer cancellation closing the Stripe session | **BLOCKED** | requires Stripe to expire a real session |
| Refund executed against Stripe | **BLOCKED** | requires a captured test payment |
| Browser E2E (customer → seller → center) | **NOT RUN** | no authorized test accounts / no logged-in session |

## Exact prerequisites to unblock Phase 2I

1. `STRIPE_SECRET_KEY` = `sk_test_…` (test mode only) and `STRIPE_PUBLISHABLE_KEY` = `pk_test_…`.
2. `STRIPE_WEBHOOK_SECRET` = the `whsec_…` of a Stripe **test-mode** endpoint that points at the backend
   (`/api/payments/stripe/webhook`), plus network access for Stripe to deliver.
3. `TEST_DATABASE_URL` = a disposable PostgreSQL that is **not** production (the guard refuses Neon
   production hosts); this also unblocks the 168 skipped DB-gated cases.
4. Two authorized test accounts (customer + seller/staff) for the browser pass.
5. COD stays disabled.

## Verdict for this phase

**BLOCKED** — safe execution of the real payment E2E cannot start without the prerequisites above.
Everything that could be proven without them was proven, and no code, test, schema, Chat file or
production data was modified. This addendum is intentionally **uncommitted**.
