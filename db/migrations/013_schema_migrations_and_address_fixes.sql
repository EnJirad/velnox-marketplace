------------------------------------------------------------
-- Migration: V0013
-- Date: 2026-08-25
-- Description:
-- 1. Create schema_migrations tracking table for the
--    incremental migration system (migrate-neon.yml).
-- 2. Absorb the ensureAddressColumns() startup DDL into
--    a proper migration so the backend no longer runs
--    ALTER TABLE at startup.
--
-- Reason:
-- Backend was running ALTER TABLE addresses ADD COLUMN at
-- every startup (schema drift). Database changes must go
-- through the migration system.
--
-- Affected:
-- schema_migrations (NEW)
-- addresses
------------------------------------------------------------

-- 1. Migration tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
  id BIGSERIAL PRIMARY KEY,
  migration_name TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Absorb startup ensureAddressColumns() DDL
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS subdistrict VARCHAR(100);
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS district VARCHAR(100);
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Mark previous migrations as applied (they were run manually or via startup DDL)
INSERT INTO schema_migrations (migration_name) VALUES
  ('001_initial'),
  ('002_auth'),
  ('003_customer'),
  ('004_seller'),
  ('005_center'),
  ('006_behavior'),
  ('007_profile_images'),
  ('008_upload_auth_fixes'),
  ('009_fix_auth_and_cover'),
  ('010_revoked_tokens'),
  ('011_seller_status_constraint'),
  ('012_product_fields')
ON CONFLICT (migration_name) DO NOTHING;
