-- Migration 009: Fix auth table + cover_url
-- 1. Add cover_url to users (if migration 007 never ran)
-- 2. Create auth_identities from provider_identities (production has provider_identities)
-- 3. Add role/status to users (if migration 008 never ran)

-- ─── Users: add cover_url ─────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_url TEXT;

-- ─── Users: add role and status (idempotent) ──────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'customer';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

-- ─── Auth: create auth_identities table ────────────────────────────────────
-- Production currently has provider_identities (from 002_auth.sql).
-- auth.ts code references auth_identities with column provider_id.
-- This migration creates auth_identities and migrates data from provider_identities.

CREATE TABLE IF NOT EXISTS auth_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_id)
);

-- Migrate data from provider_identities → auth_identities (if provider_identities exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'provider_identities') THEN
    INSERT INTO auth_identities (id, user_id, provider, provider_id, email, created_at)
    SELECT id, user_id, provider, provider_subject, email, created_at
    FROM provider_identities
    ON CONFLICT (provider, provider_id) DO NOTHING;
  END IF;
END $$;

-- Indexes for auth_identities
CREATE INDEX IF NOT EXISTS idx_auth_identities_provider ON auth_identities (provider, provider_id);
CREATE INDEX IF NOT EXISTS idx_auth_identities_email ON auth_identities (email);
