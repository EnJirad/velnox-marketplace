-- =============================================================
-- Migration: V0049
-- Date: 2026-09-29
-- Description: Durable operator incidents for money that was received but
--              could not be settled through the normal order lifecycle.
-- Reason: When Stripe reports a captured charge for an order that can no
--         longer be settled (the attempt was already recorded `failed`, or the
--         order was cancelled / expired and its stock released), the only
--         signal was one `console.warn` line on a Render log. That is not
--         queryable, not acknowledgeable, and disappears with the log
--         retention window — while real money sits in Stripe. Worse, the
--         sharpest case emitted NOTHING at all: an order that is still
--         payable moves to `paid` and commits its stock, while the payment
--         row stays `failed`, so `POST /api/admin/orders/:orderId/refund`
--         refuses it (it requires `status = 'paid'`) and no one knows to try.
--         `payment_incidents` is that missing durable record. It records WHAT
--         an operator must look at; it deliberately does NOT decide anything
--         about the money — no automatic refund, no reopening of the order.
--         That stays an operator decision, exactly as `.ai/context/payment.md`
--         already states.
-- Note: `dedupe_key` is UNIQUE so the same provider + order + attempt +
--       reason can only ever produce ONE row, however many events Stripe
--       redelivers. It is computed deterministically in
--       backend/lib/payment-incidents.ts, never from a timestamp.
-- Affected: new table `payment_incidents` + its indexes. No existing table is
--           altered.
-- Safety: Additive and idempotent only. No DROP, no TRUNCATE, no DELETE, no
--         backfill, no constraint added to an existing table. Re-running is a
--         no-op. The code tolerates this table being ABSENT (see
--         `isUndefinedTableError` in backend/lib/payment-incidents.ts) so the
--         backend can be deployed before the migration is applied — the same
--         deploy-order net `selectOrderPaymentRow` provides for
--         `orders.payment_expires_at`.
-- =============================================================

CREATE TABLE IF NOT EXISTS payment_incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dedupe_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'stripe',
  order_id UUID NOT NULL REFERENCES orders(id),
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  provider_payment_intent_id TEXT,
  provider_checkout_session_id TEXT,
  event_id TEXT,
  reason TEXT NOT NULL,
  order_status TEXT,
  amount NUMERIC(12, 2),
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolution_note TEXT,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_incidents_order ON payment_incidents (order_id);
CREATE INDEX IF NOT EXISTS idx_payment_incidents_status ON payment_incidents (status);
CREATE INDEX IF NOT EXISTS payment_incidents_dedupe_key ON payment_incidents (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_payment_incidents_intent ON payment_incidents (provider_payment_intent_id);
