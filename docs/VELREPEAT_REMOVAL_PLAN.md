# VelRepeat Legacy Database Removal Plan

**Status: PLAN ONLY — nothing in this document has been executed.**
The repository cleanup (2026-10-23) removed VelRepeat from all application code and from
the two canonical SQL files (`db/schema.sql`, `db/run-sqleditor.sql`). It deliberately did
**not** connect to any database. An EXISTING database (production Neon or a dev copy) may
still hold the legacy objects listed below. This document is the reviewable plan for
removing them later, by an operator, against a database they have verified.

**Do not run anything here against production without:**
1. A fresh backup (`pg_dump` of the whole database, or at minimum of every object named
   in Phase 1) taken the same day.
2. The owner's explicit approval.
3. The read-only inventory (Phase 0) reviewed and attached to the change record.
4. A maintenance window (Phase 2 replaces constraints on `payments`).

Every statement below is idempotent or guarded. Run with
`psql -v ON_ERROR_STOP=1` so a failure stops the batch instead of continuing half-done.
**No statement anywhere in this plan deletes business rows** — customer, order, payment,
refund and shipment data outside the archived VelRepeat tables is never touched.

---

## 0. Object inventory (what may still exist)

Derived from the pre-cleanup schema (`git show <pre-cleanup-sha>:db/schema.sql`).

### Tables (12)

| Table | Contents |
|---|---|
| `velrepeat_plans` | recurring purchase plans |
| `velrepeat_items` | plan line items |
| `velrepeat_runs` | scheduled runs (V1) |
| `velrepeat_cycles` | delivery cycles (V2) |
| `velrepeat_events` | plan/run event log |
| `velrepeat_pricing_snapshots` | per-cycle price snapshots |
| `velrepeat_pricing_snapshot_items` | snapshot line items |
| `velrepeat_package_items` | package line items |
| `velrepeat_packages` | prepaid packages (V1) |
| `vrepeat_packages` | prepaid packages (legacy) |
| `vrepeat_deliveries` | legacy deliveries |
| `subscriptions` | seller subscription plans |

### Columns on LIVE tables (12)

| Table | Columns |
|---|---|
| `products` | `vrepeat_enabled`, `vrepeat_weekly_enabled`, `vrepeat_monthly_enabled`, `vrepeat_weekly_price`, `vrepeat_monthly_price`, `vrepeat_weekly_qty`, `vrepeat_monthly_qty`, `vrepeat_min_qty`, `vrepeat_max_qty` |
| `orders` | `velrepeat_run_id`, `velrepeat_cycle_id` |
| `payments` | `plan_id` |
| `payment_incidents` | `plan_id` |

### Foreign keys INTO the live tables (must go before the tables they reference)

- `payments_plan_id_fkey` → `velrepeat_plans(id)`
- `payment_incidents_plan_id_fkey` → `velrepeat_plans(id)`
- `orders_velrepeat_run_id_fkey` → `velrepeat_runs(id)`
- `orders_velrepeat_cycle_id_fkey` → `velrepeat_cycles(id)`

(All other legacy FKs are internal to the 12 tables and disappear with them.)

### Indexes (dropped automatically with their column/table — listed for verification)

`idx_products_vrepeat`, `idx_payments_plan`, `idx_payments_one_active_stripe_plan`,
`idx_payment_incidents_plan`, `idx_orders_velrepeat_run`, `idx_orders_velrepeat_cycle`,
`idx_orders_velrepeat_cycle_seller_unique`, `idx_subscriptions_user`,
`idx_subscriptions_next_due`, all `idx_velrepeat_*`, all `idx_vrepeat_*`.

### Constraints whose DEFINITION must be swapped (Phase 2)

| Constraint | Legacy definition (pre-cleanup) | Target definition (current canonical files) |
|---|---|---|
| `payments_at_least_one_parent_check` | `order_id IS NOT NULL OR plan_id IS NOT NULL OR checkout_group_id IS NOT NULL` | `order_id IS NOT NULL OR checkout_group_id IS NOT NULL` |
| `payments_single_domain_check` | `NOT (plan_id IS NOT NULL AND (order_id IS NOT NULL OR checkout_group_id IS NOT NULL))` | `NOT (order_id IS NOT NULL AND checkout_group_id IS NOT NULL)` |
| `payment_incidents_exactly_one_parent_check` | `order_id` XOR `plan_id` | replaced by `payment_incidents_order_parent_check` = `order_id IS NOT NULL` |

The reconciler **adds** the new definitions only when the constraint is absent; on a
legacy database it leaves the legacy definitions in place (they still reference the still-
present `plan_id` column). The swap happens HERE, after the data archive — a legacy
`plan_id`-only payment row would violate the new `at_least_one_parent` definition.

---

## Phase 0 — read-only inventory (safe to run any time)

