-- V0033: Add is_enabled flag to product_option_values
-- Allows sellers to enable/disable option values for variant generation
-- Default true for backward compatibility (existing values become enabled)

ALTER TABLE product_option_values
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_option_values_enabled ON product_option_values (option_group_id, is_enabled);
