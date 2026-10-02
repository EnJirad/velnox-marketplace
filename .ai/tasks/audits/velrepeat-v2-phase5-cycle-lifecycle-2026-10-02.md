# VelRepeat V2 — Phase 5: Cycle Lifecycle & Per-Cycle Order Creation

- **Date:** 2026-10-02
- **Repo:** `EnJirad/velnox-marketplace` · branch `main`
- **Base commit:** `45a17b02f26c59895d22dbc117d7f6d18fd5b7cd`
- **Final commit:** `f7690e45958980e4e7d9276c33c601e3bbb0cf95` (pushed to `main`, verified)
- **Status:** **PASS** (implementation + verification complete; the real Stripe TEST E2E remains BLOCKED, unchanged and unrelated)
- **Audit:** this file · handoff §63

---

## 1. What was built

An `active` Repeat Plan now mints a **cycle schedule** at activation, and each cycle creates **its
own Normal Order only when it becomes due** — once, ever, under concurrent workers.

| Piece | File |
|---|---|
| Cycle lifecycle + per-cycle order creation | `backend/lib/velrepeat-cycles.ts` (new) |
| Due-cycle worker | `backend/jobs/velrepeat-v2-cycle-scheduler.ts` (new) |
| Activation wiring (Phase 4 settlement) | `backend/routes/velrepeat-v2-payments.ts` (modified) |
| Worker start | `backend/server.ts` (modified) |
| Substrate migration | `db/migrations/053_velrepeat_v2_cycle_lifecycle.sql` (new) |
| Canonical schema | `db/schema.sql` + `db/run-sqleditor.sql` (one index line each) |
| Tests | `backend/tests/velrepeat-v2-phase5-cycle-lifecycle.test.ts` (new, 28 tests) |

No new fulfillment system, no new order table, no duplicate tables, no second lock discipline, no
in-memory idempotency flag.

---

## 2. DB changes

### Migration `053_velrepeat_v2_cycle_lifecycle.sql` (additive, idempotent)

1. `orders.velrepeat_cycle_id UUID` — **nullable** `ADD COLUMN IF NOT EXISTS`. The only statement
   that touches a V1 core table, and it only *adds*, so every pre-existing order keeps its row.
2. `velrepeat_cycles` — body copied **verbatim** from `db/schema.sql`, so the migration and the
   bootstrap file cannot drift the way their shared *omission* already let them.
3. FK `orders_velrepeat_cycle_id_fkey` `ON DELETE SET NULL` in an `IF NOT EXISTS` DO block, plus
   `idx_orders_velrepeat_cycle`.
4. `idx_velrepeat_cycles_due (status, scheduled_at)` — the due worker's read path.
5. **`idx_orders_velrepeat_cycle_seller_unique`** — `UNIQUE (velrepeat_cycle_id, shop_id)`,
   `WHERE velrepeat_cycle_id IS NOT NULL AND shop_id IS NOT NULL`.

### Why this migration exists at all

`velrepeat_cycles` and `orders.velrepeat_cycle_id` existed in **both** canonical schema files
(Phase 1, `ea79277`) and in **no** migration file. That is the identical omission that made V0052
die on `relation "velrepeat_pricing_snapshots" does not exist`, and §0 of migration 052 names
both objects as Phase 5 substrate. The production ledger held rows 1–68 = migrations 001–052, so
neither object existed in Neon. **053 is the first file to create them.**

### The exactly-once key is `(cycle, shop)`, not `(cycle)`

Decision **Q17** (multi-seller plans are real) means one cycle splits into **one order per
shop/seller**, so uniqueness on `(cycle)` alone would be wrong. `shop_id` is a real nullable
column on `orders` (`db/schema.sql:366`), which is what makes this expressible.

### Deliberately NOT in 053

- **`velrepeat_runs` untouched.** Decision-closure §9.3 step 2 retires
  `UNIQUE (plan_id, scheduled_for)`, but that belongs with the scheduler that stops using it
  (**Phase 7**). Retiring a V1 uniqueness constraint here would silently widen what two concurrent
  V1 runs may write.
- No payments column, no plan-level inventory reservation, no `sold_count`.

### Verified