```sql
-- Which legacy tables exist, and how many rows does each hold?
SELECT c.relname AS table, GREATEST(c.reltuples, 0)::bigint AS approx_rows
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind = 'r'
   AND (c.relname LIKE 'velrepeat%' OR c.relname LIKE 'vrepeat%' OR c.relname = 'subscriptions')
 ORDER BY c.relname;

-- Which legacy columns exist on live tables?
SELECT table_name, column_name
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (column_name LIKE 'vrepeat%' OR column_name LIKE 'velrepeat%' OR column_name = 'plan_id')
   AND table_name IN ('products', 'orders', 'payments', 'payment_incidents')
 ORDER BY table_name, column_name;

-- Which rows would be archived? (counts only)
SELECT (SELECT count(*) FROM payments  WHERE plan_id IS NOT NULL) AS payments_plan_rows,
       (SELECT count(*) FROM payment_incidents WHERE plan_id IS NOT NULL) AS incidents_plan_rows,
       (SELECT count(*) FROM orders    WHERE velrepeat_run_id IS NOT NULL
                                            OR velrepeat_cycle_id IS NOT NULL) AS orders_linked,
       (SELECT count(*) FROM products  WHERE vrepeat_enabled
                                            OR vrepeat_weekly_enabled
                                            OR vrepeat_monthly_enabled) AS products_vrepeat;

-- Current constraint definitions (compare with the table above).
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname IN ('payments_at_least_one_parent_check',
                  'payments_single_domain_check',
                  'payment_incidents_exactly_one_parent_check',
                  'payment_incidents_order_parent_check')
 ORDER BY conname;
```

If the inventory shows **nothing exists**, stop — the database is already clean.

---

## Phase 1 — archive (never destroy, archive)

Take a physical backup first:

```bash
pg_dump "$DATABASE_URL" --table=velrepeat_plans --table=velrepeat_items \
  --table=velrepeat_runs --table=velrepeat_cycles --table=velrepeat_events \
  --table=velrepeat_pricing_snapshots --table=velrepeat_pricing_snapshot_items \
  --table=velrepeat_package_items --table=velrepeat_packages \
  --table=vrepeat_packages --table=vrepeat_deliveries --table=subscriptions \
  --data-only > velrepeat-archive-$(date +%F).sql
```

Then archive the legacy columns of live tables inside the database, so the later
`DROP COLUMN` cannot lose anything:

```sql
CREATE SCHEMA IF NOT EXISTS legacy_velrepeat_archive;

CREATE TABLE IF NOT EXISTS legacy_velrepeat_archive.payments_plan AS
  SELECT * FROM payments WHERE plan_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS legacy_velrepeat_archive.payment_incidents_plan AS
  SELECT * FROM payment_incidents WHERE plan_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS legacy_velrepeat_archive.orders_velrepeat_cols AS
  SELECT id, order_number, velrepeat_run_id, velrepeat_cycle_id, created_at
    FROM orders
   WHERE velrepeat_run_id IS NOT NULL OR velrepeat_cycle_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS legacy_velrepeat_archive.products_vrepeat_cols AS
  SELECT id, vrepeat_enabled, vrepeat_weekly_enabled, vrepeat_monthly_enabled,
         vrepeat_weekly_price, vrepeat_monthly_price, vrepeat_weekly_qty,
         vrepeat_monthly_qty, vrepeat_min_qty, vrepeat_max_qty
    FROM products
   WHERE vrepeat_enabled OR vrepeat_weekly_enabled OR vrepeat_monthly_enabled;
```

Verify every archive has the same row count as the Phase 0 count before continuing.

---

## Phase 2 — swap the payment constraints (the only write-heavy step)

Run **after** Phase 1. Each block is guarded so a re-run is a no-op.

```sql
-- 2a. payments: replace the legacy plan_id-aware definitions.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_plan_id_fkey;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_at_least_one_parent_check;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_single_domain_check;
ALTER TABLE payments ADD CONSTRAINT payments_at_least_one_parent_check
  CHECK (order_id IS NOT NULL OR checkout_group_id IS NOT NULL);
ALTER TABLE payments ADD CONSTRAINT payments_single_domain_check
  CHECK (NOT (order_id IS NOT NULL AND checkout_group_id IS NOT NULL));

-- 2b. payment_incidents: legacy XOR check → order-mandatory check,
--     but ONLY when no orphan row exists (identical guard to the reconciler).
DO $$
DECLARE orphans INTEGER;
BEGIN
  SELECT count(*) INTO orphans FROM payment_incidents WHERE order_id IS NULL;
  IF orphans = 0 THEN
    ALTER TABLE payment_incidents DROP CONSTRAINT IF EXISTS payment_incidents_exactly_one_parent_check;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_incidents_order_parent_check') THEN
      ALTER TABLE payment_incidents ADD CONSTRAINT payment_incidents_order_parent_check
        CHECK (order_id IS NOT NULL);
    END IF;
  ELSE
    RAISE NOTICE 'payment_incidents_order_parent_check NOT added - % orphan row(s); archive them first', orphans;
  END IF;
END $$;
```

