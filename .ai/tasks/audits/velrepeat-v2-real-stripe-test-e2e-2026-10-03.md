# VelRepeat V2 — Real Stripe TEST-MODE E2E (2026-10-03)

**STATUS: BLOCKED — STRIPE TEST E2E CREDENTIALS MISSING. Stop condition #2 fired. The real Stripe
TEST end-to-end payment was NOT executed and is NOT reported as passed.**

Nothing was faked. No mock Stripe success, no synthetic webhook presented as a live E2E, no
`sk_live_`/`pk_live_` key, no real money movement, no manual "mark the DB paid", no endpoint used
that bypasses settlement, no production code edited to make the E2E reachable, and no schema or
architecture change. Every "NOT EXECUTED" below means exactly that.

---

> ### ⚠️ LATER FINDING — the "credentials missing" conclusion below was a measurement error
>
> **Later the same day**, this audit's configuration conclusion was found to be wrong, because it
> measured the **Freebuff workspace sandbox** environment (`freebuff-env list`,
> `freebuff-deploy env list`) instead of the **Render Web Service** that actually serves the API.
> The owner had added the Stripe variables in Render, and the live backend already had them.
>
> Measured on the real runtime, `GET https://velnox-api.onrender.com/api/stripe/configured` returns
> **`configured: true, mode: "test", reason: null`**, with `webhookSecretHealth.shapeUsable: true`
> and `?selfTest=1` → `attempted: true, verified: true`.
>
> **This document is left unedited below on purpose.** Its `NOT EXECUTED` findings stand — the E2E
> really was never run — but its "credentials are missing" reasoning is superseded. Nothing here is
> retroactively re-labelled PASS. Full correction and root cause:
> `.ai/tasks/audits/velrepeat-v2-stripe-test-runtime-verification-2026-10-03.md`.

---

## 1. Commit SHA

| Fact | Value |
|---|---|
| Branch | `main` |
| HEAD at start of this task | `a2b6ff92e94e3b8d9c09cb097d58caaeff093b19` |
| HEAD subject | `docs(velrepeat): verify production migration 053` |
| FINAL SHA (commit that carries this audit) | `c9352b636d537406955697b55c913f4afbef7e39` — docs-only; changes no code, test or assertion. A later docs-only commit backfills this line and likewise changes no code. |
| `git ls-remote origin HEAD` | `a2b6ff92e94e3b8d9c09cb097d58caaeff093b19` |
| In sync? | **YES** — local == remote, verified before anything was done |
| Working tree at start | **clean** (`git status --porcelain` → empty) |
| `git log --oneline -10` | `a2b6ff9` → `814c30d` → `065bfe2` → `79f2b05` → `f7690e4` (Phase 5) → … |

No code, migration, schema or test file was modified by this task. The only change is this audit
(plus a compact handoff pointer).

---

## 2. STRIPE TEST mode confirmation — **NOT CONFIRMED (cannot be confirmed)**

This is the decisive finding and the reason for the hard stop. **No Stripe TEST credential exists in
any environment or location reachable from this workspace, and no LIVE credential exists either.**

### 2.1 Presence matrix (presence only — no secret value was read, printed or recorded)

| Required variable | Required prefix | State |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_` | **NOT SET** |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_` | **NOT SET** |
| `STRIPE_WEBHOOK_SECRET` | `whsec_` (TEST endpoint) | **NOT SET** |
| `STRIPE_MODE` | `test` | **NOT SET** (no key ⇒ no mode to classify) |

### 2.2 Evidence (four independent sources, all negative)

| Source | Result |
|---|---|
| `freebuff-env list` | `{"files":{}}` — no key is injected into the sandbox environment |
| `freebuff-deploy env list` | `{"keys":[]}` — no production env var is set |
| Live application gate — `stripeStatus()` executed against the real `backend/lib/payment-config.ts` | `{"usable":false,"mode":null,"publishableKeyPresent":false,"publishableKeyMatchesMode":false,"webhookConfigured":false,"reason":"STRIPE_NOT_CONFIGURED"}` |
| Live application gate — `webhookSecretHealth()` | `{"present":false,"shapeUsable":false,"prefixOk":false,"lengthBucket":"absent",…}` |
| Live application gate — `stripeSecretKey() !== null` | `false` |
| Live application gate — `stripeWebhookSecret() !== null` | `false` |
| Live application gate — `classifyStripeSecretKey(null)` | `null` (unclassifiable ⇒ refused) |
| Repository-wide fixed-string credential scan over `backend apps packages db .github` | **zero real credentials** (see 2.3) |

