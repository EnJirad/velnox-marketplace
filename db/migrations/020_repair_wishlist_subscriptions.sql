-- =============================================================
-- Migration: V0020
-- Date: 2026-08-26
-- Description: Repair customer_wishlist + subscriptions tables
-- Reason: V0019 was never applied to Neon production. The wishlist
--         table is missing entirely, causing product detail page
--         crashes when the wishlist API is called.
-- Affected: customer_wishlist, subscriptions
-- Safety: All CREATE TABLE use IF NOT EXISTS — safe to run repeatedly
-- =============================================================

-- Customer wishlist — used by product detail heart/favorite button
CREATE TABLE IF NOT EXISTS customer_wishlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_wishlist_user ON customer_wishlist (user_id);
CREATE INDEX IF NOT EXISTS idx_customer_wishlist_product ON customer_wishlist (product_id);

-- Subscriptions — used by VelRepeat / reorder feature
-- Uses the canonical schema from schema.sql (not the V0019 variant)
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    product_id UUID,
    seller_id UUID REFERENCES sellers(id),
    shop_id UUID REFERENCES shops(id),
    frequency TEXT NOT NULL DEFAULT 'monthly',
    status TEXT NOT NULL DEFAULT 'active',
    next_due_date TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_next_due ON subscriptions (next_due_date) WHERE status = 'active';
