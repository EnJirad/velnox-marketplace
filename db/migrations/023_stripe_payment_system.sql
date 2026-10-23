-- =============================================================
-- Migration: V0023
-- Date: 2026-08-26
-- Description: Stripe payment architecture — enhance orders, payments, and add payment_events
-- Reason: Need proper order lifecycle, Stripe checkout session tracking, webhook event dedup,
--         and snapshot data for order items (product name, image at time of purchase)
-- Affected: orders, order_items, payments, payment_events (NEW)
-- Safety: All ALTER TABLE use IF NOT EXISTS / safe defaults — safe to run repeatedly
-- =============================================================

-- ── orders: add order lifecycle columns ───────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- Create unique index on order_number (nullable — only set for created orders)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_orders_number_unique') THEN
    CREATE UNIQUE INDEX idx_orders_number_unique ON orders (order_number) WHERE order_number IS NOT NULL;
  END IF;
END $$;

-- ── order_items: add shop_id, variant_id, snapshot columns ───────────────
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_name_snapshot TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS image_url_snapshot TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_order_items_shop ON order_items (shop_id);

-- ── payments: add Stripe provider columns ─────────────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'cod';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_payment_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_checkout_session_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_payments_provider_session ON payments (provider_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_payment ON payments (provider_payment_id);

-- ── payment_events: webhook event dedup table ────────────────────────────
CREATE TABLE IF NOT EXISTS payment_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_provider ON payment_events (provider);
CREATE INDEX IF NOT EXISTS idx_payment_events_type ON payment_events (event_type);
CREATE INDEX IF NOT EXISTS idx_payment_events_processed ON payment_events (processed_at);
