# VelRepeat V2 — Total Prepaid Pricing Correction (audit)

- **Date:** 2026-10-01
- **Branch:** `main`
- **Start SHA:** `708321e5db3870c566cbb7a17da81a33c3c4f9c4`
- **Scope:** correct ONE invariant — the persisted commitment total. No UI, no cycles, no inventory, no
  fulfillment, no refund/cancellation policy, no VelRepeat redesign, no redo of Phase 4.
- **Status:** IMPLEMENTED, TESTED, COMMITTED, PUSHED. See *CI* and *Production DB* for the exact run.

---

## 1. Previous ambiguity

VelRepeat V2 is **prepaid repeat commerce**: a plan carries `commitment_cycles = N` and the customer
pays **once** for all N deliveries. The contract pipeline literally names the two distinct stages
(`velrepeat-v2-contract-2026-09-30.md:75`):

```
… → Cycle Price → **Total Prepaid**
```

and the plan total is defined as `cycle price × commitment`
(`velrepeat-v2-decision-closure-2026-09-30.md:130`).

Phase 3 implemented the **cycle price** and persisted it under the column name **`total_amount`**. The
snapshot therefore said `commitment_cycles = 4, total_amount = 90.00` — which reads as "a 90.00 plan
totalling 90.00 over four cycles". Nothing in the row, the API, or the database distinguished the
price of one delivery from the amount owed for the whole commitment.

Consequence: the only honest reading of that row was that the total was 90.00 for four cycles, i.e.
**22.50 per delivery for a product quoted at 90.00**. Downstream systems were left to guess.

Phase 4 did not paper over this. It added
`assertCommitmentCoversEveryCycle()` (`backend/routes/velrepeat-v2-payments.ts`), an exact proof that
`total_amount == roundHalfUp(metadata.final_price_exact × commitment_cycles)`, used by **both** the
charge path and the settlement path. Because the engine never multiplied, that proof failed for every
multi-cycle plan: initiation was refused `409 COMMITMENT_TOTAL_UNVERIFIED` before any Stripe session
or payment row, and at settlement the money would be recorded, activation refused and a durable
operator incident raised. **Fail-closed, but blocked** — the correct outcome, and an owner decision
rather than something an agent may take unilaterally.

The owner has now approved the correction. This audit records it.

## 2. Root cause

`computeCommitmentPricingWithLines()` computed `subtotal = Σ(unitPrice × quantity)` and then ran the
canonical G1 rule chain, returning the *per-cycle* result. **`commitment_cycles` was never
multiplied in.** It was a validated, stored, and enforced field — but only ever used as a coverage
check, never as a multiplier. The chain ended at the cycle price and labelled it `total`.

Minimal reproduction, on the pre-fix code:

```
base 100.00 · one line · 4 cycles · rule discount_value "0.10"
  → subtotal            100.00
  → finalPriceString     90.00     ← per cycle
  → total_amount         90.00     ← persisted as "the total"
commitment owed         360.00
```

Not a rounding bug, not a Stripe bug, not a webhook bug: **the canonical pricing engine stopped one
stage short of the contract pipeline.** Everything downstream was built correctly on top of a value
that was honestly labelled and wrongly named.

## 3. The exact invariant

```
cycle_price    = roundHalfUp(exact price after the full G1 rule chain, 2)      ← per DELIVERY
total_prepaid  = roundHalfUp(exact price after the full G1 rule chain × N, 2)  ← per COMMITMENT
                 \____________ identical, unrounded ____________/
```

`total_prepaid = cycle_price × commitment_cycles` holds **exactly whenever the exact cycle price has
at most two decimals** (which is every catalogue price in the V2 rule sets). When it does not, the
committed relationship is the one on the **exact** value, and the two columns legitimately differ by
one satang — see §6, Example D. The DB cannot express "total is a function of an exact number stored
in a jsonb key", so it enforces the weaker true statement `total_amount >= cycle_price` and the exact
relationship is re-proven at settlement from `metadata.total_prepaid_exact`.

## 4. Cycle price vs total prepaid

