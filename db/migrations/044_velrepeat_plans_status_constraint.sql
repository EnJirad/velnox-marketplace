-- Migration: V0044
-- Date: 2026-09-15
-- Description:
-- Re-assert the velrepeat_plans / velrepeat_plan_runs status CHECK constraints.
--
-- Root cause:
-- The repository state machine is NOT stale. `backend/jobs/velrepeat-scheduler.ts`
-- writes `item_unavailable`, `db/schema.sql` lists it, and
-- `035_velrepeat_plans_status_fix.sql` adds it — but two migrations share the
-- number 035 (`035_checkout_idempotency.sql` and
-- `035_velrepeat_plans_status_fix.sql`). Any runner keyed on the numeric prefix
-- applies only one of them, so environments that applied
-- `035_checkout_idempotency.sql` kept the pre-V0035 constraint and started
-- rejecting `item_unavailable` with:
--     new row for relation "velrepeat_plans" violates check constraint
--     "velrepeat_plans_status_check"
--
-- Fix:
-- Give the constraint repair its own unused number (044) so it can never be
-- skipped, and make it idempotent so re-running is harmless. The same
-- statements are appended to `db/schema.sql` / `db/run-sqleditor.sql` so the
-- bootstrap file also self-heals a database created before the widening.
--
-- Data safety:
-- This only WIDENS the allowed set — no existing row can violate the new
-- constraints, so no data normalization is required.
--
-- Affected:
--   velrepeat_plans
--   velrepeat_plan_runs

ALTER TABLE velrepeat_plans DROP CONSTRAINT IF EXISTS velrepeat_plans_status_check;
ALTER TABLE velrepeat_plans
  ADD CONSTRAINT velrepeat_plans_status_check
  CHECK (status IN ('draft', 'active', 'paused', 'processing', 'payment_failed',
                    'out_of_stock', 'item_unavailable', 'price_changed',
                    'cancelled', 'completed'));

ALTER TABLE velrepeat_plan_runs DROP CONSTRAINT IF EXISTS velrepeat_plan_runs_status_check;
ALTER TABLE velrepeat_plan_runs
  ADD CONSTRAINT velrepeat_plan_runs_status_check
  CHECK (status IN ('processing', 'success', 'payment_failed', 'out_of_stock',
                    'item_unavailable', 'price_changed', 'failed', 'cancelled'));
