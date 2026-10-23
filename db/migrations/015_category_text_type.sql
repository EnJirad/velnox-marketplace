-- Migration: V0015
-- Date: 2026-08-25
-- Description:
-- Change products.category_id from UUID FK to TEXT.
--
-- Reason:
-- Frontend sends simple category strings like "food", "daily", "beauty"
-- (StoreProductCategory type). The DB column was UUID referencing
-- categories(id), causing "invalid input syntax for type uuid" errors.
--
-- Affected:
-- products (category_id type change)

-- Drop the FK constraint if it exists
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_id_fkey;

-- Change column type from UUID to TEXT
ALTER TABLE products ALTER COLUMN category_id TYPE TEXT;