- Applies clean on a fresh chain DB; **0 errors on re-run** (idempotent).
- No `DROP TABLE` / `DROP COLUMN` / `TRUNCATE` / `DELETE FROM` / `UPDATE orders`.
- The new unique index is created over rows that cannot violate it (`velrepeat_cycle_id` is NULL on
  every existing order), so it needs no backfill and cannot fail on live data.
- `db/schema.sql` and `db/run-sqleditor.sql` are **byte-identical** (`cmp` clean).

---

## 3. Cycle lifecycle

**At activation** (`draft → active`, inside the Phase 4 settlement transaction), `createCycleSchedule`
mints cycles `1..commitment_cycles`:

- Cycle 1's `scheduled_at` = the plan's `next_run_at`, which Phase 4 already set to one full
  interval **after** the activation instant.
- Each later cycle is one further `calculateNextRunAt` step.
- All cycles point at the **one** frozen `pricing_snapshot_id`.
- Idempotent: `ON CONFLICT (plan_id, cycle_number) DO NOTHING` (the Phase 1 `UNIQUE`).

**Timing authority is reused, not reimplemented** (decision **Q16**, closed). `velrepeat_plans.timezone`
is display preference only. The module calls the single existing
`calculateNextRunAt` (`backend/jobs/velrepeat-scheduler.ts:38-65`) and contains **no**
`setUTCDate`/`setUTCMonth`/`setUTCFullYear` of its own — asserted by a structural test, so a second
date implementation cannot creep in. Month day-clamping is inherited (Jan 31 + 1mo → Feb 28/29).

**Activation creates a schedule and nothing else:** no order, no inventory hold, no shipment, no
`completed`, no `velrepeat_runs` row. It runs **inside** the settlement transaction, so "the plan
went active" and "its cycles exist" are one unit of work — a customer cannot have paid for four
cycles with no schedule.

### State machine (separate axis from the order's)

```
scheduled → processing → ordered → completed
                  ↘ out_of_stock | item_unavailable     (deterministic refusals)
```

These are `velrepeat_cycles.status` values, already present in the schema CHECK. **`fulfilled` was
not added** — `completed` is its domain name, and a second word for one state is the
duplicate-state-machine hazard the owner named. `skipped` and `cancelled` have no writer here
(owner decision C / Phase 9). The canonical `orders.status` vocabulary is untouched.

---

## 4. Order lifecycle

When a cycle reaches `scheduled_at`, `processCycle` creates **real rows in the canonical
`orders` / `order_items` tables**, linked by `orders.velrepeat_cycle_id`:

- **One order per shop** (Q17), status `pending` — the canonical entry state.
- **Never** `pending_payment` / `paid`: Q14, one prepaid charge per plan, so a cycle order has no
  charge of its own. It is **not** pushed through `paymentAllowsConfirmation`; that extension is
  **Phase 8** and this phase does not bypass it.
- Quantity, unit price and line total come from `velrepeat_pricing_snapshot_items` — the immutable
  snapshot. **No current product price is ever consulted.** The tests price the fixtures at
  `999.00` in the catalog against a `100.00` snapshot and assert the order comes out at `100.00`.
- Money is summed by **PostgreSQL** over `NUMERIC`, so no float touches the order total. Each
  order's total is the sum of **its own shop's** snapshot lines, keyed on the snapshot line's
  `id` — not on `product_id`, and not over the whole snapshot.
- **No payment row** (Q14) and **no `sold_count` write** (Q2's recognition moment is an open owner
  decision; writing it here would invent policy). Phase 6 owns it.

### The two non-equivalences, enforced

- **"Plan active" ≠ "any fulfillment happened."** A 4-cycle plan produces 4 cycles and 0 orders.
- **"Payment success" ≠ "any order exists."** Payment settled in Phase 4; the first order appears
  only when cycle 1's `scheduled_at` arrives.
- A worked cycle is `ordered`, **not** `completed`, and its order is `pending`, **not** fulfilled.

---

## 5. Idempotency strategy

Two **independent database** guarantees. Neither is process-local.

### (a) The row claim — decision-closure §9.3 step 4

```
SELECT … FROM velrepeat_cycles c JOIN velrepeat_plans p … WHERE c.id = $1 FOR UPDATE OF c
UPDATE velrepeat_cycles SET status='processing' … WHERE id = $1 AND status = 'scheduled'
```

