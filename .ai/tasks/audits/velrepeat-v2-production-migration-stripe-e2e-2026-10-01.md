# VelRepeat V2 — Production Migration Verification + Stripe TEST E2E

**Date:** 2026-10-01
**Scope:** Verify the real production database migration state, verify the pricing contract against
real schema, and execute a real Stripe TEST-mode end-to-end verification safely.
**Outcome:** the production-DB blocker is **RESOLVED IN REPOSITORY** (§2.2) and lands on the push
recorded in §19. The Stripe TEST E2E remains **NOT EXECUTED** — no TEST credential exists in any
environment reachable from here. Everything verifiable without them passed.

- **START SHA:** `3eeed8c1f6b1e91354209419d8d59488eb5df5c0`
- **FINAL SHA:** *(see §17 — recorded in the handoff and reported in the final report)*

---

## 1. Git state (§2)

| Fact | Value |
|---|---|
| Branch | `main` |
| Local HEAD | `3eeed8c1f6b1e91354209419d8d59488eb5df5c0` |
| `origin/main` (after `git fetch origin`) | `3eeed8c1f6b1e91354209419d8d59488eb5df5c0` |
| `git rev-list --left-right --count HEAD...origin/main` | `0  0` |
| Working tree at start | clean |

**In sync.** Local == remote, nothing ahead, nothing behind. No reset, rebase or history rewrite was
performed or needed.

Last 10 commits at start:

```
3eeed8c test(velrepeat): fix DB-gated expectations the pricing fix unmasked
4451185 test(velrepeat): correct Phase 3 expectations found by CI
f0cc464 fix(velrepeat): persist total prepaid commitment amount
708321e docs(ai): record phase 4 ci verification
e9d5ed9 test(velrepeat): settle through one recorded attempt, not two
2583c68 fix(velrepeat): resolve payment intent events and settle ownership first
ea24e8b test(velrepeat): assert the phase 3 cycle price, not the commitment total
435f0ec fix(velrepeat): refuse a commitment the snapshot does not cover
5bf4a49 feat(velrepeat): implement v2 prepaid stripe activation
0cb29aa docs(ai): record phase 3 ci verification
```

---

## 2. PRODUCTION DB — **no connection from this environment**

The production Neon connection string is **not available in this environment** and cannot be
obtained here. Evidence, in order of strength:

| Source | Result |
|---|---|
| `freebuff-env list` | `{"files":{}}` — no keys set |
| `freebuff-deploy env list` | `{"keys":[]}` — no production env vars |
| `DATABASE_URL` / `NEON_DATABASE_URL` in the shell | unset |
| `gh secret list` | `HTTP 403: Resource not accessible by integration` — the Freebuff GitHub App token cannot read Actions secret names |
| `gh workflow run "Velnox Neon Schema Diagnostic"` | `HTTP 403` — `workflow_dispatch` is refused for app tokens without `Actions:write` |

The repository's canonical production verifier is the **read-only** workflow
`.github/workflows/diag-neon-schema.yml` (SELECT-only, `NEON_DATABASE_URL` never echoed). It
triggers on `workflow_dispatch` — refused above — **or on a push to `main` that changes that
file**. Editing and pushing a probe file to make the owner's production database reachable is a
repository change this task did not authorize, so it was not done.

**No credential failure occurred, and none is claimed.** Per §3, the exact blocker is reported
rather than worked around: *the production database connection string is not present in this
environment and cannot be obtained by the agent.* The task's STOP condition is met, so no
production success is asserted anywhere in this document.

### 2.1 What IS known about production, from its own migration ledger

The most recent `Migrate Neon Database` run against production — run `36902790862`, on
`f0cc464` — is the authoritative record. Its own log states:

```
Already applied: 001_initial
002_auth
003_customer
… (every migration through)
051_payments_velrepeat_v2_plan_parent
📋 Pending migrations:
  - 052_velrepeat_pricing_cycle_price.sql
🔄 Applying: 052_velrepeat_pricing_cycle_price
psql:db/migrations/052_velrepeat_pricing_cycle_price.sql:38:
      ERROR:  relation "velrepeat_pricing_snapshots" does not exist
❌ 052_velrepeat_pricing_cycle_price FAILED.
```

