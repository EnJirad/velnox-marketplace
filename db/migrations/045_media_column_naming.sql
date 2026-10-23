-- Migration: V0045
-- Date: 2026-09-16
-- Description:
-- Restore the canonical `media` column names.
--
-- Root cause:
-- V0008 renamed the media columns to match what it believed the code used:
--   uploaded_by → owner_id, key → object_key, url → cdn_url,
--   content_type → mime_type, size → file_size
-- No version of the application ever adopted those names. Every media query in
-- backend/routes/{upload,verification,seller,index,auth}.ts — and the canonical
-- schema in db/schema.sql / db/run-sqleditor.sql — uses the ORIGINAL names.
-- On any database that ran V0008 (production), every media query therefore
-- failed with:
--     ERROR:  column "uploaded_by" does not exist
-- Consequences in production:
--   * POST /api/upload/... and the verification evidence insert never wrote a
--     media row, so uploaded evidence had no persistent reference.
--   * The seller-verification submit ownership check
--     (SELECT key FROM media WHERE uploaded_by = $1 …) raised 42703, so a
--     submission could not be recorded as pending.
--   * The cover lookups in auth/center responses failed, which is why they had
--     to be skipped for speed.
-- It also aborted migration V0041, blocking V0043 (review_reason_code).
--
-- Fix:
-- Rename the columns back to the canonical names. RENAME COLUMN is a
-- metadata-only operation — no row is rewritten, no data is lost, and indexes on
-- a renamed column (including idx_media_owner_key from V0041) follow the rename
-- automatically.
--
-- Idempotency / data safety:
-- Every rename is guarded by information_schema, so this is a no-op on a
-- database that already uses the canonical names (a fresh bootstrap from
-- db/schema.sql). Nothing is dropped, truncated or deleted.
--
-- Affected:
--   media

DO $$
DECLARE
  pairs TEXT[][] := ARRAY[
    ARRAY['owner_id', 'uploaded_by'],
    ARRAY['object_key', 'key'],
    ARRAY['cdn_url', 'url'],
    ARRAY['mime_type', 'content_type'],
    ARRAY['file_size', 'size']
  ];
  pair TEXT[];
BEGIN
  -- Skip entirely on a database without a media table (fresh partial bootstrap).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'media'
  ) THEN
    RAISE NOTICE 'V0045: media table not found — nothing to rename';
    RETURN;
  END IF;

  FOREACH pair SLICE 1 IN ARRAY pairs LOOP
    -- Only rename when the legacy name is present and the canonical name is not,
    -- so the canonical column is never clobbered.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'media' AND column_name = pair[1]
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'media' AND column_name = pair[2]
    ) THEN
      EXECUTE format('ALTER TABLE media RENAME COLUMN %I TO %I', pair[1], pair[2]);
      RAISE NOTICE 'V0045: media.% renamed to %', pair[1], pair[2];
    END IF;
  END LOOP;
END $$;
