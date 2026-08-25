------------------------------------------------------------
-- Migration: V0019
-- Date: 2026-08-25
-- Description:
-- Add customer_wishlist table for product favorites
--
-- Reason:
-- VelShop needs a wishlist/favorites feature for customers
-- to save products they like.
--
-- Affected:
-- customer_wishlist (new table)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customer_wishlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_wishlist_user ON customer_wishlist (user_id);
CREATE INDEX IF NOT EXISTS idx_customer_wishlist_product ON customer_wishlist (product_id);