The five price stages the brief asks to keep distinct, and where each now lives:

| Stage | Where it lives | Persisted as |
|---|---|---|
| base price | `pricing.basePriceString` | `metadata.base_price` |
| package price | `computeCommitmentPricingWithLines` → `subtotal` | `subtotal_amount` |
| quantity-adjusted price | the `lines` Σ of each line in `pricing_snapshot_items` | snapshot items |
| **discounted cycle price** | `pricing.cyclePrice` | **`cycle_price`** + `metadata.cycle_price` / `final_price_exact` |
| **total prepaid commitment** | `pricing.totalPrepaid` | **`total_amount`** + `metadata.total_prepaid` / `total_prepaid_exact` |

The engine returns both, named. `finalPriceString` is retained as an alias of `cyclePrice` so no
existing caller silently changes meaning. Both are returned to HTTP callers under their own names, so
a future UI physically cannot display one where the other is meant.

## 5. Pricing calculation

`backend/lib/velrepeat-pricing.ts`:

- `CommitmentPricingRequest` gained `commitmentCycles?: number` — **defaults to 1**, the degenerate
  commitment where per-cycle and total are the same number by definition, so a caller that only wants
  one cycle keeps its old meaning and a commitment is never silently priced as a single delivery.
- It is validated **before any rule runs** (`InvalidPricingInputError` for non-integer, ≤ 0, `NaN`,
  `Infinity`), so an impossible commitment can never produce a partially priced result. Fails closed.
- New exported `computeTotalPrepaid(cyclePrice: Rational, commitmentCycles: number): Rational`:

  ```ts
  const scaled = roundHalfUp(multiply(cyclePrice, makeRational(BigInt(commitmentCycles), 1n)), 2);
  return makeRational(scaled, 100n);
  ```

  `multiply` and `roundHalfUp` are bigint-rational operations from `backend/lib/money.ts`. **No float
  participates at any point.** `BigInt(commitmentCycles)` is safe because the value is already
  `Number.isInteger`-validated and positive.
- `CommitmentPricing` gained `cyclePrice`, `commitmentCycles`, `totalPrepaid`, `totalPrepaidString`.
- The G1 cap (30%, fail closed), G1 sequential/multiplicative ordering, the `pricing_rule_key` /
  `pricing_rule_version` identity and the audit-trail metadata are all **unchanged**. Only one
  multiplication was added, after the chain.

### Single-rounding rationale (the part that is easy to get wrong)

The cycle price is **not** rounded to 2dp before multiplying. G2 requires **one** final 2-decimal
rounding, and the number being charged is the total, so the rounding belongs to the total:

| exact cycle | × N | round the TOTAL once | round the CYCLE first | chosen |
|---|---|---|---|---|
| 93.4444… | 3 | **280.33** | 93.44 × 3 = 280.32 | 280.33 |
| 93.4444… | 4 | **373.78** | 93.44 × 4 = 373.76 | 373.78 |

Rounding the cycle first is a second rounding and charges a different number. The test suite asserts
both columns exist so a regression in either direction is caught.

## 6. Snapshot

`velrepeat_pricing_snapshots` now distinguishes the two values explicitly — smallest additive change,
one new column, no new table and no second pricing authority:

```
commitment_cycles = 4
cycle_price       = 90.00     ← one delivery
total_amount      = 360.00    ← the whole prepaid commitment  ← what is charged
metadata          = { …, final_price_exact: "90", cycle_price: "90.00",
                      commitment_cycles: 4, total_prepaid: "360.00",
                      total_prepaid_exact: "360" }
```

`metadata.final_price_exact` is kept (Phase 3 audit trail, and the exact value the total derives from)
and `metadata.total_prepaid_exact` is added, so the whole relationship is re-provable **from the row
alone** — no recomputation from a catalogue price, which may since have changed.

`db/schema.sql` (`~:949`):

