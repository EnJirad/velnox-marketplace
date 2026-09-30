# Phase 1 dependency & risk analysis — VelRepeat V2 (domain + schema)

**Date:** 2026-09-30 · **Repo:** `EnJirad/velnox-marketplace` · **Branch:** `main`
**Source of truth:** `.ai/context/velrepeat-contract.md` (V2 — Prepaid Repeat Commerce Contract)
**Runs before:** the Phase 1 implementation commit (`feat(velrepeat): implement prepaid repeat domain`).
**Rule applied (owner):** stop wherever an unresolved owner decision affects **money · refund ·
inventory ownership · sold_count · payment settlement · financial liability · historical pricing ·
fulfillment obligation**; implement only what is safe and non-inconsistent.

---

## 1. Gate check — every owner decision against Phase 1

| Gate (contract §60) | Phase-1 impact | Verdict |
|---|---|---|
| **1A–7B** (approved) | architecture rules only | applied: no COD bypass introduced, canonical inventory/payment untouched, central-scheduler rule preserved |
| **A / Q1** inventory reservation (whole commitment vs per cycle) | would add a plan-level reservation record | **deferred — Phase 6**; no inventory DDL or code in Phase 1 |
| **B / Q3** prepaid cancellation | refund/credit representation | **deferred — Phase 9**; no refund tables or policies added |
| **C / D / Q4 / Q5** skip · pause | cycle status vocabulary only | statuses exist on `velrepeat_cycles`; **financial semantics deferred** |
| **E / Q9** future price change | snapshot storage is required for **both** options | snapshot tables implemented (append-only); **reprice policy deferred to Phase 4/5 behavior** |
| **F / Q8 / Q10** out-of-stock future cycle | cycle failure states | `out_of_stock` / `item_unavailable` statuses exist; **handling policy deferred** |
| **G / Q6 / Q7** modification | optional versioning | **not added** — deferred to Phase 9 |
| **H / Q11** B2B stacking + tier-data ownership | pricing-rule/tier storage | **deferred — Phase 2**; no pricing-rule tables added |
| **I / Q12** prepaid + future fulfillment failure | credit/refund path | **deferred — Phase 9** |
| **Q13** prepaid payment shape | plan ↔ `payments` linkage | **BLOCKED — NOT implemented** (see §3); zero payment DDL |
| **Q14** one charge vs Stripe Subscriptions | payment behavior | **deferred — Phase 4** |
| **Q15** `vrepeat_packages` (V1) | reuse vs legacy | **left untouched**; V2 composition tables added beside it (non-destructive default) |
| **Q16** timezone load-bearing vs UTC | scheduling semantics | schema is timezone-agnostic (`TIMESTAMPTZ`); **deferred — Phase 7** |
| **Q17** per-seller plan splitting | scheduler scope | **deferred — Phase 7** |

## 2. Implemented in Phase 1 (additive, both canonical SQL files, byte-identical)

| Object | Purpose (contract ref) | Why it is safe under the stop rule |
|---|---|---|
| `velrepeat_packages`, `velrepeat_package_items` | commercial composition of real products/variants; no stock of its own (§40) | no money, no inventory ownership, no sold_count, no settlement; FK integrity only |
| `velrepeat_plans.commitment_cycles` (nullable, CHECK > 0) | number of delivery cycles bought (§43) | a count; NULL keeps every pre-V2 row valid; no policy encoded |
| `velrepeat_pricing_snapshots`, `velrepeat_pricing_snapshot_items` | purchase-time pricing record: commitment, currency, discount type/value/amount, subtotal, total prepaid, pricing rule key/version, per-line qty/unit price/line total (§45) | storage only; works for locked (E=A) and future-reprice (E=B); no percentage or tier is hardcoded; append-only, so history can never be recomputed from the live catalog |
| `velrepeat_cycles` — identity `UNIQUE (plan_id, cycle_number)` | the delivery cycle entity (§49/§58); the key on which “same plan + same cycle ⇒ one order” becomes provable | no generation logic; status vocabulary only; no financial semantics |
| `orders.velrepeat_cycle_id` + FK + partial index | cycle → order(s) fulfillment link (§50) | nullable, unread by any code yet; additive |

Tests added: `backend/tests/velrepeat-v2-domain-schema.test.ts` (structural half runs everywhere;
integration half is DB-gated and executes in CI's disposable `postgres:16`, which is bootstrapped from
`db/run-sqleditor.sql`).

## 3. BLOCKED — OWNER DECISION REQUIRED