A second worker **blocks on the row lock**, re-reads, sees a status it did not expect, and returns
`already_claimed` having written nothing. This reuses the existing `backend/lib/order-lock.ts`
discipline rather than introducing a second one. Verified with 4 simultaneous workers: exactly one
`ordered`, three `already_claimed`, one order, one reservation.

### (b) The unique constraint

`idx_orders_velrepeat_cycle_seller_unique` makes a second order for the same `(cycle, shop)`
impossible at the database. **Tested directly** (a raw second `INSERT` raises 23505), so the
guarantee is not taken on the module's word.

### Transaction shape

`processCycle` **owns its transaction** via `withTransaction`, so `processDueCycles` gives each
cycle an independent unit of work: a failing cycle rolls back only its own claim and its own
holds, and the cycles that already succeeded keep theirs. Reservation therefore cannot survive a
rolled-back order.

### A SAVEPOINT for deterministic refusals

Stock trouble throws inside the order build. A `SAVEPOINT` keeps that from discarding the claim
already taken: everything after it rolls back to the savepoint, so the refusal leaves **no
half-written order and no stranded inventory hold**, and the terminal status still **commits**.
Without it a cycle that can never succeed would retry forever.

### Rejected approaches

- **In-memory flag** — dies with the process and cannot see another instance. Explicitly refused.
- **Advisory lock** — a second lock discipline where an existing one fits.
- **Retiring `velrepeat_runs`'s uniqueness** in Phase 5 — belongs to Phase 7.

---

## 6. Inventory behaviour

Owner rule: no reserving future cycles' stock at activation; each cycle's inventory happens when it
reaches its fulfillment stage, under the rules the system already uses.

- **At activation:** nothing is reserved. A 4-cycle plan holds no stock at purchase time. Holding
  it is Decision A / Q1, an open owner decision, and **Phase 6**.
- **At order creation:** the canonical checkout reservation, and only then — the exact statements
  `routes/cart.ts` uses: `reserveInventoryStock` for a non-variant product, and the guarded
  `UPDATE product_variants SET stock = stock - $1 WHERE stock >= $1` for a variant. Verified: a
  quantity-3 variant line decrements stock by exactly 3, not by its `777.00` price.
- **No duplicate reservation.** It happens inside the transaction that claims the cycle, so a retry
  cannot re-reserve: the claim either already succeeded or the whole transaction rolled back.
  Verified by asserting the `inventory.reserved` delta equals the line quantity exactly once, under
  both a repeated tick and four concurrent workers.
- **Release is reachable.** A cycle order is `pending`, which is in `RELEASABLE_STATUSES`, so the
  canonical cancel/expire paths hand the hold back like any other unpaid order.
- **No `commitOrderInventory`.** Turning the hold into a completed sale is settlement-only, reached
  from payment settlement — and a cycle order has no payment to settle it. Phase 8 opens
  `paymentAllowsConfirmation` for exactly this case.

---

## 7. Tests

**New suite: `backend/tests/velrepeat-v2-phase5-cycle-lifecycle.test.ts` — 28 tests, all passing.**

| Owner requirement | Test |
|---|---|
| 1-cycle plan creates 1 cycle | ✅ |
| 4-cycle plan creates 4 cycles | ✅ |
| cycle numbers sequential | ✅ (`[1,2,3,4]`) |
| correct `scheduled_at` | ✅ (exact instants, one interval apart, from `next_run_at`) |
| correct pricing snapshot | ✅ (all cycles → the one snapshot id) |
| due cycle creates exactly 1 order | ✅ |
| order references correct cycle | ✅ (`orders.velrepeat_cycle_id`) |
| order uses snapshot quantity | ✅ |
| order uses snapshot pricing | ✅ (snapshot 100.00 vs catalog 999.00) |
| future cycle creates no order | ✅ |
| scheduler retry → no duplicate order | ✅ (3 ticks + direct re-call) |
| concurrent workers → no duplicate order | ✅ (4 simultaneous) |
| repeated processing is safe | ✅ |
| draft plan creates no cycles for fulfillment | ✅ |
| unpaid/non-active plan creates no orders | ✅ |
| active plan ≠ orders completed | ✅ (4 orders, all `pending`; cycles `ordered`, never `completed`) |
| failed order creation → no false `ordered` | ✅ (`out_of_stock`, no order, no `ordered`) |

