-- =============================================================
-- Migration: V0052
-- Date: 2026-10-01
-- Description: VelRepeat V2 — the prepaid DOMAIN schema, and then the
--              TOTAL PREPAID commitment amount that depends on it.
--
--   Part 1 (this file, §0)  creates the prepaid PRICING domain — exactly the
--              objects the V2 write path needs and nothing else:
--              `velrepeat_pricing_snapshots`,
--              `velrepeat_pricing_snapshot_items`,
--              `velrepeat_plans.commitment_cycles`.
--
--   Part 2 (§1–§4)         makes the TOTAL PREPAID commitment amount explicit.
--              `velrepeat_pricing_snapshots` now persists the discounted price
--              of ONE delivery cycle (`cycle_price`) SEPARATELY from the amount
--              the prepaid customer actually owes for the whole commitment
--              (`total_amount`).
--
-- WHY PART 1 IS IN THIS FILE AT ALL
-- `Migrate Neon Database` run 36902790862 died on this file at line 38 with
--     ERROR: relation "velrepeat_pricing_snapshots" does not exist
-- The whole V2 prepaid domain was committed to `db/schema.sql` and
-- `db/run-sqleditor.sql` (commit ea79277) but NEVER given a
-- `db/migrations/*.sql` file, so production has never had these tables.
-- `034_velrepeat_v2.sql` is a DIFFERENT, older design — one Order per
-- scheduled run over `velrepeat_plans` / `velrepeat_items` /
-- `velrepeat_runs` — not the prepaid tables. The production ledger
-- (001–051 applied, 052 pending) and the deployment failure agree: the
-- domain is missing from production and present only in the bootstrap file.
--
-- These two halves are ONE file on purpose. `backend/tests/
-- migration-numbering.test.ts` requires every new migration to take an
-- unused number prefix, and the domain must be applied BEFORE the
-- `cycle_price` ALTER. Splitting them would mean either a second file
-- sharing the 052 prefix (forbidden) or renaming this one to 053 — which
-- cannot be done for a file that is simultaneously the thing the production
-- log cites. One file, one transaction, one number: the domain cannot exist
-- without the column and the column cannot exist without the table.
--
-- WHY PART 2 IS NEEDED
-- V2 is prepaid repeat commerce. The customer pays ONCE for every cycle they
-- committed to, so the charge is `cycle price × cycles`. Before this
-- migration the snapshot stored only ONE number, in `total_amount`, holding
-- the PER-CYCLE price — so a 100 THB cycle over 4 cycles at a 10% commitment
-- discount persisted 90.00 where the commitment was 360.00. Phase 4 had to
-- REFUSE such a snapshot rather than charge a quarter of the agreed money,
-- because the column could not represent the difference.
--
-- The correction is `total_amount = roundHalfUp(cycle_price_exact ×
-- commitment_cycles)` — ONE rounding, taken from the EXACT unrounded cycle
-- price already stored in `metadata.final_price_exact`. It is NOT
-- `cycle_price × cycles` on the rounded value: 93.4444… × 3 is 280.33
-- rounded once, but 93.44 × 3 = 280.32.
--
-- Affected: velrepeat_pricing_snapshots (NEW), velrepeat_pricing_snapshot_items
--           (NEW), velrepeat_plans (+1 nullable column),
--           velrepeat_pricing_snapshots (+1 column)
--
-- DELIBERATELY NOT IN THIS FILE — two objects `db/schema.sql` declares that
-- this migration does NOT create:
--   • `velrepeat_cycles`, and
--   • `orders.velrepeat_cycle_id` + its FK.
-- Both are Phase 5 substrate: no backend module reads or writes either one
-- (`velrepeat_cycles` has zero non-test references in `backend/`), so
-- shipping them here would buy nothing and cost the V1 guard this repository
-- enforces — `velrepeat-v2-pricing-total-prepaid.test.ts` asserts that 052
-- issues no `ALTER TABLE orders`, because `orders` is a V1 core table and
-- this phase promised to leave it alone. They reach production with the
-- Phase 5 cycle-generation migration, which needs them.
-- Safety: Additive and idempotent. Every statement is `IF NOT EXISTS` or
--         lives inside an `IF NOT EXISTS`-guarded DO block; nothing is ever
--         dropped. No DROP TABLE, no DROP COLUMN, no TRUNCATE, no DELETE.
--         The tables in §0 are created EMPTY, so there is no backfill to get
--         wrong; the only statements that write a row are the two scoped
--         UPDATEs in §2, and no row of `payments`, `refunds` or
--         `payment_incidents` is read for anything but a safety gate.
--         Settled financial history is never rewritten. Re-running is a no-op.
--
-- DELIBERATELY NOT HERE: the two partial UNIQUE indexes on
-- `velrepeat_items` that exist in `db/schema.sql` but in no migration.
-- Creating `idx_velrepeat_items_unique_no_variant` on a live database could
-- FAIL if a plan already lists the same product twice with no variant — the
-- V0034 inline UNIQUE cannot catch that case because NULLs are distinct in
-- PostgreSQL. That is a pre-existing V1 divergence and a separate decision;
-- it is not required by the V2 prepaid domain.
-- =============================================================

