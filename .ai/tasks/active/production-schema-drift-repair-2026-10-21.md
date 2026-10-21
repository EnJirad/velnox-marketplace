# Production schema drift — `orders.order_state` + `product_selling_units` — REPAIR BLOCKED

**Date:** 2026-10-21 · **Branch:** `main` · **Starting SHA:** `9386816` · **Final SHA:** `9386816`
**State:** diagnosed + repair proven locally · **NOT applied** — no production database access exists in
this workspace (stop condition: *database identity is uncertain / production access is ambiguous*).

> Successor to §82 (`history/archive/AI_Handoff-2026-10-19-production-schema-mismatch.md`), which
> diagnosed the same drift. Nothing in that record is retracted; this pass re-proved it on the current
> tree, added the deployment-order timeline, and confirmed the blocker is unchanged.

---

## 1. The report

Render logs, checkout path:

```
[checkout] error: column "order_state" of relation "orders" does not exist
code: 42703 · routine: checkInsertTargets · at backend/routes/cart.ts:111
```

plus an earlier cart-related `errorMissingColumn` (42703).

## 2. Diagnosis — the repository is correct, the database is behind

`backend/routes/cart.ts:111-114` in `main` is the order INSERT naming `order_state` and
`fulfillment_status`. The objects are declared by the canonical schema (`db/schema.sql` +
`db/run-sqleditor.sql`) **and** by the canonical migrations:

| Object | Introduced by |
|---|---|
| `orders.order_state`, `orders.fulfillment_status` (+ defaults, NOT NULL, CHECKs, `idx_orders_order_state`, the 9b `CASE status …` backfill) | `db/migrations/056_commerce_core_invariants.sql` |
| `product_selling_units` (11 columns, 4 indexes, 4 FKs) + `cart_items`/`order_items` `selling_unit_id/_pieces/_name` | `db/migrations/058_selling_units.sql` |
| `product_selling_units.is_wholesale` | `db/migrations/059_store_accounts.sql` |

Nothing is missing from the repository. **The deployed database never received 056/058/059.**

### Deployment-order root cause (the actual defect)

Render deploys backend code on every push to `main`. **The database has no working forward path at
all** — `.github/workflows/production-db-migrate.yml` is the only writer, and it hard-stops because
the canonical secret `NEON_PRODUCTION_DATABASE_URL` has never been created:

| When (UTC) | What happened |
|---|---|
| 2026-10-06 17:28 | `Production DB Migrate` run `37503846147` (migration 056 pushed) → **FAIL in 9 s**, `BLOCKED: NEON_PRODUCTION_DATABASE_URL is not configured` |
| 2026-10-07 00:45 | `908fecd5 feat(orders): derive orders.status from the three lifecycle axes (P0-1)` lands on `main` → Render deploys code that **requires** 056 → checkout broken from here on |
| 2026-10-16 01:28 / 18:17 | Migrate runs `38835267035` / `38946251490` (058/059) → **FAIL in 9 s**, same missing secret |
| 2026-10-16 01:27 / 18:17 | `49eb2d1b` / `3278f758` land pack/wholesale code on `main` → Render deploys it |
| every push since | `Production DB Verify` **BLOCKED** at the same missing secret (latest run `39651137322`) — it never connected to any database, so its red status proves **nothing** about production schema |

`Production DB Migrate` has **never succeeded** (6/6 runs failed at the secret). `Production DB
Verify` has **never succeeded**. No migration has ever been applied to production through the
sanctioned path.

### The earlier cart error is the same drift, not a separate bug

The `errorMissingColumn` is `column oi.selling_unit_name does not exist` (`parse_relation.c`,
42703) — the order/cart line read naming a migration-058 column. `routes/cart.ts` also writes
`cart_items.selling_unit_id/_pieces/_name` on add-to-cart, so cart add, cart read, checkout,
settlement and order detail all name objects production does not have. One cause, many symptoms.

## 3. Proof (all local, disposable PostgreSQL 14 — production untouched)

