# VelRepeat V2 — REAL Stripe TEST-MODE E2E Verification

**Date:** 2026-10-02
**STATUS: BLOCKED — hard stop #2 ("Stripe TEST credentials are missing").**

**The real Stripe TEST-mode end-to-end payment was NOT executed.** It could not be: no Stripe
TEST credential exists in any environment or location reachable from this workspace. Every
verification that does **not** require one was completed and is recorded below. Nothing was
simulated, faked, or reported as a PASS.

- **START SHA:** `909b9c454bda847083cb389abb99ee62aa533af8`
- **FINAL SHA:** `ba1ea451b673f3f97a5af5d0063bc43e34a1f31a` — the commit that carries this audit.
  (A later docs-only commit backfills this line; that commit changes no code, test or assertion.)

---

## 0. SECOND PASS — re-verified against a later HEAD, still BLOCKED

A second, independent pass was run against `eae65e307c694eae3f6a894c94a52cc78cdddee5`, in case
credentials had been added since. **They had not.** The stop condition is unchanged, and this pass
adds one piece of evidence the first pass did not have: the **application's own gate**, queried
directly, which reports presence without ever exposing a value.

| Gate | Output |
|---|---|
| `stripeStatus()` | `{"usable":false,"mode":null,"publishableKey":null,"publishableKeyMatchesMode":false,"webhookConfigured":false,"reason":"STRIPE_NOT_CONFIGURED"}` |
| `webhookSecretHealth()` | `{"present":false,"shapeUsable":false,"prefixOk":false,"lengthBucket":"absent","wrappedInQuotes":false,"interiorWhitespace":false,"surroundingWhitespaceOnly":false}` |
| `stripeSecretKey() !== null` | `false` |
| `freebuff-deploy env list` | `{"keys":[]}` |

Git state at this pass: branch `main`, working tree **clean**,
`git rev-list --left-right --count HEAD...origin/main` = `0  0`.

Production re-confirmed: `Migrate Neon Database` is still `36944070061` (**success**, unchanged —
no `db/migrations/` change since), ledger rows 62–68 = `047_payment_foundation`,
`048_payment_reservation`, `049_payment_incidents`, `050_orders_status_check`,
`051_payments_velrepeat_v2_plan_parent`, `052_velrepeat_pricing_cycle_price`.

Re-run at this HEAD: **1853 pass / 2 skip / 0 fail** · backend `tsc` 0 · `bun run typecheck` 4/4 ·
`bun run build:apps` 4/4 · `git diff --check` clean.

**Two hard stops fire here, not one:** #2 *Stripe TEST credentials are missing* **and** #3 *webhook
secret is missing*. Per §25 the run stops immediately. **No Stripe object was created, no Stripe
webhook was received, and no simulated substitute was reported as an E2E pass.**

---

## 1. Git state

| Fact | Value |
|---|---|
| Branch | `main` |
| `git status --short` | empty — **working tree clean** |
| `git rev-parse HEAD` | `909b9c454bda847083cb389abb99ee62aa533af8` |
| `git rev-parse origin/main` (after `git fetch origin`) | `909b9c454bda847083cb389abb99ee62aa533af8` |
| `git rev-list --left-right --count HEAD...origin/main` | `0  0` |

**In sync.** Nothing to synchronise; no reset, rebase or history rewrite was performed.

---

## 2. PRODUCTION MIGRATION STATE — VERIFIED

Read from the canonical workflow itself (`Migrate Neon Database`, run **`36944070061`**, conclusion
**success**), not inferred. Its `Verify migration state` step printed the production ledger in
full:

