------------------------------------------------------------
-- Migration: V0030
-- Date: 2026-08-27
-- Description:
-- Add performance indexes for frequently queried columns
--
-- Reason:
-- Shop detail, catalog, and product queries are slow (~1.4-1.6s)
-- partly because Neon lacks indexes on foreign keys and status columns.
-- These indexes target the most common query patterns.
--
-- Affected:
-- products (idx_products_shop_id, idx_products_status, idx_products_shop_status)
-- product_images (idx_product_images_product_id)
-- inventory (idx_inventory_product_id)
-- product_variants (idx_product_variants_product_id)
-- wishlist (idx_customer_wishlist_user_product)
------------------------------------------------------------

-- Products: shop_id FK index (used by shop detail, catalog, seller products)
CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products (shop_id);

-- Products: status index (used by catalog, shop detail — filtered by 'published')
CREATE INDEX IF NOT EXISTS idx_products_status ON products (status);

-- Products: composite index for shop detail's most common query pattern
CREATE INDEX IF NOT EXISTS idx_products_shop_status ON products (shop_id, status);

-- Product images: product_id FK index (used by loadProductExtras)
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images (product_id);

-- Inventory: product_id FK index (used by loadProductExtras)
CREATE INDEX IF NOT EXISTS idx_inventory_product_id ON inventory (product_id);

-- Product variants: product_id FK index (used by loadProductExtras)
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants (product_id);

-- Wishlist: composite unique is already defined, but add explicit lookup index
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_wishlist_user_product
  ON customer_wishlist (user_id, product_id);
