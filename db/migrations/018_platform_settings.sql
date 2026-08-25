-- V0018: Add platform_settings table for configurable product approval mode
-- and other platform-wide settings managed by VelCenter admins.

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

-- Default setting: manual product approval
INSERT INTO platform_settings (key, value, description)
VALUES ('product_approval_mode', 'manual', 'Product approval mode: manual or auto')
ON CONFLICT (key) DO NOTHING;

-- Index for quick lookups (single-row table, but consistent with convention)
CREATE INDEX IF NOT EXISTS idx_platform_settings_key ON platform_settings (key);