Plus: a variant-stock path, a two-shop split with per-shop totals, an unavailable product refused as
`item_unavailable` (kept distinct from `out_of_stock`), a line that can no longer be attributed to a
shop, and structural guards (no `sold_count`, no payment insert, no `commitOrderInventory`, no
`velrepeat_runs` insert, no `fulfilled`, migration additivity, schema byte-identity, reuse of
`calculateNextRunAt`).

### Verification results

| Gate | Result |
|---|---|
| Full suite (`bun test backend/tests`) | **1882 pass / 2 skip / 0 fail** (1884 tests, 61 files) |
| `cd backend && bunx tsc --noEmit` | **0 errors** |
| `bun run typecheck` | **4/4 apps exit 0** |
| `bun run build:apps` | **4/4 apps built** |
| `git diff --check` | **clean** |
| `cmp db/schema.sql db/run-sqleditor.sql` | **identical** |
| Migration 053 fresh + re-run | **clean, 0 errors** |
| V1 / unrelated files | **all unchanged** (verified per-file with `git diff --quiet`) |

Baseline before this phase was 1853/2/0. The 6 assertions this phase superseded are itemised in §8.

---

## 8. Failures found and fixed

### 8.1 Six pre-Phase-5 assertions superseded (intentional, not a workaround)

Four Phase 4 test files asserted **`cycles = 0` after activation**. The owner's Phase 5 spec
(§10) explicitly requires `create Cycle schedule` after `draft → active`, so those assertions
encoded behaviour this phase is ordered to replace.

Files: `velrepeat-v2-phase3-pricing-snapshot.test.ts` (migration allow-list),
`velrepeat-v2-phase4-prepaid-payment.test.ts` (×2), `velrepeat-v2-pricing-total-prepaid.test.ts`,
`velrepeat-v2-verification-matrix.test.ts` (×2).

**Every fulfillment assertion was left intact** — `orders = 0`, `runs = 0`, `stock` unchanged — and
the cycle assertions were *strengthened*, not merely relaxed: they now pin that all four cycles are
`status = 'scheduled'`, so a schedule can never quietly become work, and that a duplicate or
concurrent delivery still yields exactly the commitment's number of cycles. A test named "payment
success creates no order, cycle, run or inventory movement" was renamed to "…only the cycle
schedule", since "no cycle" is no longer true.

### 8.2 Two real bugs the tests caught in my own first draft

1. **Unsafe per-shop money sum.** The first draft summed snapshot line totals via
   `unnest($2::uuid[])` joined on `product_id` alone, and also computed an unused `totals` variable.
   Replaced with a sum over `id = ANY(...)` on the exact snapshot-line ids.
2. **Join fan-out.** `velrepeat_items` was joined on `product_id` + `variant_id` with no plan
   scoping. Now scoped by `plan_id` and collapsed with `DISTINCT ON (i.id)`.

### 8.3 A schema fact the database refused to let me guess — and the bug it caused

While fixing the multi-seller test I first joined on `quantity`/`unit_price` as well, to
disambiguate two shops selling the same product. **The database rejected the fixture**, which
surfaced the real schema:

> `velrepeat_items` carries two **partial unique indexes** —
> `UNIQUE (plan_id, product_id, variant_id) WHERE variant_id IS NOT NULL` and
> `UNIQUE (plan_id, product_id) WHERE variant_id IS NULL`.

So a plan can hold a given product **at most once**, and `products.shop_id` is `NOT NULL`, so one
product belongs to exactly one shop. **A plan is multi-seller by carrying different products from
different shops, never the same product twice.** The fixture was rebuilt accordingly.

Worse, the `unit_price` join condition I had just added was itself a **latent production bug**: the
snapshot holds the **commitment-discounted** price while `velrepeat_items.unit_price` holds the
**base** price. They differ whenever a discount applies — the normal case — so that join would have
dropped the line, left its shop unattributed, and refused a perfectly deliverable cycle as
`item_unavailable`. Reverted; the join now matches on product and variant only. A structural test
pins both facts so neither can be reintroduced.

### 8.4 A hole in the idempotency guarantee, found by reading rather than by a failing test

An order inserted with `shop_id = NULL` would fall **outside** the partial unique index, silently
removing the database half of the exactly-once guarantee. A snapshot line whose plan composition can
no longer be attributed to a shop is now refused as `item_unavailable`, with a test.

