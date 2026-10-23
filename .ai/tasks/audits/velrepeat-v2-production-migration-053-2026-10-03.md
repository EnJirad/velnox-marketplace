# VelRepeat V2 — Production Migration 053 & Production Schema Verification

**Date:** 2026-10-03
**Scope:** verify migration `053_velrepeat_v2_cycle_lifecycle` against the canonical schema, establish the
real Production (Neon) migration state, verify the production schema, re-verify the Phase 5 implementation,
re-run the full verification tier, and stop before any Real Stripe TEST E2E.
**Verdict:** `Production migration 053 = PASS` · `Production schema = PASS` · `Real Stripe TEST E2E = BLOCKED`
· **Overall VelRepeat V2 production readiness = NOT READY** (a real Stripe TEST E2E has never passed).

---

## 1. Git SHA before

```
79f2b056ba5711b17844821ccef4ca631796f067
```

`git status` → working tree clean · `git log --oneline -10` → HEAD `79f2b05 docs(velrepeat): backfill the
phase 5 commit sha into the audit` · `git ls-remote origin HEAD` → `79f2b05…` (local == remote, in sync)
· `git rev-list --left-right --count HEAD...origin/main` → `0	0`.

## 2. Git SHA after

```
814c30d98911ed7d13e364e9f430e2603893802f
```

Two commits were made by this task, neither application code (see §3 note):

| SHA | Type | Purpose |
|---|---|---|
| `065bfe252cfa7d5f02937151cf192bde40879165` | `ci(db)` | add SELECT-only 053 probes to the read-only production diagnostic (the only sanctioned way to read Neon from here) |
| `814c30d98911ed7d13e364e9f430e2603893802f` | `fix(ci)` | cast `information_schema.is_nullable` (`yes_or_no`) in one probe after run `37082227237` aborted on that type error |

The Phase 5 commit `f7690e45958980e4e7d9276c33c601e3bbb0cf95` is **on the deploy branch (`main`)** and is an
ancestor of both SHAs above. No application, migration or canonical-schema file was changed by this task.

## 3. Migration 053 status — **PASS (already applied; verified, NOT re-applied)**

`053_velrepeat_v2_cycle_lifecycle` had **already been applied to production** when this task started. The
Phase 5 commit itself triggered the repo's own migration workflow:

* `Migrate Neon Database` run **`37026940189`**, conclusion **success**, `headSha = f7690e4595…` (the Phase 5 commit).
* Log: `🔄 Applying: 053_velrepeat_v2_cycle_lifecycle` → `ALTER TABLE` / `CREATE TABLE` / `CREATE INDEX` ×4 / `DO` →
  `INSERT 0 1` → `✅ 053_velrepeat_v2_cycle_lifecycle applied successfully.` → `🎉 All migrations applied successfully.`

Per the task rule *"if 053 is already applied, verify the result instead of blind re-apply"*, **no second apply
was performed**. The workflow applied it inside `--single-transaction` and recorded the ledger row itself.

**Safety review of 053 (performed locally before touching production):**

* `velrepeat_cycles` body in 053 is **byte-identical** to the canonical `db/schema.sql` body (programmatic
  comparison → `True`).
* Destructive-statement scan: no `DROP`/`TRUNCATE`/`DELETE`/`UPDATE`/`DROP COLUMN`/`SET NOT NULL`. The only
  matches are referential actions `ON DELETE CASCADE` / `ON DELETE SET NULL`. Financial history untouched.
* Every statement is `IF NOT EXISTS` or inside an `IF NOT EXISTS`-guarded `DO` block → idempotent.
* `velrepeat_runs` deliberately untouched (its `UNIQUE (plan_id, scheduled_for)` retirement is Phase 7).
* `db/schema.sql` ≡ `db/run-sqleditor.sql` (`cmp` → identical). `db/run-update.sql` not created or used.

## 4. Production migration ledger — **PASS**

Read directly from Neon (`schema_migrations`, columns `id, migration_name, applied_at`):

```
69 | 053_velrepeat_v2_cycle_lifecycle | 2026-10-02 15:26:29.648474+00
```

Full ledger read back on 2026-10-03 (diag run `37082364439`) ends
`… > 047_payment_foundation > 048_payment_reservation > 049_payment_incidents > 050_orders_status_check >
051_payments_velrepeat_v2_plan_parent > 052_velrepeat_pricing_cycle_price > 053_velrepeat_v2_cycle_lifecycle`

