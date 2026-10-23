-- =============================================================
-- Migration: V0022
-- Date: 2026-08-26
-- Description: Create customer_wishlist table
-- Reason: V0020 in run-update.sql was never applied because it
--         existed only as inline SQL — not as a migration file
--         in db/migrations/. The GitHub Action scans db/migrations/
--         and never found it. This caused:
--         "error: relation 'customer_wishlist' does not exist" (42P01)
-- Affected: customer_wishlist
-- Safety: Uses IF NOT EXISTS — safe to run repeatedly
-- =============================================================

CREATE TABLE IF NOT EXISTS customer_wishlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_wishlist_user ON customer_wishlist (user_id);
CREATE INDEX IF NOT EXISTS idx_customer_wishlist_product ON customer_wishlist (product_id);
