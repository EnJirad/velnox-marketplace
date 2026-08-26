-- =============================================================
-- Migration: V0025
-- Date: 2026-08-26
-- Description: Add VelRepeat configuration fields to products table.
--              The vrepeat.ts backend route queries these columns
--              but they were never added to the schema.
-- Reason: velrepeat.ts SELECTs vrepeat_enabled, vrepeat_weekly_price,
--         vrepeat_monthly_price, etc. from products — causing 42703 errors.
-- Safety: All ALTER TABLE use ADD COLUMN IF NOT EXISTS.
-- =============================================================

-- ── 1. VelRepeat fields on products ───────────────────────────────────────
-- These enable per-product VelRepeat configuration:
--   vrepeat_enabled           — master toggle
--   vrepeat_weekly_enabled    — weekly package available
--   vrepeat_monthly_enabled   — monthly package available
--   vrepeat_weekly_price      — discounted price per unit for weekly
--   vrepeat_monthly_price     — discounted price per unit for monthly
--   vrepeat_weekly_qty        — units per weekly package
--   vrepeat_monthly_qty       — units per monthly package

ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_weekly_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_monthly_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_weekly_price NUMERIC(12, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_monthly_price NUMERIC(12, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_weekly_qty INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_monthly_qty INTEGER;

-- ── 2. Index for VelRepeat product filtering ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_vrepeat ON products (vrepeat_enabled) WHERE vrepeat_enabled = TRUE;
