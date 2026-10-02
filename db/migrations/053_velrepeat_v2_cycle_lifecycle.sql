-- =============================================================
-- Migration: V0053
-- Date: 2026-10-02
-- Description: VelRepeat V2 Phase 5 — the DELIVERY CYCLE domain: the
--              cycle entity, the cycle → order link, and the database
--              constraint that makes "one cycle ⇒ one order per seller"
--              provable instead of merely intended.
--
-- WHY THIS FILE IS NEEDED
-- -----------------------
-- V0052 created the prepaid PRICING domain and, in the same header, named
-- two objects it deliberately did NOT create:
--
--   • `velrepeat_cycles`
--   • `orders.velrepeat_cycle_id` + its FK
--
--   "Both are Phase 5 substrate: no backend module reads or writes either
--    one … They reach production with the Phase 5 cycle-generation
--    migration, which needs them."
--
-- This IS that migration. Until now the cycle entity existed only in
-- `db/schema.sql` and `db/run-sqleditor.sql` (Phase 1, commit ea79277) and
-- in no `db/migrations/*.sql` file — the identical omission that made V0052
-- die on `relation "velrepeat_pricing_snapshots" does not exist`. The
-- production ledger proves it: V0052 is the last applied row and the cycle
-- tables were never created.
--
-- WHAT IT ADDS
-- ------------
--   1. `velrepeat_cycles` — copied VERBATIM from the canonical
--      `db/schema.sql` body, so the migration and the bootstrap file cannot
--      drift the way their omission already let them. Identity is
--      `UNIQUE (plan_id, cycle_number)` (contract §49): cycle 1..N of one
--      plan are individually addressable and no cycle can be minted twice.
--      Its status vocabulary is ALREADY the owner's Phase 5 machine —
--      `scheduled → processing → ordered → completed`, plus the refusal
--      pair `out_of_stock` / `item_unavailable` — so this migration adds no
--      new cycle state and creates no second state machine.
--
--   2. `orders.velrepeat_cycle_id` + FK + partial index — the canonical
--      cycle → order link (contract §50: "Order → Cycle → Plan → Customer →
--      Payment"). Nullable, so every pre-existing V1 order is untouched.
--
--   3. `idx_orders_velrepeat_cycle_seller_unique` — THE IDEMPOTENCY
--      GUARANTEE (contract §58, decision-closure §9.3 step 5). One cycle
--      produces one order per seller/shop (decision Q17: a plan may span
--      sellers and a cycle splits into several orders), so the exactly-once
--      key is `(cycle, shop)`, not `(cycle)` alone. A second concurrent
--      worker that somehow reached the INSERT now fails at the database with
--      23505 instead of producing a second order.
--
-- §9.3 STEP 4 — THE ROW CLAIM — NEEDS NO DDL
-- ------------------------------------------
-- Decision-closure §9.3 step 4 says the exactly-once claim is taken ON THE
-- CYCLE ROW (`SELECT … FOR UPDATE` + status transition), extending the
-- existing order-lock guard pattern. That is code, not schema, so this
-- migration adds nothing for it: `backend/lib/order-lock.ts` already owns
-- the `FOR UPDATE` + guarded-transition pattern and Phase 5 reuses it rather
-- than re-implementing a second lock discipline.
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- ---------------------------------
--   • no cycle GENERATION, no order creation, no scheduler — those are
--     Phase 5 code (`backend/lib/velrepeat-cycles.ts`). This migration only
--     makes the substrate exist so that code has something to write to;
--   • no `velrepeat_runs` change. Decision-closure §9.1 names
--     `velrepeat_cycles` the canonical cycle identity and `velrepeat_runs`
--     the execution attempt, and §9.3 step 2 retires
--     `UNIQUE (plan_id, scheduled_for)` — but that retirement belongs with
--     the scheduler that stops using it (Phase 7). Retiring a V1 uniqueness
--     constraint in a Phase 5 migration would silently widen what two
--     concurrent V1 runs may write, which is exactly the kind of unrelated
--     architecture change this phase must not make. `orders.velrepeat_run_id`
--     and `velrepeat_runs` are left whole;
--   • no `payments` column, no plan-level linkage (Q13 — Phase 4 owns it and
--     051 already applied it);
--   • no plan-level inventory reservation (Decision A / Q1 — Phase 6). No
--     stock is reserved, committed or decremented by this migration; a cycle
--     holds nothing until its order is created;
--   • no `sold_count` write anywhere.
--
-- SAFETY
-- ------
-- Additive and idempotent. Every statement is `IF NOT EXISTS` or lives in an
-- `IF NOT EXISTS`-guarded DO block. Nothing is dropped, renamed or rewritten:
-- no DROP TABLE, no DROP COLUMN, no TRUNCATE, no DELETE, no UPDATE. The one
-- new unique index is created over rows that cannot violate it —
-- `velrepeat_cycle_id` is NULL on every existing order (the column is being
-- added in this same file and no writer has ever set it) — so it cannot fail
-- on live data and needs no backfill. The table is created EMPTY. Settled
-- financial history is never rewritten. Re-running is a no-op.
-- =============================================================

-- ═════════════════════════════════════════════════════════════════════════
-- §1  The cycle → order link on the canonical `orders` table.
--     Nullable: an order that is not part of a repeat cycle has no cycle.
--     This is the ONLY statement that touches a V1 core table, and it only
--     ADDS a nullable column — `orders` keeps every existing row and value.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS velrepeat_cycle_id UUID;

-- ═════════════════════════════════════════════════════════════════════════
-- §2  The delivery cycle entity.
--     Body copied VERBATIM from `db/schema.sql`.
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS velrepeat_cycles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES velrepeat_plans(id) ON DELETE CASCADE,
  cycle_number INTEGER NOT NULL CHECK (cycle_number > 0),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'ordered', 'completed', 'skipped', 'cancelled', 'out_of_stock', 'item_unavailable')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  pricing_snapshot_id UUID REFERENCES velrepeat_pricing_snapshots(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, cycle_number)
);

CREATE INDEX IF NOT EXISTS idx_velrepeat_cycles_plan ON velrepeat_cycles (plan_id);

-- The due-cycle worker's read path: "which cycles are due right now".
CREATE INDEX IF NOT EXISTS idx_velrepeat_cycles_due ON velrepeat_cycles (status, scheduled_at);

-- ═════════════════════════════════════════════════════════════════════════
-- §3  Cycle → order(s).
--     `ON DELETE SET NULL`, matching `orders.velrepeat_run_id`, so deleting a
--     cycle can never delete a real customer order.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_velrepeat_cycle_id_fkey'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_velrepeat_cycle_id_fkey
      FOREIGN KEY (velrepeat_cycle_id) REFERENCES velrepeat_cycles(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_orders_velrepeat_cycle ON orders (velrepeat_cycle_id) WHERE velrepeat_cycle_id IS NOT NULL;

-- §3.1  THE EXACTLY-ONCE CONSTRAINT (decision-closure §9.3 step 5).
--
-- A cycle may produce several orders — one per seller/shop (decision Q17) —
-- so the key is `(cycle, shop)`. NULLs are distinct in PostgreSQL, so this
-- must be PARTIAL and must exclude a NULL shop_id: a cycle order always has
-- a shop (`velrepeat_items.shop_id` is NOT NULL), and leaving NULLs out
-- keeps the index from ever constraining an unrelated V1 order.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_velrepeat_cycle_seller_unique
  ON orders (velrepeat_cycle_id, shop_id)
  WHERE velrepeat_cycle_id IS NOT NULL AND shop_id IS NOT NULL;
