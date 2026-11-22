-- ============================================================================
-- Velnox Marketplace Clean Rebuild — Migration 0002: Marketplace Core
-- Version: 2.0.0
-- Applies to: Clean Neon PostgreSQL Database
-- ============================================================================

-- Table: sellers (Seller Profiles & Verification)
CREATE TABLE IF NOT EXISTS sellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  business_type TEXT NOT NULL CHECK (business_type IN ('individual', 'juristic')),
  tax_id TEXT,
  id_card_number TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
  verification_rejected_reason TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sellers_user_id ON sellers (user_id);
CREATE INDEX IF NOT EXISTS idx_sellers_verification_status ON sellers (verification_status);

-- Table: shops (Storefronts owned by Sellers)
CREATE TABLE IF NOT EXISTS shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  logo_url TEXT,
  cover_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  rating NUMERIC(3, 2) NOT NULL DEFAULT 0.00,
  review_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shops_seller_id ON shops (seller_id);
CREATE INDEX IF NOT EXISTS idx_shops_slug ON shops (slug);
CREATE INDEX IF NOT EXISTS idx_shops_status ON shops (status);

-- Table: categories (Multi-level Hierarchical Product Categories L1 -> L2 -> L3)
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  name_th TEXT,
  name_en TEXT,
  name_my TEXT,
  slug TEXT NOT NULL UNIQUE,
  level INT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
  icon_url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories (slug);
CREATE INDEX IF NOT EXISTS idx_categories_level_active ON categories (level, is_active);

-- Table: products (Core Product Catalog with Satang Minor Units)
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  price BIGINT NOT NULL CHECK (price >= 0), -- satang minor units (e.g. 10000 = 100.00 THB)
  original_price BIGINT CHECK (original_price >= 0),
  currency TEXT NOT NULL DEFAULT 'THB',
  total_quantity INT NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
  reserved_quantity INT NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0 AND reserved_quantity <= total_quantity),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'delisted')),
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  primary_image_url TEXT,
  rating NUMERIC(3, 2) NOT NULL DEFAULT 0.00,
  review_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products (shop_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products (slug);
CREATE INDEX IF NOT EXISTS idx_products_status ON products (status);
CREATE INDEX IF NOT EXISTS idx_products_price ON products (price);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products (created_at DESC);

-- Table: product_variants (SKUs and Options under a Product)
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  price BIGINT NOT NULL CHECK (price >= 0), -- satang minor units
  stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON product_variants (sku);

-- Table: media_objects (Cloudflare R2 Uploaded Media Metadata)
CREATE TABLE IF NOT EXISTS media_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('product_image', 'shop_logo', 'shop_cover', 'avatar', 'verification_doc', 'chat_attachment')),
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  file_size_bytes INT NOT NULL CHECK (file_size_bytes <= 5242880), -- 5 MB limit
  public_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_objects_user_id ON media_objects (user_id);
CREATE INDEX IF NOT EXISTS idx_media_objects_r2_key ON media_objects (r2_key);

-- Seed Initial Marketplace Categories (L1 & L2)
INSERT INTO categories (id, parent_id, name, name_th, name_en, name_my, slug, level, sort_order)
VALUES
  ('00000000-0000-0000-0000-000000000001', NULL, 'Electronics', 'อิเล็กทรอนิกส์และไอที', 'Electronics & IT', 'အီလက်ထရွန်းနစ်', 'electronics', 1, 1),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Smartphones & Tablets', 'สมาร์ทโฟนและแท็บเล็ต', 'Smartphones & Tablets', 'စမတ်ဖုန်းနှင့် တက်ဘလက်', 'smartphones-tablets', 2, 1),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Computers & Laptops', 'คอมพิวเตอร์และแล็ปท็อป', 'Computers & Laptops', 'ကွန်ပျူတာနှင့် လက်ပ်တော့', 'computers-laptops', 2, 2),
  ('00000000-0000-0000-0000-000000000004', NULL, 'Fashion', 'แฟชั่น', 'Fashion', 'ဖက်ရှင်', 'fashion', 1, 2),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000004', 'Men Fashion', 'แฟชั่นผู้ชาย', 'Men Fashion', 'အမျိုးသားဖက်ရှင်', 'men-fashion', 2, 1),
  ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000004', 'Women Fashion', 'แฟชั่นผู้หญิง', 'Women Fashion', 'အမျိုးသမီးဖက်ရှင်', 'women-fashion', 2, 2),
  ('00000000-0000-0000-0000-000000000007', NULL, 'Home & Living', 'บ้านและของใช้ในบ้าน', 'Home & Living', 'အိမ်သုံးပစ္စည်း', 'home-living', 1, 3),
  ('00000000-0000-0000-0000-000000000008', NULL, 'Health & Beauty', 'สุขภาพและความงาม', 'Health & Beauty', 'ကျန်းမာရေးနှင့် အလှအပ', 'health-beauty', 1, 4)
ON CONFLICT (slug) DO NOTHING;
