# Phase 2F — CI Checkout/Payment Test Reliability — Change Report

| Field | Value |
|---|---|
| Date | 2026-10-30 (report name per task) |
| Agent | Buffy (Codebuff), Freebuff workspace |
| Branch | `main` |
| Base SHA | `31456976c017f9dd85f5cb04ab383b852b6d1cf9` (= `origin/main`; local checkout was 8 commits behind and **fast-forwarded** first — 0 local commits, clean tree, nothing discarded) |
| Code SHA | `fe7927b6fee4a7028244b1eead79f2502e01ba2b` — `test(ci): stabilize checkout payment test configuration` (3 test files, +232/−4) |
| Final (docs) SHA | the `docs(ai)` commit carrying this report and `AI_HANDOFF.md` §85 — reported in the task's final answer (a commit cannot contain its own SHA) |
| Scope | CI/test reliability of the 11 checkout tests that failed with 503. **No production behavior changed.** |

> **SOURCE CODE MODIFIED: NO** (production code untouched; tests only)
> **DATABASE MODIFIED: NO**
> **SQL MODIFIED: NO**
> **PRODUCTION DB CONNECTED: NO**
> **PRODUCTION PAYMENT TOUCHED: NO**
> **STRIPE MODIFIED: NO**
> **VELREPEAT MODIFIED: NO**

---

## 1. Preflight (before any edit)

- `git fetch origin main` → local `HEAD` was `f78322f9aa8006f950315db6984d79206fd5c892`, `origin/main`
  `31456976c017f9dd85f5cb04ab383b852b6d1cf9`: **8 behind / 0 ahead**, working tree clean. A
  `git pull --ff-only` (fast-forward) was applied — no reset, rebase, stash or overwrite.
- Read `AGENTS.md`, `.ai/AI_RULES.md`, `.ai/README.md`, `.ai/AI_HANDOFF.md`,
  `.ai/context/{testing,workflow}.md`, `.ai/history/2026-10-28-phase-2e-verification.md`.
- Read the real code: `backend/routes/cart.ts` (checkout handler, lines 703–1287), the two failing
  suites, `backend/lib/payment-config.ts`, `backend/db/test-database.ts`, `.github/workflows/test.yml`,
  the payment/reservation policies and the existing payment test helpers.
- Verified no Phase 2F work existed on the branch and that no production credentials/URLs are
  configured in this workspace (`freebuff-env list` → no env files).

## 2. The REAL failures (not inferred from the old report)

CI run **`40602654432`** on the base SHA (job `122534368576`) — `conclusion: failure`,
**11 unique failures**, every one `expect(...).toBe(200/400)` → **`Received: 503`**:

| # | File | Test |
|---|---|---|
| 1 | `backend/tests/buy-now-checkout.test.ts` | quantity = 1: order line, total, stock and cart are all exact |
| 2 | same | quantity = 2: … |
| 3 | same | quantity = 5: … |
| 4 | same | over-stock quantity is refused, never silently clamped |
| 5 | same | double submit with the same requestId creates ONE order, not two |
| 6 | same | an unpublished product cannot be bought directly |
| 7 | `backend/tests/realtime-commerce-phase2c.test.ts` | a successful checkout publishes order:created to the customer, the seller and VelCenter |
| 8 | same | a replayed request creates no second order, no second event and no second notification |
| 9 | same | a FAILED checkout publishes nothing and writes no notification |
| 10 | same | order:updated reaches the customer and the seller, never a stranger |
| 11 | same | shipment:updated is published once, only after the parcel row really changed |

The CI log line numbers in that run were 332 (×3), ~372, ~405, ~448 for the buy-now suite and
641, 685, 713, 734, 784 for the realtime suite; every assertion is a status assertion, not a
behavioral assertion that could be "relaxed".

**Reproduced locally, before any change**, against a disposable PostgreSQL 14:
`31 pass / 11 fail` on exactly those 11 cases (same 503).

## 3. Root cause (verified in source, not assumed)

`POST /api/customer/checkout` canonicalizes `paymentMethod` and runs
`assertPaymentMethodUsable(paymentMethod)` (`backend/routes/cart.ts:782–788`) **before** address,
stock, order and notification work. For CARD that reads `stripeStatus()`
(`backend/lib/payment-config.ts`), which reports a usable rail **only** when:

1. `STRIPE_SECRET_KEY` has a `sk_test_` / `rk_test_` shape (live keys are refused),
2. an explicit `STRIPE_MODE` (if any) is `test`, **and**
3. `STRIPE_WEBHOOK_SECRET` is present.