If 2b reports orphan rows, archive them
(`legacy_velrepeat_archive.payment_incidents_no_order`) and re-run before proceeding —
orphans cannot be deleted by this plan.

---

## Phase 3 — drop legacy columns (FKs and their indexes go with them)

```sql
ALTER TABLE payments          DROP COLUMN IF EXISTS plan_id;
ALTER TABLE payment_incidents DROP COLUMN IF EXISTS plan_id;
ALTER TABLE orders            DROP COLUMN IF EXISTS velrepeat_run_id;
ALTER TABLE orders            DROP COLUMN IF EXISTS velrepeat_cycle_id;
ALTER TABLE products          DROP COLUMN IF EXISTS vrepeat_enabled;
ALTER TABLE products          DROP COLUMN IF EXISTS vrepeat_weekly_enabled;
ALTER TABLE products          DROP COLUMN IF EXISTS vrepeat_monthly_enabled;
ALTER TABLE products          DROP COLUMN IF EXISTS vrepeat_weekly_price;
ALTER TABLE products          DROP COLUMN IF EXISTS vrepeat_monthly_price;
ALTER TABLE products          DROP COLUMN IF EXISTS vrepeat_weekly_qty;
ALTER TABLE products          DROP COLUMN IF EXISTS vrepeat_monthly_qty;
ALTER TABLE products          DROP COLUMN IF EXISTS vrepeat_min_qty;
ALTER TABLE products          DROP COLUMN IF EXISTS vrepeat_max_qty;
```

Dropping each column also drops its FK and its partial indexes (`idx_payments_plan`,
`idx_payments_one_active_stripe_plan`, `idx_payment_incidents_plan`,
`idx_orders_velrepeat_*`, `idx_products_vrepeat`). Postgres refuses a drop while a
constraint other than the column's own depends on the column — Phase 2 removed those.

---

## Phase 4 — drop legacy tables

```sql
DROP TABLE IF EXISTS velrepeat_events;               -- children first
DROP TABLE IF EXISTS velrepeat_pricing_snapshot_items;
DROP TABLE IF EXISTS velrepeat_pricing_snapshots;
DROP TABLE IF EXISTS velrepeat_package_items;
DROP TABLE IF EXISTS velrepeat_items;
DROP TABLE IF EXISTS velrepeat_runs;
DROP TABLE IF EXISTS velrepeat_cycles;
DROP TABLE IF EXISTS velrepeat_packages;
DROP TABLE IF EXISTS vrepeat_deliveries;
DROP TABLE IF EXISTS vrepeat_packages;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS velrepeat_plans;                -- referenced by the rows above
```

Order matters only among the legacy tables themselves (they reference each other);
Phase 3 has already removed every reference from live tables.

---

## Phase 5 — verification (all must report zero / absent)

```sql
SELECT count(*) AS legacy_tables FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND (c.relname LIKE 'velrepeat%' OR c.relname LIKE 'vrepeat%' OR c.relname = 'subscriptions');

SELECT count(*) AS legacy_indexes FROM pg_indexes
 WHERE schemaname = 'public'
   AND (indexname LIKE '%velrepeat%' OR indexname LIKE '%vrepeat%'
        OR indexname LIKE '%subscription%' OR indexname LIKE '_plan%');

SELECT count(*) AS legacy_columns FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (column_name LIKE 'vrepeat%' OR column_name LIKE 'velrepeat%' OR column_name = 'plan_id');

SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname IN ('payments_at_least_one_parent_check', 'payments_single_domain_check',
                  'payment_incidents_order_parent_check')
 ORDER BY conname;   -- must match the TARGET definitions in the inventory table
```

Then run the canonical reconciler once (`db/run-sqleditor.sql` in the Neon SQL
Editor, or the `Production DB Reconcile` workflow). It carries **no** VelRepeat
statement of any kind, so it must succeed and change nothing — that run is the proof
the database and the repository agree.

---

## Rollback

- Phases 0–2 are reversible: the archived tables in `legacy_velrepeat_archive` plus the
  `pg_dump` restore the old constraints' inputs; re-add the legacy definitions from the
  inventory table above.
- Phases 3–4 are DDL drops — rollback = restore the affected tables/columns from the
  Phase 1 `pg_dump` (`pg_restore` a single table, or re-run the pre-cleanup
  `db/schema.sql` section for the structure and copy archived rows back). This is why
  Phase 1 is mandatory and why no row is ever deleted by this plan.

## What this plan deliberately does NOT do

- No `DELETE`, `TRUNCATE` or `DROP` of any table holding customer, order, payment,
  refund, shipment or seller data.
- No change to any non-VelRepeat table, column, index or constraint beyond the three
  payment-constraint definitions listed in Phase 2 (which are the definitions the
  current canonical files already declare).
- Nothing against a database until this document has been reviewed and executed by an
  operator with a same-day backup.
