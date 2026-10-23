-- Migration: V0016
-- Date: 2026-08-25
-- Description:
-- Sync schema discrepancies between run-update.sql V0004 base tables
-- and the actual schema.sql/run-sqleditor.sql canonical schema.
--
-- Reason:
-- Several columns were added to schema.sql outside of the migration
-- system. These ALTERs use IF NOT EXISTS to be safe for all cases.
--
-- Affected:
-- inventory (reserved), orders (shipping_address, total_amount DEFAULT),
-- order_items (product_name)

-- inventory: add reserved column (tracks customer-reserved stock)
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS reserved INTEGER NOT NULL DEFAULT 0;

-- orders: add shipping_address JSONB snapshot column
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address JSONB;

-- orders: ensure total_amount has DEFAULT 0 (V0004 had NOT NULL without DEFAULT)
ALTER TABLE orders ALTER COLUMN total_amount SET DEFAULT 0;

-- orders: remove restrictive CHECK constraint if it exists (V0003 added one)
-- The backend uses status values not in V0003's CHECK list
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

-- order_items: add product_name column for display
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name TEXT NOT NULL DEFAULT '';

-- order_items: ensure quantity has DEFAULT 1 (V0003 had CHECK without DEFAULT)
ALTER TABLE order_items ALTER COLUMN quantity SET DEFAULT 1;

-- notifications: add body and metadata columns (V0003 didn't have these)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- addresses: ensure subdistrict, district, latitude, longitude exist
-- (V0013 adds these but may not have been applied)
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS subdistrict TEXT;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
