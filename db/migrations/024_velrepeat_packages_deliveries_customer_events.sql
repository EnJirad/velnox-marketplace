-- =============================================================
-- Migration: V0024
-- Date: 2026-08-26
-- Description: VelRepeat package/delivery system, product variant
--              support, cart purchase_type, customer events, and
--              performance indexes.
-- Reason: VelRepeat must be a "buy-ahead package + scheduled
--         delivery" system, separate from Buy Once.
-- Affected: vrepeat_packages (NEW), vrepeat_deliveries (NEW),
--           customer_events (NEW), product_variants (NEW),
--           products, cart_items, index additions
-- Safety: All CREATE TABLE use IF NOT EXISTS.
--         All ALTER TABLE use ADD COLUMN IF NOT EXISTS.
-- =============================================================

-- ── 1. VelRepeat Packages ─────────────────────────────────────────────────
-- A package represents a customer's upfront purchase of N units
-- to be delivered on a schedule (weekly, monthly, or custom).
CREATE TABLE IF NOT EXISTS vrepeat_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  variant_id UUID,
  shop_id UUID NOT NULL REFERENCES shops(id),
  seller_id UUID NOT NULL REFERENCES sellers(id),
  package_type TEXT NOT NULL CHECK (package_type IN ('weekly', 'monthly', 'custom')),
  quantity_total INTEGER NOT NULL CHECK (quantity_total > 0),
  quantity_delivered INTEGER NOT NULL DEFAULT 0 CHECK (quantity_delivered >= 0),
  unit_price NUMERIC(12, 2) NOT NULL,
  regular_unit_price NUMERIC(12, 2) NOT NULL,
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'THB',
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'paid', 'active', 'paused', 'completed', 'cancelled', 'refunded')),
  interval_days INTEGER NOT NULL DEFAULT 7,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  payment_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_user ON vrepeat_packages (user_id);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_product ON vrepeat_packages (product_id);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_shop ON vrepeat_packages (shop_id);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_seller ON vrepeat_packages (seller_id);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_status ON vrepeat_packages (status);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_user_status ON vrepeat_packages (user_id, status);

-- ── 2. VelRepeat Deliveries ───────────────────────────────────────────────
-- Each delivery record represents one scheduled shipment within a package.
CREATE TABLE IF NOT EXISTS vrepeat_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  package_id UUID NOT NULL REFERENCES vrepeat_packages(id) ON DELETE CASCADE,
  delivery_number INTEGER NOT NULL CHECK (delivery_number > 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  scheduled_at TIMESTAMPTZ NOT NULL,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'processing', 'shipped', 'delivered', 'failed', 'cancelled')),
  tracking_number TEXT,
  order_id UUID REFERENCES orders(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (package_id, delivery_number)
);

CREATE INDEX IF NOT EXISTS idx_vrepeat_deliveries_package ON vrepeat_deliveries (package_id);
CREATE INDEX IF NOT EXISTS idx_vrepeat_deliveries_status ON vrepeat_deliveries (status);
CREATE INDEX IF NOT EXISTS idx_vrepeat_deliveries_scheduled ON vrepeat_deliveries (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_vrepeat_deliveries_order ON vrepeat_deliveries (order_id);

-- ── 3. Product Variants ──────────────────────────────────────────────────
-- Supports color, size, weight, flavor, etc.
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  price NUMERIC(12, 2) NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  options JSONB DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_status ON product_variants (product_id, status);

-- ── 4. Products: VelRepeat configuration ─────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_weekly_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_monthly_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_weekly_price NUMERIC(12, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_monthly_price NUMERIC(12, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_weekly_qty INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_monthly_qty INTEGER;

-- ── 5. Cart Items: purchase_type + package_config ────────────────────────
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS purchase_type TEXT NOT NULL DEFAULT 'once'
  CHECK (purchase_type IN ('once', 'repeat'));
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS package_config JSONB;

-- ── 6. Customer Events ───────────────────────────────────────────────────
-- Behavioral tracking for future personalization / recommendations.
CREATE TABLE IF NOT EXISTS customer_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  product_id UUID,
  category_id TEXT,
  shop_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_events_user ON customer_events (user_id);
CREATE INDEX IF NOT EXISTS idx_customer_events_type ON customer_events (event_type);
CREATE INDEX IF NOT EXISTS idx_customer_events_product ON customer_events (product_id);
CREATE INDEX IF NOT EXISTS idx_customer_events_user_type ON customer_events (user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_customer_events_created ON customer_events (created_at);

-- ── 7. Performance Indexes ───────────────────────────────────────────────
-- For frequently queried patterns identified from production logs.
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_sellers_status ON sellers (status);
CREATE INDEX IF NOT EXISTS idx_carts_user ON carts (user_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product ON cart_items (product_id);