→ **001–052 applied, 053 applied (pending = none).** No gap in the V2 tail. Note the historical duplicate
numbering (`029`, `030`, `034`, `035` each appear twice) is already-known and untouched by this task.

## 5. Production schema verification — **PASS**

Read-only probes (`Velnox Neon Schema Diagnostic`, run **`37082364439`**, conclusion **success**). Every probe
is a `SELECT` over `pg_catalog`/`information_schema`; aggregate counts only; no customer identifier is read.

| Object | Production state | Canonical (`db/schema.sql`) | Match |
|---|---|---|---|
| `velrepeat_cycles` | `PRESENT` | table defined | ✅ |
| `velrepeat_cycles.columns` | `completed_at timestamptz \| created_at timestamptz NOT NULL DEFAULT now() \| cycle_number integer NOT NULL \| id uuid NOT NULL DEFAULT uuid_generate_v4() \| metadata jsonb DEFAULT '{}'::jsonb \| plan_id uuid NOT NULL \| pricing_snapshot_id uuid \| scheduled_at timestamptz NOT NULL \| started_at timestamptz \| status text NOT NULL DEFAULT 'scheduled' \| updated_at timestamptz NOT NULL DEFAULT now()` | 12 columns, identical set/types/defaults/nullability | ✅ |
| cycle status CHECK | `CHECK (status = ANY (ARRAY['scheduled','processing','ordered','completed','skipped','cancelled','out_of_stock','item_unavailable']))` | same 8 values | ✅ |
| `cycle_number` CHECK | `CHECK (cycle_number > 0)` | same | ✅ |
| `velrepeat_cycles` UNIQUE | `UNIQUE (plan_id, cycle_number)` | same | ✅ |
| `orders.velrepeat_cycle_id` | `uuid NULLABLE` | `velrepeat_cycle_id UUID` (nullable) | ✅ |
| `orders_velrepeat_cycle_id_fkey` | `FOREIGN KEY (velrepeat_cycle_id) REFERENCES velrepeat_cycles(id) ON DELETE SET NULL` | same | ✅ |
| `idx_orders_velrepeat_cycle` | `CREATE INDEX … ON orders (velrepeat_cycle_id) WHERE velrepeat_cycle_id IS NOT NULL` | same | ✅ |
| `idx_velrepeat_cycles_plan` | `CREATE INDEX … ON velrepeat_cycles (plan_id)` | same | ✅ |
| `idx_velrepeat_cycles_due` | `CREATE INDEX … ON velrepeat_cycles (status, scheduled_at)` | same | ✅ |

Pre-existing drift markers in the same run remain **explained, not new**: `products.status CHECK | MISSING (no
status CHECK in canonical either)`; `velrepeat_plans.status CHECK` matches canonical exactly (10 values).

## 6. `velrepeat_cycles` verification — **PASS**

Present in production with all 12 canonical columns, `UNIQUE (plan_id, cycle_number)`, both CHECKs
(`cycle_number > 0` and the 8-value status vocabulary), and both cycle indexes. Row count **0** — the table was
created empty, which is exactly the intended state: nothing existed before 053 and nothing was backfilled.

## 7. `orders.velrepeat_cycle_id` verification — **PASS**

Column exists in production as `uuid NULLABLE` with FK `ON DELETE SET NULL`. Nullable is the safety property:
every pre-existing V1 order keeps a NULL cycle and is untouched. Production orders linked to a cycle: **0 / 0**
(0 of 0 orders carry a cycle).

## 8. Unique exactly-once constraint verification — **PASS**

```
idx_orders_velrepeat_cycle_seller_unique
= CREATE UNIQUE INDEX … ON public.orders USING btree (velrepeat_cycle_id, shop_id)
  WHERE ((velrepeat_cycle_id IS NOT NULL) AND (shop_id IS NOT NULL))
```

Present in production exactly as specified — **UNIQUE**, keyed on **`(cycle, shop)`** (not `(cycle)` alone,
because decision Q17 allows one cycle to split into one order per seller), and **partial** so it can never
constrain an unrelated V1 order. This is the database half of the exactly-once guarantee; the code half is
verified in §9.

## 9. Phase 5 implementation verification — **PASS** (code read, not comments)

Re-read the four Phase 5 source files and judged the implementation.

**`backend/lib/velrepeat-cycles.ts`**
* `createCycleSchedule` refuses a non-`active` plan (`PLAN_NOT_ACTIVE`) and a plan without `commitment_cycles`
  (`COMMITMENT_CYCLES_MISSING`); requires a pricing snapshot; inserts with
  `ON CONFLICT (plan_id, cycle_number) DO NOTHING` → repeated activation is a no-op.
