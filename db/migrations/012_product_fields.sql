------------------------------------------------------------
-- Migration: V0012
-- Date: 2026-08-25
-- Description:
-- Add unit and supplier columns to products.
-- These fields are used by the seller product form
-- (ProductFormDialog.tsx) and required for product management.
--
-- Reason:
-- The product creation system requires unit (ชิ้น/กล่อง/ถุง)
-- and supplier (ชื่อร้านค้าส่ง) fields.
--
-- Affected:
-- products
------------------------------------------------------------

ALTER TABLE products ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'ชิ้น';
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier TEXT;

-- Add index for seller product queries (products by shop)
CREATE INDEX IF NOT EXISTS idx_products_shop_status ON products (shop_id, status);