> **CORRECTION (this pass).** An earlier draft of this audit read that line as "the ledger holds
> exactly one row" and concluded 048–051 were unapplied too. That was wrong: the workflow's
> `echo "Already applied: $APPLIED"` prints a **multi-line** string, so the first line carries the
> prefix and the remaining 51 migration names follow on their own lines. `gh run view
> 36902790862 --log` shows all of them. The workflow's own pending-detection step independently
> agrees: it listed **only** `052_velrepeat_pricing_cycle_price.sql`. Production is at 051, not at
> 001. The central finding below is unaffected; the collateral claim was removed.

Two facts follow, and they are the central finding of this task:

1. **The VelRepeat V2 prepaid domain tables do not exist in production.** 052 failed on its very
   first statement because `velrepeat_pricing_snapshots` is absent.
2. **052 is the only pending migration.** Everything before it is applied and recorded.

This confirms, and hardens, the Phase 4 / pricing-phase finding: the V2 prepaid **domain** schema
was added to `db/schema.sql` + `db/run-sqleditor.sql` only (commit `ea79277`) and **never got a
`db/migrations/*.sql` file**. `034_velrepeat_v2` is the older per-run-order design
(`velrepeat_plans` / `velrepeat_items` / `velrepeat_runs`), not the prepaid tables.

`Migrate Neon Database` is therefore **red on `main`**, and has stayed red on every push since
`f0cc464` until this pass. This is pre-existing and was deliberately not papered over by editing
the workflow.

### 2.2 The fix — V052 now carries the domain it depends on

**Owner decision, taken by the owner on 2026-10-01: author and push the domain migration.** It is
authored and verified below; §19 records the push and the resulting CI.

`db/migrations/052_velrepeat_pricing_cycle_price.sql` now opens with a new **§0 — the prepaid
PRICING domain**, before the `cycle_price` ALTER it depends on:

- `CREATE TABLE IF NOT EXISTS velrepeat_pricing_snapshots`
- `CREATE TABLE IF NOT EXISTS velrepeat_pricing_snapshot_items`
- `ALTER TABLE velrepeat_plans ADD COLUMN IF NOT EXISTS commitment_cycles INTEGER`
- their indexes, and the two CHECK constraints already guarded by §3/§4

Both table bodies are copied **verbatim** from `db/schema.sql` — a test asserts the byte-identical
block is present, so the two cannot drift again.

Three constraints shaped the shape of the fix, and none of them was worked around:

| Constraint | Source | Consequence |
|---|---|---|
| A new migration must take an **unused number prefix** | `backend/tests/migration-numbering.test.ts` | A second `052_*` file is forbidden; `053_*` would sort *after* the ALTER it must precede. |
| 052 must issue **no `ALTER TABLE orders`** | `velrepeat-v2-pricing-total-prepaid.test.ts` ("051 and 052 change no V1 table") | `orders.velrepeat_cycle_id` cannot ride along here. |
| Phase 3 pins the exact set of `*velrepeat*` migration filenames | `velrepeat-v2-phase3-pricing-snapshot.test.ts` | A new file named for the domain would have to edit a deliberate inventory guard. |

One file, one transaction, one number: the domain cannot exist without the column, and the column
cannot exist without the table.

#### Verified against a real PostgreSQL server

A database was built to reproduce production's exact starting state — bootstrapped from
`db/run-sqleditor.sql`, then the V2 domain stripped (`velrepeat_pricing_snapshots`,
`velrepeat_pricing_snapshot_items`, `velrepeat_cycles` dropped; `velrepeat_plans.commitment_cycles`
and `orders.velrepeat_cycle_id` dropped) — and 052 was applied with the workflow's exact
invocation (`psql -v ON_ERROR_STOP=1 --single-transaction -f`):

| Check | Result |
|---|---|
| 052 applies on the simulated production state | **exit 0** |
| Re-run (idempotency) | **exit 0**, no-op |
| `pg_dump --schema-only` vs a `db/run-sqleditor.sql` bootstrap | **identical except the three disclosed items below** |

#### Disclosed divergences from `db/schema.sql` (deliberate)

| Object | In `schema.sql` | In production after this push | Why |
|---|---|---|---|
| `velrepeat_cycles` (+2 indexes, +3 constraints) | yes | **no** | Phase 5 substrate. Zero non-test references in `backend/`; nothing can read a table that no query names. |
| `orders.velrepeat_cycle_id` + FK + index | yes | **no** | Same phase, and adding it would mean `ALTER TABLE orders` in 052 — the V1 guard above. |
| `velrepeat_items` partial UNIQUE indexes | yes | already present (from the production bootstrap) | Present in production; simply never written as a migration file. |