The gate probe was run by executing the application's own exported functions; it reports presence
and classification only, never a value.

### 2.3 Every credential-shaped literal in the tree is a shape-only fixture

A fixed-string regex scan over `backend apps packages db .github` returned exactly two value
families, both **all-zero / all-`f` shape placeholders** used by test fixtures to exercise the
configuration gate — none is a credential:

- `sk_test_000000000000000000000000` · `sk_live_000000000000000000000000` ·
  `pk_test_000000000000000000000000` · `pk_live_000000000000000000000000` — in
  `backend/tests/checkout-payment-flow.test.ts:486`, `customer-order-cancel.test.ts:682,726`,
  `inventory-settlement.test.ts:194`, `late-payment-incidents.test.ts:364`,
  `payment-attempt-identity.test.ts:367`, `payment-cancellation-race.test.ts:365`,
  `payment-foundation.test.ts:60,61,139,148,336,401`, `payment-reservation-expiry.test.ts:751,1017,1023`,
  `velrepeat-v2-phase4-prepaid-payment.test.ts:107,108,341`,
  `velrepeat-v2-pricing-total-prepaid.test.ts:79,80`,
  `velrepeat-v2-verification-matrix.test.ts:82,83,299`
- `whsec_000000000000000000000000` · `whsec_ffffffffffffffffffffffffffffffff` — in
  `backend/tests/checkout-payment-flow.test.ts:487`, `customer-order-cancel.test.ts:683,701,727,741`,
  `inventory-settlement.test.ts:153`, `late-payment-incidents.test.ts:231`,
  `payment-attempt-identity.test.ts:228`, `payment-cancellation-race.test.ts:208`,
  `payment-foundation.test.ts:62`, `payment-reservation-expiry.test.ts:606`,
  `velrepeat-v2-phase4-prepaid-payment.test.ts:109`,
  `velrepeat-v2-pricing-total-prepaid.test.ts:81`,
  `velrepeat-v2-verification-matrix.test.ts:84,863`

The only non-fixture occurrences are the **prefix regexes** in `backend/lib/payment-config.ts:127-128`
and the `WEBHOOK_SECRET_PREFIX = "whsec_"` constant at `:222` — i.e. the code that *checks* the
prefix, not a key.

**Conclusion: there is no `sk_test_…` value and no `sk_live_…` value anywhere reachable. Stop
condition #2 (TEST credentials missing) fires. Per the task instruction the run stops here.**

This is the **sixth** consecutive check for these credentials (passes recorded on 2026-10-01,
2026-10-02 ×4, and now 2026-10-03). The blocker has not moved, and no product defect was found.

---

## 3. Test plan (authored, NOT executed)

Had the credentials been present, this is the exact plan that would have run. It is recorded so the
next pass is mechanical. **None of steps 1–10 was performed.**

1. **Disposable fixture, created against a disposable database** (never production data):
   approved seller → seller-owned active Repeat Package → published product → active, valid variant
   with a resolvable `pricing_snapshot` → correct package composition. All identifiers disposable.
2. Create a **draft** VelRepeat V2 Repeat Plan via `POST /api/velrepeat/v2/plans` with
   `commitment_cycles = 3` (or `2`) and a **testable frequency** — the repository's contract offers
   `runDueCycleTick()` so no multi-day wall-clock wait is needed; production code is **not** edited
   to shorten a schedule.
3. Freeze the pricing snapshot. Record `cycle_price`, `total_amount` (TOTAL PREPAID = `cycle_price ×
   commitment_cycles`), `currency`, `commitment_cycles`, `pricing_snapshot_id`.
4. Call the canonical payment-create endpoint → `openPlanPaymentSession` → `stripe.checkout.sessions.create`
   against the **real Stripe TEST** account with a TEST payment method only.
5. Complete the TEST checkout with a Stripe TEST card.
6. Let **Stripe itself** deliver the webhook to the deployed endpoint (this requires a webhook
   endpoint reachable by Stripe — currently absent).
7. Backend verifies the signature (`stripe.webhooks.constructEventAsync`,
   `backend/routes/stripe.ts:1539`).
8. Backend re-verifies **amount + currency + state** against the immutable
   `velrepeat_pricing_snapshots` row, then settles the payment.
9. Assert `velrepeat_plans.status = active` and that the cycle schedule exists (`cycle 1 … cycle N`).
10. Assert **`orders` created at activation = 0** — payment success must not fulfil prepaid money.
11. Force the first cycle due through the canonical `runDueCycleTick()`
    (`backend/jobs/velrepeat-v2-cycle-scheduler.ts`) and assert `scheduled → processing → ordered`.