| Row | Migration | Applied at |
|---|---|---|
| 1 | `001_initial` | 2026-09-15 15:33:05+00 |
| … | *(rows 2–63, unchanged historical migrations)* | 2026-09-15 → 2026-09-25 |
| 62 | `047_payment_foundation` | 2026-09-25 17:29:25+00 |
| 64 | **`048_payment_reservation`** | 2026-10-01 16:17:06+00 |
| 65 | **`049_payment_incidents`** | 2026-10-01 16:17:11+00 |
| 66 | **`050_orders_status_check`** | 2026-10-01 16:17:15+00 |
| 67 | **`051_payments_velrepeat_v2_plan_parent`** | 2026-10-01 16:17:21+00 |
| 68 | **`052_velrepeat_pricing_cycle_price`** | 2026-10-02 00:04:18+00 |

**001 → 052 are all applied.** 048–052 each carry a real application timestamp, and 052's own log
reported `V0052: 0 snapshot(s) given a cycle_price` — no production row was rewritten.

**052 remains additive and idempotent.** No historical migration was rerun by hand and no
production data was rewritten or reset. **No new migration number was created** — the source proved
no schema defect blocking Stripe E2E. `db/schema.sql` ≡ `db/run-sqleditor.sql`; `db/run-update.sql`
remains absent.

---

## 3. STRIPE MODE AND TEST CONFIGURATION — **BLOCKED**

### What the backend can see

`backend/lib/payment-config.ts` → `stripeStatus()` is the single gate. With no credentials
configured it returns exactly:

```
{ usable: false, mode: null, publishableKey: null,
  publishableKeyMatchesMode: false, webhookConfigured: false,
  reason: "STRIPE_NOT_CONFIGURED" }
```

and `stripeSecretKey()` returns `null`, so **no Stripe checkout session can be created**.

| Required | Value in this environment |
|---|---|
| `STRIPE_SECRET_KEY` (`sk_test_…`) | **absent** |
| `STRIPE_PUBLISHABLE_KEY` (`pk_test_…`) | **absent** |
| `STRIPE_WEBHOOK_SECRET` (TEST endpoint `whsec_…`) | **absent** |
| `STRIPE_MODE` | **absent** |
| **Required report** | **`usable = true`, `mode = "test"`** — **NOT ACHIEVED** |

Evidence, in order:

| Source | Result |
|---|---|
| `freebuff-deploy env list` | `{"keys":[]}` — no production env vars set |
| `.env` / `.env.local` | no Stripe keys present |
| Repository-wide credential scan | **no** `sk_test_`/`sk_live_`/`whsec_`/`pk_test_` value anywhere outside test fixtures |
| Test fixtures | shape-only placeholders (`sk_test_000000000000000000000000`, `whsec_ffff…`) — **not credentials**, never used as such |

**No LIVE credentials were available, so stop condition #1 did not fire. Stop condition #2 did.**

### The three refusals are intact and were NOT weakened

| Protection | Code path | Verified by |
|---|---|---|
| Live secret key refused | `if (secretMode === "live") → STRIPE_LIVE_KEY_REFUSED` | `velrepeat-v2-verification-matrix.test.ts` §7 |
| Unrecognised key refused | `if (secretMode === null) → STRIPE_KEY_UNRECOGNIZED` | same |
| Declared-mode mismatch refused | `declaredMode !== "test"` → `STRIPE_MODE_MISMATCH` | same |
| Missing webhook secret refused | `!webhookConfigured → STRIPE_WEBHOOK_NOT_CONFIGURED` | same |

`stripeStatus()` returns `usable: true, mode: "test"` **only** for a complete test configuration.
Nothing was relaxed to make this task runnable.

---

## 4. TEST PAYMENT — **NOT EXECUTED**

Every field in this section is **NOT EXECUTED**. No value was invented, and no identifier is
reported because none was ever minted.

| Field | Value |
|---|---|
| Real TEST payment | **NOT EXECUTED — no TEST credential** |
| Plan ID | **NOT EXECUTED** |
| Payment attempt ID | **NOT EXECUTED** |
| Checkout session ID | **NOT EXECUTED** |
| PaymentIntent ID | **NOT EXECUTED** |
| Webhook event ID | **NOT EXECUTED** |
| Cycle price | **NOT OBSERVED** (no plan was created) |
| Commitment cycles | **NOT OBSERVED** |
| Total prepaid | **NOT OBSERVED** |
| Stripe minor units | **NOT OBSERVED** |
| Currency | **NOT OBSERVED** |
| Draft → Active | **NOT EXERCISED** |
| `started_at` / `next_run_at` | **NOT OBSERVED** |

