-- =============================================================
-- Migration: V0035
-- Date: 2026-09-13
-- Description: Fix velrepeat_plans.status CHECK constraint to include
--              item_unavailable and price_changed which the scheduler
--              writes but were missing from the original V0034 constraint.
-- =============================================================

-- Drop old constraint and add new one with all valid statuses
ALTER TABLE velrepeat_plans DROP CONSTRAINT IF EXISTS velrepeat_plans_status_check;

ALTER TABLE velrepeat_plans ADD CONSTRAINT velrepeat_plans_status_check
  CHECK (status IN (
    'draft', 'active', 'paused', 'processing',
    'payment_failed', 'out_of_stock', 'item_unavailable',
    'price_changed', 'cancelled', 'completed'
  ));
