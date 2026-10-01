-- =============================================================
-- Migration: V0051
-- Date: 2026-10-01
-- Description: VelRepeat V2 plan-level prepaid payment parent.
--              `payments` (and the operator incident record) can name a
--              Repeat Plan as their parent instead of an Order, so a prepaid
--              PLAN commitment is recorded in the ONE canonical payment
--              authority without inventing a fake order to satisfy a
--              foreign key (owner decision Q13=B / Q14).
-- Reason: `payments.order_id` was `UUID NOT NULL REFERENCES orders(id)`, so a
--         plan-level prepaid charge was impossible to record. The two
--         available workarounds were both forbidden: create a fake Order to
--         hold the money, or make Cycle 1's order carry the whole commitment.
--         The decision closure
--         (.ai/tasks/audits/velrepeat-v2-owner-decision-closure-2026-09-30.md
--         §3.1) requires a nullable parent plus an "exactly one parent" CHECK,
--         and — because NULLs are distinct in PostgreSQL — a plan-scoped twin
--         of `idx_payments_one_active_stripe`, which otherwise cannot constrain
--         plan-level rows at all.
--
--         `payment_incidents` moves with it: it is `order_id NOT NULL`
--         too, and it is the durable operator record for money this system
--         could not settle. Without plan scope, an amount/currency mismatch on
--         a prepaid commitment could only be written to a Render log line —
--         exactly the invisibility that table was created to remove.
--
--         NOT CHANGED HERE: `refunds.order_id` stays NOT NULL. No refund writer
--         for a plan exists (the refund formula is still OWNER FORMULA
--         REQUIRED, Phase 9), so widening it now would add an unused
--         constraint without a writer.
-- Affected: payments, payment_incidents
-- Safety: Additive and idempotent only. `order_id` only loses NOT NULL (it
--         keeps its FK and its type), so every existing row still has a parent;
--         the new CHECK additionally guarantees no row can ever have BOTH or
--         NEITHER. No DROP TABLE, no DROP COLUMN, no TRUNCATE, no DELETE.
--         Re-running is a no-op.
-- =============================================================

-- ── payments: a plan may now be the parent ────────────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan_id UUID;

-- The constraint that made a plan-level charge impossible. Relaxing it is
-- only safe together with the "exactly one parent" CHECK below, which is what
-- preserves the old guarantee (every payment belongs to an order).
ALTER TABLE payments ALTER COLUMN order_id DROP NOT NULL;

-- `velrepeat_plans` is created later than `payments`, so the foreign key is
-- added as a deferred constraint rather than inline.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_plan_id_fkey'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_plan_id_fkey
      FOREIGN KEY (plan_id) REFERENCES velrepeat_plans(id);
  END IF;
END
$$;

-- Exactly one parent. No row may be an order payment and a plan payment, and
-- no row may be an orphan.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_exactly_one_parent_check'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_exactly_one_parent_check
      CHECK (
        (order_id IS NOT NULL AND plan_id IS NULL)
        OR (order_id IS NULL AND plan_id IS NOT NULL)
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_payments_plan ON payments (plan_id) WHERE plan_id IS NOT NULL;

-- The plan-scoped twin of `idx_payments_one_active_stripe`. This is the
-- database-backed idempotency guarantee for prepaid plan payments: a
-- double-click, a client retry or two concurrent requests can never open two
-- Checkout Sessions for one plan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_active_stripe_plan
  ON payments (plan_id)
  WHERE provider = 'stripe'
    AND plan_id IS NOT NULL
    AND status IN ('pending', 'requires_action');

-- ── payment_incidents: the same parent rule for operator records ───────────
ALTER TABLE payment_incidents ADD COLUMN IF NOT EXISTS plan_id UUID;

ALTER TABLE payment_incidents ALTER COLUMN order_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_incidents_plan_id_fkey'
  ) THEN
    ALTER TABLE payment_incidents
      ADD CONSTRAINT payment_incidents_plan_id_fkey
      FOREIGN KEY (plan_id) REFERENCES velrepeat_plans(id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_incidents_exactly_one_parent_check'
  ) THEN
    ALTER TABLE payment_incidents
      ADD CONSTRAINT payment_incidents_exactly_one_parent_check
      CHECK (
        (order_id IS NOT NULL AND plan_id IS NULL)
        OR (order_id IS NULL AND plan_id IS NOT NULL)
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_payment_incidents_plan
  ON payment_incidents (plan_id) WHERE plan_id IS NOT NULL;