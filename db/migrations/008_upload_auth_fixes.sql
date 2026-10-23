-- Migration 008: Upload system + auth fixes
-- Fixes: media table columns, users.role/status, auth_identities constraints

-- ─── Users: add role and status columns ───────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'customer';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

-- ─── Media: rename columns to match code ──────────────────────────────────
-- The code uses: owner_id, object_key, cdn_url, mime_type, file_size
-- The old schema may have used: uploaded_by, key, url, content_type, size
-- These ALTERs are safe if columns already have the new names (IF EXISTS pattern)

DO $$
BEGIN
  -- Rename uploaded_by → owner_id (if old column exists)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'uploaded_by')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'owner_id')
  THEN
    ALTER TABLE media RENAME COLUMN uploaded_by TO owner_id;
  END IF;

  -- Rename key → object_key (if old column exists)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'key')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'object_key')
  THEN
    ALTER TABLE media RENAME COLUMN key TO object_key;
  END IF;

  -- Rename url → cdn_url (if old column exists)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'url')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'cdn_url')
  THEN
    ALTER TABLE media RENAME COLUMN url TO cdn_url;
  END IF;

  -- Rename content_type → mime_type (if old column exists)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'content_type')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'mime_type')
  THEN
    ALTER TABLE media RENAME COLUMN content_type TO mime_type;
  END IF;

  -- Rename size → file_size (if old column exists)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'size')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'file_size')
  THEN
    ALTER TABLE media RENAME COLUMN size TO file_size;
  END IF;
END $$;

-- Add status column to media if missing
ALTER TABLE media ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

-- Ensure index exists for owner_id
CREATE INDEX IF NOT EXISTS idx_media_owner_v2 ON media (owner_id);

-- ─── Auth: fix provider_identities unique constraint ──────────────────────
-- The schema has UNIQUE(provider, provider_id) but auth code inserts with
-- ON CONFLICT(provider, provider_id). Verify constraint exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'auth_identities_provider_provider_id_key'
    AND contype = 'u'
  ) THEN
    -- Drop duplicate constraint if different name exists
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'auth_identities'::regclass
      AND contype = 'u'
    ) THEN
      -- Constraint already exists with different name, that's fine
      NULL;
    ELSE
      ALTER TABLE auth_identities ADD CONSTRAINT auth_identities_provider_provider_id_key UNIQUE (provider, provider_id);
    END IF;
  END IF;
END $$;