Both failing suites' `beforeAll` set a dummy `sk_test_…` key but **deleted**
`STRIPE_WEBHOOK_SECRET`. The gate therefore answered **503 `STRIPE_WEBHOOK_NOT_CONFIGURED`** (a 503
refusal; the Phase 2E report's shorthand "`STRIPE_NOT_CONFIGURED`" named the same status family but
not the exact code) in **every** environment — CI and a developer machine alike. It was never a
missing CI secret, and it was never a product defect.

The tests configure the rail themselves; they simply configured **half** of it. All 11 use checkout as
**setup** for business logic that asserts none of Stripe's behavior:

| Concern actually asserted | Stripe needed? |
|---|---|
| buy-now quantity → order line, `price × quantity` total, inventory reservation, cart untouched | no |
| over-stock refusal, invalid-quantity refusal, unpublished-product refusal | no |
| `requestId` idempotency (one order, one hold, replay returns the first response) | no |
| `order:created` only after COMMIT, addressed delivery, no event/notification on failure or replay | no |
| `order:updated` / `shipment:updated` addressed delivery and no-op suppression | no |
| notification rows follow the real business mutation | no |

Supporting evidence: the "invalid quantities" case in the same file was already green, because input
validation runs before the payment gate — the gate sits after validation, not before all logic.

## 4. Options considered (as required) and the decision

| Option | Assessment |
|---|---|
| **A. Stripe test-mode configuration** | **CHOSEN, narrowest form.** The suites install the same complete DUMMY TEST-mode rail `checkout-payment-flow.test.ts` already uses: `STRIPE_MODE=test`, `sk_test_000000000000000000000000`, `whsec_000000000000000000000000`. It is confined to the two test files (not the CI job, not a secret); values are shape-valid dummies, never credentials; live keys remain refused by the product guard. |
| **B. Enable COD in the test job** | **REJECTED.** It would require rewriting all 11 cases to `paymentMethod: "COD"`, changes the exercised path (COD is carrier-settled and gets **no** 30-minute payment window — `applyPaymentReservationPolicy`), adds a job-level rail flag that could mask COD-specific defects elsewhere, and does not match the production checkout path the tests intend to drive. Production default would stay off, but the change is larger and weaker as evidence. |
| **C. Separate tests by purpose** | **ADOPTED together with A.** The 11 cases are business/realtime tests; their checkout setup now carries a valid test rail while every original assertion stays byte-identical. No test was skipped, deleted, or weakened, and no case was moved to "Stripe-only". |

CI keeps **no payment credential at all**: the rail lives only in test files under `backend/tests/`.

## 5. The change (exact files)

1. `backend/tests/buy-now-checkout.test.ts` — `beforeAll` now saves/restores `STRIPE_MODE`, sets
   `STRIPE_MODE=test`, keeps the dummy `sk_test_` key, and sets a dummy `whsec_` webhook secret
   instead of deleting it. Comment documents the gate contract and the previous half-configuration.
2. `backend/tests/realtime-commerce-phase2c.test.ts` — the identical complete test rail, saved and
   restored around the harness (which starts the real HTTP + WebSocket servers).
3. `backend/tests/checkout-test-payment-rail.test.ts` — **new guard file (10 cases)**:
   - both checkout-as-setup suites set all three rail values, never a live key, and restore them;
   - the fixture is `usable: true`, `mode: "test"`, and passes `assertPaymentMethodUsable("CARD")`;
   - a `sk_live_` key is still **refused** (`STRIPE_LIVE_KEY_REFUSED`), a missing webhook secret is
     still **refused** (`STRIPE_WEBHOOK_NOT_CONFIGURED`), and no configuration is still refused
     (`STRIPE_NOT_CONFIGURED` with 503) — production guards intact;
   - the **checkout handler slice makes no Stripe API call** (`api.stripe.com`, `.sessions.create`,
     `expireStripeCheckoutSession(` are absent; the only payment work is the local gate + policy);
   - `.github/workflows/test.yml` contains **no `secrets.`**, no `STRIPE_*`, no `COD_ENABLED`, still
     sets `TEST_DATABASE_URL`, and still pins the production-looking `DATABASE_URL` refusal.

No change to `backend/lib/payment-config.ts`, `backend/routes/cart.ts`, Stripe routes/webhooks,
checkout pricing, reservation rules, authorization, or the workflow.

## 6. Verification — actual results

### 6.1 The 11 previously failing tests