### 3.1 Plan-level prepaid payment linkage (Q13)

- **Exact blocker:** `payments.order_id UUID NOT NULL REFERENCES orders(id)` (`db/run-sqleditor.sql`)
  — there is no canonical place for a charge that funds N cycles, and the shape (A: attach to cycle 1's
  order, with its coherence problems; B: nullable `order_id` + `velrepeat_plan_id`; C: a separate
  payments table) is an owner/architecture decision.
- **Evidence:** 77 SQL sites across 14 backend files read/write `payments` (incl. `routes/stripe.ts`,
  `routes/cart.ts`, `routes/seller-orders.ts`, `routes/center.ts`, `lib/inventory.ts`,
  `lib/order-lock.ts`, `lib/payment-incidents.ts`, `jobs/payment-reservation-scheduler.ts`,
  `jobs/velrepeat-scheduler.ts`) — changing `order_id` semantics touches settlement, refund, incident
  and reservation paths simultaneously.
- **Files:** `db/*`, `backend/routes/stripe.ts`, `backend/routes/cart.ts`, `backend/lib/*` — all
  untouched.
- **Why implementation cannot safely continue:** any shape choice here decides **payment settlement and
  financial liability**, both on the stop list. Loosening the FK “just to migrate” is explicitly
  forbidden (owner instruction §10).
- **Decision required:** Q13 (shape A or B; C rejected as a second payment authority).
- **Suggested options:** A or B as analysed in contract §25/§46; the Phase-1 schema intentionally has
  **no** column or table that presumes either.

### 3.2 Inventory reservation model (Decision A / Q1) — Phase 6

Plan-level vs per-cycle reservation is unanswered; Phase 1 added **no** reservation record and no
inventory code. Nothing in Phase 1 depends on the answer.

### 3.3 Pricing-rule / tier storage (Decision H / Q11) — Phase 2

Tier data ownership (platform vs seller) and quantity×commitment stacking are unanswered; Phase 1 added
**no** pricing-rule tables, and **no discount percentages anywhere**. Snapshot tables store whatever a
future pricing engine computes; they do not define it.

### 3.4 Plan prepaid status vocabulary (Q13/Q14) — Phase 4

The existing `velrepeat_plans.status` CHECK was **not** extended: prepaid payment states depend on the
Q13 payment shape. Cycle statuses are new (a separate axis, §20) and contain no money semantics.

## 4. Risk register

| Risk | Detail | Mitigation / status |
|---|---|---|
| **Migration auto-apply hazard** | `.github/workflows/migrate-neon.yml` runs on any push touching `db/migrations/*.sql` and applies **ALL pending migrations** — 048/049/050 are still unapplied (owner action, Neon quota). Adding a Phase-1 migration now would push unattended production DDL. | **No migration file was added.** Next number is `051`. Add it only when the owner approves and the 048–050 backlog is cleared. |
| Production DB drift | Production does not yet have the new tables/column; schema files do. | No code reads or writes the new objects, so production behavior is unchanged until the approved migration + Phase 3+ code. |
| CI validation | CI bootstraps the disposable DB from `db/run-sqleditor.sql`, so the new DDL is exercised by the DB-gated tests there. | Watch the Tests workflow after push. |
| DB-gated tests skip locally | No local PostgreSQL. | Same as every prior pass; CI `postgres:16` is the only real execution. |
| “One order per cycle” not yet provable end-to-end | Generation logic is Phase 5; the unique key now exists to build it on. | Stopped by contract (STOP #12) until Phase 5 writes and tests generation. |

## 5. Verification of this pass (local)

- `bun run test` — **968 pass / 196 skip / 0 fail** (1164 tests, 53 files); the new file: 9 pass / 4 skip.
- `cd backend && bunx tsc --noEmit` — 0 errors · `bun run typecheck` — 4/4 · `bun run build:apps` — 4/4.
- `git diff --check` clean · `cmp db/schema.sql db/run-sqleditor.sql` — identical.
- **No** route, scheduler, inventory, payment, frontend or package code changed.

## 6. What Phase 1 deliberately did not decide

V1 table fate (Q15) · timezone semantics (Q16) · per-seller splitting (Q17) · refund/credit/skip/pause
policies (B/C/D/I) · inventory model (A) · tier ownership/stacking (H) · payment linkage (Q13) ·
plan status vocabulary (Q13/Q14) · repricing behavior (E) · out-of-stock handling (F) · modification
semantics (G) · plan→package provenance column (deferred until Phase 2/3 needs it).
