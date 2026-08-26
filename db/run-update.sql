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
