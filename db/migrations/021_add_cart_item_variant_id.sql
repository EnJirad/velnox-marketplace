-- =============================================================
-- Migration: V0021
-- Date: 2026-08-26
-- Description: Add variant_id to cart_items for product variant support
-- Reason: Backend cart.ts INSERT includes variant_id column but the
--         production cart_items table does not have this column.
--         PostgreSQL error: 42703 - column "variant_id" does not exist
-- Affected: cart_items
-- Safety: Uses IF NOT EXISTS — safe to run repeatedly
-- =============================================================

-- Add variant_id column (nullable — existing cart items have no variant)
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS variant_id UUID;

-- Update UNIQUE constraint: (cart_id, product_id) → (cart_id, product_id, variant_id)
-- This allows the same product with different variants to coexist in the cart.
-- Note: PostgreSQL treats NULLs as distinct in UNIQUE constraints, so multiple
-- "no variant" rows for the same product in the same cart won't violate this.
-- The backend ON CONFLICT logic handles upsert deduplication.

-- Drop old constraint if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'cart_items'::regclass
    AND conname = 'cart_items_cart_id_product_id_key'
    AND contype = 'u'
  ) THEN
    ALTER TABLE cart_items DROP CONSTRAINT cart_items_cart_id_product_id_key;
  END IF;
END $$;

-- Add new unique constraint including variant_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'cart_items'::regclass
    AND conname = 'cart_items_cart_product_variant_key'
    AND contype = 'u'
  ) THEN
    ALTER TABLE cart_items
      ADD CONSTRAINT cart_items_cart_product_variant_key
      UNIQUE (cart_id, product_id, variant_id);
  END IF;
END $$;

-- Add index for variant lookups
CREATE INDEX IF NOT EXISTS idx_cart_items_variant ON cart_items (variant_id);
