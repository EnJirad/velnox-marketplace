------------------------------------------------------------
-- Migration: V0014
-- Date: 2026-08-25
-- Description:
-- Repair: ensure products.unit and products.supplier exist.
-- Migration V0012 defined these columns but was never applied
-- to production Neon. V0013 incorrectly marked V0012 as
-- applied in schema_migrations, so the GitHub Action skipped it.
-- This repair migration uses IF NOT EXISTS to be safe in all cases.
--
-- Reason:
-- Production error: column "unit" of relation "products" does not exist
-- Backend inserts unit but Neon lacks the column.
--
-- Affected:
-- products (unit, supplier)
------------------------------------------------------------

ALTER TABLE products ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'ชิ้น';
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier TEXT;

-- Ensure the index from V0012 exists (also never applied)
CREATE INDEX IF NOT EXISTS idx_products_shop_status ON products (shop_id, status);