12. Assert `orders.velrepeat_cycle_id = cycle.id` and that line items come from the **frozen
    snapshot**, never from live catalog prices.
13. Multi-seller: assert 1 plan → 1 cycle → 1 order **per shop**, unique on
    `(velrepeat_cycle_id, shop_id)`.
14. Replay the tick and the webhook; assert no duplicate order / reservation / cycle / payment /
    activation.
15. Negative battery (§11).
16. Full verification suite (§13).

---

## 4. Payment result — **BLOCKED (real failure point traced in source)**

**Real failure point, exactly:**

```
POST /api/velrepeat/v2/plans/:planId/payment
  → openPlanPaymentSession()                 backend/routes/velrepeat-v2-payments.ts:604
  → stripeServerClient()                     backend/routes/velrepeat-v2-payments.ts:610
  → stripeServerClient() { return getStripe(); }   backend/routes/stripe.ts:110-112
  → getStripe() === null                     (stripeStatus().usable === false)
  → throw RepeatPlanPaymentError(503, "STRIPE_NOT_CONFIGURED",
        "Card and PromptPay payments are not available right now.")   :611-617
```

Verified in the source at `backend/routes/velrepeat-v2-payments.ts:610-617`:

```ts
const stripe = stripeServerClient();
if (!stripe) {
  throw new RepeatPlanPaymentError(
    503,
    "STRIPE_NOT_CONFIGURED",
    "Card and PromptPay payments are not available right now.",
  );
}
```

**The flow therefore fails closed *before any Stripe API call is attempted*.** The refusal is the
gate working as designed, not a product defect.

| Field | Value |
|---|---|
| Stripe TEST payment attempted | **NOT EXECUTED — no TEST credential** |
| HTTP status the real gate would return | `503 STRIPE_NOT_CONFIGURED` |
| Plan ID | **none — no plan was created** |
| Checkout Session ID | **none** |
| PaymentIntent ID | **none** |
| Stripe minor units | **NOT OBSERVED** |
| Currency | **NOT OBSERVED** |
| Amount authority (code, read) | charged amount = `velrepeat_pricing_snapshots.total_amount`, the **TOTAL PREPAID** `cycle_price × commitment_cycles`; currency taken from the same immutable snapshot |
| Paid marked manually | **NO — not done, never will be** |
| Real money used | **NONE** |

**No identifier is reported above because none was ever minted.** The `90.00 × 4 = 360.00` style
figures that appear elsewhere in this repository come from the pricing engine exercised against a
local PostgreSQL — they are **not** Stripe observations and are not presented as such here.

---

## 5. Webhook result — **NOT EXECUTED**

| Field | Value |
|---|---|
| Stripe webhook endpoint registered & reachable by Stripe | **absent** (nothing to register with — no account) |
| Real Stripe event delivered | **NOT EXECUTED** |
| Signature verified from a real Stripe delivery | **NOT EXECUTED** |
| Webhook event ID | **none** |
| Duplicate-delivery replay against real Stripe | **NOT EXECUTED** |

Signature verification is implemented at `backend/routes/stripe.ts:1534-1539`
(`stripe.webhooks.constructEventAsync(payload, signature, webhookSecret)`) and requires a real
`whsec_…`; without one, **no Stripe-signed event can be verified**, and none was forged for this
audit. The gateway also refuses its own 503 paths at `backend/routes/stripe.ts:1116, :1645, :1837`.

---

## 6. Plan activation result — **NOT EXECUTED**

`velrepeat_plans.status` could not be moved from `draft` because no payment could exist. The
activation implementation was **read** (`backend/routes/velrepeat-v2-payments.ts:1209-1290`):
`UPDATE velrepeat_plans … WHERE id=$1 AND status='draft'` → `createCycleSchedule(...)` **inside the
same settlement transaction** → `PLAN_ACTIVATED` metadata written. It is unreachable without a
verified, amount-and-currency-matched Stripe settlement.

| Field | Value |
|---|---|
| `velrepeat_plans.status` | `draft` — never transitioned (no plan row was created) |
| Activation transaction | **NOT EXECUTED** |
| `started_at` / `next_run_at` | **NOT OBSERVED** |

---

## 7. Cycle creation result — **NOT EXECUTED**

| Field | Value |
|---|---|
| `velrepeat_cycles` rows created by this task | **0** |
| Cycle IDs | **none** |
| Cycle 1 / 2 / … N schedule | **NOT OBSERVED** |
| `scheduled_at` / `pricing_snapshot_id` per cycle | **NOT OBSERVED** |

