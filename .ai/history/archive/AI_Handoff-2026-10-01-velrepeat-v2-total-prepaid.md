## 61. VelRepeat **V2 — TOTAL PREPAID correction** (2026-10-01)

Closes the §60 blocker. **The invariant:** V2 is prepaid, so
`total_prepaid = roundHalfUp(EXACT post-rule cycle price × commitment_cycles, 2)` — the exact cycle
price, never the 2dp one (93.4444… × 3 = **280.33**; 93.44 × 3 = 280.32). `commitment_cycles` is
validated (positive integer) **before any rule runs** → fail closed.
**Pricing** (`lib/velrepeat-pricing.ts`): `CommitmentPricingRequest.commitmentCycles?` (defaults 1);
new exported `computeTotalPrepaid()` = `roundHalfUp(multiply(cyclePrice, rational), 2)` — bigint only,
**no float**; `CommitmentPricing` gained `cyclePrice`/`commitmentCycles`/`totalPrepaid`/
`totalPrepaidString`; `finalPriceString` is now an alias of `cyclePrice`; `insertPricingSnapshot`
writes **both** columns plus `metadata.cycle_price` / `commitment_cycles` / `total_prepaid` /
`total_prepaid_exact` (keeps `final_price_exact`). G1 ordering, the G1.1 30% cap and rule identity
are untouched.

**Snapshot:** new `cycle_price NUMERIC(12,2)` = one delivery; `total_amount` = the commitment total
(the charge). Two constraints: `cycle_price IS NOT NULL` and `total_amount >= cycle_price`. SQL cannot
express the exact relationship (`final_price_exact` lives in jsonb), so the exact proof runs in
TypeScript at charge and settlement.

**Stripe:** unchanged code path — `planTotalToStripeMinor(snapshot.total_amount)` via `toStripeMinor`.
What changed is what `total_amount` *means*. Responses return both, named: `{ cyclePrice,
totalPrepaidAmount, amountMinor }` on payment (`amount` renamed) and `{ cyclePrice,
totalPrepaidAmount }` on plan creation. A webhook carrying the **cycle** amount is rejected
`PLAN_AMOUNT_MISMATCH`; the correct total activates once, 0 orders/cycles/runs. All Phase 4 protections
untouched. **Migration 052** (additive, idempotent) backfills `cycle_price` from the old `total_amount`,
recomputes `total_amount`, and **excludes any plan with a settled payment**
(`payments.status IN ('paid','processing')`) — settled financial history is never rewritten, and the
NOTICE reports rows skipped. `db/schema.sql` ≡ `db/run-sqleditor.sql`; `db/run-update.sql` still absent.

**Verified:** new suite `velrepeat-v2-pricing-total-prepaid.test.ts` = **31 tests** (Examples A–F,
cycle≠total, Stripe-amount, no-float structural, schema, V1 protection, HTTP+DB integration), 4
DB-gated → SKIP locally, run in CI. A **local PostgreSQL was installed** and the suite bootstrapped
from `db/run-sqleditor.sql`, so the DB path is no longer left to CI: **1812 pass / 2 skip / 0 fail**
(the exact CI command), and 1566 pass / 0 fail without a database. backend tsc 0; typecheck 4/4;
build:apps 4/4; `git diff --check` clean. No V1 file touched.
Three real findings came out of it, none of them product bugs: two stale expectations in the new
suite (`total_prepaid_exact` is an exact decimal `"360"`; a mismatched payment is recorded **`paid`**
— Stripe took the money, which is what makes it refundable), and one **latent Phase 4 defect** — *“a
client cannot pay a different amount…”* asserted `[403,409]`, which only held because the
pre-correction pricing guard short-circuited **before** the live Stripe call. With the pricing fixed
it returned 500 `Invalid API Key`. It now asserts the property that matters (plan stays draft, no
payment row, never a success quoting an amount). No protection was removed.
Audit: `.ai/tasks/audits/velrepeat-v2-pricing-total-prepaid-2026-10-01.md`.

> **PRODUCTION DB: BLOCKED — and the cause predates this phase.** `Migrate Neon Database`
> (`36902790862`) applied nothing: `052` failed with `relation "velrepeat_pricing_snapshots" does not
> exist`. **The entire VelRepeat V2 prepaid domain schema has no `db/migrations/*.sql` file** — Phase 1
> (`ea79277`) added it to `db/schema.sql` + `db/run-sqleditor.sql` ONLY. `034_velrepeat_v2` is the
> older per-run-order design, not the prepaid tables. So §60's “the V2 tables exist” claim in Neon is
> **WRONG**; V2 is CI-only. 052 is not recorded, so the Neon workflow stays **red on every push** until
> the domain migration exists. Do NOT paper over it — 052 is correct SQL.
> **Safe next action:** land the missing V2 domain migration (the 72 schema lines Phase 1 wrote),
> numbered ahead of the pricing change, then 052 applies. That deploys ~8 new tables to production and
> is an OWNER decision, not this phase's.

**Known limits:** the `cycle_price IS NOT NULL` "constraint" is a CHECK, which SQL satisfies with
NULL — convert to a real `NOT NULL` once settled rows are confirmed empty. No Stripe E2E credential.
Refunds still order-scoped (Phase 9). No UI touched.
**Next safe phase:** the V2 domain migration above — then 5, V2 plan lifecycle routes
(pause/resume/cancel/read for an *active* V2 plan, which V1's routes can now reach). NOT cycles,
inventory or fulfillment.
