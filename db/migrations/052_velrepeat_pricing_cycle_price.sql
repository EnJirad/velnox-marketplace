-- =============================================================
-- Migration: V0052
-- Date: 2026-10-01
-- Description: VelRepeat V2 — make the TOTAL PREPAID commitment amount explicit.
--              `velrepeat_pricing_snapshots` now persists the discounted price
--              of ONE delivery cycle (`cycle_price`) SEPARATELY from the amount
--              the prepaid customer actually owes for the whole commitment
--              (`total_amount`).
-- Reason: V2 is prepaid repeat commerce. The customer pays ONCE for every
--         cycle they committed to, so the charge is `cycle price × cycles`.
--         Before this migration the snapshot stored only ONE number, in
--         `total_amount`, holding the PER-CYCLE price — so a 100 THB cycle
--         over 4 cycles at a 10% commitment discount persisted 90.00 where the
--         commitment was 360.00. Phase 4 had to REFUSE such a snapshot rather
--         than charge a quarter of the agreed money, because the column could
--         not represent the difference.
--
--         The correction is `total_amount = roundHalfUp(cycle_price_exact ×
--         commitment_cycles)` — ONE rounding, taken from the EXACT unrounded
--         cycle price already stored in `metadata.final_price_exact`. It is NOT
--         `cycle_price × cycles` on the rounded value: 93.4444… × 3 is 280.33
--         rounded once, but 93.44 × 3 = 280.32.
--
-- Affected: velrepeat_pricing_snapshots
-- Safety: Additive and idempotent. One new nullable column, then a BACKFILL
--         that is explicitly scoped, then a NOT NULL constraint applied only
--         if the backfill covered every row. No DROP TABLE, no DROP COLUMN, no
--         TRUNCATE. No row of `payments`, `refunds` or `payment_incidents` is
--         read for anything but a safety gate — settled financial history is
--         never rewritten. Re-running is a no-op.
-- =============================================================

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