The `90.00 × 4 = 360.00` figures elsewhere in this repository come from **the authoritative pricing
engine**, exercised against a real PostgreSQL in §7. They are **not** observations from a Stripe
TEST payment, and are not presented as such.

---

## 5. WHAT *IS* PROVEN WITHOUT A STRIPE CREDENTIAL

This is the honest boundary of the work. Our half of the contract is verified end-to-end through
the **real webhook endpoint** with a **real HMAC-SHA256 signature** against a **real PostgreSQL**;
**Stripe's half is not**.

### 5.1 Amount authority — server-derived, structurally proven

`backend/routes/velrepeat-v2-payments.ts`:

- line 319 reads the snapshot: `SELECT id, currency, cycle_price, total_amount, commitment_cycles, metadata FROM velrepeat_pricing_snapshots …`
- line 402 derives the charge: `const amountMinor = planTotalToStripeMinor(snapshot.totalAmount);`
- line 1146 **re-derives and re-checks it at settlement**: `const expectedMinor = planTotalToStripeMinor(snapshot.totalAmount);`

The amount is never taken from the request body. Hard stop #4 ("amount not derived from the
immutable snapshot") and #5 ("charges per-cycle price instead of total prepaid") do **not** fire —
the charge is the commitment total, and settlement re-proves it against the same immutable row.

### 5.2 Failure and security cases — proven against the real endpoint

| Case | Result | How |
|---|---|---|
| Wrong amount (90.00 attempted vs 360.00 expected) | **not activated**; plan stays `draft`; payment row **retained as `paid`** (never deleted); exactly 1 `PLAN_AMOUNT_MISMATCH` incident; `order_id` NULL; no fabricated success | real webhook, real signature |
| Wrong customer | **not activated** — ownership is checked **before** the snapshot is read, so a pricing refusal cannot act as an oracle | real webhook |
| Wrong currency | **not activated** — THB required on both plan and snapshot | real webhook |
| Invalid signature | **no mutation** of payment or plan state | tampered HMAC |
| Already-active plan | **no reactivation**, `started_at`/`next_run_at` do not move | real webhook |
| Client amount injection | `amount`, `amountMinor`, `sellerId`, `cyclePrice`, `totalAmount`, `discount*`, `pricingRule`, `currency`, `paymentStatus`, `planStatus`, `userId`, `planId` injected in one body at **both** endpoints — **none** changes the snapshot, the plan status, the ownership, or the charged amount | real endpoints |

### 5.3 Idempotency — proven

Replaying the **same signed event** yields exactly **one** payment, **one** activation and **one**
`PLAN_ACTIVATED` event — no second activation, no second payment, no cycle, no order. A **different**
duplicate event for an already-active plan is safely ignored per contract.

### 5.4 No premature fulfillment — proven

Before and after settlement, all of these are **unchanged**: `orders`, inventory (`sold_count`,
stock), `velrepeat_runs`, `order_shipments`, `velrepeat_cycles`. Payment success creates **no** order,
cycle, run, stock decrement or fulfillment record. **Activation means the prepaid plan is active —
not that cycles were fulfilled.**

### 5.5 V1 regression

No V1 file was touched. The V1 per-run cycle path, scheduler, inventory authority,
order fulfillment, order lock, payment reservation and payment config guards are unchanged.

---

## 6. WHAT THIS DOES **NOT** PROVE

Stated plainly so no reader over-reads §5:

- **No charge was ever created.** The outbound `stripe.checkout.sessions.create` call has not run
  once against Stripe in this task, or in any prior pass of this work.
- **No Stripe-side state was observed.** No PaymentIntent, no Checkout Session, no test card was
  used, and Stripe's own amount/currency validation was never exercised.
