-- Migration: V0017
-- Date: 2026-08-25
-- Description:
-- Add rejection_reason column to products for the product moderation pipeline.
-- Also ensure shops.product_count only counts published products.
--
-- Reason:
-- When VelCenter rejects a product, the seller needs to see the rejection reason.
-- The current products table has no column to store this.
--
-- Affected:
-- products (rejection_reason)

-- Add rejection_reason column (nullable — only set when status = 'rejected')
ALTER TABLE products ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
