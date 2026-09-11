-- =============================================================
-- Velnox Marketplace — Incremental Migration History
-- This file MUST NEVER be overwritten.
-- New migrations MUST be appended at the end.
-- =============================================================

-- ------------------------------------------------------------
-- Migration: V0001
-- Date: 2025-01-01
-- Description: Initial schema — shared domain
-- Reason: Bootstrap database with core shared tables.
-- Affected: media, categories, system_settings
-- ------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS media (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    url TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    icon TEXT,
    parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT NOT NULL UNIQUE,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_media_key ON media(key);

-- ------------------------------------------------------------
-- Migration: V0002
-- Date: 2025-01-01
-- Description: Auth & Users
-- Reason: User authentication and identity management.
-- Affected: users, provider_identities, customer_profiles
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  avatar TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'customer',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_subject VARCHAR(255) NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_subject),
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS customer_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_auth_identities_provider ON provider_identities(provider, provider_subject);
CREATE INDEX IF NOT EXISTS idx_auth_identities_email ON provider_identities(email);

-- ------------------------------------------------------------
-- Migration: V0003
-- Date: 2025-01-01
-- Description: Customer domain
-- Reason: Customer-facing features — addresses, cart, orders, notifications.
-- Affected: addresses, carts, cart_items, orders, order_items, notifications
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT 'Home',
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    line1 TEXT NOT NULL,
    line2 TEXT,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'TH',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cart_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    price NUMERIC(12, 2) NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(cart_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    shop_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
    total_amount NUMERIC(12, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'THB',
    shipping_address_id UUID REFERENCES addresses(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_addresses_user_id ON addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_shop_id ON orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read) WHERE read = FALSE;

-- ------------------------------------------------------------
-- Migration: V0004
-- Date: 2025-01-01
-- Description: Seller domain
-- Reason: Seller marketplace — shops, products, inventory.
-- Affected: sellers, shops, products, product_images, inventory,
--           seller_settings, seller_analytics
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sellers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    logo TEXT,
    cover TEXT,
    rating NUMERIC(3, 2),
    product_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    short_description TEXT,
    price NUMERIC(12, 2) NOT NULL,
    compare_at_price NUMERIC(12, 2),
    currency TEXT NOT NULL DEFAULT 'THB',
    status TEXT NOT NULL DEFAULT 'draft',
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    rating NUMERIC(3, 2),
    review_count INTEGER NOT NULL DEFAULT 0,
    sold_count INTEGER NOT NULL DEFAULT 0,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    alt TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 5,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seller_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seller_id UUID NOT NULL UNIQUE REFERENCES sellers(id) ON DELETE CASCADE,
    settings JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seller_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    orders INTEGER NOT NULL DEFAULT 0,
    revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(seller_id, date)
);

CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products(shop_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured) WHERE featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_shops_slug ON shops(slug);
CREATE INDEX IF NOT EXISTS idx_shops_seller_id ON shops(seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_analytics_seller_date ON seller_analytics(seller_id, date);

-- ------------------------------------------------------------
-- Migration: V0005
-- Date: 2025-01-01
-- Description: Center domain
-- Reason: Company admin — departments, employees, settings, audit.
-- Affected: departments, employees, company_settings, platform_settings,
--           audit_logs, moderation_records
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'manager', 'staff')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT NOT NULL UNIQUE,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT NOT NULL UNIQUE,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    details JSONB DEFAULT '{}',
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderation_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    moderator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    action TEXT NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

-- ------------------------------------------------------------
-- Migration: V0006
-- Date: 2025-01-01
-- Description: Behavioral events
-- Reason: Analytics and user behavior tracking.
-- Affected: behavioral_events
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS behavioral_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    metadata JSONB DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_behavioral_events_user_id ON behavioral_events(user_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_events_session ON behavioral_events(session_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_events_type ON behavioral_events(event_type);
CREATE INDEX IF NOT EXISTS idx_behavioral_events_entity ON behavioral_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_events_occurred ON behavioral_events(occurred_at);

-- ------------------------------------------------------------
-- Migration: V0007
-- Date: 2025-01-01
-- Description: Add cover_url to users table
-- Reason: Profile cover image support via R2 storage.
-- Affected: users
-- ------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_url TEXT;

-- ------------------------------------------------------------
-- Migration: V0008
-- Date: 2025-01-01
-- Description: Upload system + auth fixes
-- Reason: Add role/status columns to users; rename media columns for
--         upload code; ensure auth_identities constraints exist.
-- Affected: users, media, auth_identities
-- ------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'customer';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'uploaded_by')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'owner_id')
  THEN ALTER TABLE media RENAME COLUMN uploaded_by TO owner_id; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'key')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'object_key')
  THEN ALTER TABLE media RENAME COLUMN key TO object_key; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'url')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'cdn_url')
  THEN ALTER TABLE media RENAME COLUMN url TO cdn_url; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'content_type')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'mime_type')
  THEN ALTER TABLE media RENAME COLUMN content_type TO mime_type; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'size')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'media' AND column_name = 'file_size')
  THEN ALTER TABLE media RENAME COLUMN size TO file_size; END IF;
END $$;

ALTER TABLE media ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
CREATE INDEX IF NOT EXISTS idx_media_owner_v2 ON media (owner_id);

-- ------------------------------------------------------------
-- Migration: V0009
-- Date: 2025-01-01
-- Description: Fix auth table + cover_url
-- Reason: Create auth_identities from provider_identities; ensure
--         cover_url and role/status exist on users.
-- Affected: users, auth_identities
-- ------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'customer';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS auth_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_id)
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'provider_identities') THEN
    INSERT INTO auth_identities (id, user_id, provider, provider_id, email, created_at)
    SELECT id, user_id, provider, provider_subject, email, created_at
    FROM provider_identities
    ON CONFLICT (provider, provider_id) DO NOTHING;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auth_identities_provider ON auth_identities (provider, provider_id);
CREATE INDEX IF NOT EXISTS idx_auth_identities_email ON auth_identities (email);

-- ------------------------------------------------------------
-- Migration: V0010
-- Date: 2026-08-25
-- Description: Add revoked_tokens for session invalidation
-- Reason: Logout must invalidate JWT server-side. Each JWT has a unique
--         jti stored in this table; /api/auth/me checks before accepting.
-- Affected: revoked_tokens
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS revoked_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_id VARCHAR(255) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_id ON revoked_tokens (token_id);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON revoked_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens (expires_at);

-- -----------------------------------------------------------
-- Migration: V0011
-- Date: 2026-08-25
-- Description:
-- Add CHECK constraint to sellers.status with canonical values.
--
-- Reason:
-- sellers.status previously had no constraint or an incorrect one.
-- Backend uses: pending, approved, rejected, suspended.
-- Normalize existing inconsistent data (active→approved, under_review→pending).
--
-- Affected:
-- sellers
-- ------------------------------------------------------------

UPDATE sellers SET status = 'approved' WHERE status = 'active';
UPDATE sellers SET status = 'pending' WHERE status = 'under_review';

ALTER TABLE sellers DROP CONSTRAINT IF EXISTS sellers_status_check;

ALTER TABLE sellers
  ADD CONSTRAINT sellers_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'suspended'));