Column **ordering** also differs for the two added columns (`pg_dump` lists them last rather than
in their `schema.sql` position). That is inherent to any additive `ALTER`, has no effect on
PostgreSQL behaviour, and is not avoidable by any migration.

Each divergence is a Phase 5 migration away, and each is recorded rather than papered over.

---

## 3. Migrations 048–052 (§3)

Verified **against a real PostgreSQL server**, not against an audit. A disposable local
PostgreSQL 14 cluster was started, bootstrapped from the canonical `db/run-sqleditor.sql`, and each
migration applied through `psql -v ON_ERROR_STOP=1` — the same mechanism the Neon workflow uses
(`psql --single-transaction -f <file>` plus a `schema_migrations` insert).

On a database that has the V2 domain schema present:

| Migration | Result | Notes |
|---|---|---|
| 048 `048_payment_reservation` | **APPLIES CLEAN** (exit 0) | no errors, no fatal |
| 049 `049_payment_incidents` | **APPLIES CLEAN** (exit 0) | no errors, no fatal |
| 050 `050_orders_status_check` | **APPLIES CLEAN** (exit 0) | no errors, no fatal |
| 051 `051_payments_velrepeat_v2_plan_parent` | **APPLIES CLEAN** (exit 0) | no errors, no fatal |
| 052 `052_velrepeat_pricing_cycle_price` | **APPLIES CLEAN** (exit 0) | emits its NOTICE |
| 052 re-run (idempotency) | **APPLIES CLEAN** (exit 0) | identical NOTICE; no-op, as designed |

The 052 NOTICE on a fresh database:

```
V0052: 0 snapshot(s) given a cycle_price; 0 snapshot(s) left untouched because their plan already has a settled payment
```

**This proves the SQL is correct and idempotent. It does NOT prove any of it is in production.**
The per-migration status above is *verifiability*, not *production state*. Production's ledger
records 001–051 as applied and 052 as pending (§2.1); the run that applies 052 is the canonical
mechanism, and §2.2 records what this pass changed so that run can succeed.

### 3.1 Structures verified present in the canonical schema

On a database bootstrapped from `db/run-sqleditor.sql`, all seven required V2 relations exist:

```
velrepeat_cycles, velrepeat_items, velrepeat_package_items, velrepeat_packages,
velrepeat_plans, velrepeat_pricing_snapshot_items, velrepeat_pricing_snapshots
```

Plus the two linkages:

| Requirement | Verified |
|---|---|
| `orders.velrepeat_cycle_id` | present, `uuid` |
| Phase 4 payment linkage | `payments.plan_id` present, `uuid`, nullable, NO ACTION FK |

Columns on `velrepeat_pricing_snapshots`:

```
commitment_cycles  integer(32,0)
cycle_price        numeric(12,2)
total_amount       numeric(12,2)
```

Constraints:

```
velrepeat_pricing_snapshots_commitment_cycles_check  CHECK (commitment_cycles > 0)
velrepeat_pricing_snapshots_subtotal_amount_check    CHECK (subtotal_amount >= 0)
velrepeat_pricing_snapshots_discount_amount_check    CHECK (discount_amount >= 0)
velrepeat_pricing_snapshots_cycle_price_check        CHECK (cycle_price IS NULL OR cycle_price >= 0)
velrepeat_pricing_snapshots_total_amount_check       CHECK (total_amount >= 0)
velrepeat_pricing_snapshots_cycle_price_not_null     CHECK (cycle_price IS NOT NULL)
velrepeat_pricing_snapshots_total_not_below_cycle    CHECK (cycle_price IS NULL OR total_amount >= cycle_price)
```

Indexes (all 16 across the five V2 tables, including every uniqueness and lookup index):
`idx_velrepeat_cycles_due`, `idx_velrepeat_cycles_plan`, `idx_velrepeat_package_items_package`,
`idx_velrepeat_package_items_product`, `idx_velrepeat_package_items_unique_no_variant`,
`idx_velrepeat_package_items_unique_variant`, `idx_velrepeat_packages_active`,
`idx_velrepeat_packages_seller`, `idx_velrepeat_pricing_snapshot_items_snapshot`,
`idx_velrepeat_pricing_snapshot_items_unique_no_variant`,
`idx_velrepeat_pricing_snapshot_items_unique_variant`,
`idx_velrepeat_pricing_snapshots_plan`, plus the four primary keys and
`velrepeat_cycles_plan_id_cycle_number_key`.

