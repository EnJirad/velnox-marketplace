-- =============================================================
-- Migration: V0029 (corrected)
-- Date: 2026-08-27
-- Description: Ensure category_id columns are TEXT (not UUID)
-- Reason: V0015 changed products.category_id from UUID to TEXT
--         because the frontend sends string slugs like "food",
--         "daily", "beauty". The previous version of V0029
--         incorrectly tried to convert TEXT back to UUID, which
--         would fail on production data. This corrected version
--         ensures the column type is TEXT and drops any
--         incorrect FK constraints.
-- Affected: products.category_id, customer_events.category_id
-- Safety:   Uses IF NOT EXISTS / IF EXISTS for idempotency
-- =============================================================

-- ── 1. products.category_id — ensure TEXT ─────────────────────

-- Drop any FK constraint that references categories(id) (UUID)
-- if it exists from the previous incorrect V0029
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS fk_products_category;

-- Ensure the column is TEXT (safe — no-op if already TEXT)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products'
      AND column_name = 'category_id'
      AND data_type != 'text'
  ) THEN
    ALTER TABLE products ALTER COLUMN category_id TYPE TEXT;
  END IF;
END $$;

-- Recreate index (idempotent)
DROP INDEX IF EXISTS idx_products_category;
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id);

-- ── 2. customer_events.category_id — ensure TEXT ──────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customer_events'
      AND column_name = 'category_id'
      AND data_type != 'text'
  ) THEN
    ALTER TABLE customer_events ALTER COLUMN category_id TYPE TEXT;
  END IF;
END $$;

-- ── Done ─────────────────────────────────────────────────────
