# AI handoff §52–§63 — VelRepeat V2 design sheets and phases 1–5

Moved verbatim from `.ai/AI_HANDOFF.md` on 2026-10-04 for edit-headroom housekeeping
(the file had reached ~57.5 KB, past the ~55 KB point at which the file-edit tools stop
matching). Every section below is COMPLETE and closed. Current state lives in §64–§66.

Note on §62/§64: both record a migration as "APPLIED + verified in production" on the
strength of the Actions ledger alone. **§66 proves that ledger describes a different
database from the one Render serves**, so treat every "production verified" claim in
this file as unproven until the secret is re-pointed.

---

## 52. VelRepeat **V2 — Prepaid Repeat Commerce Contract** (2026-09-30) — CONTRACT COMPLETE (design only)

**What was done:** `.ai/context/velrepeat-contract.md` upgraded in place to the **V2 contract**
(Revision 2.0) preserving Parts I–II and adding **Part III §39–§64**: business definition; Product /
Package / Repeat Plan / Delivery Cycle / Order / Payment / Fulfillment distinctions; quantity per cycle
vs total commitment; schedule + explicit timezone semantics; commitment vs schedule; pricing pipeline
(tiers in data — no hardcoded percentages); immutable price snapshot; one prepaid payment per plan
(฿93 × 4 = ฿372 once); payment authority (1A/2A/5A); payment vs fulfillment; plan → Cycle 1..N → per-cycle
order(s); inventory Model A/B comparison (not chosen); `sold_count` invariants (3A); cancellation /
pause / skip / modification with owner decisions reserved; B2C+B2B single model; authorization (7B);
idempotency incl. *same Plan + Cycle + execution ⇒ one Order*; HIGH #5 incidents; **V2 OWNER DECISIONS**
(approved 1A–7B + new **A–I** + Q13–Q17); 14-area gap analysis; Phases 1–10 roadmap; acceptance
criteria; prohibited actions. Audit: `.ai/tasks/audits/velrepeat-v2-contract-2026-09-30.md`.

**Files changed:** `.ai/context/velrepeat-contract.md`,
`.ai/tasks/audits/velrepeat-v2-contract-2026-09-30.md`, `.ai/AI_HANDOFF.md`. **No production code,
schema, migration, payment, inventory or scheduler change.**

**Gates for implementation (NOT STARTED):** §60.2 decisions **A–I** (inventory model; prepaid
cancellation; skip; pause; future price change; out-of-stock cycle; modification; B2B stacking;
prepaid fulfillment failure) + §60.3 **Q13–Q17** + Q2 residual (`sold_count` moment). Approved:
**1A–7B**. The three structural blockers (§51) remain and are folded into contract §61.