| Stage | Command / environment | Result |
|---|---|---|
| Before fix, local disposable PG14 | `bun test tests/buy-now-checkout.test.ts tests/realtime-commerce-phase2c.test.ts` | **31 pass / 11 fail** (194 assertions, 42 tests) — same 11, all 503 |
| After fix, local disposable PG14 | same command | **42 pass / 0 fail** (305 assertions, 42 tests) |
| After fix, GitHub Actions `40986922370` (commit `fe7927b`) | `bun test backend/tests` | **1363 pass / 2 skip / 0 fail** (1365 tests, 67 files) — all 11 are `(pass)` in the log; **0** `(fail)` lines |

CI run URL: `https://github.com/EnJirad/velnox-marketplace/actions/runs/40986922370` — `conclusion: success`.
The 2 CI skips are pre-existing environment-dependent skips, not caused by this change.

### 6.2 Full project battery (final tree, code SHA)

| Command | Result |
|---|---|
| `cd backend && bun run typecheck` | **PASS** — exit 0 |
| `bun run typecheck` | **PASS** — 4/4 apps, exit 0 |
| `bun run build:apps` | **PASS** — 4/4 apps built, exit 0 |
| `bun run i18n:check` | **PASS** — th=1257 en=1257 my=1257 at parity |
| `bun test tests/checkout-test-payment-rail.test.ts` | **10 pass / 0 fail** (43 assertions) |
| `cd backend && bun test tests` (disposable PG14) | **1359 pass / 6 skip / 0 fail** (1365 tests, 67 files, 14,148 assertions) |
| `git diff --check` | **clean** (exit 0) |

DB-gated tests were **RUN**, not blocked: a disposable local PostgreSQL 14 database
(`velnox_test`, owned by a dedicated local role) was created/reconciled for this pass with
`db/run-sqleditor.sql` (`ON_ERROR_STOP=1`, exit 0, 63 tables / 653 columns / 369 constraints /
235 indexes) and passed to tests only as `TEST_DATABASE_URL`. The 6 local skips are pre-existing
conditional skips (`seller apply` evidence ×4, `upload confirm` ×2), unrelated to checkout.

**BROWSER/E2E: NOT RUN.** The repository ships no browser/DOM test tooling and this environment has
no preview command; no rendered-pixels claim is made. The change is test-configuration only, so no
UI behavior changed.

## 7. Evidence that production was never touched

- This workspace has **no env files** and therefore no `DATABASE_URL`/production connection string
  (`freebuff-env list` → no files). Every DB command used an explicit `TEST_DATABASE_URL` pointing at
  `127.0.0.1:5432/velnox_test`; `backend/db/test-database.ts` refuses Neon/production targets.
- No production payment credential exists anywhere in the change; the rail values are
  `sk_test_0000…` / `whsec_0000…` dummies. `stripeStatus()` refuses `sk_live_` keys, and the new test
  pins that refusal.
- The checkout handler makes no Stripe API call; the new test pins it. Session-opening payment suites
  in this repo use `spyOn` on the SDK prototype (documented in `checkout-group-session-open.test.ts`),
  and webhooks verify signatures locally with HMAC — no network call to a payment provider was made.
- `.github/workflows/test.yml` is unchanged: disposable `postgres:16`, `TEST_DATABASE_URL` only, no
  repository secret, production-refusal guard still exercised.

## 8. Boundaries confirmed

`git diff --name-only 3145697..fe7927b` → the three test files only. No `db/*.sql`, no schema or
migration change, no `backend/routes/*`, no Stripe/payment logic, no COD flag/default change, no
VelRepeat change, no dependency or structure change.

## 9. Residual risks and next steps

1. **Contract coupling:** the two suites now depend on `stripeStatus()` requiring (secret key + mode +
   webhook). If that contract is tightened again, these suites must be updated deliberately — the new
   guard test makes the expectation explicit instead of failing with an opaque 503.
2. **`bun-version: latest` in CI** vs local Bun 1.4.2 — the CI run is the authoritative verifier and is
   green; pinning the Bun version is a possible follow-up outside this phase.
3. **Pre-existing flake** `order-number.test.ts:122` (one failure in five observed runs in Phase 2E)
   was not addressed; it is unrelated to checkout/payment configuration.
4. **Owner action required:** none for this fix — no secret, no approval, no production change. If the
   owner later wants a *real* Stripe TEST E2E (hosted Checkout in a browser), that remains a separate,
   human-driven task (Phase 2E §10 item 1).

## 10. Status lines

- **PHASE 2F: COMPLETE**
- CI (code commit): **RUN — success**, `40986922370`, 1363 pass / 2 skip / 0 fail
- Production DB touched: **NO** · Production payment touched: **NO**
- Schema/SQL changed: **NO** · Stripe logic changed: **NO** · VelRepeat changed: **NO**
- Browser/E2E: **NOT RUN** (no tooling; not needed for a test-configuration change)
- **PHASE 2G STARTED: NO**
