-- =============================================================
-- Migration: V0031
-- Date: 2026-08-30
-- Description: Add compare_at_price and discount_percent columns
--              to product_variants for variant-level pricing.
--              This fixes the production error:
--              "column compare_at_price does not exist"
-- Affected:
--   product_variants
-- Safety: All ADD COLUMN use IF NOT EXISTS — safe to run repeatedly.
--         No DROP, no DELETE, no TRUNCATE.
--         Existing data is never modified.
-- =============================================================

-- ── Add compare_at_price (original/strikethrough price) ──────
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(12, 2);

-- ── Add discount_percent (e.g., 10.00 for 10%) ──────────────
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2);
