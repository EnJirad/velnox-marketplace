-- =============================================================
-- Velnox — Paste this entire file into Neon SQL Editor
-- Creates the complete database schema
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- SHARED DOMAIN
CREATE TABLE IF NOT EXISTS media (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), url TEXT NOT NULL, key TEXT NOT NULL UNIQUE, content_type TEXT NOT NULL, size INTEGER NOT NULL, uploaded_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS categories (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, icon TEXT, parent_id UUID REFERENCES categories(id) ON DELETE SET NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS system_settings (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), key TEXT NOT NULL UNIQUE, value JSONB NOT NULL, description TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

-- CUSTOMER DOMAIN
CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, avatar TEXT, phone TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS user_auth_identities (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, provider_id TEXT NOT NULL, email TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(provider, provider_id), UNIQUE(user_id, provider));
CREATE TABLE IF NOT EXISTS customer_profiles (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, preferences JSONB DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS addresses (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, label TEXT NOT NULL DEFAULT 'Home', full_name TEXT NOT NULL, phone TEXT NOT NULL, line1 TEXT NOT NULL, line2 TEXT, city TEXT NOT NULL, state TEXT NOT NULL, postal_code TEXT NOT NULL, country TEXT NOT NULL DEFAULT 'TH', is_default BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS carts (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS cart_items (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE, product_id UUID NOT NULL, quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0), price NUMERIC(12, 2) NOT NULL, added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(cart_id, product_id));
CREATE TABLE IF NOT EXISTS orders (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID NOT NULL REFERENCES users(id), shop_id UUID NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')), total_amount NUMERIC(12, 2) NOT NULL, currency TEXT NOT NULL DEFAULT 'THB', shipping_address_id UUID REFERENCES addresses(id), notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS order_items (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id UUID NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0), price NUMERIC(12, 2) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS notifications (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, read BOOLEAN NOT NULL DEFAULT FALSE, data JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS behavioral_events (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID, session_id TEXT NOT NULL, event_type TEXT NOT NULL, entity_type TEXT, entity_id UUID, metadata JSONB DEFAULT '{}', occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

-- SELLER DOMAIN
CREATE TABLE IF NOT EXISTS sellers (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS shops (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT, logo TEXT, cover TEXT, rating NUMERIC(3, 2), product_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS products (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', short_description TEXT, price NUMERIC(12, 2) NOT NULL, compare_at_price NUMERIC(12, 2), currency TEXT NOT NULL DEFAULT 'THB', status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')), featured BOOLEAN NOT NULL DEFAULT FALSE, rating NUMERIC(3, 2), review_count INTEGER NOT NULL DEFAULT 0, sold_count INTEGER NOT NULL DEFAULT 0, category_id UUID REFERENCES categories(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS product_images (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE, url TEXT NOT NULL, alt TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS inventory (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), product_id UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE, quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0), low_stock_threshold INTEGER NOT NULL DEFAULT 5, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS seller_settings (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), seller_id UUID NOT NULL UNIQUE REFERENCES sellers(id) ON DELETE CASCADE, settings JSONB DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS seller_analytics (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE, date DATE NOT NULL, views INTEGER NOT NULL DEFAULT 0, orders INTEGER NOT NULL DEFAULT 0, revenue NUMERIC(12, 2) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(seller_id, date));

-- CENTER DOMAIN
CREATE TABLE IF NOT EXISTS departments (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name TEXT NOT NULL, description TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS employees (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, department_id UUID REFERENCES departments(id) ON DELETE SET NULL, role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'manager', 'staff')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS company_settings (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), key TEXT NOT NULL UNIQUE, value JSONB NOT NULL, description TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS platform_settings (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), key TEXT NOT NULL UNIQUE, value JSONB NOT NULL, description TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS audit_logs (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id UUID, details JSONB DEFAULT '{}', ip_address TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS moderation_records (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), moderator_id UUID REFERENCES users(id) ON DELETE SET NULL, entity_type TEXT NOT NULL, entity_id UUID NOT NULL, action TEXT NOT NULL, reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_auth_identities_provider ON user_auth_identities(provider, provider_id);
CREATE INDEX IF NOT EXISTS idx_auth_identities_email ON user_auth_identities(email);
CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products(shop_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured) WHERE featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_shops_slug ON shops(slug);
CREATE INDEX IF NOT EXISTS idx_shops_seller_id ON shops(seller_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_shop_id ON orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_addresses_user_id ON addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read) WHERE read = FALSE;
CREATE INDEX IF NOT EXISTS idx_behavioral_events_user_id ON behavioral_events(user_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_events_session ON behavioral_events(session_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_events_type ON behavioral_events(event_type);
CREATE INDEX IF NOT EXISTS idx_behavioral_events_entity ON behavioral_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_events_occurred ON behavioral_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_seller_analytics_seller_date ON seller_analytics(seller_id, date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_media_key ON media(key);