* `processCycleInTransaction` claims with `SELECT … JOIN velrepeat_plans … FOR UPDATE OF c`, re-checks
  `status = 'scheduled'` and `plan.status = 'active'`, then a **guarded** transition
  `UPDATE velrepeat_cycles SET status='processing' … WHERE id=$1 AND status='scheduled'`; `rowCount === 0` →
  `already_claimed`, nothing written.
* Order creation inserts real rows into the **canonical** `orders` / `order_items` with `status='pending'` and
  `velrepeat_cycle_id = cycle.id`, one order per shop, money summed in PostgreSQL from
  `velrepeat_pricing_snapshot_items.line_total` over exact line ids (`id = ANY($2::uuid[])`) — no live product
  price, no float.
* Inventory: `reserveInventoryStock` for non-variant lines, guarded
  `UPDATE product_variants SET stock = stock - $1 WHERE id=$2 AND stock >= $1` for variants. **No**
  `commitOrderInventory`, **no** `sold_count`, **no** payment row, **no** `velrepeat_runs` write — confirmed by
  grep (only comment mentions).
* `SAVEPOINT cycle_order_build` + `ROLLBACK TO SAVEPOINT` on failure → `markRefusal` commits a terminal
  `out_of_stock` / `item_unavailable` with **no half-written order and no stranded hold**.
* Terminal `ordered` transition is itself guarded (`WHERE id=$1 AND status='processing'`), and the cycle cannot
  be left `processing` after a rollback because the claim and the writes share one transaction.
* Structural: no `setUTC*` anywhere (UTC authoritative); scheduling reuses the single existing
  `calculateNextRunAt` authority in `backend/jobs/velrepeat-scheduler.ts`.

**`backend/jobs/velrepeat-v2-cycle-scheduler.ts`** — `runDueCycleTick(limit=25)` over `processDueCycles`, 5s boot
fire + interval, `unref()`, `VELREPEAT_V2_CYCLE_INTERVAL_MS` override. The `running` flag is tidiness only;
idempotency lives in the DB (`FOR UPDATE` + guarded transition + unique index), as documented.

**`backend/routes/velrepeat-v2-payments.ts`** — activation is `UPDATE velrepeat_plans … WHERE id=$1 AND
status='draft' RETURNING id` (rowCount 0 → `already_active`), and `createCycleSchedule(client, charge.planId,
{ pricingSnapshotId: snapshot.id })` is called **inside that same settlement transaction**, after the guarded
UPDATE succeeds. Activation therefore mints a **schedule only** — no order, no inventory hold.

**`backend/server.ts`** — `import { startVelRepeatV2CycleScheduler }` (`:30`) and
`startVelRepeatV2CycleScheduler();` (`:546`), alongside the untouched V1 `startVelRepeatScheduler();` (`:537`).

**Chain verified end-to-end:** activation → cycle schedule (no order) → due cycle `scheduled` → `processing` →
normal order linked via `orders.velrepeat_cycle_id` → `ordered`. **Idempotency proven on two independent
levels:** code (row lock + guarded status transition) and database (unique `(cycle, shop)` index, exercised
directly by the test suite — a raw second `INSERT` fails with 23505). Concurrency is covered by the suite's
duplicate/concurrent-delivery cases.

## 10. Normal Commerce regression status — **PASS (unchanged)**

* 053 touches exactly one pre-existing core table, and only **adds** a nullable column: `ALTER TABLE orders ADD
  COLUMN IF NOT EXISTS velrepeat_cycle_id UUID`. No existing column, constraint, index or row was altered.
* No canonical fulfilment path was touched: `backend/lib/order-fulfillment.ts` (incl.
  `paymentAllowsConfirmation`, `:218-235`), `backend/lib/inventory.ts` (`RELEASABLE_STATUSES`, release path)
  and `backend/routes/cart.ts` are unmodified in this commit range; the cycle code **reuses** them rather than
  introducing a second order/fulfilment/inventory machine.
* Production confirms the no-side-effect property: `orders status distribution | (no rows)` and
  `velrepeat_cycles rowcount | 0` — the additive migration created structure and rewrote nothing.
* The full suite below covers normal cart → checkout → order → fulfilment.

## 11. Tests — **PASS, baseline matched exactly**

`TEST_DATABASE_URL=postgresql://velnox_test:velnox_test@127.0.0.1:5432/velnox_test bun test backend/tests`