**Verification:** `git diff --check` clean · docs-only (no typecheck/test impact; DB-gated tests still
skip locally) · remote `main` = `94888dc` (push verified) · CI **Tests** run
[`36665766003`](https://github.com/EnJirad/velnox-marketplace/actions/runs/36665766003) **success**
(1m11s) · **PRODUCTION = BLOCKED** (Neon quota; migrations 048/049/050 unapplied).

**Next step:** owner answers A–I (+Q13–Q17) → then contract §62 **Phase 1** (domain + schema) may
start; nothing before.

---

## 53. VelRepeat **V2 Phase 1 — domain + schema implemented** (2026-09-30)

**What was done (additive, both canonical SQL files, byte-identical).** `velrepeat_packages` +
`velrepeat_package_items` (composition of real products/variants; owns no stock);
`velrepeat_plans.commitment_cycles` (nullable, CHECK > 0); `velrepeat_pricing_snapshots` +
`velrepeat_pricing_snapshot_items` (append-only checkout snapshot: commitment, currency, discount,
totals, rule key/version, per-line qty/price); `velrepeat_cycles` (**UNIQUE (plan_id, cycle_number)** —
the idempotency key for “same plan + cycle ⇒ one order”); `orders.velrepeat_cycle_id` + FK + partial
index. Tests: `backend/tests/velrepeat-v2-domain-schema.test.ts` (structural everywhere + DB-gated, run
by CI’s `postgres:16`). Analysis/audit:
`.ai/tasks/audits/velrepeat-v2-phase1-dependency-analysis-2026-09-30.md`.

**No migration file** — deliberately. `.github/workflows/migrate-neon.yml` applies **all pending
migrations** (048–050 still unapplied — owner action, Neon quota) on any push touching
`db/migrations/*.sql`; adding Phase 1 as `051` would trigger unattended production DDL. Next number: `051`.

**BLOCKED — OWNER DECISION REQUIRED (unchanged):** Q13 payment linkage (no payment DDL) · Decision A
inventory (Phase 6) · H/Q11 pricing rules (Phase 2) · plan prepaid statuses Q13/Q14 (Phase 4) ·
B/C/D/G/I lifecycle (Phase 9) · Q15–Q17. Nothing was guessed.

**Verification:** `bun run test` **968 pass / 196 skip / 0 fail** (1164 tests, 53 files) · backend tsc 0 ·
typecheck 4/4 · build:apps 4/4 · `git diff --check` clean · `cmp` schema files identical · **PRODUCTION =
BLOCKED** (Neon quota; migrations 048/049/050 unapplied — the new objects are absent in prod and unread
by any code, so behavior is unchanged).

**Next step:** Phase 2 (Package + Pricing) is **gated on H/Q11** and the package-authoring ownership
question; Phase 3/4 additionally on Q13/Q14. Do not start a phase whose gates are open.

---

## 54. VelRepeat **V2 Decision Closure + Architecture Gate** (2026-09-30)

**What was done (analysis only — no code, no schema, no migration, no decision answered).** New audit
`.ai/tasks/audits/velrepeat-v2-decision-closure-2026-09-30.md` (20 sections): Q13 options A/B/C with
Option B's full surface (payments + refunds + incidents + reservation mapping; 88 `payments` occurrences
across 13 backend non-test files — 44 SQL lines; **Option B does not create a second payment authority**
— finding, not implementation); Q14 (one large canonical charge per plan; not per-cycle; not Stripe
Subscriptions unless the owner redefines); inventory Model A/B across all 15 required axes
(variant/non-variant asymmetry `velrepeat-scheduler.ts:328` vs `:341`; 30-min window meaningless for a
long hold `payment-reservation.ts:44`); pricing as rule rows (no hardcoded 1/2/4/8/16 → 0/3/7/10/15 %);
Q15–Q17; lifecycle decision matrix with **separate Plan / Payment / Cycle / Order / Fulfillment axes**
(PAID PLAN ≠ FULFILLED PLAN; PAID CYCLE ≠ DELIVERED ORDER); invariants with proof (cycle uniqueness
implemented; one-order-per-cycle still unprovable; `sold_count` violation `:344`); migration safety;
dependency graph; Decision Matrix (15 rows, every one `OWNER DECISION REQUIRED`). Contract Revision 2.2
pointer added. **No migration 051; no production source changes; Phases 2–10 still NOT STARTED.**

**Outcome:** all gates stay open (A–I, Q13–Q17, Q2 residual, package-authoring ownership, cycle-identity
reconciliation, rounding). The audit states the recommendation **and** the owner decision for each —
never presenting one as the other.

**Verification:** `bun run test` **968 pass / 196 skip / 0 fail** (1164 tests, 53 files) · backend tsc 0 ·
typecheck 4/4 · build:apps 4/4 · `git diff --check` clean. Docs-only — DB-gated tests skip locally (no
PostgreSQL); CI's `postgres:16` remains the only real DB execution. **PRODUCTION = BLOCKED** (Neon
quota; 048–050 unapplied; new objects absent in prod and unread by any code).

---

## 55. VelRepeat **V2 Owner Decision Closure + Architecture Consistency Gate** (2026-09-30)

