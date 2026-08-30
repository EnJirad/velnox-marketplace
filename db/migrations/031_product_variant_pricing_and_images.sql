------------------------------------------------------------
-- Migration: V0031
-- Date: 2026-08-30
-- Description:
-- Add pricing columns to product_variants, create
-- product_variant_images table, add reorder_level to inventory.
--
-- Reason:
-- Backend queries compare_at_price and discount_percent from
-- product_variants but they were never added via migration.
-- product_variant_images is queried by the backend but the
-- table was never created. inventory.reorder_level is used
-- in the seller UI but was never added to the schema.
--
-- Affected:
-- product_variants
-- product_variant_images (NEW)
-- inventory
------------------------------------------------------------

-- 1. Add pricing columns to product_variants (idempotent)
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(12,2);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2);

-- 2. Create product_variant_images table
CREATE TABLE IF NOT EXISTS product_variant_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt TEXT DEFAULT '',
  storage_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variant_images_variant ON product_variant_images (variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_images_product ON product_variant_images (product_id);

-- 3. Add reorder_level to inventory (idempotent)
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS reorder_level INTEGER NOT NULL DEFAULT 0;