### 3.2 Migration 052 backfill — real data, both safety branches

052 was applied to a database deliberately reverted to its **pre-052 shape** (`cycle_price`
dropped, both 052 constraints dropped) and seeded with two snapshots carrying the same fractional
cycle price `93.4444` over 3 cycles — one with **no payment**, one with a **settled `paid`
payment**.

```
BEFORE 052  (plan | total_amount | final_price_exact)
  aaaa…0001 | 93.44 | 93.4444      ← no payment
  aaaa…0002 | 93.44 | 93.4444      ← settled paid payment

052 NOTICE
  V0052: 1 snapshot(s) given a cycle_price;
         1 snapshot(s) left untouched because their plan already has a settled payment
  V0052: 1 snapshot(s) still have no cycle_price (settled payments);
         NOT NULL was NOT applied. Inspect before acting.

AFTER 052   (plan | cycle_price | total_amount)
  aaaa…0001 | 93.44   | 280.33      ← backfilled
  aaaa…0002 | (null)  | 93.44       ← UNTOUCHED
```

Three properties proven by this run:

1. **The recompute uses the EXACT price.** `93.4444 × 3 = 280.3332 → 280.33`, not
   `93.44 × 3 = 280.32`. A one-satang difference, in the customer's favour and in the correct
   direction.
2. **Settled financial history is never rewritten.** The plan whose payment is `paid` kept its
   original `total_amount = 93.44` and received no `cycle_price`. The money the customer was
   actually charged is still the number the row says.
3. **The `NOT NULL` constraint is declined, not forced.** Because one row legitimately has no
   `cycle_price`, 052 reported the count and applied nothing rather than inventing a value for
   financial history.

No settled payment, completed order, customer balance, historical Stripe record or existing
transaction was modified. No data was deleted and no database was reset. The 052 backfill is
additive and scoped, which is exactly the design the migration documents.

---

## 4. Schema source of truth (§4)

| Check | Result |
|---|---|
| `cmp db/schema.sql db/run-sqleditor.sql` | **IDENTICAL** (byte for byte) |
| `db/run-update.sql` | **absent** — not resurrected, not modified |
| A third schema source created | **no** |
| 052 agrees with both canonical files | **yes** — both carry `cycle_price NUMERIC(12,2)`, `velrepeat_pricing_snapshots_cycle_price_not_null` and `velrepeat_pricing_snapshots_total_not_below_cycle`, matching 052's DDL exactly |

No mismatch was found, so no schema fix was required. The canonical files are consistent with
migration 052 and with each other.

---

## 5. Pricing contract (§6)

Verified from the actual source and against a real database.

**The invariant.** `backend/lib/velrepeat-pricing.ts` computes, in order:
`computeCommitmentPricing` → `cyclePrice = toMoneyString(running)` (one cycle) and
`totalPrepaid = computeTotalPrepaid(running, commitmentCycles)`. `computeTotalPrepaid` is
`roundHalfUp(multiply(cyclePrice, rational(cycles,1)), 2)`, bigint throughout.

| Property | Verified | How |
|---|---|---|
| `cycle_price` = price of ONE cycle | yes | `pricing.cyclePrice` → `velrepeat_pricing_snapshots.cycle_price` |
| `total_amount` = whole commitment | yes | `pricing.totalPrepaidString` → `total_amount` |
| `total_amount = exact_cycle_price × commitment_cycles` | yes | from `metadata.final_price_exact`, one rounding |
| G1 sequential / multiplicative | yes | two rules compose: 7% then 5% on 170.00 → 150.195, i.e. `×0.93 ×0.95`, not a 12% sum |
| G1.1 30% cap, fail closed | yes | exactly 30% accepted (1000 → 700.00); 31% throws `PricingCapExceededError`, never clamped |
| G2 exact THB, no float | yes | `parseFloat`, `toFixed`, `Math.round` absent from `velrepeat-pricing.ts` + `money.ts` |
| no intermediate rounding | yes | `93.4444 × 3 = 280.33`, not `93.44 × 3 = 280.32` |
| one final 2dp rounding | yes | `170.00 → 150.195` displayed `150.20`; total `450.59`, **not** `450.60` |
| `commitment_cycles` validated before rules | yes | `0`, `-1`, `2.5`, `NaN` all → `InvalidPricingInputError`, even with zero rules |

