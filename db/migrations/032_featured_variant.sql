-- V0032: Add featured_variant_id to products
-- Featured variant determines which variant's price/image appears on product cards.
-- Seller can select one variant per product as the "featured" variant.

ALTER TABLE products ADD COLUMN IF NOT EXISTS featured_variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_featured_variant ON products (featured_variant_id) WHERE featured_variant_id IS NOT NULL;