------------------------------------------------------------
-- Migration: V0012
-- Date: 2026-08-25
-- Description:
-- Add unit and supplier columns to products.
--
-- Reason:
-- Product creation system requires unit and supplier fields.
--
-- Affected:
-- products
------------------------------------------------------------

ALTER TABLE products ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'ชิ้น';
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier TEXT;

CREATE INDEX IF NOT EXISTS idx_products_shop_status ON products (shop_id, status);

------------------------------------------------------------
-- Migration: V0013
-- Date: 2026-08-25
-- Description:
-- Create schema_migrations tracking table.
-- Absorb ensureAddressColumns() startup DDL.
--
-- Reason:
-- Backend was running ALTER TABLE at startup (schema drift).
-- Database changes must go through the migration system.
--
-- Affected:
-- schema_migrations (NEW)
-- addresses
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schema_migrations (
  id BIGSERIAL PRIMARY KEY,
  migration_name TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE addresses ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS subdistrict VARCHAR(100);
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS district VARCHAR(100);
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Mark previous migrations as applied
INSERT INTO schema_migrations (migration_name) VALUES
  ('001_initial'), ('002_auth'), ('003_customer'), ('004_seller'),
  ('005_center'), ('006_behavior'), ('007_profile_images'),
  ('008_upload_auth_fixes'), ('009_fix_auth_and_cover'),
  ('010_revoked_tokens'), ('011_seller_status_constraint'),
  ('012_product_fields')
ON CONFLICT (migration_name) DO NOTHING;

------------------------------------------------------------
-- Migration: V0014
-- Date: 2026-08-25
-- Description:
-- Repair: ensure products.unit and products.supplier exist.
-- V0012 was marked as applied by V0013 but never actually
-- applied to production Neon.
--
-- Reason:
-- Production error: column "unit" of relation "products"
-- does not exist (code: 42703).
--
-- Affected:\-- products (unit, supplier)
------------------------------------------------------------

ALTER TABLE products ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'ชิ้น';
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier TEXT;
CREATE INDEX IF NOT EXISTS idx_products_shop_status ON products (shop_id, status);

------------------------------------------------------------
-- Migration: V0015
-- Date: 2026-08-25
-- Description:
-- Change products.category_id from UUID FK to TEXT.
--
-- Reason:
-- Frontend sends simple category strings ("food", "daily", "beauty")
-- but category_id was UUID referencing categories(id).
-- Causes: invalid input syntax for type uuid: "food"
--
-- Affected:
-- products (category_id type change)
------------------------------------------------------------

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_id_fkey;
ALTER TABLE products ALTER COLUMN category_id TYPE TEXT;

------------------------------------------------------------
-- Migration: V0016
-- Date: 2026-08-25
-- Description:
-- Sync schema discrepancies between V0004 base tables and
-- the canonical schema.sql/run-sqleditor.sql.
--
-- Reason:
-- Several columns were added to schema.sql outside of the
-- migration system. These ALTERs use IF NOT EXISTS for safety.
--
-- Affected:
-- inventory, orders, order_items, notifications, addresses
------------------------------------------------------------

-- inventory: add reserved column (customer-reserved stock)
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS reserved INTEGER NOT NULL DEFAULT 0;

-- orders: add shipping_address JSONB snapshot column
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address JSONB;

-- orders: ensure total_amount has DEFAULT 0
ALTER TABLE orders ALTER COLUMN total_amount SET DEFAULT 0;

-- orders: remove restrictive CHECK constraint if it exists
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

-- order_items: add product_name column
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name TEXT NOT NULL DEFAULT '';

-- order_items: ensure quantity has DEFAULT 1
ALTER TABLE order_items ALTER COLUMN quantity SET DEFAULT 1;

-- notifications: add body and metadata columns
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- addresses: ensure all columns exist
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS subdistrict TEXT;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

------------------------------------------------------------
-- Migration: V0017
-- Date: 2026-08-25
-- Description:
-- Add rejection_reason column to products for the product moderation pipeline.
--
-- Reason:
-- When VelCenter rejects a product, the seller needs to see the rejection reason.
--
-- Affected:
-- products (rejection_reason)
------------------------------------------------------------

ALTER TABLE products ADD COLUMN IF NOT EXISTS rejection_reason TEXT;


------------------------------------------------------------
-- Migration: V0018
-- Date: 2026-08-25
-- Description:
-- Add platform_settings table for configurable product approval mode
-- and other platform-wide settings managed by VelCenter admins.
--
-- Reason:
-- Need a configurable auto/manual approval system for products.
--
-- Affected:
-- platform_settings (new table)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

INSERT INTO platform_settings (key, value, description)
VALUES ('product_approval_mode', 'manual', 'Product approval mode: manual or auto')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_platform_settings_key ON platform_settings (key);

-- =============================================================
-- Migration: V0019
-- Date: 2026-08-25
-- Description: Customer wishlist + subscriptions tables
-- Reason: Support marketplace shopping flow (wishlist, VelRepeat)
-- Affected: customer_wishlist, subscriptions
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

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1,
    interval_days INTEGER NOT NULL DEFAULT 30,
    next_order_date DATE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_next_due ON subscriptions (next_due_date) WHERE status = 'active';

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

CREATE TABLE IF NOT EXISTS customer_wishlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_wishlist_user ON customer_wishlist (user_id);
CREATE INDEX IF NOT EXISTS idx_customer_wishlist_product ON customer_wishlist (product_id);

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

-- =============================================================
-- Migration: V0021
-- Date: 2026-08-26
-- Description: Add variant_id to cart_items for product variant support
-- Reason: Backend cart.ts INSERT includes variant_id column but the
--         production cart_items table does not have this column.
--         PostgreSQL error: 42703 - column "variant_id" does not exist
-- Affected: cart_items
-- Safety: Uses IF NOT EXISTS — safe to run repeatedly
-- =============================================================

ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS variant_id UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'cart_items'::regclass
    AND conname = 'cart_items_cart_id_product_id_key'
    AND contype = 'u'
  ) THEN
    ALTER TABLE cart_items DROP CONSTRAINT cart_items_cart_id_product_id_key;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'cart_items'::regclass
    AND conname = 'cart_items_cart_product_variant_key'
    AND contype = 'u'
  ) THEN
    ALTER TABLE cart_items
      ADD CONSTRAINT cart_items_cart_product_variant_key
      UNIQUE (cart_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cart_items_variant ON cart_items (variant_id);

-- =============================================================
-- Migration: V0022
-- Date: 2026-08-26
-- Description: Create customer_wishlist table (migration file)
-- Reason: V0020 existed only as inline SQL but never as a migration
--         file in db/migrations/. The GitHub Action never applied it.
--         This caused: relation "customer_wishlist" does not exist
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

-- =============================================================
-- Migration: V0023
-- Date: 2026-08-26
-- Description: Stripe payment architecture — enhance orders, payments, and add payment_events
-- Reason: Need proper order lifecycle, Stripe checkout session tracking, webhook event dedup,
--         and snapshot data for order items (product name, image at time of purchase)
-- Affected: orders, order_items, payments, payment_events (NEW)
-- Safety: All ALTER TABLE use IF NOT EXISTS / safe defaults — safe to run repeatedly
-- =============================================================

-- ── orders: add order lifecycle columns ───────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount NUMERIC(12, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_orders_number_unique') THEN
    CREATE UNIQUE INDEX idx_orders_number_unique ON orders (order_number) WHERE order_number IS NOT NULL;
  END IF;
END $$;

-- ── order_items: add shop_id, variant_id, snapshot columns ───────────────
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_name_snapshot TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS image_url_snapshot TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_order_items_shop ON order_items (shop_id);

-- ── payments: add Stripe provider columns ─────────────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'cod';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_payment_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_checkout_session_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_payments_provider_session ON payments (provider_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_payment ON payments (provider_payment_id);

-- ── payment_events: webhook event dedup table ────────────────────────────
CREATE TABLE IF NOT EXISTS payment_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_provider ON payment_events (provider);
CREATE INDEX IF NOT EXISTS idx_payment_events_type ON payment_events (event_type);
CREATE INDEX IF NOT EXISTS idx_payment_events_processed ON payment_events (processed_at);

-- =============================================================
-- Migration: V0024
-- Date: 2026-08-26
-- Description: VelRepeat package/delivery system, product variants,
--              product vrepeat config, cart purchase_type, customer events,
--              and performance indexes.
-- Affected: vrepeat_packages (NEW), vrepeat_deliveries (NEW),
--           product_variants (NEW), customer_events (NEW),
--           products, cart_items, index additions
-- =============================================================

-- VelRepeat Packages
CREATE TABLE IF NOT EXISTS vrepeat_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  variant_id UUID,
  shop_id UUID NOT NULL REFERENCES shops(id),
  seller_id UUID NOT NULL REFERENCES sellers(id),
  package_type TEXT NOT NULL CHECK (package_type IN ('weekly', 'monthly', 'custom')),
  quantity_total INTEGER NOT NULL CHECK (quantity_total > 0),
  quantity_delivered INTEGER NOT NULL DEFAULT 0 CHECK (quantity_delivered >= 0),
  unit_price NUMERIC(12, 2) NOT NULL,
  regular_unit_price NUMERIC(12, 2) NOT NULL,
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'THB',
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'paid', 'active', 'paused', 'completed', 'cancelled', 'refunded')),
  interval_days INTEGER NOT NULL DEFAULT 7,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  payment_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_user ON vrepeat_packages (user_id);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_product ON vrepeat_packages (product_id);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_shop ON vrepeat_packages (shop_id);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_seller ON vrepeat_packages (seller_id);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_status ON vrepeat_packages (status);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_user_status ON vrepeat_packages (user_id, status);

-- VelRepeat Deliveries
CREATE TABLE IF NOT EXISTS vrepeat_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  package_id UUID NOT NULL REFERENCES vrepeat_packages(id) ON DELETE CASCADE,
  delivery_number INTEGER NOT NULL CHECK (delivery_number > 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  scheduled_at TIMESTAMPTZ NOT NULL,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'processing', 'shipped', 'delivered', 'failed', 'cancelled')),
  tracking_number TEXT,
  order_id UUID REFERENCES orders(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (package_id, delivery_number)
);