-- ═════════════════════════════════════════════════════════════════════════
-- §0  The prepaid PRICING domain — the tables `insertPricingSnapshot()`
--     writes and Phase 4 re-reads. Written from the canonical `db/schema.sql`
--     definitions, copied here VERBATIM, so the migration and the bootstrap
--     file cannot drift the way their omission already let them.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 0.1 A plan may record how many cycles it committed to ──────────────
-- Nullable on purpose: a legacy V1 per-run-order plan has no prepaid
-- commitment, and defaulting it would invent one for every existing row.
ALTER TABLE velrepeat_plans
  ADD COLUMN IF NOT EXISTS commitment_cycles INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_plans_commitment_cycles_check'
  ) THEN
    ALTER TABLE velrepeat_plans
      ADD CONSTRAINT velrepeat_plans_commitment_cycles_check
      CHECK (commitment_cycles IS NULL OR commitment_cycles > 0);
  END IF;
END
$$;

-- ── 0.2 Pricing snapshots — the immutable quote behind a commitment ─────
-- One snapshot per plan creation. It is the number a prepaid customer is
-- later charged, so Phase 4 re-proves `total_amount = roundHalfUp(
-- final_price_exact × commitment_cycles)` from this row on every settlement
-- rather than trusting the caller.
CREATE TABLE IF NOT EXISTS velrepeat_pricing_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES velrepeat_plans(id) ON DELETE CASCADE,
  commitment_cycles INTEGER NOT NULL CHECK (commitment_cycles > 0),
  currency TEXT NOT NULL DEFAULT 'THB',
  subtotal_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  discount_type TEXT,
  discount_value NUMERIC(12, 2),
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  cycle_price NUMERIC(12, 2) CHECK (cycle_price IS NULL OR cycle_price >= 0),
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  pricing_rule_key TEXT,
  pricing_rule_version TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_velrepeat_pricing_snapshots_plan
  ON velrepeat_pricing_snapshots (plan_id, created_at);