```sql
cycle_price NUMERIC(12, 2) CHECK (cycle_price IS NULL OR cycle_price >= 0),
…
ALTER TABLE … ADD CONSTRAINT velrepeat_pricing_snapshots_cycle_price_not_null   CHECK (cycle_price IS NOT NULL);
ALTER TABLE … ADD CONSTRAINT velrepeat_pricing_snapshots_total_not_below_cycle CHECK (cycle_price IS NULL OR total_amount >= cycle_price);
```

The second constraint is the relationship the schema *can* state cheaply, and it is genuinely true:
rounding is monotonic, so `round(exact × N) >= round(exact)` for every `N >= 1`. It is deliberately
**not** `total_amount = cycle_price * commitment_cycles`, which would be wrong by a satang for a
fractional cycle price (Example D). An earlier draft of migration 052 tried to express the exact
relationship with a subquery inside a `CHECK`; that is invalid in PostgreSQL and was replaced with the
form above.

## 7. Stripe integration changes

- `readCommitmentSnapshot()` now also selects `cycle_price`.
- `PlanCommitment` / `PlanPaymentSession` carry `cyclePrice: string | null` **for display only**.
- The charged amount is **unchanged in code path**: `planTotalToStripeMinor(snapshot.total_amount)`.
  What changed is what `total_amount` now *means* — the commitment total. The amount is still derived
  from the persisted authoritative snapshot, never from the request body, and still converted by
  `toStripeMinor` (integer minor units), the same rule the order path uses.
- `POST /api/velrepeat/v2/plans/:planId/payment` response now returns **both**, explicitly named:

  ```json
  { "cyclePrice": "90.00", "totalPrepaidAmount": "360.00", "amountMinor": 36000, … }
  ```
  (`amount` was renamed to `totalPrepaidAmount` so the field name itself carries the invariant.)
- `allow_promotion_codes` is still NOT set, so Stripe cannot capture less than the committed total.

## 8. Webhook verification

Unchanged in mechanism, corrected in target. The settlement path compares the Stripe amount against
**`snapshot.total_amount`**, which is now the commitment total, and additionally runs
`assertCommitmentCoversEveryCycle()`. For a 4-cycle commitment whose Stripe event carries 36000 minor
units (90.00) instead of 36000 THB-worth `36000`… concretely:

- Stripe amount == `total_amount` **and** `total_amount == roundHalfUp(final_price_exact × N)` →
  activate.
- Stripe amount == `cycle_price` (under-covered) → **rejected** `PLAN_AMOUNT_MISMATCH`, money recorded,
  activation refused, durable operator incident raised.

All Phase 4 protections are preserved untouched: webhook signature verification, amount verification,
currency verification, payment idempotency, plan ownership (checked before the pricing guards so a
non-owner gets 403, not 409), draft-only initiation, the single `draft → active` guarded update,
canonical payment authority, Stripe **test** mode.

## 9. Migration status

`db/migrations/052_velrepeat_pricing_cycle_price.sql` — **V0052**, additive and idempotent
(`ADD COLUMN IF NOT EXISTS`, guarded constraints, `DO $$` blocks). No `DROP TABLE`, no `DROP COLUMN`,
no `TRUNCATE`, no `UPDATE` against `payments`, `refunds` or `payment_incidents` except as a read-only
safety gate.

Steps:
1. `ADD COLUMN cycle_price NUMERIC(12,2)` (nullable).
2. **Scoped backfill** (`DO $$`, three rules):
   (a) `cycle_price ← total_amount` — the old column *was* the per-cycle price, so nothing is
   recomputed and no catalogue price is re-read: a legacy row keeps the number it was actually quoted;
   (b) rows whose plan already has a **settled** payment (`payments.status IN ('paid','processing')`)
   are **EXCLUDED** — rewriting a charged total would make the snapshot disagree with the money;
   (c) `total_amount ← ROUND(COALESCE(metadata->>'final_price_exact', cycle_price)::numeric ×
   commitment_cycles, 2)` — exact `numeric` arithmetic, one half-up rounding, the same rule as
   `money.ts`. Tags the row `metadata.total_prepaid_migration = 'V0052'` so a re-run is a no-op.