CREATE INDEX IF NOT EXISTS idx_vrepeat_deliveries_package ON vrepeat_deliveries (package_id);
CREATE INDEX IF NOT EXISTS idx_vrepeat_deliveries_status ON vrepeat_deliveries (status);
CREATE INDEX IF NOT EXISTS idx_vrepeat_deliveries_scheduled ON vrepeat_deliveries (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_vrepeat_deliveries_order ON vrepeat_deliveries (order_id);

-- Product Variants
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  price NUMERIC(12, 2) NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  options JSONB DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_status ON product_variants (product_id, status);

-- Products: VelRepeat config
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_weekly_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_monthly_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_weekly_price NUMERIC(12, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_monthly_price NUMERIC(12, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_weekly_qty INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_monthly_qty INTEGER;

-- Cart Items: purchase_type + package_config
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS purchase_type TEXT NOT NULL DEFAULT 'once'
  CHECK (purchase_type IN ('once', 'repeat'));
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS package_config JSONB;

-- Customer Events (behavioral tracking)
CREATE TABLE IF NOT EXISTS customer_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  product_id UUID,
  category_id TEXT,
  shop_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_events_user ON customer_events (user_id);
CREATE INDEX IF NOT EXISTS idx_customer_events_type ON customer_events (event_type);
CREATE INDEX IF NOT EXISTS idx_customer_events_product ON customer_events (product_id);
CREATE INDEX IF NOT EXISTS idx_customer_events_user_type ON customer_events (user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_customer_events_created ON customer_events (created_at);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_sellers_status ON sellers (status);
CREATE INDEX IF NOT EXISTS idx_carts_user ON carts (user_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product ON cart_items (product_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- V0025: Add VelRepeat configuration fields to products table
-- Date: 2026-08-26
-- Reason: velrepeat.ts backend route queries vrepeat_enabled, vrepeat_weekly_price,
--         vrepeat_monthly_price, etc. from products — but these columns never existed.
-- Safety: All ALTER TABLE use ADD COLUMN IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. VelRepeat fields on products ───────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_weekly_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_monthly_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_weekly_price NUMERIC(12, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_monthly_price NUMERIC(12, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_weekly_qty INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vrepeat_monthly_qty INTEGER;

-- ── 2. Index for VelRepeat product filtering ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_vrepeat ON products (vrepeat_enabled) WHERE vrepeat_enabled = TRUE;

-- ═══════════════════════════════════════════════════════════════════════════
-- V0026: Add product_reviews table + fix catalog images + order snapshots
-- Date: 2026-08-26
-- ═══════════════════════════════════════════════════════════════════════════

-- Migration tracking
INSERT INTO schema_migrations (migration_name) VALUES ('026_product_reviews_and_fixes') ON CONFLICT (migration_name) DO NOTHING;

-- Product Reviews
CREATE TABLE IF NOT EXISTS product_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id UUID REFERENCES shops(id),
  order_id UUID,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title TEXT,
  comment TEXT,
  images JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON product_reviews (product_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_user ON product_reviews (user_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_status ON product_reviews (product_id, status);

-- =============================================================
-- Migration: V0027
-- Date: 2026-08-26
-- Description: Dynamic product option groups, option values,
--              variant option mapping, and product attributes.
-- =============================================================

-- Product Option Groups
CREATE TABLE IF NOT EXISTS product_option_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_type TEXT NOT NULL DEFAULT 'text' CHECK (display_type IN ('text', 'color', 'image', 'button')),
  required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_option_groups_product ON product_option_groups (product_id);

-- Product Option Values
CREATE TABLE IF NOT EXISTS product_option_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  option_group_id UUID NOT NULL REFERENCES product_option_groups(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_option_values_group ON product_option_values (option_group_id);

-- Product Variant Option Values
CREATE TABLE IF NOT EXISTS product_variant_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  option_value_id UUID NOT NULL REFERENCES product_option_values(id) ON DELETE CASCADE,
  UNIQUE (variant_id, option_value_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_values_variant ON product_variant_values (variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_values_option_value ON product_variant_values (option_value_id);

-- Product Attributes
CREATE TABLE IF NOT EXISTS product_attributes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_attributes_product ON product_attributes (product_id);

-- ─── V0028: Create variant tables if missing ───────────────────────────────
-- Migration: 028_create_variant_tables_if_missing.sql
-- This is a safety migration for production databases missing V0024/V0027 tables.
-- All CREATE use IF NOT EXISTS — fully idempotent, never destructive.

CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  price NUMERIC(12, 2) NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  options JSONB DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_status ON product_variants (product_id, status);

CREATE TABLE IF NOT EXISTS product_option_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_type TEXT NOT NULL DEFAULT 'text' CHECK (display_type IN ('text', 'color', 'image', 'button')),
  required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_option_groups_product ON product_option_groups (product_id);

CREATE TABLE IF NOT EXISTS product_option_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  option_group_id UUID NOT NULL REFERENCES product_option_groups(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_option_values_group ON product_option_values (option_group_id);

CREATE TABLE IF NOT EXISTS product_variant_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  option_value_id UUID NOT NULL REFERENCES product_option_values(id) ON DELETE CASCADE,
  UNIQUE (variant_id, option_value_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_values_variant ON product_variant_values (variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_values_option_value ON product_variant_values (option_value_id);

CREATE TABLE IF NOT EXISTS product_attributes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_attributes_product ON product_attributes (product_id);

-- cart_items.variant_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cart_items' AND column_name = 'variant_id'
  ) THEN
    ALTER TABLE cart_items ADD COLUMN variant_id UUID;
  END IF;
END $$;

-- V0028 additional: customer_wishlist + product_reviews
CREATE TABLE IF NOT EXISTS customer_wishlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_wishlist_user ON customer_wishlist (user_id);
CREATE INDEX IF NOT EXISTS idx_customer_wishlist_product ON customer_wishlist (product_id);

CREATE TABLE IF NOT EXISTS product_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id UUID REFERENCES shops(id),
  order_id UUID,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title TEXT,
  comment TEXT,
  images JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON product_reviews (product_id);

------------------------------------------------------------
-- Migration: V0030
-- Date: 2026-08-30
-- Description:
-- Add image_type and variant_id columns to product_images
-- for typed image system (gallery/variant/detail).
--
-- Reason:
-- Product images need to be classified into three types:
-- gallery (product showcase), variant (option-specific),
-- and detail (infographic/spec). This migration adds
-- the columns needed for this classification.
--
-- Affected:
-- product_images
------------------------------------------------------------

ALTER TABLE product_images ADD COLUMN IF NOT EXISTS image_type TEXT NOT NULL DEFAULT 'gallery';
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_product_images_type ON product_images (product_id, image_type);
CREATE INDEX IF NOT EXISTS idx_product_images_variant ON product_images (variant_id) WHERE variant_id IS NOT NULL;

------------------------------------------------------------
-- Migration: V0031
-- Date: 2026-08-30
-- Description:
-- Add compare_at_price, discount_percent to product_variants,
-- create product_variant_images table, add reorder_level to inventory.
--
-- Reason:
-- Backend queries compare_at_price and discount_percent from
-- product_variants but they were never added via migration.
-- product_variant_images is queried by the backend but the
-- table was never created. inventory.reorder_level is used
-- in the seller UI but was never added to the schema.
--
-- Affected:
-- product_variants
-- product_variant_images (NEW)
-- inventory
------------------------------------------------------------

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(12,2);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2);

CREATE TABLE IF NOT EXISTS product_variant_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  storage_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_variant_images_variant ON product_variant_images (variant_id);

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS reorder_level INTEGER NOT NULL DEFAULT 0;

------------------------------------------------------------
-- Migration: V0031b
-- Date: 2026-08-30
-- Description:
-- Update product_variant_images to include product_id column
-- matching the backend's expected schema.
--
-- Reason:
-- The startup DDL in server.ts creates product_variant_images
-- with product_id. This migration ensures the migration file
-- matches that structure. Safe to re-run (IF NOT EXISTS).
--
-- Affected:
-- product_variant_images
------------------------------------------------------------

-- product_id column may already exist from V0031 or startup DDL
ALTER TABLE product_variant_images ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_variant_images_product ON product_variant_images (product_id);

------------------------------------------------------------
-- V0033: Add is_enabled flag to product_option_values
------------------------------------------------------------

ALTER TABLE product_option_values
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_option_values_enabled ON product_option_values (option_group_id, is_enabled);

------------------------------------------------------------
-- Migration: V0034 — Order Shipments & Tracking Events
-- Date: 2026-09-05
-- Description:
-- Adds shipments + tracking_events tables so orders can carry
-- real carrier/tracking data and the customer tracking timeline
-- can be rendered from actual data.
--
-- Reason:
-- Order Detail / Tracking pages had no data source for tracking;
-- sellers had no way to attach a shipment to an order.
--
-- Affected:
-- shipments (NEW), tracking_events (NEW)
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  carrier TEXT NOT NULL DEFAULT '',
  tracking_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  estimated_delivery_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments (order_id);

CREATE TABLE IF NOT EXISTS tracking_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'info',
  description TEXT,
  location TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment ON tracking_events (shipment_id, occurred_at);

-- ------------------------------------------------------------
-- Migration: V0036
-- Date: 2026-09-07
-- Description: Customer ↔ Seller chat (conversations + messages)
-- Reason: Velnox marketplace needs direct customer↔seller
--         messaging. Database is the source of truth; WebSocket
--         is only the realtime delivery mechanism.
-- Affected: conversations (NEW), chat_messages (NEW)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, shop_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations (customer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_seller ON conversations (seller_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_shop ON conversations (shop_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL DEFAULT 'customer' CHECK (sender_role IN ('customer', 'seller')),
  body TEXT NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 4000),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'read')),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_unread ON chat_messages (conversation_id, sender_id, read_at) WHERE read_at IS NULL;

-- =============================================================
-- Migration: V0037
-- Date: 2026-09-08
-- Description: orders.inventory_released — idempotent stock restoration
-- Reason: Stripe checkout expiry and payment failure webhooks do not
--         restore reserved inventory, leaking stock permanently.
--         The flag ensures release happens at most once per order.
-- =============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS inventory_released BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_orders_unreleased
  ON orders (id) WHERE inventory_released = FALSE;

-- =============================================================
-- Migration: V0038
-- Date: 2026-09-09
-- Description: product_reviews UNIQUE(product_id, user_id) + dedupe
-- Reason: the review create endpoint used SELECT→INSERT, so concurrent
--         double-submits could create duplicate reviews. The constraint
--         makes the race impossible; existing duplicates are removed
--         (newest kept) and rating/review_count are recomputed.
-- =============================================================

DELETE FROM product_reviews a
USING product_reviews b
WHERE a.product_id = b.product_id
  AND a.user_id = b.user_id
  AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id > b.id));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_product_reviews_product_user'
  ) THEN
    ALTER TABLE product_reviews
      ADD CONSTRAINT uq_product_reviews_product_user UNIQUE (product_id, user_id);
  END IF;
END $$;

UPDATE products p
SET rating = COALESCE(
      (SELECT AVG(rating)::numeric(3,2) FROM product_reviews r
       WHERE r.product_id = p.id AND r.status = 'approved'),
      p.rating),
    review_count = (SELECT COUNT(*) FROM product_reviews r
                    WHERE r.product_id = p.id AND r.status = 'approved')
WHERE p.id IN (SELECT DISTINCT product_id FROM product_reviews);

-- =============================================================
-- Migration: V0039
-- Date: 2026-09-09
-- Description: seller_goals table + users.department + employees columns
-- Reason: VelSeller Goals and VelCenter staff/users tabs called endpoints
--         with no backend support. Adds the seller_goals table (goals were
--         previously UI-only), users.department (company dept on the user
--         row), and employees.employee_id/permissions.
-- =============================================================

CREATE TABLE IF NOT EXISTS seller_goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  period TEXT NOT NULL DEFAULT 'monthly',
  unit TEXT NOT NULL DEFAULT 'ครั้ง',
  target_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  current_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  due_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_goals_seller ON seller_goals (seller_id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department TEXT;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employee_id TEXT;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]';
-- V0040: Scalable multilingual categories + dual verification systems
-- Phase 1: Enhanced categories
-- Phase 2: Seller verification tracking
-- Phase 3: Product verification tracking
-- Phase 4: Seed categories

-- ── Phase 1: Enhanced categories ────────────────────────────────────────────
-- Add multilingual names and metadata to categories
ALTER TABLE categories ADD COLUMN IF NOT EXISTS names JSONB DEFAULT '{}';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS description_names JSONB DEFAULT '{}';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── Phase 2: Seller verification tracking ───────────────────────────────────
-- Separate seller VERIFICATION from seller approval status
-- (sellers.status = approved means they can sell; verification is a trust badge)
CREATE TABLE IF NOT EXISTS seller_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified','pending','verified','rejected','suspended')),
  verification_type TEXT NOT NULL DEFAULT 'identity',
  evidence_urls JSONB DEFAULT '[]',
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id),
  rejection_reason TEXT,
  suspension_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_verifications_seller ON seller_verifications(seller_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_verifications_pending
  ON seller_verifications(seller_id) WHERE status = 'pending';

-- Add verification fields to sellers table
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified'
  CHECK (verification_status IN ('unverified','pending','verified','rejected','suspended'));
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- ── Phase 3: Product verification tracking ──────────────────────────────────
CREATE TABLE IF NOT EXISTS product_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified','pending','verified','rejected','suspended')),
  verification_type TEXT NOT NULL DEFAULT 'standard',
  evidence_urls JSONB DEFAULT '[]',
  evidence_notes TEXT,
  category_requirements JSONB DEFAULT '{}',
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id),
  rejection_reason TEXT,
  suspension_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_verifications_product ON product_verifications(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_verifications_pending
  ON product_verifications(product_id) WHERE status = 'pending';

-- Add verification field to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified'
  CHECK (verification_status IN ('unverified','pending','verified','rejected','suspended'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- ── Phase 4: Seed scalable categories ───────────────────────────────────────
-- Uses ON CONFLICT(slug) DO UPDATE for idempotent seeding

INSERT INTO categories (id, name, slug, icon, names, description, description_names, sort_order, is_active) VALUES

-- Level 0: Top-level categories
('a0000001-0000-0000-0000-000000000001', 'Food & Beverage', 'food-beverage', 'utensils-crossed',
  '{"th":"อาหารและเครื่องดื่ม","en":"Food & Beverage","my":"အစားအစာနှင့်ဖျော်ရည်"}',
  'Food, drinks, and culinary products',
  '{"th":"อาหาร เครื่องดื่ม และผลิตภัณฑ์อาหาร","en":"Food, drinks, and culinary products","my":"အစားအစာ၊ ဖျော်ရည်နှင့် အစားအစာထုတ်ကုန်များ"}',
  1, true),

('a0000001-0000-0000-0000-000000000002', 'Grocery & Household', 'grocery-household', 'shopping-basket',
  '{"th":"ของชำและของใช้ในครัวเรือน","en":"Grocery & Household","my":"အစားအစာနှင့်အိမ်သုံးပစ္စည်း"}',
  'Daily essentials, cleaning supplies, and household items',
  '{"th":"สิ่งจำเป็นประจำวัน ผลิตภัณฑ์ทำความสะอาด และของใช้ในบ้าน","en":"Daily essentials, cleaning supplies, and household items","my":"နေ့စဉ်လိုအပ်ချက်များ၊ သန့်ရှင်းရေးပစ္စည်းများနှင့် အိမ်သုံးပစ္စည်းများ"}',
  2, true),

('a0000001-0000-0000-0000-000000000003', 'Beauty & Personal Care', 'beauty-personal-care', 'sparkles',
  '{"th":"ความงามและการดูแลส่วนบุคคล","en":"Beauty & Personal Care","my":"အလှအပနှင့်ကိုယ်ရေးကိုယ်တာစောင့်ရှောက်မှု"}',
  'Skincare, makeup, haircare, and personal hygiene',
  '{"th":"ผลิตภัณฑ์ดูแลผิว แต่งหน้า ดูแลเส้นผม และสุขอนามัยส่วนบุคคล","en":"Skincare, makeup, haircare, and personal hygiene","my":"အသားအရေပြုစုခြင်း၊ မိတ်ကပ်၊ ဆံပင်ပြုစုခြင်းနှင့် ကိုယ်ရေးကိုယ်တာသန့်ရှင်းရေး"}',
  3, true),

('a0000001-0000-0000-0000-000000000004', 'Health & Wellness', 'health-wellness', 'heart-pulse',
  '{"th":"สุขภาพและความเป็นอยู่ที่ดี","en":"Health & Wellness","my":"ကျန်းမာရေးနှင့်ကောင်းကျိုး"}',
  'Supplements, vitamins, traditional remedies, and wellness products',
  '{"th":"อาหารเสริม วิตามิน สมุนไพร และผลิตภัณฑ์สุขภาพ","en":"Supplements, vitamins, traditional remedies, and wellness products","my":"ဖြည့်စွက်စားသောက်ကုန်၊ ဗိတာမင်၊ ရိုးရာဆေးနည်းများနှင့် ကျန်းမာရေးထုတ်ကုန်များ"}',
  4, true),

('a0000001-0000-0000-0000-000000000005', 'Fashion', 'fashion', 'shirt',
  '{"th":"แฟชั่น","en":"Fashion","my":"ဖက်ရှင်"}',
  'Clothing for men, women, and children',
  '{"th":"เสื้อผ้าสำหรับผู้ชาย ผู้หญิง และเด็ก","en":"Clothing for men, women, and children","my":"အမျိုးသား၊ အမျိုးသမီးနှင့် ကလေးများအတွက်အဝတ်အထည်"}',
  5, true),

('a0000001-0000-0000-0000-000000000006', 'Shoes & Bags', 'shoes-bags', 'footprints',
  '{"th":"รองเท้าและกระเป๋า","en":"Shoes & bags","my":"ဖိနပ်နှင့်အိတ်များ"}',
  'Footwear, handbags, backpacks, and travel bags',
  '{"th":"รองเท้า กระเป๋าถือ กระเป๋าเป้ และกระเป๋าเดินทาง","en":"Footwear, handbags, backpacks, and travel bags","my":"ဖိနပ်၊ လက်ကိုင်အိတ်၊ ပုခုံးကျောအိတ်နှင့် ခရီးဆောင်အိတ်များ"}',
  6, true),

('a0000001-0000-0000-0000-000000000007', 'Jewelry & Accessories', 'jewelry-accessories', 'gem',
  '{"th":"เครื่องประดับและแอคเซสเซอรี่","en":"Jewelry & accessories","my":"ရတနာနှင့်ဖက်ရှင်ပစ္စည်းများ"}',
  'Rings, necklaces, watches, and fashion accessories',
  '{"th":"แหวน สร้อยคอ นาฬิกา และเครื่องประดับแฟชั่น","en":"Rings, necklaces, watches, and fashion accessories","my":"လက်စွပ်၊ လည်ဆွဲ၊ နာရီနှင့် ဖက်ရှင်အဆင်တန်ဆာများ"}',
  7, true),

('a0000001-0000-0000-0000-000000000008', 'Electronics', 'electronics', 'cpu',
  '{"th":"อิเล็กทรอนิกส์","en":"Electronics","my":"အီလက်ထရွန်နစ်ပစ္စည်းများ"}',
  'Gadgets, audio, cameras, and electronic accessories',
  '{"th":" gadgets เสียง กล้อง และอุปกรณ์เสริมอิเล็กทรอนิกส์","en":"Gadgets, audio, cameras, and electronic accessories","my":"ဂက်ဂျက်၊ အသံ၊ ကင်မရာနှင့် အီလက်ထရွန်နစ်ဖြည့်စွက်ပစ္စည်းများ"}',
  8, true),

('a0000001-0000-0000-0000-000000000009', 'Phones & Accessories', 'phones-accessories', 'smartphone',
  '{"th":"โทรศัพท์มือถือและอุปกรณ์เสริม","en":"Phones & accessories","my":"ဖုန်းနှင့်ဖြည့်စွက်ပစ္စည်းများ"}',
  'Smartphones, cases, chargers, and phone accessories',
  '{"th":"สมาร์ทโฟน เคส ที่ชาร์จ และอุปกรณ์เสริมโทรศัพท์","en":"Smartphones, cases, chargers, and phone accessories","my":"စမတ်ဖုန်း၊ ဖုန်းအိတ်၊ အားသွင်းကိရိယာနှင့် ဖုန်းဖြည့်စွက်ပစ္စည်းများ"}',
  9, true),

('a0000001-0000-0000-0000-000000000010', 'Computers & Accessories', 'computers-accessories', 'monitor',
  '{"th":"คอมพิวเตอร์และอุปกรณ์เสริม","en":"Computers & accessories","my":"ကွန်ပျူတာနှင့်ဖြည့်စွက်ပစ္စည်းများ"}',
  'Laptops, desktops, peripherals, and computer accessories',
  '{"th":"แล็ปท็อป เดสก์ท็อป อุปกรณ์ต่อพ่วง และอุปกรณ์เสริมคอมพิวเตอร์","en":"Laptops, desktops, peripherals, and computer accessories","my":"လက်တော့ပ်၊ ဒက်စ်တော့၊ ပြင်ပကိရိယာများနှင့် ကွန်ပျူတာဖြည့်စွက်ပစ္စည်းများ"}',
  10, true),

('a0000001-0000-0000-0000-000000000011', 'Home Appliances', 'home-appliances', 'washing-machine',
  '{"th":"เครื่องใช้ไฟฟ้าภายในบ้าน","en":"Home appliances","my":"အိမ်သုံးလျှပ်စစ်ပစ္စည်းများ"}',
  'Kitchen appliances, washing machines, and home electronics',
  '{"th":"เครื่องใช้ไฟฟ้าในครัว เครื่องซักผ้า และอิเล็กทรอนิกส์ภายในบ้าน","en":"Kitchen appliances, washing machines, and home electronics","my":"မီးဖိုချောင်သုံးပစ္စည်း၊ အဝတ်လျှော်စက်နှင့် အိမ်သုံးအီလက်ထရွန်နစ်ပစ္စည်းများ"}',
  11, true),

('a0000001-0000-0000-0000-000000000012', 'Home & Living', 'home-living', 'home',
  '{"th":"บ้านและไลฟ์สไตล์","en":"Home & living","my":"အိမ်နှင့်နေထိုင်မှု"}',
  'Furnishings, decor, bedding, and home essentials',
  '{"th":"เครื่องเรือน การตกแต่ง ผ้าปูที่นอน และสิ่งจำเป็นในบ้าน","en":"Furnishings, decor, bedding, and home essentials","my":"အိမ်ဆောက်ပစ္စည်း၊ အလှဆင်ပစ္စည်း၊ အိပ်ရာခင်းနှင့် အိမ်လိုအပ်ချက်များ"}',
  12, true),

('a0000001-0000-0000-0000-000000000013', 'Furniture', 'furniture', 'armchair',
  '{"th":"เฟอร์นิเจอร์","en":"Furniture","my":"ဖာနီကျားပစ္စည်းများ"}',
  'Sofas, tables, chairs, beds, and storage furniture',
  '{"th":"โซฟา โต๊ะ เก้าอี้ เตียง และเฟอร์นิเจอร์จัดเก็บ","en":"Sofas, tables, chairs, beds, and storage furniture","my":"ဆိုဖာ၊ စားပွဲ၊ ကုလားထိုင်၊ အိပ်ရာနှင့် သိုလှောင်ဖာနီကျားပစ္စည်းများ"}',
  13, true),

('a0000001-0000-0000-0000-000000000014', 'Garden & Outdoor', 'garden-outdoor', 'flower-2',
  '{"th":"สวนและกลางแจ้ง","en":"Garden & outdoor","my":"ဥယျာဉ်နှင့်ပြင်ပ"}',
  'Gardening tools, outdoor furniture, and plants',
  '{"th":"เครื่องมือทำสวน เฟอร์นิเจอร์กลางแจ้ง และต้นไม้","en":"Gardening tools, outdoor furniture, and plants","my":"ဥယျာဉ်ကိရိယာများ၊ ပြင်ပဖာနီကျားပစ္စည်းများနှင့် အပင်များ"}',
  14, true),

('a0000001-0000-0000-0000-000000000015', 'Baby & Kids', 'baby-kids', 'baby',
  '{"th":"ทารกและเด็ก","en":"Baby & kids","my":"ကလေးနှင့်မွေးကင်းစပစ္စည်းများ"}',
  'Baby gear, children clothing, toys, and nursery essentials',
  '{"th":"อุปกรณ์ทารก เสื้อผ้าเด็ก ของเล่น และสิ่งจำเป็นสำหรับทารก","en":"Baby gear, children clothing, toys, and nursery essentials","my":"ကလေးသုံးပစ္စည်း၊ ကလေးအဝတ်အထည်၊ ကစားကွင်းနှင့် မွေးကင်းစလိုအပ်ချက်များ"}',
  15, true),

('a0000001-0000-0000-0000-000000000016', 'Toys & Games', 'toys-games', 'gamepad-2',
  '{"th":"ของเล่นและเกม","en":"Toys & games","my":"ကစားကွင်းနှင့်ဂိမ်းများ"}',
  'Board games, action figures, puzzles, and electronic games',
  '{"th":"เกมกระดาน ตัวละคร จิ๊กซอว์ และเกมอิเล็กทรอนิกส์","en":"Board games, action figures, puzzles, and electronic games","my":"ဘုတ်ဂိမ်း၊ ဇာတ်ကောင်ပုံများ၊ ဂျီဂျာဂိမ်းနှင့် အီလက်ထရွန်နစ်ဂိမ်းများ"}',
  16, true),

('a0000001-0000-0000-0000-000000000017', 'Pets', 'pets', 'paw-print',
  '{"th":"สัตว์เลี้ยง","en":"Pets","my":"အိမ်မွေးတိရစ္ဆာန်"}',
  'Pet food, accessories, grooming, and pet care',
  '{"th":"อาหารสัตว์เลี้ยง อุปกรณ์ ผลิตภัณฑ์ดูแลขน และการดูแลสัตว์เลี้ยง","en":"Pet food, accessories, grooming, and pet care","my":"အိမ်မွေးတိရစ္ဆာန်အစားအစာ၊ ဖြည့်စွက်ပစ္စည်းများ၊ ဆံပင်ပြုစုခြင်းနှင့် တိရစ္ဆာန်စောင့်ရှောက်မှု"}',
  17, true),

('a0000001-0000-0000-0000-000000000018', 'Sports & Outdoors', 'sports-outdoors', 'dumbbell',
  '{"th":"กีฬาและกลางแจ้ง","en":"Sports & outdoors","my":"အားကစားနှင့်ပြင်ပ"}',
  'Fitness equipment, outdoor gear, and sportswear',
  '{"th":"อุปกรณ์ออกกำลังกาย อุปกรณ์กลางแจ้ง และชุดกีฬา","en":"Fitness equipment, outdoor gear, and sportswear","my":"ကိရိယာများ၊ ပြင်ပပစ္စည်းများနှင့် အားကစားဝတ်စုံများ"}',
  18, true),

('a0000001-0000-0000-0000-000000000019', 'Automotive', 'automotive', 'car',
  '{"th":"ยานยนต์","en":"Automotive","my":"ကားနှင့်ဆက်စပ်ပစ္စည်းများ"}',
  'Car accessories, parts, and automotive supplies',
  '{"th":"อุปกรณ์เสริมรถยนต์ อะไหล่ และผลิตภัณฑ์ยานยนต์","en":"Car accessories, parts, and automotive supplies","my":"ကားဖြည့်စွက်ပစ္စည်းများ၊ အစိတ်အပိုင်းများနှင့် ကားဆက်စပ်ပစ္စည်းများ"}',
  19, true),

('a0000001-0000-0000-0000-000000000020', 'Tools & Hardware', 'tools-hardware', 'wrench',
  '{"th":"เครื่องมือและฮาร์ดแวร์","en":"Tools & hardware","my":"ကိရိယာများနှင့် hardware"}',
  'Power tools, hand tools, and building hardware',
  '{"th":"เครื่องมือไฟฟ้า เครื่องมือมือ และฮาร์ดแวร์ก่อสร้าง","en":"Power tools, hand tools, and building hardware","my":"လျှပ်စစ်ကိရိယာများ၊ လက်ကိရိယာများနှင့် ဆောက်လုပ်ရေး hardware"}',
  20, true),

('a0000001-0000-0000-0000-000000000021', 'Stationery & Office', 'stationery-office', 'pen-tool',
  '{"th":"เครื่องเขียนและสำนักงาน","en":"Stationery & office","my":"ရုံးသုံးပစ္စည်းများ"}',
  'Office supplies, notebooks, pens, and desk accessories',
  '{"th":"อุปกรณ์สำนักงาน สมุด ปากกา และอุปกรณ์บนโต๊ะทำงาน","en":"Office supplies, notebooks, pens, and desk accessories","my":"ရုံးသုံးပစ္စည်း၊ မှတ်စုစာအုပ်၊ ဘောပင်နှင့် စားပွဲပေါ်ဖြည့်စွက်ပစ္စည်းများ"}',
  21, true),

('a0000001-0000-0000-0000-000000000022', 'Business Equipment', 'business-equipment', 'briefcase',
  '{"th":"อุปกรณ์ธุรกิจ","en":"Business equipment","my":"စီးပွားရေးကိရိယာများ"}',
  'Printers, POS systems, and commercial equipment',
  '{"th":"เครื่องพิมพ์ ระบบ POS และอุปกรณ์เชิงพาณิชย์","en":"Printers, POS systems, and commercial equipment","my":"ပရင်တာ၊ POS စနစ်နှင့် ကုန်သွယ်ရေးကိရိယာများ"}',
  22, true),

('a0000001-0000-0000-0000-000000000023', 'Packaging', 'packaging', 'package',
  '{"th":"บรรจุภัณฑ์","en":"Packaging","my":"ထုပ်ပိုးပစ္စည်းများ"}',
  'Boxes, bags, wraps, and shipping supplies',
  '{"th":"กล่อง ถุง ห่อ และอุปกรณ์จัดส่ง","en":"Boxes, bags, wraps, and shipping supplies","my":"ဘူးအိတ်၊ အိတ်၊ ထုပ်ပိုးပစ္စည်းနှင့် ပို့ဆောင်ရေးပစ္စည်းများ"}',
  23, true),

('a0000001-0000-0000-0000-000000000024', 'Books & Media', 'books-media', 'book-open',
  '{"th":"หนังสือและสื่อ","en":"Books & media","my":"စာအုပ်နှင့်မီဒီယာ"}',
  'Books, magazines, music, movies, and digital media',
  '{"th":"หนังสือ นิตยสาร ดนตรี ภาพยนตร์ และสื่อดิจิทัล","en":"Books, magazines, music, movies, and digital media","my":"စာအုပ်၊ မဂ္ဂဇင်း၊ တေးဂီတ၊ ရုပ်ရှင်နှင့် ဒီဇိုင်းမီဒီယာ"}',
  24, true),

('a0000001-0000-0000-0000-000000000025', 'Hobbies & Collectibles', 'hobbies-collectibles', 'stamp',
  '{"th":"งานอดิเรกและของสะสม","en":"Hobbies & collectibles","my":"အပန်းဖြေနှင့်စုဆောင်းပစ္စည်းများ"}',
  'Collectibles, crafts,模型, and hobby supplies',
  '{"th":"ของสะสม งานฝีมือ โมเดล และอุปกรณ์งานอดิเรก","en":"Collectibles, crafts, models, and hobby supplies","my":"စုဆောင်းပစ္စည်း၊ လက်မှုပညာ၊ မော်ဒယ်နှင့် အပန်းဖြေပစ္စည်းများ"}',
  25, true),

('a0000001-0000-0000-0000-000000000026', 'Agriculture', 'agriculture', 'sprout',
  '{"th":"เกษตรกรรม","en":"Agriculture","my":"စိုက်ပျိုးရေး"}',
  'Seeds, fertilizers, farming tools, and agricultural products',
  '{"th":"เมล็ดพันธุ์ ปุ๋ย เครื่องมือทำไร่ และผลิตภัณฑ์เกษตร","en":"Seeds, fertilizers, farming tools, and agricultural products","my":"မျိုးစေ့၊ ဓာတ်မြေဩဇာ၊ စိုက်ပျိုးကိရိယာများနှင့် စိုက်ပျိုးထုတ်ကုန်များ"}',
  26, true),

('a0000001-0000-0000-0000-000000000027', 'Local Products', 'local-products', 'map-pin',
  '{"th":"สินค้าท้องถิ่น","en":"Local products","my":"ဒေသထုတ်ကုန်များ"}',
  'OTOP, local specialties, and regional products',
  '{"th":"สินค้า OTOP ของดีประจำถิ่น และสินค้าภูมิภาค","en":"OTOP, local specialties, and regional products","my":"OTOP၊ ဒေသထုတ်ကုန်နှင့် ဒေသအလိုက်ထုတ်ကုန်များ"}',
  27, true),

('a0000001-0000-0000-0000-000000000028', 'Services', 'services', 'headphones',
  '{"th":"บริการ","en":"Services","my":"ဝန်ဆောင်မှုများ"}',
  'Digital services, subscriptions, and professional services',
  '{"th":"บริการดิจิทัล การสมัครสมาชิก และบริการระดับมืออาชีพ","en":"Digital services, subscriptions, and professional services","my":"ဒီဂျစ်တယ်ဝန်ဆောင်မှု၊ အသင်းဝင်မှုနှင့် ပညာရှင်ဝန်ဆောင်မှုများ"}',
  28, true),

('a0000001-0000-0000-0000-000000000029', 'Other', 'other', 'package',
  '{"th":"อื่น ๆ","en":"Other","my":"အခြား"}',
  'Miscellaneous products that do not fit other categories',
  '{"th":"สินค้าอื่น ๆ ที่ไม่จัดอยู่ในหมวดหมู่อื่น","en":"Miscellaneous products that do not fit other categories","my":"အခြားအမျိုးအစားများတွင်မပါဝင်သော ထုတ်ကုန်များ"}',
  29, true)

ON CONFLICT (slug) DO UPDATE SET
  names = EXCLUDED.names,
  description = EXCLUDED.description,
  description_names = EXCLUDED.description_names,
  icon = EXCLUDED.icon,
  image_url = EXCLUDED.image_url,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

-- ── Phase 4b: Seed subcategories ───────────────────────────────────────────

-- Food & Beverage subcategories
INSERT INTO categories (id, name, slug, parent_id, names, sort_order, is_active) VALUES
('b0000001-0001-0000-0000-000000000001', 'Coffee', 'coffee', 'a0000001-0000-0000-0000-000000000001',
  '{"th":"กาแฟ","en":"Coffee","my":"ကော်ဖီ"}', 1, true),
('b0000001-0001-0000-0000-000000000002', 'Tea', 'tea', 'a0000001-0000-0000-0000-000000000001',
  '{"th":"ชา","en":"Tea","my":"လက်ဖက်ရည်"}', 2, true),
('b0000001-0001-0000-0000-000000000003', 'Snacks', 'snacks', 'a0000001-0000-0000-0000-000000000001',
  '{"th":"ขนมขบเคี้ยว","en":"Snacks","my":"မုန့်စား"}', 3, true),
('b0000001-0001-0000-0000-000000000004', 'Beverages', 'beverages', 'a0000001-0000-0000-0000-000000000001',
  '{"th":"เครื่องดื่ม","en":"Beverages","my":"ဖျော်ရည်"}', 4, true),
('b0000001-0001-0000-0000-000000000005', 'Cooking Ingredients', 'cooking-ingredients', 'a0000001-0000-0000-0000-000000000001',
  '{"th":"วัตถุดิบปรุงอาหาร","en":"Cooking Ingredients","my":"ချက်ပြုတ်ပစ္စည်းများ"}', 5, true),

-- Beauty subcategories
('b0000001-0002-0000-0000-000000000001', 'Skincare', 'skincare', 'a0000001-0000-0000-0000-000000000003',
  '{"th":"ดูแลผิว","en":"Skincare","my":"အသားအရေပြုစုခြင်း"}', 1, true),
('b0000001-0002-0000-0000-000000000002', 'Makeup', 'makeup', 'a0000001-0000-0000-0000-000000000003',
  '{"th":"เครื่องสำอาง","en":"Makeup","my":"မိတ်ကပ်"}', 2, true),
('b0000001-0002-0000-0000-000000000003', 'Haircare', 'haircare', 'a0000001-0000-0000-0000-000000000003',
  '{"th":"ดูแลเส้นผม","en":"Haircare","my":"ဆံပင်ပြုစုခြင်း"}', 3, true),

-- Electronics subcategories
('b0000001-0008-0000-0000-000000000001', 'Audio', 'audio-electronics', 'a0000001-0000-0000-0000-000000000008',
  '{"th":"เสียง","en":"Audio","my":"အသံ"}', 1, true),
('b0000001-0008-0000-0000-000000000002', 'Cameras', 'cameras', 'a0000001-0000-0000-0000-000000000008',
  '{"th":"กล้อง","en":"Cameras","my":"ကင်မရာများ"}', 2, true),

-- Fashion subcategories
('b0000001-0005-0000-0000-000000000001', 'Men\'s Clothing', 'mens-clothing', 'a0000001-0000-0000-0000-000000000005',
  '{"th":"เสื้อผ้าผู้ชาย","en":"Men\'s clothing","my":"အမျိုးသားအဝတ်အထည်"}', 1, true),
('b0000001-0005-0000-0000-000000000002', 'Women\'s Clothing', 'womens-clothing', 'a0000001-0000-0000-0000-000000000005',
  '{"th":"เสื้อผ้าผู้หญิง","en":"Women\'s clothing","my":"အမျိုးသမီးအဝတ်အထည်"}', 2, true),
('b0000001-0005-0000-0000-000000000003', 'Children\'s Clothing', 'childrens-clothing', 'a0000001-0000-0000-0000-000000000005',
  '{"th":"เสื้อผ้าเด็ก","en":"Children\'s clothing","my":"ကလေးအဝတ်အထည်"}', 3, true),

-- Phones subcategories
('b0000001-0009-0000-0000-000000000001', 'Smartphones', 'smartphones', 'a0000001-0000-0000-0000-000000000009',
  '{"th":"สมาร์ทโฟน","en":"Smartphones","my":"စမတ်ဖုန်းများ"}', 1, true),
('b0000001-0009-0000-0000-000000000002', 'Cases & Covers', 'cases-covers', 'a0000001-0000-0000-0000-000000000009',
  '{"th":"เคสและฝาครอบ","en":"Cases & covers","my":"ဖုန်းအိတ်များ"}', 2, true),
('b0000001-0009-0000-0000-000000000003', 'Chargers & Cables', 'chargers-cables', 'a0000001-0000-0000-0000-000000000009',
  '{"th":"ที่ชาร์จและสายไฟ","en":"Chargers & cables","my":"အားသွင်းကိရိယာနှင့်ကြိုးများ"}', 3, true)

ON CONFLICT (slug) DO UPDATE SET
  names = EXCLUDED.names,
  parent_id = EXCLUDED.parent_id,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();