### 8.5 Global due-set coupling

Two tests asserted on `processDueCycles`' **global** due count, which is shared across fixtures in
the file. Both are now scoped to the plan's own cycle ids (or drive `processCycle` directly), so
they assert a property of the phase rather than of test ordering.

### 8.6 Comment-stripping in structural assertions

The migration header *names* the destructive statements it refuses to run, and the module header
*names* the side effects it refuses to write. Asserting on raw text failed on the very comments
proving the intent, so structural assertions now run against comment-stripped source.

---

## 9. Things deliberately NOT done

- **No `sold_count`** — Q2's recognition moment is an open owner decision.
- **No plan-level inventory reservation** — Decision A / Q1, Phase 6.
- **No `commitOrderInventory`** — settlement-only, and a cycle order has no payment.
- **No payment row per cycle** — Q14.
- **No `velrepeat_runs` write, and no retirement of its `UNIQUE (plan_id, scheduled_for)`** — Phase 7.
- **No `paymentAllowsConfirmation` change** — Phase 8. This phase does not bypass the gate.
- **No new HTTP route.** The owner did not request one, the test list needs none, and the properties
  under test are database properties. The two updated Phase 4 assertions are what pin the activation
  boundary end-to-end over real HTTP.
- **No changes** to V1 routes, the V1 scheduler, `cart.ts`, `inventory.ts`, `order-fulfillment.ts`,
  `order-lock.ts`, `payment-reservation.ts`, `payment-config.ts`, the pricing engine, R2, auth, or
  any unrelated table — each verified unchanged.

---

## 10. Remaining blockers

1. **Real Stripe TEST E2E is still BLOCKED** — unchanged, unrelated to this phase, and re-attempted
   four times at HEADs `eae65e3` / `0d09e50` / `3b728b3` / `45a17b0`. No TEST credential exists
   anywhere reachable. **Until one runs, VelRepeat V2 is not production ready.** Owner action:
   add `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` under
   **Settings → Environment** (never a live key). Audit:
   `.ai/tasks/audits/velrepeat-v2-real-stripe-test-e2e-2026-10-02.md`.
2. **Migration 053 must be applied to production.** The cycle substrate has never existed in Neon.
   This is the same class of gap 052 fixed, one phase later.
3. **Q2 recognition moment** (open owner decision) — Phase 6. Not a Phase 5 blocker.
4. **Decision A / Q1** plan-level vs per-cycle reservation (open owner decision) — Phase 6. Not a
   Phase 5 blocker: per-cycle reservation at order creation is fully determined by existing canonical
   checkout behaviour.
5. **Owner decision C** — the monetary consequence of a `skipped` / `cancelled` cycle — Phase 9.
6. **Owner decision F** — what happens next to a refused cycle (postpone, substitute, credit,
   refund) — Phase 9. Phase 5 records the refusal and stops rather than inventing a policy.
7. **Phase 7** must retire `velrepeat_runs` as the cycle identity. Until then a cycle and a run are
   distinct concepts and this phase writes no run.
8. **Phase 8** must extend `paymentAllowsConfirmation` so a cycle order with no payment row can be
   confirmed. A cycle order is created `pending` and, until Phase 8, cannot be confirmed by the
   canonical path.

### Pre-existing, out of scope, worth recording

Replaying the **whole** migration chain `001 → 053` against a fresh database fails on migrations
**008, 023, 047, 049, 051, 052** with `relation "payments" does not exist` /
`relation "auth_identities" does not exist`. This is **pre-existing and unrelated to Phase 5** —
production was bootstrapped from the canonical schema and only partially migrated, so the
from-scratch chain was never validated end to end. **Migration 053 itself applies clean** in that
same run and creates every object it declares. Not fixed here, per "do not refactor unrelated code";
flagged so it is not mistaken for a Phase 5 regression.

---

## 11. Final commit

- **Commit:** `feat(velrepeat): implement phase 5 cycle lifecycle`
- **SHA:** `f7690e45958980e4e7d9276c33c601e3bbb0cf95`
- **Pushed to:** `origin/main` — verified, `git rev-parse HEAD` == `git rev-parse origin/main` ==
  `git ls-remote origin HEAD`.