Built a "behind production" database (canonical schema with the incident's objects stripped, per
`db/verify-reconciler.sh` scenario J's fixture) and ran the **real backend code** against it:

```
error: column "order_state" of relation "orders" does not exist        code 42703
error: column "fulfillment_status" does not exist                      code 42703  (Stripe webhook → projection)
error: column oi.selling_unit_name does not exist      parse_relation.c  code 42703  ← the cart errorMissingColumn
error: relation "product_selling_units" does not exist                 code 42P01
```

| Proof | Result |
|---|---|
| `bash db/verify-reconciler.sh` (scenarios A–J, real databases) | **ALL SCENARIOS PASSED** — J reproduces the exact 42703 + 42P01, then proves one run of `db/run-sqleditor.sql` fixes both |
| Same stripped shape + 3 real legacy orders, then **one** `db/run-sqleditor.sql` run **in place** | exit 0, 0 ERRORs · orders `3 → 3`, id md5 unchanged · `order_state` `NO|'pending'::text`, `fulfillment_status` `NO|'unfulfilled'::text` · backfill `SU-A=processing/shipped, SU-B=completed/delivered, SU-C=pending/unfulfilled` · legacy `status` untouched · 6 selling-unit columns + `product_selling_units` restored |
| Same 8 checkout-critical suites on the **repaired** DB | **272 pass / 0 fail** (selling-units, checkout-payment-flow, multi-shop-checkout, cart-selection, order-state-projection, customer-order-cancel, order-fulfillment-state-machine, payment-reservation-expiry) |
| Same 8 suites on the **behind** DB | fails with the four errors above |
| `bun test backend/tests` on a fresh canonical DB | **2163 pass / 20 skip / 0 fail** (76 files) |
| `bun run typecheck` | 4/4 exit 0 · `git diff --check` clean |

**The repair is therefore: run `db/run-sqleditor.sql` ONCE against the production database.** It is
the documented reconciler, it is additive (no `DROP TABLE`/`DROP COLUMN`/`TRUNCATE`/`DELETE` — CI
enforces that), and it is proven to converge the reported shape without losing or rewriting an order.
**No new migration is required and none was written.** The migration history was not edited.

### Retail pack compatibility after the repair

The deployed backend converts on the line, never on the definition:
`baseUnits(quantity, selling_unit_pieces)` (`backend/lib/selling-units.ts`) is the single conversion,
and `backend/lib/inventory.ts` reserves/commits/releases `quantity * selling_unit_pieces` through the
existing guarded atomic UPDATE. There is **no per-pack stock column anywhere** — a pack is never
independent stock. The 272-test block covers: set price per selling unit, snapshot survival after the
definition is re-priced/retired, `stock 10 − pack 6 = 4`, 2 packs release 12, expiry releases exactly
once, five concurrent sweeps release once, and last-stock concurrency never oversells.

## 4. Owner runbook — the only thing left, and it needs a credential this workspace does not have

1. **Create the secret.** GitHub → Settings → Secrets and variables → Actions →
   `NEON_PRODUCTION_DATABASE_URL` = the Neon connection string for the **same project and branch**
   Render's `DATABASE_URL` uses. There is deliberately no fallback; do not add one.
2. **Confirm identity before writing.** `production-db-migrate.yml` prints
   `DATABASE IDENTITY | database=… server=… user=…`. Compare with the `[db]` boot line Render logs
   (`[db] ✅ payment schema complete (database=… server=…)`). If the names differ, **STOP**.
3. **Repair.** Run **`db/run-sqleditor.sql` once** against that database (the Neon SQL Editor is
   fine). It is the proven path; `db/verify-reconciler.sh` scenario J is its acceptance test.
   Do **not** start with `Production DB Migrate`: 056 references `checkout_groups`, so on a database
   whose ledger claims 054 but lacks that table (§66) the migration path fails exactly there.
4. **Verify (read-only).** Actions → **Production DB Verify**. It must print
   `orders.order_state | NO|'pending'::text`, `orders.fulfillment_status | NO|'unfulfilled'::text`,
   `product_selling_units` present with 11 columns and `is_wholesale NOT NULL DEFAULT false`, and the
   six `cart_items`/`order_items` snapshot columns. Check the `schema_migrations` ledger.
5. **Re-test the real path** (staging or a production test account): cart add base + pack → read →
   qty → checkout → order row + items + pack snapshot → reservation (`10 on hand, 6 reserved`) →
   cancel 2 packs (12 released) → expiry releases once → two buyers on the last unit.
6. **Then** close the structural hole: either give Render a pre-deploy migration step that runs the
   reconciler, or gate deploys on `Production DB Verify` going green. Code currently deploys on every
   push while the database has no forward path — this drift will recur.

## 5. Explicitly NOT done

No production data read, written or deleted · no DDL executed against production · no `DROP`,
`TRUNCATE`, `DELETE`, no Neon reset · no Stripe key or mode touched · no deployment triggered or
changed · no migration created or edited · no `order_state` removed from application code ·
no index/query/pool optimisation (PERF-1 stays parked: ~210–230 ms statements and ~1.2 s pool
acquisition need their own measured task).

## 6. NOT VERIFIED

- **Production database identity and current shape** — no credential exists in this workspace
  (`freebuff-env list` → `{}`) and the Actions secret is absent. Everything above about production is
  inference from Render's own logs plus local reproduction, never a direct read.
- **Render deployed SHA** — no Render API/dashboard access. The live service answers
  `GET https://velnox-api.onrender.com/api/health` 200 and serves real catalog data, and the reported
  frame `cart.ts:111` is the order INSERT in current `main`, but the deployed commit was **not**
  read from Render.
- **`schema_migrations` ledger contents on production** — unreachable.