**Docs only.** Audit `.ai/tasks/audits/velrepeat-v2-owner-decision-closure-2026-09-30.md` records the owner's
binding decisions: **Q13=B** (plan-level linkage inside `payments`), **Q14** (one canonical Stripe prepaid charge
per plan, not Subscriptions), **A/Q1=B** (reserve per cycle), **Q2** (`sold_count` on actual cycle settlement),
**B/C/D/E/F/G** (refund future unfulfilled only · skip future only · pause future only · price snapshot at
purchase · no oversell / no auto-substitute), **H/Q11** (platform-controlled data-driven pricing; the
1/2/4/8/16 → 0/3/7/10/15 % ladder is examples only), **Q15** (V1 legacy), **Q16** (scheduling = UTC,
`timezone` display-only), **Q17** (multi-seller plan, one payment, per-seller fulfillment); cycle identity =
`velrepeat_cycles` (identity) / `velrepeat_runs` (execution attempt). Contract Rev 2.3 pointer added.

**Verdict `PHASE 2 = BLOCKED`** on pricing-rule resolution (stack vs one-wins), rounding & currency,
package-authoring ownership. **Stop tokens:** `OWNER FORMULA REQUIRED` for **B** refund / **C** skip / **D** paused
/ **F** out-of-stock monetary consequences → **Phase 9 STOPPED** (no per-cycle amount or discount allocation to
refund from); `OWNER DECISION REQUIRED` for the **Q2 recognition moment**, multi-seller money attribution, seller
eligibility, plan status `pending_payment`, cycle status `due`/`reserved`/`fulfilled`, 4A reservation window.

**Findings:** (1) **Q2 conflicts with commerce semantics** — canonical `sold_count` commits at *payment
settlement* (`inventory.ts:141` ← `stripe.ts:559`, gated by `orders.status → 'paid'`), which a prepaid cycle order
never has → ambiguous, STOPPED not resolved. (2) The "settled payment outranks cancellation" guard is keyed to
per-order payments (`inventory.ts:226-232`) and vanishes for cycle orders under Q14 → Phase 6 needs a cycle-state
claim. (3) `paymentAllowsConfirmation` (`order-fulfillment.ts:218-235`) would refuse every cycle order → Phase 8
must extend it, not bypass it. (4) Per-seller money attribution is **unrepresentable**: `commissions.order_id NOT
NULL`, `settlements` has no plan/cycle reference, neither has a writer, no Connect/payout rail
(`.ai/context/payment.md:239-250`). (5) `velrepeat_runs` and `velrepeat_cycles` are unrelated while `orders`
references both → dual cycle-identity hazard.

**Verification:** `bun run test` **968 pass / 196 skip / 0 fail** · backend tsc 0 · typecheck 4/4 · build:apps 4/4
· diff clean · schema files identical · `db/migrations/` ended at `050`. **PRODUCTION = BLOCKED** (Neon quota).

---

## 56–58. VelRepeat V2 decision sheets + Phase 3 gate (2026-09-30/10-01) — ARCHIVED

Superseded by §59–§65 (Phase 3 shipped, Phase 4 shipped, Phase 5 shipped, the multi-shop /
numeric-order-number / V2-UI work landed). Moved verbatim to
[`.ai/history/archive/AI_Handoff-2026-10-01-decisions-and-phase3-gate.md`](./history/archive/AI_Handoff-2026-10-01-decisions-and-phase3-gate.md).

## 59. VelRepeat **V2 Phase 3 — package → draft plan → immutable snapshot** (2026-10-01) — ARCHIVED

Implemented + CI-verified: `createDraftPlanFromPackage`, the G1/G1.1/G2/G3 pricing engine, and the
immutable `velrepeat_pricing_snapshots` / `_items` write inside the purchase transaction.
**Archived verbatim to `.ai/history/archive/AI_Handoff-2026-10-01-velrepeat-v2-phase3.md`; audit at
`.ai/tasks/audits/velrepeat-v2-phase3-pricing-snapshot-2026-10-01.md`.** Its pricing output was
corrected by §61 and its production state re-measured by §62 — read those, not this.