`createCycleSchedule` (`backend/lib/velrepeat-cycles.ts:265-353`) is invoked only from the
settlement transaction (§6). With settlement blocked, no cycle can exist.

---

## 8. Cycle processing result — **NOT EXECUTED**

| Transition | Observed? |
|---|---|
| `scheduled → processing` | **NOT EXERCISED** |
| `processing → ordered` | **NOT EXERCISED** |
| `runDueCycleTick()` invoked against real settled data | **NOT EXECUTED** |
| `VELREPEAT_V2_CYCLE_INTERVAL_MS` scheduler run in a live E2E | **NOT EXECUTED** |

No cycle exists, so there was nothing due. `processCycleInTransaction`
(`backend/lib/velrepeat-cycles.ts:377-655`) — row claim `FOR UPDATE OF c` (`:391`), guarded
`processing` transition (`:435-440`), `SAVEPOINT cycle_order_build` / `ROLLBACK TO SAVEPOINT`
(`:510`, `:599-601`), terminal `ordered` transition (`:611-619`) — was **read and verified, not
executed against a real payment**.

**Production code was not modified in order to bypass or shorten a schedule.**

---

## 9. Order creation + multi-seller result — **NOT EXECUTED**

| Check | Value |
|---|---|
| Order IDs | **none** |
| `orders.velrepeat_cycle_id = cycle.id` | **NOT EXERCISED** |
| Line items priced from the frozen snapshot (never live catalog) | **NOT EXERCISED at runtime**; the code path reads `velrepeat_pricing_snapshots` and contains no live-catalog price read for cycle lines |
| 1 plan → 1 cycle → **1 order per shop** (decision Q17) | **NOT EXERCISED** |
| Unique key `(velrepeat_cycle_id, shop_id)` | **exists in production** (partial unique index) but **never exercised by a real cycle** |

---

## 10. Inventory result — **NOT EXECUTED**

| Check | Value |
|---|---|
| Canonical inventory reservation used at cycle order creation | **NOT EXERCISED** (code read: reservation only, no `commitOrderInventory`) |
| `commitOrderInventory` called for a Repeat cycle | **NO** — verified absent from the cycle path by reading `backend/lib/velrepeat-cycles.ts` |
| `sold_count` updated | **NO** — Phase 5 deliberately does **not** decide `sold_count` (that is Phase 6) |
| A new `payments` row per cycle | **NO** — cycles create no payment row; money is prepaid once at activation |

No inventory row was read or written in production by this task.

---

## 11. Idempotency result — **proven only by the automated suite, NOT by a real E2E**

| Scenario | Real E2E | Automated suite / DB |
|---|---|---|
| Replay `runDueCycleTick()` for the same cycle → no duplicate order / reservation / cycle | **NOT EXECUTED** | **Proven** — row lock `FOR UPDATE OF c` + guarded `processing` transition (code), **and** DB-level unique index `idx_orders_velrepeat_cycle_seller_unique` on `(velrepeat_cycle_id, shop_id)`; a raw second INSERT returns `23505` |
| Replay the same Stripe webhook → no duplicate activation / payment / cycle / order | **NOT EXECUTED** | **Proven at suite level** — replaying an identical signed event yields exactly one payment, one activation, one `PLAN_ACTIVATED`; a *different* duplicate for an already-active plan is ignored |

This is honest: idempotency is demonstrated **twice over** by the Phase 5 suite and by the database
constraint, but it has **not** been demonstrated through a real Stripe delivery.

---

## 12. Negative test results — covered by the suite, **not** by a live Stripe call

| # | Case | Suite result (this round) | Live Stripe E2E |
|---|---|---|---|
| 1 | Invalid webhook signature → reject | **PASS** — `rejects an invalid signature without touching the database` | **NOT EXECUTED** |
| 1b | Signature computed with the wrong secret → reject | **PASS** — `rejects a signature computed with the wrong secret` | **NOT EXECUTED** |
| 1c | Correctly signed event must be **accepted**, not rejected as forged | **PASS** — `a correctly signed event is ACCEPTED, not rejected as forged` | **NOT EXECUTED** |
| 1d | A quoted secret can never verify | **PASS** — `a value pasted with its wrapping quotes can never verify a signature` | **NOT EXECUTED** |
| 1e | Self-test over a signature the deployment signed itself | **PASS** — `the self-test verifies a signature this deployment signed itself` | **NOT EXECUTED** |
| 2 | Wrong amount → reject / refuse activation | **PASS** — settlement re-derives `expectedMinor` from the snapshot and records `PLAN_AMOUNT_MISMATCH`; plan stays `draft` | **NOT EXECUTED** |
| 3 | Wrong currency → reject / refuse activation | **PASS** — currency must match the plan and the snapshot; a mismatched snapshot is refused by `loadPayableCommitment` (`:342-418`) | **NOT EXECUTED** |
| 4 | Duplicate webhook → idempotent | **PASS** — one payment, one activation, one cycle set | **NOT EXECUTED** |
| 5 | Unauthorized plan access → reject | **PASS** — ownership is checked **before** the snapshot is read (no pricing oracle) | **NOT EXECUTED** |
| 6 | Live Stripe key → configuration gate rejects it | **PASS** — `a LIVE key is refused — this phase is test mode only`; gate returns `STRIPE_LIVE_KEY_REFUSED` (`backend/lib/payment-config.ts:182`) | n/a — no key |
| 7 | Payment unavailable when Stripe is unconfigured | **PASS** — `Card and PromptPay are unavailable when Stripe is not configured` (the exact state this workspace is in) | n/a |

