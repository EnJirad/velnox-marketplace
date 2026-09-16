-- Migration: V0041
-- Date: 2026-09-11
-- Description:
-- Owner+key lookup index for the `media` table (cover-image lookup).
--
-- Root cause of the failure this file previously caused:
-- The `media` column names are NOT stable across environments. V0001 created
-- url / key / content_type / size / uploaded_by, and V0008 renamed them to
-- cdn_url / object_key / mime_type / file_size / owner_id. db/schema.sql and
-- every backend query use the ORIGINAL names, so a database that ran V0008
-- (production) has no `uploaded_by` column and this statement aborted with:
--     ERROR:  column "uploaded_by" does not exist
-- Because the runner applies pending migrations in order and stops on the first
-- failure, that error blocked V0042, V0043 and V0044 — which is why
-- seller_verifications.review_reason_code was missing in production.
--
-- Fix:
-- Create the index over whichever owner/key columns the live table actually
-- has, and skip silently if the table is absent or unnamed differently.
-- V0045 renames the columns back to the canonical names; an index follows the
-- rename automatically, so the end state matches db/schema.sql exactly
-- (idx_media_owner_key ON media (uploaded_by, key)).
--
-- Affected:
--   media

DO $$
DECLARE
  owner_col TEXT;
  key_col   TEXT;
BEGIN
  SELECT c.column_name INTO owner_col
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'media'
     AND c.column_name IN ('uploaded_by', 'owner_id')
   ORDER BY (c.column_name = 'uploaded_by') DESC
   LIMIT 1;

  SELECT c.column_name INTO key_col
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'media'
     AND c.column_name IN ('key', 'object_key')
   ORDER BY (c.column_name = 'key') DESC
   LIMIT 1;

  IF owner_col IS NOT NULL AND key_col IS NOT NULL THEN
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_media_owner_key ON media (%I, %I)',
      owner_col, key_col
    );
  ELSE
    RAISE NOTICE 'V0041: skipping idx_media_owner_key — media owner/key columns not found';
  END IF;
END $$;
