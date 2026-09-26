# Task — Stripe TEST Mode E2E verification (payment E2E gate)

Status: completed — **STRIPE TEST E2E: BLOCKED** (`BLOCKED — Stripe TEST credentials unavailable`)
Assigned: 2026-09-26 · Recorded: 2026-09-26T01:59:09Z
Base commit: `0712c70be7a4017365dc41b2b94d117b737cf5e0` (= `origin/main` at the time of
this run; the sandbox was synchronized per `.ai/AI_RULES.md` §0 before any inspection)

## Objective

Execute a real Stripe TEST-mode E2E round trip (Card, PromptPay, idempotency,
concurrent checkout, duplicate webhook, failed payment, refund, COD fail-closed) —
or, when no Stripe TEST credential exists, stop the E2E portion, prove everything
that can be proven without Stripe, and report the exact BLOCKED state.

**Outcome: the E2E portion is BLOCKED.** No Stripe API call was made. No mock, stub,
or recorded response was substituted, and nothing here is reported as E2E.

## Allowed Scope (as executed)

Verification only. **Zero lines changed** in `backend/routes/stripe.ts`,
`backend/lib/payment-config.ts`, `db/migrations/` and `db/*.sql`; no table added, no
provider added, no payment state semantics touched, COD not enabled, no live
credential, no production database.

## 1. Environment

| Item | Observed |
|---|---|
| Workspace | Freebuff sandbox (`/home/daytona/codebase`), branch `main` |
| Local HEAD == `origin/main` | `0712c70be7a4017365dc41b2b94d117b737cf5e0` (verified by `git fetch` + `git rev-parse`) |
| Working tree | clean before and after the run |
| Stripe mode | **not configured** → no Stripe object, event, or credential exists |
| Database used for tests | disposable local PostgreSQL 14 (`velnox_test`), never Neon |
| Production systems touched | **none** (no production API call, no production DB, no live key) |

## 2. Credential gate — BLOCKED