## 60. VelRepeat **V2 Phase 4 — Stripe prepaid plan-level payment** (2026-10-01) — ARCHIVED

Implemented + CI-verified: the V2 payment endpoint, migration 051 (`payments.plan_id` +
exactly-one-parent), webhook settlement and the payment-gated `draft → active`.
**Archived verbatim to `.ai/history/archive/AI_Handoff-2026-10-01-velrepeat-v2-phase4.md`; audit at
`.ai/tasks/audits/velrepeat-v2-phase4-stripe-prepaid-2026-10-01.md`.** Note the original "V2 tables
exist in Neon" claim in that audit is **WRONG** — disproved by §62. Its money semantics are
corrected by §61 and re-verified by §62 — read those, not this.

## 61. VelRepeat **V2 — TOTAL PREPAID correction** (2026-10-01) — ARCHIVED

Implemented and CI-verified: the V2 prepaid invariant
`total_prepaid = roundHalfUp(EXACT post-rule cycle price × commitment_cycles, 2)`, a new
`velrepeat_pricing_snapshots.cycle_price NUMERIC(12,2)` separate from `total_amount`, migration 052
(additive, idempotent, excluding settled payments), the `TOTAL_ACTIVATED` response keys, and a
31-test suite. **Full text archived verbatim to
`.ai/history/archive/AI_Handoff-2026-10-01-velrepeat-v2-total-prepaid.md`; the superseding,
measured state is in §62.** The production blocker it raised is CONFIRMED and WIDENED by §62:
the V2 domain schema still has no `db/migrations/*.sql` file, and the production ledger holds
only `001_initial`.

## 62. VelRepeat **V2 — production migration + Stripe TEST E2E verification** (2026-10-01) — ARCHIVED

**Superseded** by §63 (Phase 5) and §64 (053 applied + production verified). Original text, the four
Stripe credential re-attempts, and the 052 production-failure investigation:
`.ai/history/archive/AI_Handoff-2026-10-02-velrepeat-v2-production-migration.md` and
`.ai/tasks/audits/velrepeat-v2-real-stripe-test-e2e-2026-10-02.md`. Pointer only.

## 63. VelRepeat **V2 Phase 5 — cycle lifecycle & per-cycle order creation** (2026-10-02)

**STATUS: PASS.** An `active` plan mints its cycle schedule at activation; each cycle creates its
own Normal Order **only when due**, exactly once, under concurrent workers. Audit:
`.ai/tasks/audits/velrepeat-v2-phase5-cycle-lifecycle-2026-10-02.md`. Suite **1882 / 2 / 0**
(1884 tests, 61 files), backend tsc 0, typecheck 4/4, build 4/4, `git diff --check` clean,
`db/schema.sql` ≡ `db/run-sqleditor.sql`.

**New:** `backend/lib/velrepeat-cycles.ts` (schedule + per-cycle order creation),
`backend/jobs/velrepeat-v2-cycle-scheduler.ts` (due worker, started in `server.ts`),
`db/migrations/053_velrepeat_v2_cycle_lifecycle.sql`, and a 28-test suite. **Modified:** the Phase 4
settlement (activation now calls `createCycleSchedule` **inside its own transaction**), `server.ts`,
both canonical schema files, and 4 Phase 3/4 test files (see below). All V1 and unrelated files
verified unchanged.

**Migration 053 — the substrate gap, one phase after 052.** `velrepeat_cycles` and
`orders.velrepeat_cycle_id` existed in both canonical schema files since Phase 1 (`ea79277`) and in
**no** migration. That is the identical omission that killed V0052, and §0 of 052 names both as
Phase 5 substrate. Additive + idempotent: nullable `ADD COLUMN`, the cycle table copied **verbatim**
from `db/schema.sql`, FK `ON DELETE SET NULL`, plus **`idx_orders_velrepeat_cycle_seller_unique`** —
`UNIQUE (velrepeat_cycle_id, shop_id)`. **053 was applied to production and verified (§64).**

