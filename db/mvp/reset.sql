-- ============================================================================
-- VELNOX MVP — DEVELOPMENT / TEST RESET (DESTRUCTIVE)
-- ============================================================================
-- Rebuilds the CURRENT database from db/mvp/schema.sql. It drops everything in
-- the `public` schema, so it is deliberately hard to run by accident:
--
--   1. the database name must end in `_dev` or `_test`;
--   2. the session must carry `velnox.allow_reset=yes`, which this file does
--      NOT set for you.
--
-- Run it through `db/mvp/reset.sh` (the guarded wrapper), which satisfies both
-- and reuses `backend/db/test-database.ts` to refuse production-looking
-- targets. Running this file directly requires:
--
--   PGOPTIONS='-c velnox.allow_reset=yes' psql "$TEST_DATABASE_URL" -f db/mvp/reset.sql
--
-- It must NEVER be aimed at production. Nothing in this repository runs it
-- automatically, and no production workflow references it.
-- ============================================================================

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() !~* '_(dev|test)$' THEN
    RAISE EXCEPTION
      'REFUSING RESET: database "%" does not end in _dev or _test. This script is destructive.',
      current_database()
      USING HINT = 'Point it at a disposable development or test database. Production is never reset.';
  END IF;

  IF COALESCE(current_setting('velnox.allow_reset', true), '') <> 'yes' THEN
    RAISE EXCEPTION
      'REFUSING RESET: velnox.allow_reset is not set to yes for this session.'
      USING HINT = 'Run db/mvp/reset.sh, or set PGOPTIONS=''-c velnox.allow_reset=yes''.';
  END IF;
END $$;

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

\ir schema.sql
