-- =============================================================
-- Migration: V0034
-- Date: 2026-09-06
-- Description: VelRepeat V2 — Recurring Commerce Engine.
--              Customer creates a recurring PLAN (1 user, N items).
--              A scheduler worker creates a fresh ORDER per scheduled
--              run (unlike V1 vrepeat_packages which is a pay-upfront
--              package). Runs are idempotent via UNIQUE(plan_id,
--              scheduled_for); concurrent workers are serialized by
--              row locks (FOR UPDATE) in the worker transaction.
-- Affected: velrepeat_plans (NEW), velrepeat_items (NEW),
--           velrepeat_runs (NEW), velrepeat_events (NEW),
--           orders (+velrepeat_run_id), products (+vrepeat_min/max_qty)
-- Safety:  All CREATE TABLE use IF NOT EXISTS.
--          All ALTER TABLE use ADD COLUMN IF NOT EXISTS.
--          Backward compatible: V1 vrepeat_packages/deliveries and
--          legacy subscriptions table are untouched.
-- =============================================================

-- ── 1. VelRepeat Plans ──────────────────────────────────────────────────
-- One recurring plan per customer. A plan has N items (velrepeat_items).
CREATE TABLE IF NOT EXISTS velrepeat_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'paused', 'processing',
                      'payment_failed', 'out_of_stock', 'cancelled', 'completed')),
  frequency_type TEXT NOT NULL CHECK (frequency_type IN ('days', 'weeks', 'months')),
  interval_value INTEGER NOT NULL DEFAULT 30 CHECK (interval_value > 0),
  next_run_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  shipping_address_id UUID REFERENCES addresses(id) ON DELETE SET NULL,
  shipping_address JSONB,
  payment_method TEXT NOT NULL DEFAULT 'cod',
  payment_method_ref TEXT,
  currency TEXT NOT NULL DEFAULT 'THB',
  timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_velrepeat_plans_user ON velrepeat_plans (user_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_plans_user_status ON velrepeat_plans (user_id, status);
CREATE INDEX IF NOT EXISTS idx_velrepeat_plans_due ON velrepeat_plans (status, next_run_at)
  WHERE status IN ('active');

-- ── 2. VelRepeat Items ─────────────────────────────────────────────────
-- Each item references product + variant (never product-only when the
-- product has variants) + shop + seller + quantity + price snapshot.
CREATE TABLE IF NOT EXISTS velrepeat_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES velrepeat_plans(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'THB',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, product_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_velrepeat_items_plan ON velrepeat_items (plan_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_items_product ON velrepeat_items (product_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_items_variant ON velrepeat_items (variant_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_items_shop ON velrepeat_items (shop_id);

-- ── 3. VelRepeat Runs ──────────────────────────────────────────────────
-- One run = one scheduled execution of a plan = (usually) one or more
-- orders. UNIQUE(plan_id, scheduled_for) is the idempotency guard:
-- a scheduler may attempt a run for the same scheduled time only once.
CREATE TABLE IF NOT EXISTS velrepeat_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES velrepeat_plans(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'success', 'payment_failed',
                      'out_of_stock', 'item_unavailable', 'price_changed',
                      'failed', 'cancelled')),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  error_code TEXT,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_velrepeat_runs_plan ON velrepeat_runs (plan_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_runs_status ON velrepeat_runs (status);
CREATE INDEX IF NOT EXISTS idx_velrepeat_runs_scheduled ON velrepeat_runs (scheduled_for);
CREATE INDEX IF NOT EXISTS idx_velrepeat_runs_order ON velrepeat_runs (order_id) WHERE order_id IS NOT NULL;

-- ── 4. VelRepeat Events ────────────────────────────────────────────────
-- Lifecycle/analytics events (PLAN_CREATED, PLAN_PAUSED, RUN_SUCCESS,
-- OUT_OF_STOCK, PAYMENT_FAILED, ...) — feeds Smart Repeat later.
CREATE TABLE IF NOT EXISTS velrepeat_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES velrepeat_plans(id) ON DELETE CASCADE,
  run_id UUID REFERENCES velrepeat_runs(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_velrepeat_events_plan ON velrepeat_events (plan_id, created_at);
CREATE INDEX IF NOT EXISTS idx_velrepeat_events_type ON velrepeat_events (event_type);
CREATE INDEX IF NOT EXISTS idx_velrepeat_events_run ON velrepeat_events (run_id) WHERE run_id IS NOT NULL;

-- ── 5. Link recurring orders to their run ─────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS velrepeat_run_id UUID REFERENCES velrepeat_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_velrepeat_run ON orders (velrepeat_run_id) WHERE velrepeat_run_id IS NOT NULL;

-- ── 6. Product-level VelRepeat quantity bounds (seller config) ─────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_min_qty INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_max_qty INTEGER;