**Worked examples (all asserted):**

| Commitment | Cycle price | Total prepaid | Stripe minor units |
|---|---|---|---|
| 1 | 90.00 | 90.00 | 9000 |
| 2 | 90.00 | 180.00 | 18000 |
| 4 | 90.00 | **360.00** | **36000** |
| 8 | 90.00 | 720.00 | 72000 |
| 1000 | 90.00 | 90000.00 | 9000000 |

**NUMERIC(12,2) overflow is refused, not clamped.** Two halves, both verified:

- The engine produces the exact arithmetic result and does not clamp it —
  `9,999,999.99 × 1002 = 10019999989.98`, which is outside the column.
- PostgreSQL then **rejects the insert** with `22003 numeric field overflow`. Verified against
  the live database, not asserted from a comment.

Clamping here would be the dangerous outcome: a customer committed to one number and silently
charged less.

---

## 6. Stripe TEST-mode configuration (§7)

**No Stripe credential of any kind exists in this environment.** Checked: `freebuff-env list`
(empty), `freebuff-deploy env list` (empty), `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
unset in the shell, and no `sk_test_`/`sk_live_` literal anywhere in `backend/lib` or
`backend/routes` outside test files. Repository secret *names* are unreadable (HTTP 403).

**Test-mode enforcement is nevertheless verified in code, and it is strong.** `stripeStatus()` in
`backend/lib/payment-config.ts` is a single gate, and it refuses rather than degrades. All five
rows below are asserted:

| Configuration | Result |
|---|---|
| `sk_live_…` secret key | **`STRIPE_LIVE_KEY_REFUSED`**, `usable: false`, no key handed out |
| unrecognized key shape | `STRIPE_KEY_UNRECOGNIZED` |
| test key + `STRIPE_MODE=live` | `STRIPE_MODE_MISMATCH` |
| test key, no webhook secret | `STRIPE_WEBHOOK_NOT_CONFIGURED` |
| complete test configuration | `usable: true`, `mode: "test"` |

So a live key cannot be used even if one were supplied by mistake, and the code path is
structurally incapable of charging real money from this configuration.

**Amount authority.** The charged amount is derived server-side from the persisted snapshot and
from nowhere else. `loadPayableCommitment` reads the newest snapshot's `total_amount`, converts it
with `planTotalToStripeMinor` (a single `toStripeMinor` rule shared with the V1 order path), and
returns it. Ownership is checked **before** the snapshot is read, so a pricing refusal cannot
become an oracle for another customer's plan. Currency must be THB on both the plan and the
snapshot. Currency is never a client input.

**Secrets.** No secret key, webhook secret, credential, card datum or personal datum was printed,
logged, or written to this document. The only key-shaped strings that appear anywhere are the
shape-only placeholders already in the repository's test files
(`sk_test_000000000000000000000000`), which are not credentials.

---

## 7. Real Stripe TEST E2E (§8) — **NOT EXECUTED**

**This is the second blocker. No real Stripe TEST-mode E2E was run, and none is claimed.**

A real E2E requires a Stripe **TEST** secret key and the **TEST** endpoint's webhook signing
secret. Neither exists in this environment (§6). The task forbids live keys, forbids inventing a
success, and forbids weakening tests to manufacture a pass. Fabricating a payment was therefore
the only way to "complete" §8, and it was not done.

**What was NOT therefore executed:** the outbound charge-creation call to Stripe
(`stripe.checkout.sessions.create`), and any real Stripe-side confirmation of the resulting
PaymentIntent. Everything downstream of a genuine Stripe charge is unverified in this run.

**What WAS verified — our half of the contract, in full.** Every settlement behaviour is exercised
through the **real webhook endpoint** (`POST /api/payments/stripe/webhook`) with a **real
HMAC-SHA256 Stripe signature**, against a **real database**, running the **real server-side
settlement code**. Only Stripe's half of the conversation is supplied. This is a genuine
verification of our authority, not a simulation of it:

| Check | Verified |
|---|---|
| webhook signature | verified for a correct signature; an invalid one is refused and changes nothing |
| event identity / idempotency | the same `evt_…` replayed byte-for-byte → one activation |
| payment identity | attempts resolve on the session id and payment-intent id they actually carry |
| expected plan | the plan named by the attempt is the plan acted on |
| expected customer | another customer's plan cannot be paid for (403) |
| expected currency | a non-THB event does not activate |
| expected amount | a cycle-price amount for a 4-cycle commitment is refused |
| expected payment state | only a `paid` canonical payment activates |
| draft-only activation | a non-draft plan is never payable; `WHERE status = 'draft'` guards the UPDATE |
| duplicate-webhook safety | a second, different event for an active plan is a no-op, and does not re-anchor timing |

**Lifecycle verified:** V2 package → draft plan created through the real route → immutable
pricing snapshot persisted → payment attempt recorded → correctly-signed TEST event → plan
`active`, timing re-anchored.

---

## 8. Mismatch handling (§10)

A payment was attempted at **90.00 THB** against a commitment whose authoritative total is
**360.00 THB** (cycle price 90.00 × 4 cycles), delivered as a correctly-signed event.

| Assertion | Result |
|---|---|
| Plan activates | **NO** — `status` stays `draft` |
| Payment record hidden or deleted | **NO** — the row is retained |
| Payment row status | **`paid`** — Stripe really took the money |
| Payment row amount | **360.00** — the snapshot's total, not the attempted 90.00 |
| Refusal is durable | 1 `payment_incidents` row, reason `PLAN_AMOUNT_MISMATCH` |

The money is recorded, not hidden, and the row is reconcilable and refundable. What is refused is
the **activation**, refused durably so an operator can see it. No fake success state was invented.

---

## 9. Webhook idempotency (§11)

| Property | Result |
|---|---|
| Same event replayed | **one** success, **one** activation |
| `PLAN_ACTIVATED` events | exactly **1** |
| Duplicate cycles | **0** |
| Duplicate orders | **0** |
| Duplicate `velrepeat_runs` | **0** |
| Duplicate inventory mutation | **0** |
| Duplicate fulfillment | **0** |
| Second, different event for an already-active plan | no-op; `started_at` is **not** re-anchored |
| Fake "Cycle 1" order to hold prepaid money | **never created** — `payments.order_id` stays `NULL` |

---

## 10. Plan timing (§12)

After activation:

| Field | Value |
|---|---|
| `status` | `active` |
| `payment_method` | `CARD` — a real Stripe rail, never the schema's default `'cod'` |
| `started_at` | the **activation** instant (`new Date()` at settlement), not draft creation |
| `next_run_at` | `started_at + exactly 1 week` (604,800,000 ms), via the same `calculateNextRunAt` the V1 scheduler uses |

The re-anchor is real, not a no-op: a second event for the already-active plan leaves `started_at`
byte-identical, which is only observable because the value genuinely changes once and only once.

---

## 11. No premature fulfillment (§13)

Measured before and after a successful prepaid activation, on the same database:

| Check | Result |
|---|---|
| Order created by payment success | **NO** — order count unchanged |
| Stock decremented by payment success | **NO** — `SUM(inventory.quantity)` unchanged |
| Per-cycle inventory reserved | **NO** |
| Fake "Cycle 1" order | **NO** |
| Duplicate order | **NO** |
| Seller fulfillment trigger | **NO** — 0 `velrepeat_runs`, 0 shipments |
| `velrepeat_cycles` created | **NO** — cycle count unchanged |

Payment success means `draft → active`, and nothing else. A V2 plan is active but not fulfilled;
the `velrepeat_plans` due-index only matches `status = 'active'`, and the V1 per-run scheduler
never materialises a run for it.

---

## 12. V1 regression (§14)

| Check | Result |
|---|---|
| Full suite, with a real database | **1849 pass / 2 skip / 0 fail** (1851 tests, 60 files) |
| Pre-existing baseline, same command | 1812 pass / 2 skip / 0 fail |
| Delta | **+37 pass, +0 fail** — the new matrix suite only |
| V1 route namespace | intact — `/api/velrepeat/*` untouched |
| V1 COD behaviour | intact — `lib/payment-config.ts` unmodified, shared as one gate |
| V1 scheduler behaviour | intact — `jobs/velrepeat-scheduler.ts` unmodified; only *read* for `calculateNextRunAt` |
| V1 active-plan semantics | intact — `velrepeat_plans` constraints untouched |
| V2 entering a V1 path | **NO** — an activated V2 plan produces 0 `velrepeat_runs` |
| V1 protected files in this diff | **NONE** — `velrepeat-plans.ts`, `velrepeat.ts`, `velrepeat-scheduler.ts`, `inventory.ts`, `order-fulfillment.ts`, `order-lock.ts`, `payment-reservation.ts`, `payment-config.ts`, `cart.ts` are all unmodified |

This task changed **no production runtime code at all**. The only production-file change is
`db/migrations/052_velrepeat_pricing_cycle_price.sql`, which gained a §0 that creates the tables
it was already failing on (§2.2). No backend route, library or frontend file was touched.

---

## 13. Test matrix (§15) — 41 tests, all passing

`backend/tests/velrepeat-v2-verification-matrix.test.ts` (new). Chosen so a gap is visible in one
place rather than inferred across five existing suites.

**Pricing (12/12):** 1 cycle · 2 cycles · 4 cycles · 8 cycles · maximum supported commitment ·
invalid commitment (`0`, `-1`, `2.5`, `NaN`, and with no rules) · 30% boundary accepted · >30%
rejected, not clamped · G1 sequential vs sum · fractional exact money · single final 2dp rounding ·
large valid total · NUMERIC(12,2) overflow refused (engine + real PostgreSQL `22003`).

**Payment (10/10):** successful TEST payment of the full commitment · wrong amount (90.00 vs
360.00) · wrong currency · duplicate webhook (same event id) · duplicate payment event (different
event, plan already active) · invalid signature · already-active plan · non-draft plan · wrong
customer · wrong plan/payment mapping.

**Security (client cannot override any of):** `seller_id` · `cycle_price` · `total_amount` ·
`discount` / `discount_amount` / `discount_percent` · `pricing_rule` · `currency` · `payment
amount` (`amount` / `amountMinor`) · `payment status` · `plan status` · `user_id` · `plan_id` —
all injected in one body at both the plan-creation and payment endpoints. The snapshot is
immutable, the plan stays `draft`, ownership is unchanged, and any payment row carries the
snapshot's 360.00/THB, never a body-supplied value.

**Also covered:** §7 test-mode enforcement (5 rows), §3/§5 migration safety (5 rows), §3 the V2
prepaid domain inside 052 (4 rows — the objects it creates, their order relative to the
`cycle_price` ALTER, their verbatim equality with `db/schema.sql`, and that the file issues no
`ALTER TABLE orders`), §13 fulfillment safety, §14 V1 non-interference.

Nine assertions failed on first run. **All nine were defects in the new test, not in the
product**, and each was fixed by correcting the test:

- `Date.prototype.toString()` omits milliseconds, hiding a real `started_at` re-anchor → compare
  epoch milliseconds, and assert `next_run_at - started_at` exactly.
- A stray positional parameter on a query with no placeholder → a wire-protocol error, not a
  product failure.
- Two wrong destructure shapes of the `query` result.
- The 30% cap compared a `Rational` to a `Rational`'s string form.
- `170 × 0.93 × 0.95` was written as two 93%/95% *discounts* (which correctly trip the cap)
  instead of 7% and 5% discounts.
- Two miscalculated exact totals.
- `DROP TABLE` etc. matched inside 052's own header comment, which *names* the operations it
  refuses → strip comments before the destructive check.
- An undefined local in a body literal.

**No assertion was weakened, skipped or deleted to obtain green.** Each fix made the assertion
*stricter or more precise*; the underlying behaviour was never changed.

---

## 14. Build & verification (§17)

| Check | Command | Result |
|---|---|---|
| Full suite with database | `TEST_DATABASE_URL=… bun test backend/tests` | **1853 pass / 2 skip / 0 fail** (1855 tests, 60 files) |
| Full suite without a database | `bun run test` | 1603 pass / 248 skip / 0 fail |
| Backend typecheck | `cd backend && bunx tsc --noEmit` | **0 errors** |
| App typecheck | `bun run typecheck` | **4/4 exit 0** |
| App build | `bun run build:apps` | **4/4 exit 0** |
| Whitespace / conflict markers | `git diff --check` | **clean** |
| Canonical SQL agreement | `cmp db/schema.sql db/run-sqleditor.sql` | **identical** |
| Vercel | not configured for this repository (four Vercel frontends, no `vercel.json` project linkage in CI) | n/a |

CI runs PostgreSQL **16**; local verification ran PostgreSQL **14**. Both bootstrap from the same
canonical `db/run-sqleditor.sql`, and the pre-existing suite already passes identically on both.

**One transient infrastructure failure, recorded for honesty.** An intermediate full-suite run
reported 172 failures. The cause was the local PostgreSQL **service** dying mid-run
(`ECONNREFUSED 127.0.0.1:5432`, cluster `14/main` reported `down`); the server log held only the
ordinary errors those tests provoke deliberately. It was **not** a code regression: the database
was restarted and the full suite then returned 1849/2/0 **three consecutive times** (and
1853/2/0 after this pass's four added tests), and the
matrix suite passes in isolation. CI provisions its own `postgres:16` service container and is
unaffected.

---

## 15. Remaining blockers

### Blocker 1 — the missing VelRepeat V2 domain — **RESOLVED IN REPOSITORY, PENDING THE PUSH**

052 could not apply because `velrepeat_pricing_snapshots` does not exist in production: the V2
prepaid domain schema had **no `db/migrations/*.sql` file** — it existed only in `db/schema.sql` +
`db/run-sqleditor.sql` (commit `ea79277`), while `034_velrepeat_v2` is the older per-run-order
design.

The owner authorised authoring it on 2026-10-01, and it is done and verified (§2.2): §0 of
`052_velrepeat_pricing_cycle_price.sql` now creates the prepaid pricing domain ahead of the
`cycle_price` ALTER, with both table bodies copied verbatim from `db/schema.sql`. It applies clean
and is idempotent on a database reproduced to production's exact starting state.

What remains is mechanical: the next push to `main` triggers `Migrate Neon Database` (the
`paths: db/migrations/*.sql` filter matches), which will apply 052 to production for the first
time. Two things only the owner can see afterwards — the workflow run's conclusion, and the
resulting `schema_migrations` row — are not observable from here (§2).

### Blocker 2 — no Stripe TEST credential (owner action)

A real Stripe TEST-mode E2E (§8) requires `STRIPE_SECRET_KEY` (a `sk_test_…` key) and
`STRIPE_WEBHOOK_SECRET` (the **TEST** endpoint's signing secret). Neither is present in any
environment reachable from here, and the agent cannot read the repository's secret names
(HTTP 403). Live keys are forbidden and were not sought.

To unblock, set in **Settings → Environment** (or the Render backend's environment):

- `STRIPE_SECRET_KEY` = a **test** secret key (`sk_test_…`)
- `STRIPE_PUBLISHABLE_KEY` = the matching test publishable key (`pk_test_…`)
- `STRIPE_WEBHOOK_SECRET` = the signing secret of the **TEST** webhook endpoint
- `NEON_DATABASE_URL` = the production connection string, to unblock §3 verification

### Not blockers — known limits, unchanged by this task

- `velrepeat_pricing_snapshots_cycle_price_not_null` is a **CHECK**, which SQL satisfies with
  `NULL`. 052 declines to force it while a settled row legitimately has no `cycle_price`.
  Converting it to a real `NOT NULL` requires confirming settled rows are empty — a
  production-data decision.
- `POST /api/velrepeat/v2/plans/:planId/payment` ignores **unknown** body fields rather than
  refusing them. A strict allowlist is an API-shape decision for the owner. Note this is a
  *usability* gap, not a security gap: the injected `amount`/`sellerId` provably cannot change
  the money (§13), and the test now asserts that property directly.
- Refunds remain order-scoped (Phase 9). No UI was touched.

---

## 16. Statement of what is and is not verified

**Verified independently:** the pricing contract against real code and a real database; migration
052's SQL correctness, idempotency and financial-history safety against real data; that 052 could
not apply until the domain it depends on existed, and that it applies clean once §0 is present —
on a database reproduced to production's exact starting state, with a `pg_dump` parity diff
against the canonical bootstrap; the entire server-side Stripe settlement contract — signature,
idempotency, payment identity, plan, customer, currency, amount, state, draft-only activation,
duplicate safety — through the real endpoint against a real database; mismatch handling; activation
timing; absence of premature fulfillment; Stripe test-mode enforcement; and full V1 regression with
no V1 file touched.

**Not verified:** the production database's actual contents and its ledger **after** this push (no
connection available), and a real Stripe TEST-mode round trip (no TEST credential available).

**Therefore this task does not claim VelRepeat V2 is production ready.** The Stripe half is
blocked on a credential. The production half is now unblocked in the repository and lands on the
next push; confirming it in production needs the owner's read of the `Migrate Neon Database` run.