- **No webhook was delivered by Stripe.** Every event in §5 was constructed locally and signed with
  the exact scheme Stripe uses; the server-side verification of that signature is proven, but
  Stripe's delivery, retries and event ordering are not.
- **Production was never connected to.** §2 is the migration workflow's own log, not a query.

---

## 7. REGRESSION SUITE

| Check | Command | Result |
|---|---|---|
| Full suite | `TEST_DATABASE_URL=… bun test backend/tests` | **1853 pass / 2 skip / 0 fail** (1855 tests, 60 files) |
| VelRepeat V2 matrix | `backend/tests/velrepeat-v2-verification-matrix.test.ts` | **41 pass / 0 fail** |
| Backend typecheck | `cd backend && bunx tsc --noEmit` | **0 errors** |
| App typecheck | `bun run typecheck` | **4/4 exit 0** |
| Build | `bun run build:apps` | **4/4 exit 0** |
| Whitespace / conflict markers | `git diff --check` | **clean** |

**Zero failures.** No assertion was weakened, skipped or deleted. Nothing was changed to obtain
this result — the working tree was already clean at `909b9c4`.

---

## 8. PRODUCTION SAFETY

The E2E did **not** run, so nothing touched production at all:

- no settled historical payment modified
- no real customer financial history modified
- no unrelated order, inventory or shipment modified
- no production data deleted, reset or truncated
- no fake fulfillment, no fake "Cycle 1" order
- no V1 behaviour altered

---

## 9. VERCEL

No Vercel project is linked to this repository in CI (four Vercel frontends are deployed
separately from `main`). Not triggered by this change; nothing to verify.

---

## 10. REMAINING BLOCKERS

**One blocker, and it is entirely an owner action:**

> Supply Stripe **TEST**-mode credentials:
> - `STRIPE_SECRET_KEY` = `sk_test_…`
> - `STRIPE_PUBLISHABLE_KEY` = `pk_test_…`
> - `STRIPE_WEBHOOK_SECRET` = signing secret of the **TEST** webhook endpoint
>
> Add them under **Settings → Environment** (or the Render backend's environment). **Never** a live
> key. `NEON_DATABASE_URL` is additionally required if the E2E is to run against production rather
> than a disposable database.

Once supplied, the remaining work is mechanical: create the disposable test seller/package, create
the 4-cycle draft plan through `POST /api/velrepeat/v2/plans`, drive the real Stripe TEST checkout,
let Stripe deliver the webhook, and record the real identifiers. **No code change is expected to be
needed** — the gate already accepts a complete test configuration.

---

## 11. WHAT WOULD HAVE BEEN A FAIL (and was not claimed)

For the record, none of these fired, and none is being papered over:

| Hard stop | Status |
|---|---|
| #1 only LIVE credentials available | not applicable — no credentials at all |
| #2 **Stripe TEST credentials missing** | **THIS IS THE STOP** |
| #3 production DB migration not applied | not applicable — 001→052 all applied (§2) |
| #4 amount not from the immutable snapshot | not triggered (§5.1) |
| #5 charges per-cycle price | not triggered (§5.1) |
| #6 webhook activates without verified payment | not triggered (§5.2) |
| #7 webhook activates another customer's plan | not triggered (§5.2) |
| #8 duplicate webhook activates twice | not triggered (§5.3) |
| #9 payment creates an order prematurely | not triggered (§5.4) |
| #10 payment mutates inventory prematurely | not triggered (§5.4) |
| #11 payment triggers fulfillment prematurely | not triggered (§5.4) |
| #12 settled financial history rewritten | not triggered (§2) |
| #13 ambiguous schema change required | not applicable — no schema change |
| #14 tests weakened to obtain PASS | **not applicable — no test was changed** |

**The goal is not a green report. It is proof that the real Stripe TEST payment path is safe and
correct — and that proof cannot be produced until a TEST credential exists.**