-- ── 0.3 Snapshot lines — the per-item proof of the quoted price ─────────
-- `variant_id` is nullable and the two UNIQUE indexes are PARTIAL, because a
-- plain UNIQUE (snapshot_id, product_id, variant_id) does not constrain the
-- variant-less case at all: NULLs are distinct in PostgreSQL, so two
-- identical product-only lines would both be accepted.
CREATE TABLE IF NOT EXISTS velrepeat_pricing_snapshot_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  snapshot_id UUID NOT NULL REFERENCES velrepeat_pricing_snapshots(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_velrepeat_pricing_snapshot_items_snapshot
  ON velrepeat_pricing_snapshot_items (snapshot_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_pricing_snapshot_items_unique_variant
  ON velrepeat_pricing_snapshot_items (snapshot_id, product_id, variant_id) WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_pricing_snapshot_items_unique_no_variant
  ON velrepeat_pricing_snapshot_items (snapshot_id, product_id) WHERE variant_id IS NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- §1–§4  The total prepaid commitment amount.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 1. The new per-cycle column ──────────────────────────────────────────
-- The price of ONE delivery cycle after the commitment rules. It equals the
-- OLD meaning of `total_amount`, which is exactly why it is populated from
-- that column rather than recomputed.
ALTER TABLE velrepeat_pricing_snapshots
  ADD COLUMN IF NOT EXISTS cycle_price NUMERIC(12, 2);

-- ── 2. Backfill ──────────────────────────────────────────────────────────
-- Scoped three ways, in this order:
--   (a) `cycle_price` is taken from the existing `total_amount`, which held
--       the per-cycle price before this migration. Nothing is recomputed and
--       no catalogue price is re-read, so a legacy row keeps the number it
--       was actually quoted.
--   (b) Rows whose plan already has a SETTLED payment are EXCLUDED. A paid
--       commitment is financial history: its stored total is what the customer
--       was charged, and rewriting it would make the snapshot disagree with
--       the money. Such a row is left untouched and reported instead.
--   (c) `total_amount` becomes the commitment total, computed in SQL from the
--       exact unrounded cycle price in `metadata.final_price_exact`, with a
--       single half-up rounding to 2 decimals — the same rule the engine and
--       `money.ts` apply. Exact `numeric` arithmetic; no float anywhere.
DO $$
DECLARE
  backfilled INTEGER;
  skipped_settled INTEGER;
BEGIN
  UPDATE velrepeat_pricing_snapshots s
     SET cycle_price = s.total_amount
   WHERE s.cycle_price IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM payments p
        WHERE p.plan_id = s.plan_id
          AND p.status IN ('paid', 'processing')
     );
  GET DIAGNOSTICS backfilled = ROW_COUNT;

  SELECT COUNT(*) INTO skipped_settled
    FROM velrepeat_pricing_snapshots s
   WHERE s.cycle_price IS NULL
     AND EXISTS (
       SELECT 1 FROM payments p
        WHERE p.plan_id = s.plan_id
          AND p.status IN ('paid', 'processing')
     );

  -- The commitment total. `COALESCE` falls back to the (already 2dp) cycle
  -- price when a legacy row has no exact value recorded, which reproduces the
  -- old number rather than inventing a new one.
  UPDATE velrepeat_pricing_snapshots s
     SET total_amount = ROUND(
           COALESCE(NULLIF(s.metadata ->> 'final_price_exact', ''), s.cycle_price::text)::numeric
           * s.commitment_cycles,
           2
         ),
         metadata = s.metadata || jsonb_build_object(
           'total_prepaid_migration', 'V0052',
           'total_prepaid_basis', 'final_price_exact × commitment_cycles'
         )
   WHERE s.cycle_price IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM payments p
        WHERE p.plan_id = s.plan_id
          AND p.status IN ('paid', 'processing')
     )
     AND s.metadata ->> 'total_prepaid_migration' IS DISTINCT FROM 'V0052';

  RAISE NOTICE 'V0052: % snapshot(s) given a cycle_price; % snapshot(s) left untouched because their plan already has a settled payment',
    backfilled, skipped_settled;
END
$$;

-- ── 3. Make the new column mandatory for every FUTURE snapshot ───────────
-- Applied ONLY when every row now has a value. If a settled payment left a
-- row without one, this migration reports it and declines to force it, rather
-- than inventing a cycle price for financial history.
DO $$
DECLARE
  missing INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing
    FROM velrepeat_pricing_snapshots
   WHERE cycle_price IS NULL;

  IF missing > 0 THEN
    RAISE NOTICE 'V0052: % snapshot(s) still have no cycle_price (settled payments); NOT NULL was NOT applied. Inspect before acting.',
      missing;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_pricing_snapshots_cycle_price_not_null'
  ) THEN
    ALTER TABLE velrepeat_pricing_snapshots
      ADD CONSTRAINT velrepeat_pricing_snapshots_cycle_price_not_null
      CHECK (cycle_price IS NOT NULL);
  END IF;
END
$$;

-- ── 4. The invariant the schema can now state ────────────────────────────
-- `total_amount` is the commitment total and `cycle_price` is one cycle, so
-- the total is never less than a single cycle. This is the one relationship the
-- schema can enforce cheaply, and it is a real one: the total is
-- `roundHalfUp(exact × N)` while the cycle price is `roundHalfUp(exact)`, and
-- rounding is monotonic, so for every N >= 1 the total is >= the cycle price.
--
-- It is deliberately NOT `total_amount = cycle_price * commitment_cycles`:
-- the total is rounded once from the EXACT cycle price, so for a fractional
-- cycle price the two columns differ by a satang (93.4444… × 3 = 280.33,
-- while 93.44 × 3 = 280.32). The exact relationship is re-provable from
-- `metadata.total_prepaid_exact` / `final_price_exact`, and Phase 4 verifies
-- it on every settlement.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_pricing_snapshots_total_not_below_cycle'
  ) THEN
    ALTER TABLE velrepeat_pricing_snapshots
      ADD CONSTRAINT velrepeat_pricing_snapshots_total_not_below_cycle
      CHECK (cycle_price IS NULL OR total_amount >= cycle_price);
  END IF;
END
$$;