```
1882 pass
2 skip
0 fail
Ran 1884 tests across 61 files.
```

**Exactly the Phase 5 baseline (1882 / 2 / 0) — zero delta.** The Phase 5 file
`backend/tests/velrepeat-v2-phase5-cycle-lifecycle.test.ts` is included in that 61 files and every one of its
structural + integration cases passes.

## 12. TypeScript (backend) — **PASS**

`cd backend && bunx tsc --noEmit` → exit 0, 0 errors.

## 13. Typecheck (apps) — **PASS 4/4**

`bun run typecheck` → exit 0. `velshop`, `velseller`, `velcenter`, `velnox` all `Exited with code 0`.

## 14. Build (apps) — **PASS 4/4**

`bun run build:apps` → exit 0. All four apps `Exited with code 0`.
`git diff --check` → clean. `cmp db/schema.sql db/run-sqleditor.sql` → identical.

## 15. Stripe TEST credential status — **BLOCKED**

Checked at HEAD `79f2b05` before any change:

```
STRIPE_SECRET_KEY: NOT SET
STRIPE_PUBLISHABLE_KEY: NOT SET
STRIPE_WEBHOOK_SECRET: NOT SET
freebuff-env list            -> {"files":{}}
freebuff-deploy env list     -> {"keys":[]}
```

The backend gate `backend/lib/payment-config.ts:181` therefore returns
`{ usable: false, reason: "STRIPE_NOT_CONFIGURED" }`, which `backend/routes/velrepeat-v2-payments.ts:614` and
`backend/routes/stripe.ts:1116/1645/1837` surface as HTTP 503. No real TEST credential and no LIVE credential
exists anywhere reachable.

**Nothing was faked.** No fake Stripe success, no synthetic webhook labelled E2E, no LIVE key, no real payment,
and the Stripe gate was not bypassed. Even if TEST credentials were present, the task instructs not to run the
Stripe E2E here without an explicit owner request — so **STOP** at this boundary as required.

## 16. Remaining blockers

1. **Real Stripe TEST E2E has never run** (BLOCKED, unchanged across five credential checks). Only the owner can
   unblock it: add `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` under
   **Settings → Environment** — **TEST keys only, never a live key**. This is the sole reason VelRepeat V2 is
   NOT production ready.
2. **No production DB credential in the sandbox.** `DATABASE_URL` / `NEON_DATABASE_URL` are unset and `.env`
   access is blocked, so Neon can only be reached through the repo's GitHub Actions workflows. Production
   evidence in this audit therefore comes from workflow run logs (`37026940189`, `37082364439`), which is the
   repo's sanctioned channel, not a guess from the local checkout.
3. **Known, pre-existing, NOT a Phase 5 regression:** replaying the whole chain `001 → 053` on a fresh database
   fails on migrations **008, 023, 047, 049, 051, 052** (`relation "auth_identities"/"payments" does not exist`)
   because production was bootstrapped from the canonical schema and only partially migrated. 053 itself
   applies clean in that same run. Out of scope here; recorded so it is not mistaken for Phase 5 damage.
4. **Phase-later boundaries (not blockers for this task):** Phase 6 = Q2 `sold_count` recognition moment +
   Decision A/Q1 plan-level inventory reservation; Phase 7 = retire `velrepeat_runs` as cycle identity;
   Phase 8 = extend `paymentAllowsConfirmation` (until then a cycle order is `pending` and cannot be confirmed by
   the canonical path); Phase 9 = owner decisions C (money for skipped/cancelled cycles) and F (what follows a
   refused cycle).

## 17. Exact next action

**The owner adds the three Stripe TEST keys under Settings → Environment, then explicitly asks for the Real
Stripe TEST E2E to be run.** Nothing else in this task is outstanding: migration 053 is applied and verified in
production, the production schema matches the canonical schema exactly, normal commerce is unaffected, and the
full verification tier is green at the Phase 5 baseline.

Until that E2E passes end-to-end against Stripe **TEST**, VelRepeat V2 must not be declared production ready.

---

### Status summary

| Area | Status |
|---|---|
| Code | **PASS** |
| Phase 5 | **PASS** |
| Production migration 053 | **PASS** (applied by run `37026940189`, verified — not re-applied) |
| Production schema | **PASS** (verified read-only, run `37082364439`) |
| Real Stripe TEST E2E | **BLOCKED — STRIPE TEST E2E CREDENTIALS MISSING** |
| **Overall VelRepeat V2 production readiness** | **NOT READY** |