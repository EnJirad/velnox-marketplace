-- Migration: V0011
-- Date: 2026-08-25
-- Description:
-- Add CHECK constraint to sellers.status with canonical values.
--
-- Reason:
-- The sellers.status column previously had no constraint (or an incorrect one
-- allowing only 'pending','active','suspended'). The backend uses:
-- pending, approved, rejected, suspended.
-- This migration normalizes the constraint and any existing data.
--
-- Affected:
-- sellers

-- First, normalize any inconsistent existing data
-- 'active' → 'approved' (old value from incorrect CHECK constraint)
UPDATE sellers SET status = 'approved' WHERE status = 'active';
-- 'under_review' → 'pending' (non-canonical value)
UPDATE sellers SET status = 'pending' WHERE status = 'under_review';

-- Drop existing CHECK constraint if any (safe — re-add below)
ALTER TABLE sellers DROP CONSTRAINT IF EXISTS sellers_status_check;

-- Add the correct CHECK constraint
ALTER TABLE sellers
  ADD CONSTRAINT sellers_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'suspended'));
