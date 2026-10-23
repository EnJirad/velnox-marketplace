-- =============================================================
-- Migration: V0048
-- Date: 2026-09-28
-- Description: Payment reservation — a deadline for the stock an unpaid order
--              holds, plus the audited policy that produced it.
-- Reason: Stock is reserved inside the order-creation transaction, but the
--         reservation had no deadline: an order abandoned at Stripe held its
--         units until someone cancelled it or Stripe expired the session (~24 h
--         later), so the last unit of a scarce product sat behind an abandoned
--         order while other customers were told it was out of stock. The sweep
--         in backend/jobs/payment-reservation-scheduler.ts expires those orders
--         and releases the stock through the ONE release path
--         (releaseOrderInventory) exactly once.
-- Note: The columns are policy-agnostic — they store a deadline and the policy
--       record that produced it. The duration is now a CONSTANT 30 minutes
--       (backend/lib/payment-reservation.ts, `version: "v2"`); the earlier
--       risk-based windows (15-60 min, `version: "v1"`) are superseded, and a
--       stored v1 row stays distinguishable by its version field.
-- Re-queued 2026-09-28: comment-only touch. Both earlier attempts (02:57Z, 14:38Z)
--       died on the provider quota, so production still has neither column and the
--       storefront countdown cannot render. DDL below is unchanged.
-- Affected: orders (payment_expires_at, reservation_policy + one partial index)
-- Safety: Additive and idempotent only. No DROP TABLE, no DROP COLUMN, no
--         TRUNCATE, no DELETE, no backfill of existing rows (a NULL deadline
--         means "no reservation window was ever taken", and the sweep ignores
--         those rows). Re-running is a no-op.
-- =============================================================

-- ── orders: the reservation deadline + the policy that produced it ────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reservation_policy JSONB;

-- The expiry sweep's range scan and ORDER BY. Partial on the only rows it can
-- ever look at, so orders without a window cost nothing.
CREATE INDEX IF NOT EXISTS idx_orders_payment_expires_at
  ON orders (payment_expires_at)
  WHERE payment_expires_at IS NOT NULL;