3. `CHECK (cycle_price IS NOT NULL)` added **only if every row has a value**; otherwise the migration
   reports the count and declines to force it.
4. `CHECK (cycle_price IS NULL OR total_amount >= cycle_price)` added always.

`db/schema.sql` and `db/run-sqleditor.sql` both carry the column and both constraints; `cmp` reports
them **IDENTICAL**. `db/run-update.sql` was not created and must never be.

## 10. Existing data — production state (brief §10)

Inspected before migrating, as required:

- `034_velrepeat_v2` (Phase 2 tables) applied 2026-09-15, `schema_migrations` id 48 → V2 tables exist.
- `051_payments_velrepeat_v2_plan_parent` applied 2026-10-01 16:17 UTC, id 67.
- V2 has been in production with **no seller-facing UI and no way to create a plan** — plan creation is
  reachable only through the API, and Phase 4 (which made payment possible) shipped on this very day.
  Any pre-existing V2 plan was therefore a draft created by an API call during testing, with at most a
  test-mode payment attempt.
- Consequently the migration's settled-payment gate is the mechanism that makes this safe regardless:
  it **cannot** touch a row whose plan has a `paid`/`processing` payment, and it reports how many rows
  it skipped. **No historical financial data is deleted, rewritten or reinterpreted.**

**Safety verdict:** proceed. No stop condition from brief §20 is met. The gate is enforced in SQL
rather than by assumption.

## 11. Tests

New suite `backend/tests/velrepeat-v2-pricing-total-prepaid.test.ts` — **31 tests, 7 blocks**:

1. **Examples A–F, exactly as briefed.**
   - A: 100 × 1 = 100 (and cycle == total, the only legitimate charge-the-cycle case).
   - B: 90 × 4 = **360**.
   - C: 93 × 4 = **372**.
   - D: fractional cycle 93.4444… × 3 → **280.33**; asserts that rounding the cycle first gives a
     *different* 280.32, and that through the full pipeline `cyclePrice === "93.44"` while
     `totalPrepaidString === "280.33"`.
   - E: 9 999 999.99 × 4 = 39 999 999.96, inside `NUMERIC(12,2)`; and that an over-large commitment is
     **not** silently clamped — it produces a number PostgreSQL will refuse so the purchase transaction
     rolls back.
   - F: `0, -1, -4, 2.5, NaN, Infinity, 1.0000001` all throw `InvalidPricingInputError`, both from
     `computeTotalPrepaid` and from `computeCommitmentPricing` (which refuses *before* any rule runs).
2. **cycle ≠ total** for 2, 3, 4, 6, 12 cycles; equal at 1.
3. **Stripe amount derivation** — minor units equal the total, never the cycle, for multi-cycle
   commitments; the request body cannot inject an amount.
4. **No-float structural proof** — the authoritative total path is scanned for `Number(`,
   `parseFloat(`, `toFixed(` and float multiplication and asserted clean; `money.ts`'s
   `parseDecimal` / `multiply` / `roundHalfUp` / `makeRational` / `toExactDecimalString` are asserted
   to be the only arithmetic used. `Number(...)` appears **only** in test assertions comparing
   magnitudes, never in the production path.
5. **Schema** — `cycle_price` column present; a snapshot inserted without it is refused (23514).
6. **V1 protection** — the nine protected V1 files are asserted unmodified relative to `main` in the
   pricing surface, and the V1 order path still derives `toStripeMinor(order.total_amount)`.
7. **HTTP + DB integration** (DB-gated): create a plan over HTTP, assert the snapshot proves
   `cycle ≠ total`; assert the Stripe amount is `4 × cycle` in minor units; POST a webhook carrying the
   **cycle** amount → rejected `PLAN_AMOUNT_MISMATCH`; POST the **correct total** → plan activates
   exactly once, `order_id IS NULL`, exactly 1 `PLAN_ACTIVATED`, **0 cycles, 0 runs**.

