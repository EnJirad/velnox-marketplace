-- Migration: V0030
-- Date: 2026-08-30
-- Description:
-- Add image_type and variant_id columns to product_images to support
-- the three image categories: product gallery, variant images, and detail images.
--
-- This migration is idempotent (safe to run multiple times).

-- Add image_type column (defaults to 'gallery' for backward compatibility)
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS image_type TEXT NOT NULL DEFAULT 'gallery';

-- Add variant_id column (nullable — only set for variant-type images)
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL;

-- Add index for filtering by image type
CREATE INDEX IF NOT EXISTS idx_product_images_type ON product_images (product_id, image_type);

-- Add index for variant image lookups
CREATE INDEX IF NOT EXISTS idx_product_images_variant ON product_images (variant_id) WHERE variant_id IS NOT NULL;