**Idempotency — two independent DB guarantees, never a flag.** (1) The row claim: `SELECT … FOR
UPDATE OF c` + `UPDATE … WHERE status = 'scheduled'`, reusing `lib/order-lock.ts` — a second worker
blocks, re-reads, returns `already_claimed` and writes nothing (tested with 4 simultaneous workers:
1 `ordered`, 3 `already_claimed`, 1 order, 1 reservation). (2) The unique index, tested directly via
a raw second `INSERT` → 23505. The key is **`(cycle, shop)`, not `(cycle)`** — Q17 says a cycle
splits into one order per seller. `processCycle` owns its transaction, so each cycle is an
independent unit of work.

**Boundaries held.** No `sold_count` (Q2 open), no plan-level reservation (Decision A/Q1, Phase 6),
no `commitOrderInventory` (settlement-only), **no payment row per cycle** (Q14 — a cycle order is
`pending`, never `pending_payment`/`paid`), no `velrepeat_runs` write and **no retirement of its
`UNIQUE (plan_id, scheduled_for)`** (Phase 7), no change to `paymentAllowsConfirmation` (Phase 8).
Pricing is the **frozen snapshot** — no current product price is ever read. Scheduling **reuses**
`calculateNextRunAt`; the module contains no date arithmetic of its own (structural test). `fulfilled`
was **not** added to the cycle vocabulary. Activation writes cycles and **zero** orders.

**6 pre-Phase-5 test assertions superseded** (4 files) — they asserted `cycles = 0` after
activation, which the owner's §10 (`create Cycle schedule` after `draft → active`) replaces. **Every
fulfillment assertion was left intact** (`orders = 0`, `runs = 0`, `stock` unchanged) and the cycle
assertions were **strengthened**: they now pin all four cycles as `status = 'scheduled'`, and pin
that a duplicate/concurrent delivery still yields exactly the commitment's count.

**Two real bugs the tests caught in the first draft** (both fixed): an unsafe per-shop money sum that
joined on `product_id` via `unnest`, and a `velrepeat_items` join with no plan scoping. A third was
caught when the database **refused an invalid fixture** and exposed that `velrepeat_items` has two
**partial unique indexes** — so a plan holds a given product at most once, `products.shop_id` is
NOT NULL, and **a multi-seller plan spans shops via different products, never the same product
twice**. The `unit_price` join condition I had added for that was itself a latent production bug:
the snapshot holds the **discounted** price and `velrepeat_items` the **base**, so it would have
refused deliverable cycles. Reverted, and both facts are now pinned by a structural test. Also found
by reading: an order with `shop_id = NULL` would fall **outside** the unique index, so an
unattributable line is now refused.

**Remaining blockers.** (1) **Real Stripe TEST E2E still BLOCKED** — config PASS, gate is the
execution surface (§64). **Until one runs, VelRepeat V2 is NOT production ready.**
(2) Q2 recognition moment → Phase 6. (3) Decision A/Q1 → Phase 6.
(4) Owner decision C (`skipped`/`cancelled` money) → Phase 9. (5) Owner decision F (what happens
next to a refused cycle) → Phase 9. (6) Phase 7 retires `velrepeat_runs`; Phase 8 extends
`paymentAllowsConfirmation` — **until then a cycle order is `pending` and cannot be confirmed by the
canonical path.**

**Pre-existing, NOT a Phase 5 regression:** replaying the whole chain `001 → 053` on a fresh DB fails
on **008, 023, 047, 049, 051, 052** (`relation "payments"/"auth_identities" does not exist`) —
production was bootstrapped from the canonical schema and only partially migrated. **053 itself
applies clean** in that same run. Left alone per "do not refactor unrelated code"; flagged so it is
not later mistaken for Phase 5 damage.