Updated existing suites (regressions, not rewrites):
`velrepeat-v2-phase3-pricing-snapshot.test.ts` (pricing response now
`{cyclePrice: "282.72", totalPrepaidAmount: "1130.88"}`), `velrepeat-v2-domain-schema.test.ts`
(fixtures carry `cycle_price`; a snapshot without it is refused), and
`velrepeat-v2-phase4-prepaid-payment.test.ts` — which now asserts `cyclePrice === "90.00"` and
`totalPrepaidAmount === "360.00"`, proves **the corrected plan is payable at the total**, and converts
its two guard tests into deliberate legacy rows (`total_amount = cycle_price`) so the guard is still
exercised.

**4 of the 31 tests are DB-gated and SKIP locally** (no local PostgreSQL). They execute in CI.

## 12. Typecheck / builds

- `cd backend && bunx tsc --noEmit` — **0 errors**.
- `bun run typecheck` — velshop, velseller, velcenter, velnox — **4/4 exit 0**.
- `bun run build:apps` — **4/4 built**.
- `bun run test` — **1566 pass / 248 skip / 0 fail** (1814 tests, 59 files).
- `git diff --check` — clean.
- `cmp db/schema.sql db/run-sqleditor.sql` — **IDENTICAL**.

## 13. CI

Workflows are triggered by the push; see the final report for the run ID and conclusion. The material
difference from Phase 4's local runs is that **CI owns a disposable `postgres:16`**
(`.github/workflows/test.yml`, `TEST_DATABASE_URL`), so the 4 DB-gated integration tests and every
other DB suite actually execute there. A local 0-fail does **not** prove the schema migration runs
against a real PostgreSQL 16 — only CI does. The `Migrate Neon Database` workflow applies 052 to
production; its log is the evidence of how many snapshots the backfill touched and how many it left
untouched because of the settled-payment gate.

## 14. Known limitations (honest list)

1. **`velrepeat_pricing_snapshots_cycle_price_not_null` is a CHECK, not a real `NOT NULL`.** A
   `CHECK (cycle_price IS NOT NULL)` rejects `false` but is **satisfied by `NULL`** in SQL, so a row
   with `cycle_price IS NULL` still passes it. It was written this way on purpose — a real
   `SET NOT NULL` cannot be applied conditionally in a single migration, and forcing it would fail on
   a settled-payment row the gate deliberately left alone. The `velrepeat-v2-domain-schema` test
   asserts the intended behaviour (a snapshot without a cycle price is refused) against a real
   PostgreSQL, and the writer always supplies the column. Converting to a real `NOT NULL` is a
   follow-up once the settled rows are confirmed empty.
2. **The exact total cannot be re-proven in SQL.** The exact relationship is
   `roundHalfUp(metadata.final_price_exact × commitment_cycles)`, and `final_price_exact` lives in
   jsonb. The DB enforces `total_amount >= cycle_price` instead; the exact proof runs in TypeScript at
   charge and settlement time (`assertCommitmentCoversEveryCycle`).
3. **No Stripe end-to-end run.** No test credential is available in any environment, so the Stripe
   Test-mode path is verified by unit/DB tests and CI only.
4. **Refunds are still order-scoped.** Nothing in this change touches `refunds.plan_id` or a
   prepaid-commitment refund formula. That is Phase 9 work and no policy is invented here.
5. **The V1 lifecycle routes can now reach an *active* V2 plan** (carried from Phase 4; unchanged by
   this task).
6. **No UI.** The backend contract is explicit — `cyclePrice` and `totalPrepaidAmount` are separate,
   named fields in both plan creation and payment initiation — but nothing renders them yet, and no
   UI file was touched.
7. **Migration 052 assumes `final_price_exact` is present for legacy rows**; the `COALESCE` falls back
   to the already-2dp `cycle_price` in that case, reproducing the old number rather than inventing a
   new one. The NOTICE in the migration reports counts either way.

## 15. What was NOT done

No Phase 5. No UI in velshop / velseller / velcenter / velnox. No cycle, fulfillment or inventory
logic. No refund, cancellation or skip/pause policy. No change to any V1 file. No new pricing
authority, no second table, no change to `db/run-update.sql` (which does not exist and must not).