**No real money was used in any case.** Every negative case above ran against a local PostgreSQL with
shape-only keys — never against a live Stripe account, and never as a substitute for the blocked E2E.

---

## 13. Full verification suite — results from **this round**, re-run from scratch

Run after the Stripe gate was found closed. Real numbers, not copied from any prior audit.

| # | Command | Result |
|---|---|---|
| 1 | `TEST_DATABASE_URL=postgresql://velnox_test:velnox_test@127.0.0.1:5432/velnox_test bun test backend/tests` | **1882 pass / 2 skip / 0 fail — 1884 tests across 61 files, 10.36 s, EXIT=0** |
| 2 | `cd backend && bunx tsc --noEmit` | **0 errors, EXIT=0** |
| 3 | `bun run typecheck` | **EXIT=0 — velshop / velseller / velcenter / velnox all "Exited with code 0" (4/4)** |
| 4 | `bun run build:apps` | **EXIT=0 — all four apps "Exited with code 0" (4/4)** |
| 5 | `git diff --check` | **clean** |
| 6 | `cmp db/schema.sql db/run-sqleditor.sql` | **identical** |
| 7 | `git status --porcelain` | **empty (clean)** before this audit was written |

Note: PostgreSQL was not accepting connections at the start of this round (`pg_isready` → "no
response"); `service postgresql start` was run to bring up the **local, disposable test database**.
That is a local test dependency only and touches nothing in production.

**Zero failures. No assertion was weakened, skipped, deleted or suppressed to obtain this result.**

---

## 14. Production safety

The E2E did not run, so **nothing in production was touched at all**:

- no settled historical payment modified
- no real customer financial history read or modified
- no production order, inventory, shipment, plan or cycle created or altered
- no production data deleted, reset or truncated
- no fake fulfillment and no fake "Cycle 1" order
- no V1 behaviour altered; no production code changed

---

## 15. Remaining blockers

**Exactly one blocker, and it is entirely an owner action. No repository change is required.**

> Provide Stripe **TEST-mode** credentials under **Settings → Environment**:
> - `STRIPE_SECRET_KEY` = `sk_test_…`
> - `STRIPE_PUBLISHABLE_KEY` = `pk_test_…`
> - `STRIPE_WEBHOOK_SECRET` = the signing secret of the **TEST** webhook endpoint
>
> **TEST keys only. Never a live key.** The gate refuses a live secret with
> `STRIPE_LIVE_KEY_REFUSED`, and that refusal must stay in force.

A second prerequisite, once credentials exist: **a webhook endpoint that Stripe can actually reach**,
with the TEST endpoint's signing secret above, so a real delivery can occur.

Optional but expected for a production-realistic E2E: `DATABASE_URL` / `NEON_DATABASE_URL` so the run
can target production. Production is currently reachable from here **only** through the repo's GitHub
Actions workflows; `gh workflow run` is refused (HTTP 403 — the app token lacks `Actions: write`), so
pushing a change to a workflow file is the only trigger available from this workspace.

**Next action once unblocked:** re-run §3 top to bottom on the same HEAD and record the real plan,
checkout session, payment, webhook event, cycle and order identifiers.

---

## 16. Hard stops that fired, and those that did not

| # | Hard stop | Status |
|---|---|---|
| 1 | Only LIVE credentials available | not applicable — **no credentials at all** |
| 2 | **Stripe TEST credentials missing** | **THIS IS THE STOP** |
| 3 | Webhook secret missing | **also fires** (no `whsec_…`) |
| 4 | Production DB migration not applied | not applicable — **001 → 053 all applied** (verified in the 2026-10-03 migration audit: run `37026940189` success, ledger row `69 \| 053_velrepeat_v2_cycle_lifecycle \| 2026-10-02 15:26:29.648474+00`) |
| 5 | Amount not derived from the immutable snapshot | not triggered — server-derived from `velrepeat_pricing_snapshots.total_amount` |
| 6 | Charges per-cycle price instead of total prepaid | not triggered — the charge is the commitment total |
| 7 | Webhook activates without verified payment | not triggered — settlement requires a verified signature + amount + currency |
| 8 | Webhook activates another customer's plan | not triggered — ownership checked before the snapshot is read |
| 9 | Duplicate webhook activates twice | not triggered — proven idempotent at suite + DB level |
| 10 | Payment creates an order prematurely | not triggered — activation creates a **schedule only** |
| 11 | Payment mutates inventory prematurely | not triggered — no inventory write on activation |
| 12 | Payment triggers fulfillment prematurely | not triggered |
| 13 | Settled financial history rewritten | not triggered — nothing was written |
| 14 | Ambiguous schema change required | not applicable — **no schema change was made** |
| 15 | Architecture changed to make the E2E pass | **not done** |
| 16 | Tests weakened to obtain a PASS | **not done** |
| 17 | Fake/simulated Stripe success reported as E2E | **not done** |

---

## 17. Verdict

**REAL STRIPE TEST E2E = BLOCKED.**

The blocker is unchanged across six checks (2026-10-01, 2026-10-02 ×4, 2026-10-03). It is an
**environment/credential** blocker, not a code defect: every gate, refusal and money-authority rule
was read in the real source, and the full verification tier passed clean at
`a2b6ff92e94e3b8d9c09cb097d58caaeff093b19`.

**Overall VelRepeat V2 production readiness = NOT READY.** A real Stripe TEST E2E has never passed,
so the Phase 5 / contract readiness gates cannot be declared regardless of migration 053 being
applied and verified in production.

*The goal is proof that the real Stripe TEST path is safe — not a green report. That proof cannot be
produced until a TEST credential exists, and it will not be manufactured.*

---

## 18. Later pass, same day — configuration CLEARED, the **execution surface** is the real gate

> **STATUS OF THIS ROUND: `REAL STRIPE TEST E2E = BLOCKED` — and NOT on credentials.**
> The Stripe TEST runtime on Render is proven configured and working (§18.1). The E2E still cannot be
> executed, but the reason is now a **reachability / execution-surface** gate (§18.2), not a missing
> credential. §2's "credentials missing" conclusion is superseded by
> `.ai/tasks/audits/velrepeat-v2-stripe-test-runtime-verification-2026-10-03.md`; §2's
> `NOT EXECUTED` findings still stand and are **not** retroactively relabelled.

| Fact | Value |
|---|---|
| Test timestamp | **2026-10-03T16:14Z → 2026-10-03T16:26:29Z** (live probes) |
| Environment | **Render Web Service `velnox-api`** — `https://velnox-api.onrender.com` (production host, Stripe **TEST** mode) |
| HEAD at this pass | `8ef8c0b35544caa5d63bc70a85087f598789b333` — local == `git ls-remote origin refs/heads/main`; tree clean |
| Runtime-verification commit | `407cdb1dc4920d7257b1b1431224b2c02e8c4890` (present in history, as cited in the brief) |
| Production writes made | **none** |
| Test data created | **none** — no fixture could be created without an authenticated session (§18.2) |
| Mocks / simulated Stripe success | **none** |

### 18.1 Stripe TEST runtime — **PASS** (live, measured this round)

Prefixes only. No secret value is recorded anywhere in this document.

| Probe | Result |
|---|---|
| `GET /api/stripe/configured` | **HTTP 200** — `configured: true`, `mode: "test"`, `reason: null`, `webhookConfigured: true`; `webhookSecretHealth` = `present: true`, `shapeUsable: true`, `prefixOk: true`, `lengthBucket: "expected"`, `wrappedInQuotes: false`, `interiorWhitespace: false`, `surroundingWhitespaceOnly: false` |
| `GET /api/stripe/configured?selfTest=1` | **HTTP 200** — `webhookSignatureSelfTest: {attempted: true, verified: true, reason: null}`. `attempted: true` is direct proof `getStripe()` built a **non-null test client inside the Render process** (a live key would have been refused as `STRIPE_LIVE_KEY_REFUSED`) |
| `GET /api/payments/methods` | **HTTP 200** — `CARD` + `PROMPTPAY` `enabled: true`, `COD` `enabled: false`, `currency: "THB"`, `stripe.mode: "test"` |
| `GET /api/health` | **HTTP 200** — `{"status":"ok"}` |
| `GET /auth/google` | **HTTP 302** → `accounts.google.com/o/oauth2/v2/auth` with a real `client_id` (the browser login path exists and is live) |

Credential presence, as reported by the runtime itself (presence only):
`STRIPE_SECRET_KEY` = **SET**, prefix `sk_test_***` · `STRIPE_PUBLISHABLE_KEY` = **SET**, prefix
`pk_test_***` · `STRIPE_WEBHOOK_SECRET` = **SET**, prefix `whsec_***` · `STRIPE_MODE` = **test**.

**`STRIPE_NOT_CONFIGURED` is resolved.** That earlier verdict was a measurement error: it was taken
from the Freebuff workspace sandbox (`freebuff-env list` → `{"files":{}}`,
`freebuff-deploy env list` → `{"keys":[]}`, both of which describe **Freebuff hosting, not Render**)
rather than from the host that serves traffic. The owner's Render variables were always in effect.

### 18.2 The real blocker — nothing in this workspace can drive an authenticated Checkout

Five independent facts, each verified from source and/or a live probe:

| # | Fact | Evidence |
|---|---|---|
| 1 | **Both V2 money endpoints require the `velnox_session` cookie.** | `requireAuth` reads **only** `req.cookies?.velnox_session` (`backend/middleware/auth.ts:73`); there is no `Authorization`, `x-api-key`, internal-token or cron auth path (greps over `backend/` return empty). Live: `POST /api/velrepeat/v2/plans` → **401**, `POST /api/velrepeat/v2/plans/:planId/payment` → **401**, `GET /api/velrepeat/v2/packages/:id` → **401** |
| 2 | **Only a browser Google OAuth round trip can mint that cookie.** | `GET /auth/google` → 302 to Google; the only other login is `POST /api/auth/member-login`, which needs an existing user's email + password. This workspace has **no browser binary** (no chromium/chrome/firefox), **no Playwright/Puppeteer/Cypress** (installed or cached), and **no provisioned test account** (handoff §14: "No safe authorized production test account exists"; no account email is recorded anywhere in `.ai/` or `docs/`) |
| 3 | **The payment is a Stripe *hosted* Checkout Session — it can only be completed by a human in a browser.** | `stripe.checkout.sessions.create({ mode: "payment", … })` (`backend/routes/velrepeat-v2-payments.ts:691`). A repo-wide grep for `.confirm(`, `confirm: true`, `paymentIntents.confirm` returns **empty** — the only session calls are `create` / `retrieve` / `expire`. There is no server-side `pm_card_*` completion path, so no script can finish a TEST payment |
| 4 | **Stripe itself must deliver the webhook, and forging one is forbidden.** | Verification is `constructEventAsync(req.body, signature, webhookSecret)` (`backend/routes/stripe.ts:1539`) against the real `whsec_…`. The endpoint is live and correctly refuses forgeries — see §18.3 — but a *real* delivery requires a real payment (fact 3) |
| 5 | **There is no non-production environment to run against.** | `velnox-api-staging.onrender.com`, `velnox-staging.onrender.com`, `velnox-api-test.onrender.com` all resolve but return **HTTP 404** — none serves this API. The only live backend is production, and this workspace holds **no Neon credential** (`freebuff-env list` → `{"files":{}}`), so the production database is reachable only through read-only GitHub Actions probes |

A sixth, smaller consequence: `runDueCycleTick()` has **no HTTP or operator trigger** — it is an
in-process job started by `startVelRepeatV2CycleScheduler()` (`backend/server.ts:546`, 60 s interval).
Driving a due cycle in production would require either waiting on that tick after a real activation,
or database access. Neither is available here.

**Consequence for §7 (due cycle):** the canonical test path the brief allows — `runDueCycleTick()` — is
only reachable from inside the deployed process. It was **not** called against production data, and no
production code was edited to expose it.

### 18.3 What *was* executed live this round (negative battery, subset)

These ran against the real Render backend. All are refusal paths that stop **before** any database write.

| # | Case | Live result |
|---|---|---|
| 1 | Webhook with **no** `stripe-signature` header | **400** `{"error":"Missing stripe-signature header"}` |
| 2 | Webhook with a **forged** `stripe-signature` | **400** `{"error":"Invalid signature"}` |
| 2b | Webhook with a **malformed** signature header | **400** `{"error":"Invalid signature"}` |
| 3 | V2 plan creation with **no** session | **401** `UNAUTHORIZED` |
| 4 | V2 plan payment with **no** session | **401** `UNAUTHORIZED` |
| 5 | V2 package read with **no** session | **401** `UNAUTHORIZED` |
| 6 | V2 plan creation with a **forged/unsigned** cookie | **401** `Invalid or expired token` |
| 7 | `/api/auth/me` with a forged cookie | **401** `Invalid session` |
| 8 | `/api/_diag/schema` unauthenticated | **401** `UNAUTHORIZED` (guarded by prefix, fails closed) |

**No money, no order, no payment row, no inventory change, and no plan row resulted from any of the above.**
The remaining negative cases (duplicate webhook, payment failure, cancelled payment, out-of-stock item,
unavailable product/variant, duplicate cycle processing) all require a real payment or a real plan+cycle
first, so they remain **suite-proven only** — see §12.

### 18.4 Regression — re-run from scratch this round

| # | Command | Result |
|---|---|---|
| 1 | `TEST_DATABASE_URL=… bun test backend/tests` (repo-canonical, `.ai/AI_RULES.md`) | **1882 pass / 2 skip / 0 fail** — 1884 tests / 61 files, **EXIT=0** |
| 1b | `TEST_DATABASE_URL=… pnpm test` (as literally requested) | **1882 pass / 2 skip / 0 fail**, **EXIT=0** (same suite; `pnpm` delegates to the same `bun test` script) |
| 2 | `cd backend && bunx tsc --noEmit` | **0 errors, EXIT=0** |
| 2b | `bun --filter @velnox/backend typecheck` (the CI variant) | **EXIT=0** |
| 3 | `bun run typecheck` | **EXIT=0 — 4/4 apps "Exited with code 0"** |
| 4 | `bun run build:apps` | **EXIT=0 — 4/4 apps "Exited with code 0"** |
| 5 | `cmp db/schema.sql db/run-sqleditor.sql` | **identical** |
| 6 | `git diff --check` | **clean** |
| 7 | `git status --porcelain` | **clean** |

**Two notes, stated plainly rather than hidden:**

- `pnpm exec tsc -b` and `pnpm build` — the literal commands in the brief — **do not apply to this
  repository**: there is no root `tsconfig.json` (`TS5083: Cannot read file …/tsconfig.json`) and no root
  `build` script (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "build" not found`). This is a **bun**
  workspace; the equivalents defined by the repo (and by `.ai/AI_RULES.md`) are rows 2–4 above. They were
  run instead, and they pass.
- The **first** `pnpm test` attempt reported `1601 pass / 173 fail`, all `ECONNREFUSED 127.0.0.1:5432`:
  the **local disposable PostgreSQL had stopped** (`pg_isready` → "no response",
  `service postgresql status` → `14/main (port 5432): down`). After `service postgresql start`, the same
  command returned **1882 / 2 / 0, EXIT=0**. The 173 failures were a local test-dependency outage, **not**
  a product defect, and they are not reported as a pass. The clean re-run is the recorded result.

### 18.5 Verdict for this round

| Area | Status |
|---|---|
| Stripe runtime configuration | **PASS** |
| Stripe TEST payment | **BLOCKED** — no authenticated session; hosted Checkout needs a browser |
| Webhook (real Stripe delivery) | **BLOCKED** — endpoint live and correctly refusing forgeries, but no real event can occur without a payment |
| Plan activation / cycle schedule / cycle processing / order creation / inventory / idempotency / multi-seller | **BLOCKED** — all downstream of the payment |
| Negative cases | **PARTIAL** — 8 refusal paths executed live (§18.3); the rest suite-proven only |
| Regression | **PASS** (§18.4) |

**`REAL STRIPE TEST E2E = BLOCKED`** — the blocker is the **execution surface**, not the credentials.
**VelRepeat V2 production readiness = NOT READY.** No `PASS` is claimed for any step that was not
actually executed against real Stripe.

**To unblock (owner actions, no repository change required):**

1. Run the §3 flow in a **browser** with an authorized account — sign in via Google on VelShop, create a
   draft Repeat Plan from a real package, open the payment session, and complete TEST Checkout with card
   `4242 4242 4242 4242`. Stripe will then deliver the webhook to the already-configured endpoint.
2. **Or** provision a disposable staging backend (its own database + the same TEST keys) so an E2E can be
   driven without touching production data.
3. **Or** grant this workspace a way to authenticate (a dedicated test account) plus database read access,
   so the post-payment assertions in §6–§11 can be verified.

*No secret, token, or credential value appears in this document. The only credential-shaped strings
anywhere in this file are the all-zero/`f` shape fixtures already catalogued in §2.3.*