-- =============================================================
-- Migration: V0029
-- Date: 2026-08-29
-- Description: Add option_value_images table for variant image support.
--              Each option value (e.g., "Red" in Color group) can have
--              multiple images that replace the product gallery when
--              that option is selected.
-- Safety: All CREATE use IF NOT EXISTS — safe to run repeatedly.
--         No DROP, no DELETE, no TRUNCATE.
-- =============================================================

-- ── Option Value Images ──────────────────────────────────────
-- Multiple images per option value for variant-specific galleries
CREATE TABLE IF NOT EXISTS option_value_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  option_value_id UUID NOT NULL REFERENCES product_option_values(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_option_value_images_value ON option_value_images (option_value_id);
