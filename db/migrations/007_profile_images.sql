-- Migration 007: Add cover_url to users table
-- Covers are stored in R2, URL persisted in users.cover_url

ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_url TEXT;