`freebuff-env list` → `{"files":{}}` — the workspace defines **no** environment keys.
A second, app-level probe (secret-free output; only the app's own decision point):

```
bun -e 'import("./backend/lib/payment-config.ts").then(m => console.log(JSON.stringify(m.stripeStatus())))'
→ {"usable":false,"mode":null,"publishableKey":null,"publishableKeyMatchesMode":false,
   "webhookConfigured":false,"reason":"STRIPE_NOT_CONFIGURED"}
codEnabled: false | codCustomerSelectable: false
methods: CARD enabled:false · PROMPTPAY enabled:false · COD enabled:false
```

| Required credential | State |
|---|---|
| `STRIPE_SECRET_KEY` (`sk_test_…`) | **unset** |
| `STRIPE_WEBHOOK_SECRET` (test sign secret) | **unset** |
| `STRIPE_PUBLISHABLE_KEY` (`pk_test_…`) | **unset** |
| `STRIPE_MODE` | unset (would default to test-only anyway) |
| `TEST_DATABASE_URL` / disposable DB | **available** (disposable local PostgreSQL 14) |

→ **`BLOCKED — Stripe TEST credentials unavailable`.** The Stripe E2E portion stops
here, as the brief requires. No value of any key was read, printed, or logged.

## 3. Test database isolation (Phase 2) — PASS

| Proof | Command shape | Result |
|---|---|---|
| Production-looking target is REFUSED | `env -u TEST_DATABASE_URL NODE_ENV=test DATABASE_URL="postgresql://…@ep-ci-guard-check.us-east-2.aws.neon.tech/velnox?sslmode=require" bun -e 'await import("./backend/db/index.ts")'` | printed `REFUSING TEST AGAINST PRODUCTION DATABASE` → refused, non-zero exit (**expected**) |
| Disposable target is ACCEPTED | same probe **with** `TEST_DATABASE_URL` → disposable DB | accepted, exit 0 — and it ignores the production-looking `DATABASE_URL`, which is the pinned precedence |
| Guard suite | `bun test backend/tests/test-database-isolation.test.ts` | **39 pass / 0 fail / 109 assertions** |
| CI guard step | `.github/workflows/test.yml` → *Verify the guard refuses production* | ran in run `36209255216`: `✅ Disposable test database accepted as expected.` |

The disposable database was bootstrapped once from `db/run-sqleditor.sql` (**59
tables**). No test connected to Neon; no production row was read or written.

## 4. Phase 3 — implementation already contains every required property (no change needed)

Each row is a source citation, not a claim. Line numbers are for
`0712c70` and stay valid for the current `main` lineage.

| # | Required property | Where it lives | Proof |
|---|---|---|---|
| 1 | **Stripe TEST-mode enforcement** | `backend/lib/payment-config.ts:117-130` (`classifyStripeSecretKey` / `…PublishableKey`), `:182` (`STRIPE_LIVE_KEY_REFUSED`), `:168-190` (`stripeStatus`) | only `sk_/rk_test_` is `test`; `…_live_` → refused; unrecognized → refused; `mode` can only ever be `"test"` when usable |
| 2 | **Authoritative order amount** | `backend/routes/stripe.ts:736-739` (`toMinor(order.total_amount)`), `:159-201` (`buildCheckoutLineItems`) | the charged minor amount comes from the order row, reconciled exactly; client `amount`/`price`/`quantity` never determine the charge |
| 3 | **Checkout idempotency** | `backend/routes/stripe.ts:756-776` (`checkout_requests`, `scope='payment'`, `ON CONFLICT (user_id, scope, request_key)`) · `db/migrations/047_payment_foundation.sql:56-74` · `db/schema.sql:391,395` | one durable row per (user, scope, request key); a retry replays the stored response |
| 4 | **One active Stripe payment per order** | `db/migrations/047_payment_foundation.sql:27` (`idx_payments_one_active_stripe`, partial unique index) · `backend/routes/stripe.ts:100` (23505 detection), `:792`, `:973` (`409 DUPLICATE_PAYMENT_IN_PROGRESS`) | a second active attempt cannot be inserted; the loser is answered with the winner's session or a 409 — never a fabricated success |
| 5 | **Webhook signature verification** | `backend/routes/stripe.ts:1015-1039` (`stripeWebhookSecret()`, `stripe-signature` required, `constructEventAsync`) · raw-body branch in `backend/server.ts:43-50` | verified against the **raw** body; unconfigured → 503 rather than acking an unverifiable event; bad signature → 400 |
| 6 | **Duplicate webhook protection** | `backend/routes/stripe.ts:1049-1086` (`INSERT … ON CONFLICT (event_id) DO NOTHING`, `failed`-event re-arm, `duplicate: true`) | the second delivery of the same `event.id` is acknowledged without re-running the sync |
| 7 | **Refund idempotency** | `backend/routes/stripe.ts:1232` (deterministic key `velnox-refund-<payment>-<alreadyRefunded>-<requested>`), `:358` (`refunds` keyed by provider id), `:1165` (`alreadyRefundedMinor`), `:1198-1221` (replay `duplicate: true`) · `047:51` (`idx_refunds_provider_refund`) | over-refund is rejected before Stripe is called; a repeated request replays instead of double-refunding |
| 8 | **COD fail-closed** | `backend/lib/payment-config.ts:227-242` (`isCodEnabled` / `isCodCustomerSelectable` — literal `true`/`1` only), `:298-320` (`assertPaymentMethodUsable` → `403 PAYMENT_METHOD_DISABLED`) · enforced in `backend/routes/cart.ts:756` and `backend/routes/stripe.ts:690` | default off; a direct API attempt is refused **before** the first database read |

**No implementation change appears necessary → none was made** (per the brief: report
rather than redesign). The only code delta in this task lineage is a **test** added in
`0712c70` (DB-backed COD no-write proof, +59 lines).

## 5. Phase 4 — real Stripe TEST E2E: NOT RUN (BLOCKED)

| # | Flow | Status | Reason / what would be required |
|---|---|---|---|
| 1 | **Card success** (test checkout → test card → real webhook → payment/order paid → inventory once) | **BLOCKED** | needs `sk_test_…` + test webhook secret; no Checkout Session can be created |
| 2 | **PromptPay** (TEST PromptPay checkout → async event → delayed handling) | **BLOCKED** | needs a live Stripe TEST account (PromptPay is THB-only at Stripe) |
| 3 | **Checkout idempotency** (same request key twice → one logical result) | **BLOCKED** | the replay path sits behind `getStripe()`; without a key the request stops at `503 STRIPE_NOT_CONFIGURED` before the idempotency layer |
| 4 | **Concurrent checkout** (no duplicate active Stripe payment) | **BLOCKED** | needs a real session to race; the DB index that enforces it exists (`idx_payments_one_active_stripe`) and is exercised by the schema tests |
| 5 | **Duplicate webhook** (same real Stripe event twice → processed once) | **PARTIAL — executed without Stripe**: a correctly-signed event (local HMAC + fake `whsec_`) delivered twice to the real route against the real DB → `payment_events` = 1 row, `status = processed`, second response `{duplicate:true}`. **A real Stripe-hosted delivery/retry remains BLOCKED** |
| 6 | **Failed payment** (official failing test method → failure event → payment failed, order not paid) | **BLOCKED** | needs Stripe; the state mapping is source-verified (`failed`→`payment_failed`) |
| 7 | **Refund** (admin refund path → TEST refund → real refund webhook → `refunded_amount` → no double refund) | **BLOCKED** | needs a paid TEST payment; arithmetic/replay/over-refund rejection are covered by tests only |
| 8 | **COD fail-closed** | **PASS — executed** | 403 `PAYMENT_METHOD_DISABLED` on both checkout endpoints, and a DB read-back proves **no** order / payment / shipment / settlement / `checkout_requests` row for the caller, with a non-vacuity control |

## 6. What was executed instead of E2E (executed evidence)

| Check | Result |
|---|---|
| `bun test backend/tests` with the disposable DB | **560 pass / 2 skip / 0 fail** (562 tests, 24 files) |
| `bun test backend/tests/payment-foundation.test.ts` | **61 pass / 0 fail** (incl. webhook duplicate delivery + COD no-write, both DB-backed) |
| `bun test backend/tests` with no DB (skip path intact) | **523 pass / 39 skip / 0 fail** |
| `bun test backend/tests/test-database-isolation.test.ts` | **39 pass / 0 fail** |
| `bun test backend/tests/schema-drift.test.ts backend/tests/migration-numbering.test.ts` | **57 pass / 0 fail** |
| backend `bunx tsc --noEmit` | exit 0 |
| `bun run typecheck` (4 apps) | 4/4 exit 0 |
| `bun run i18n:check` | th=1295 · en=1295 · my=1295, parity |
| `db/schema.sql` vs `db/run-sqleditor.sql` | identical |
| `db/run-update.sql` | absent |
| `git diff --check` | clean |
| CI on `0712c70` (run `36209255216`) | **success** — guard step OK, suite 560 / 2 / 0; the new COD test and the webhook-idempotency test both ran in CI |

The 2 skips are the R2-credential upload cases, unrelated to payment.

## 7. What remains unproven (do not read as PASS)

- No PaymentIntent, Checkout Session, PromptPay QR, Stripe-hosted webhook delivery,
  Stripe refund, or Stripe retry has **ever** been executed in this repository's
  agent workspace.
- Checkout request-key replay, the single-active-session race, and method switching
  are **CODE VERIFIED only**.
- Inventory/stock transitions tied to a paid Stripe session are **BLOCKED**.
- VelShop checkout UI has not been opened in a browser in this environment.

## 8. Evidence locations

- `.ai/AI_HANDOFF.md` §16 (TASK 006, BLOCKED) · §18 (TASK 007, re-verification + executed evidence)
- `.ai/context/payment.md` (live payment reference: endpoints, rules, unblock steps)
- `.ai/context/testing.md` (test-database isolation contract)
- `.ai/history/archive/AI_Handoff-2026-09-25-payment-foundation.md` (pre-move §15/§16 narrative)
- CI: run `36209255216` on `0712c70`

## 9. Unblock (owner action)

1. Settings → Environment: `STRIPE_SECRET_KEY` (`sk_test_…`), `STRIPE_PUBLISHABLE_KEY`
   (`pk_test_…`), `STRIPE_WEBHOOK_SECRET` (`whsec_…`), optionally `STRIPE_MODE=test`.
2. Keep `TEST_DATABASE_URL` pointed at a disposable PostgreSQL
   (`psql "$TEST_DATABASE_URL" -f db/run-sqleditor.sql`).
3. For webhook delivery in a dev shell: `stripe listen --forward-to localhost:3001/api/payments/stripe/webhook`.
4. Then re-run this task; flows 1–7 above become executable, and the tier table in
   `.ai/AI_HANDOFF.md` §18 can move from BLOCKED to executed per flow.

`.env.example` still does not document `STRIPE_*` / `COD_*` / `TEST_DATABASE_URL` and
agent tooling cannot edit that file — add them there by hand while adding the keys.
