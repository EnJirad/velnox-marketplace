-- =============================================================
-- Migration: V0027
-- Date: 2026-08-26
-- Description: Dynamic product option groups, option values,
--              variant option mapping, and product attributes.
--
-- This replaces the JSONB `options` column in product_variants
-- with a proper relational model that supports:
--   - Any option type (Color, Size, Weight, Flavor, etc.)
--   - Any number of option groups per product
--   - Variant generation from option combinations
--   - Product attributes (Brand, Material, RAM, etc.)
--
-- Reason: Hard-coded option types (color/size only) cannot support
--         a multi-vendor marketplace with diverse product types.
-- Safety: All CREATE TABLE use IF NOT EXISTS — safe to run repeatedly.
-- =============================================================

-- ── Product Option Groups ──────────────────────────────────────
-- Represents a group of options (e.g., "Color", "Size", "Flavor")
CREATE TABLE IF NOT EXISTS product_option_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_type TEXT NOT NULL DEFAULT 'text' CHECK (display_type IN ('text', 'color', 'image', 'button')),
  required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_option_groups_product ON product_option_groups (product_id);

-- ── Product Option Values ──────────────────────────────────────
-- Represents a value within an option group (e.g., "Red" within "Color")
CREATE TABLE IF NOT EXISTS product_option_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  option_group_id UUID NOT NULL REFERENCES product_option_groups(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_option_values_group ON product_option_values (option_group_id);

-- ── Product Variant Option Values ──────────────────────────────
-- Maps a variant to its selected option values
-- Each variant has exactly one value per required option group
CREATE TABLE IF NOT EXISTS product_variant_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  option_value_id UUID NOT NULL REFERENCES product_option_values(id) ON DELETE CASCADE,
  UNIQUE (variant_id, option_value_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_values_variant ON product_variant_values (variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_values_option_value ON product_variant_values (option_value_id);

-- ── Product Attributes ─────────────────────────────────────────
-- Represents informational product attributes (Brand, Material, RAM, etc.)
-- These are read-only display attributes, not used for variant selection.
CREATE TABLE IF NOT EXISTS product_attributes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_attributes_product ON product_attributes (product_id);

-- ── Add variant_id FK to product_variants if missing ───────────
-- (The existing product_variants table may not have a proper FK)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'product_variants'::regclass
    AND conname = 'product_variants_product_id_fkey'
    AND contype = 'f'
  ) THEN
    ALTER TABLE product_variants
      ADD CONSTRAINT product_variants_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
  END IF;
END $$;
