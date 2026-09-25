-- =============================================================
-- Migration: V0047
-- Date: 2026-09-25
-- Description: Payment foundation — Stripe test-mode Card/PromptPay, webhook
--              processing state, refund tracking, and a scoped idempotency key.
-- Reason: The Stripe routes (V0023) could record a payment but not represent a
--         failure reason, a refund, or a webhook whose processing died
--         half-way. POST /api/stripe/checkout also had no idempotency boundary,
--         so a double-click could open two Checkout Sessions for one order.
-- Affected: payments, payment_events, refunds, checkout_requests
-- Safety: Additive and idempotent only. No DROP TABLE, no DROP COLUMN,
--         no TRUNCATE, no DELETE. Re-running is a no-op.
-- =============================================================

-- ── payments: failure detail + refund accounting ──────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_code TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_message TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_status TEXT;

-- At most ONE live Stripe attempt per order. This is what makes the payment
-- creation idempotent under a double-click or a client retry: the second
-- concurrent insert cannot create a second Checkout Session (and therefore
-- cannot create a second PaymentIntent), and the handler then returns the
-- session the first request already opened. Terminal states leave the index,
-- so a failed attempt can still be retried.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_active_stripe
  ON payments (order_id)
  WHERE provider = 'stripe' AND status IN ('pending', 'requires_action');

-- ── payment_events: durable webhook processing state ──────────────────────
-- The event row is now claimed BEFORE processing so a concurrent duplicate is
-- rejected atomically, and its outcome is recorded so a Stripe retry of an
-- event whose processing genuinely failed is no longer silently skipped.
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'processed';
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── refunds: provider linkage so a refund is webhook-confirmed ────────────
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS provider_refund_id TEXT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES users(id);
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Plain (not partial) unique index: PostgreSQL treats NULLs as distinct, so
-- many un-submitted refund rows coexist while one provider refund id maps to
-- exactly one row. A partial index would also force a predicate into every
-- ON CONFLICT inference.
CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_provider_refund
  ON refunds (provider_refund_id);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds (order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_payment ON refunds (payment_id);

-- ── checkout_requests: one idempotency store, two scopes ──────────────────
-- V0035 gave checkout a (user_id, request_key) idempotency boundary. Payment
-- creation needs the same guarantee, and the repository must not grow a second
-- competing idempotency table, so the existing one gains a scope discriminator.
-- The default keeps every existing row and every existing caller on 'checkout'.
ALTER TABLE checkout_requests ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'checkout';

DO $$
DECLARE
  existing TEXT;
BEGIN
  SELECT conname INTO existing
    FROM pg_constraint
   WHERE conrelid = 'checkout_requests'::regclass
     AND contype = 'u'
     AND pg_get_constraintdef(oid) = 'UNIQUE (user_id, request_key)';

  IF existing IS NOT NULL THEN
    EXECUTE format('ALTER TABLE checkout_requests DROP CONSTRAINT %I', existing);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'checkout_requests'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) = 'UNIQUE (user_id, scope, request_key)'
  ) THEN
    ALTER TABLE checkout_requests
      ADD CONSTRAINT checkout_requests_user_scope_key UNIQUE (user_id, scope, request_key);
  END IF;
END $$;

INSERT INTO schema_migrations (migration_name)
VALUES ('047_payment_foundation')
ON CONFLICT (migration_name) DO NOTHING;
