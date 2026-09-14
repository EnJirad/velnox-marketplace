CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  avatar TEXT,
  cover_url TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'customer',
  status TEXT NOT NULL DEFAULT 'active',
  department TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE TABLE IF NOT EXISTS auth_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_id)
);
CREATE INDEX IF NOT EXISTS idx_auth_identities_provider ON auth_identities (provider, provider_id);
CREATE INDEX IF NOT EXISTS idx_auth_identities_email ON auth_identities (email);
CREATE TABLE IF NOT EXISTS customer_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  date_of_birth DATE,
  gender TEXT,
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Home',
  recipient_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  line1 TEXT NOT NULL,
  line2 TEXT,
  subdistrict TEXT,
  district TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'TH',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses (user_id);
CREATE TABLE IF NOT EXISTS carts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  total_items INTEGER NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  url TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_key ON media (key);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_media_owner_key ON media (uploaded_by, key);
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT,
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  names JSONB DEFAULT '{}',
  description TEXT,
  description_names JSONB DEFAULT '{}',
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories (slug);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent_active ON categories (parent_id, is_active);
CREATE TABLE IF NOT EXISTS sellers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending','verified','rejected','suspended')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sellers_user ON sellers (user_id);
CREATE TABLE IF NOT EXISTS seller_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','pending','verified','rejected','suspended')),
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
CREATE INDEX IF NOT EXISTS idx_seller_verifications_seller ON seller_verifications (seller_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_verifications_pending ON seller_verifications (seller_id) WHERE status = 'pending';
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
  address_line1 TEXT,
  address_line2 TEXT,
  subdistrict TEXT,
  district TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT NOT NULL DEFAULT 'TH',
  phone TEXT,
  email TEXT,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shops_slug ON shops (slug);
CREATE INDEX IF NOT EXISTS idx_shops_seller ON shops (seller_id);
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
  unit TEXT NOT NULL DEFAULT 'ชิ้น',
  supplier TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  rejection_reason TEXT,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  rating NUMERIC(3, 2),
  review_count INTEGER NOT NULL DEFAULT 0,
  sold_count INTEGER NOT NULL DEFAULT 0,
  category_id TEXT,
  vrepeat_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  vrepeat_weekly_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  vrepeat_monthly_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  vrepeat_weekly_price NUMERIC(12, 2),
  vrepeat_monthly_price NUMERIC(12, 2),
  vrepeat_weekly_qty INTEGER,
  vrepeat_monthly_qty INTEGER,
  vrepeat_min_qty INTEGER,
  vrepeat_max_qty INTEGER,
  featured_variant_id UUID,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending','verified','rejected','suspended')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_shop ON products (shop_id);
CREATE INDEX IF NOT EXISTS idx_products_shop_status ON products (shop_id, status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products (status);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products (featured) WHERE featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_slug ON products (slug);
CREATE INDEX IF NOT EXISTS idx_products_price ON products (price);
CREATE INDEX IF NOT EXISTS idx_products_vrepeat ON products (vrepeat_enabled) WHERE vrepeat_enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_verification ON products (verification_status);
CREATE INDEX IF NOT EXISTS idx_products_featured_variant ON products (featured_variant_id) WHERE featured_variant_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  price NUMERIC(12, 2) NOT NULL,
  compare_at_price NUMERIC(12, 2),
  discount_percent NUMERIC(5, 2),
  stock INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  options JSONB DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_status ON product_variants (product_id, status);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_featured_variant_id_fkey') THEN ALTER TABLE products ADD CONSTRAINT products_featured_variant_id_fkey FOREIGN KEY (featured_variant_id) REFERENCES product_variants(id) ON DELETE SET NULL; END IF; END $$;
CREATE TABLE IF NOT EXISTS cart_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(12, 2) NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items (cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_variant ON cart_items (variant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_items_unique ON cart_items (cart_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  image_type TEXT NOT NULL DEFAULT 'gallery',
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images (product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_type ON product_images (product_id, image_type);
CREATE INDEX IF NOT EXISTS idx_product_images_variant ON product_images (variant_id) WHERE variant_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS product_variant_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt TEXT DEFAULT '',
  storage_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_variant_images_variant ON product_variant_images (variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_images_product ON product_variant_images (product_id);
CREATE TABLE IF NOT EXISTS product_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','pending','verified','rejected','suspended')),
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
CREATE INDEX IF NOT EXISTS idx_product_verifications_product ON product_verifications (product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_verifications_pending ON product_verifications (product_id) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 0,
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
  UNIQUE (seller_id, date)
);
CREATE INDEX IF NOT EXISTS idx_seller_analytics_seller_date ON seller_analytics (seller_id, date);
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
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  shop_id UUID REFERENCES shops(id),
  order_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  shipping_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'THB',
  shipping_address_id UUID REFERENCES addresses(id),
  shipping_address JSONB,
  notes TEXT,
  inventory_released BOOLEAN NOT NULL DEFAULT FALSE,
  velrepeat_run_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_number_unique ON orders (order_number) WHERE order_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_unreleased ON orders (id) WHERE inventory_released = FALSE;
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_shop ON orders (shop_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE TABLE IF NOT EXISTS checkout_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, request_key)
);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_order ON checkout_requests (order_id);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_user ON checkout_requests (user_id);
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  shop_id UUID REFERENCES shops(id),
  variant_id UUID REFERENCES product_variants(id),
  product_name_snapshot TEXT NOT NULL DEFAULT '',
  variant_name_snapshot TEXT,
  image_url_snapshot TEXT,
  product_name TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(12, 2) NOT NULL,
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_shop ON order_items (shop_id);
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
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id),
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'THB',
  method TEXT NOT NULL DEFAULT 'cod',
  status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT NOT NULL DEFAULT 'cod',
  provider_payment_id TEXT,
  provider_checkout_session_id TEXT,
  paid_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_session ON payments (provider_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_payment ON payments (provider_payment_id);
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
CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id),
  payment_id UUID REFERENCES payments(id),
  amount NUMERIC(12, 2) NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS commissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id),
  seller_id UUID NOT NULL REFERENCES sellers(id),
  amount NUMERIC(12, 2) NOT NULL,
  rate NUMERIC(5, 4) NOT NULL DEFAULT 0.05,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID NOT NULL REFERENCES sellers(id),
  amount NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  product_id UUID REFERENCES products(id),
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
  employee_id TEXT,
  permissions JSONB NOT NULL DEFAULT '[]',
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
CREATE TABLE IF NOT EXISTS system_settings (
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
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at);
CREATE TABLE IF NOT EXISTS moderation_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  moderator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  body TEXT,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  data JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications (user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (user_id, read) WHERE read = FALSE;
CREATE TABLE IF NOT EXISTS customer_wishlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_wishlist_user ON customer_wishlist (user_id);
CREATE INDEX IF NOT EXISTS idx_customer_wishlist_product ON customer_wishlist (product_id);
CREATE TABLE IF NOT EXISTS behavioral_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_behavioral_user ON behavioral_events (user_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_session ON behavioral_events (session_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_type ON behavioral_events (event_type);
CREATE INDEX IF NOT EXISTS idx_behavioral_entity ON behavioral_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_time ON behavioral_events (occurred_at);
CREATE TABLE IF NOT EXISTS customer_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  product_id UUID REFERENCES products(id),
  category_id TEXT,
  shop_id UUID REFERENCES shops(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_events_user ON customer_events (user_id);
CREATE INDEX IF NOT EXISTS idx_customer_events_type ON customer_events (event_type);
CREATE INDEX IF NOT EXISTS idx_customer_events_product ON customer_events (product_id);
CREATE INDEX IF NOT EXISTS idx_customer_events_user_type ON customer_events (user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_customer_events_created ON customer_events (created_at);
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_platform_settings_key ON platform_settings (key);
CREATE TABLE IF NOT EXISTS schema_migrations (
  id BIGSERIAL PRIMARY KEY,
  migration_name TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS revoked_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_id ON revoked_tokens (token_id);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON revoked_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens (expires_at);
CREATE TABLE IF NOT EXISTS vrepeat_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  variant_id UUID REFERENCES product_variants(id),
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
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'paid', 'active', 'paused', 'completed', 'cancelled', 'refunded')),
  interval_days INTEGER NOT NULL DEFAULT 7,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  payment_id UUID REFERENCES payments(id),
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
CREATE TABLE IF NOT EXISTS vrepeat_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  package_id UUID NOT NULL REFERENCES vrepeat_packages(id) ON DELETE CASCADE,
  delivery_number INTEGER NOT NULL CHECK (delivery_number > 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  scheduled_at TIMESTAMPTZ NOT NULL,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'shipped', 'delivered', 'failed', 'cancelled')),
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
CREATE TABLE IF NOT EXISTS product_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id UUID REFERENCES shops(id),
  order_id UUID REFERENCES orders(id),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title TEXT,
  comment TEXT,
  images JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON product_reviews (product_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_user ON product_reviews (user_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_status ON product_reviews (product_id, status);
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
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_option_values_group ON product_option_values (option_group_id);
CREATE TABLE IF NOT EXISTS option_value_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  option_value_id UUID NOT NULL REFERENCES product_option_values(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_option_value_images_value ON option_value_images (option_value_id);
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
CREATE TABLE IF NOT EXISTS velrepeat_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'processing', 'payment_failed', 'out_of_stock', 'item_unavailable', 'price_changed', 'cancelled', 'completed')),
  frequency_type TEXT NOT NULL CHECK (frequency_type IN ('days', 'weeks', 'months')),
  interval_value INTEGER NOT NULL DEFAULT 30 CHECK (interval_value > 0),
  next_run_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  shipping_address_id UUID REFERENCES addresses(id) ON DELETE SET NULL,
  shipping_address JSONB,
  payment_method TEXT NOT NULL DEFAULT 'cod',
  payment_method_ref TEXT,
  currency TEXT NOT NULL DEFAULT 'THB',
  timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_velrepeat_plans_user ON velrepeat_plans (user_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_plans_user_status ON velrepeat_plans (user_id, status);
CREATE INDEX IF NOT EXISTS idx_velrepeat_plans_due ON velrepeat_plans (status, next_run_at) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS velrepeat_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES velrepeat_plans(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'THB',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_velrepeat_items_plan ON velrepeat_items (plan_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_items_product ON velrepeat_items (product_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_items_variant ON velrepeat_items (variant_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_items_shop ON velrepeat_items (shop_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_items_unique_variant ON velrepeat_items (plan_id, product_id, variant_id) WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_items_unique_no_variant ON velrepeat_items (plan_id, product_id) WHERE variant_id IS NULL;
CREATE TABLE IF NOT EXISTS velrepeat_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES velrepeat_plans(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'success', 'payment_failed', 'out_of_stock', 'item_unavailable', 'price_changed', 'failed', 'cancelled')),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  error_code TEXT,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, scheduled_for)
);
CREATE INDEX IF NOT EXISTS idx_velrepeat_runs_plan ON velrepeat_runs (plan_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_runs_status ON velrepeat_runs (status);
CREATE INDEX IF NOT EXISTS idx_velrepeat_runs_scheduled ON velrepeat_runs (scheduled_for);
CREATE INDEX IF NOT EXISTS idx_velrepeat_runs_order ON velrepeat_runs (order_id) WHERE order_id IS NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_velrepeat_run_id_fkey') THEN ALTER TABLE orders ADD CONSTRAINT orders_velrepeat_run_id_fkey FOREIGN KEY (velrepeat_run_id) REFERENCES velrepeat_runs(id) ON DELETE SET NULL; END IF; END $$;
CREATE INDEX IF NOT EXISTS idx_orders_velrepeat_run ON orders (velrepeat_run_id) WHERE velrepeat_run_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS velrepeat_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES velrepeat_plans(id) ON DELETE CASCADE,
  run_id UUID REFERENCES velrepeat_runs(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_velrepeat_events_plan ON velrepeat_events (plan_id, created_at);
CREATE INDEX IF NOT EXISTS idx_velrepeat_events_type ON velrepeat_events (event_type);
CREATE INDEX IF NOT EXISTS idx_velrepeat_events_run ON velrepeat_events (run_id) WHERE run_id IS NOT NULL;
INSERT INTO platform_settings (key, value, description) VALUES ('product_approval_mode', 'manual', 'Product approval mode: manual or auto') ON CONFLICT (key) DO NOTHING;
INSERT INTO categories (id, name, slug, icon, parent_id, sort_order, names, description, description_names, image_url, is_active) VALUES
('c0000001-0000-0000-0000-000000000001', 'Electronics', 'electronics', 'cpu', NULL, 1, '{"th":"อิเล็กทรอนิกส์","en":"Electronics","my":"အီလက်ထရွန်နစ်ပစ္စည်းများ"}', 'Audio, cameras, wearable tech and electronic accessories', '{"th":"อุปกรณ์เสียง กล้อง อุปกรณ์สวมใส่ และอุปกรณ์เสริมอิเล็กทรอนิกส์","en":"Audio, cameras, wearable tech and electronic accessories","my":"အသံပစ္စည်း၊ ကင်မရာ၊ ဝတ်ဆင်နည်းပညာနှင့်အီလက်ထရွန်နစ် ဖြည့်စွက်ပစ္စည်းများ"}', NULL, true),
('c0000001-0000-0000-0000-000000000002', 'Computers & Accessories', 'computers-accessories', 'monitor', NULL, 2, '{"th":"คอมพิวเตอร์และอุปกรณ์เสริม","en":"Computers & Accessories","my":"ကွန်ပျူတာနှင့်ဖြည့်စွက်ပစ္စည်းများ"}', 'Laptops, desktops, monitors and computer peripherals', '{"th":"แล็ปท็อป เดสก์ท็อป จอภาพ และอุปกรณ์ต่อพ่วงคอมพิวเตอร์","en":"Laptops, desktops, monitors and computer peripherals","my":"လက်တော့ပ်၊ ဒက်စ်တော့၊ မော်နီတာနှင့်ကွန်ပျူတာ ပြင်ပကိရိယာများ"}', NULL, true),
('c0000001-0000-0000-0000-000000000003', 'Mobile & Accessories', 'mobile-accessories', 'smartphone', NULL, 3, '{"th":"มือถือและอุปกรณ์เสริม","en":"Mobile & Accessories","my":"မိုဘိုင်းနှင့်ဖြည့်စွက်ပစ္စည်းများ"}', 'Mobile phones, tablets and accessories', '{"th":"โทรศัพท์มือถือ แท็บเล็ต และอุปกรณ์เสริม","en":"Mobile phones, tablets and accessories","my":"မိုဘိုင်းဖုန်း၊ တက်ဘလက်နှင့် ဖြည့်စွက်ပစ္စည်းများ"}', NULL, true),
('c0000001-0000-0000-0000-000000000004', 'Home Appliances', 'home-appliances', 'washing-machine', NULL, 4, '{"th":"เครื่องใช้ไฟฟ้าภายในบ้าน","en":"Home Appliances","my":"အိမ်သုံးလျှပ်စစ်ပစ္စည်းများ"}', 'Refrigerators, washing machines, air conditioners and home appliances', '{"th":"ตู้เย็น เครื่องซักผ้า เครื่องปรับอากาศ และเครื่องใช้ไฟฟ้าภายในบ้าน","en":"Refrigerators, washing machines, air conditioners and home appliances","my":"ရေခဲသေတ္တာ၊ အဝတ်လျှော်စက်၊ လေအေးပေးစက်နှင့် အိမ်သုံးလျှပ်စစ်ပစ္စည်းများ"}', NULL, true),
('c0000001-0000-0000-0000-000000000005', 'Home & Furniture', 'home-furniture', 'sofa', NULL, 5, '{"th":"บ้านและเฟอร์นิเจอร์","en":"Home & Furniture","my":"အိမ်နှင့်ဖာနီကျားပစ္စည်းများ"}', 'Furniture, decor, storage and home essentials', '{"th":"เฟอร์นิเจอร์ ของตกแต่ง ที่เก็บของ และของจำเป็นในบ้าน","en":"Furniture, decor, storage and home essentials","my":"ဖာနီကျား၊ အလှဆင်ပစ္စည်း၊ သိုလှောင်ပစ္စည်းနှင့် အိမ်လိုအပ်ချက်များ"}', NULL, true),
('c0000001-0000-0000-0000-000000000006', 'Kitchen & Cooking', 'kitchen-cooking', 'cooking-pot', NULL, 6, '{"th":"ครัวและเครื่องครัว","en":"Kitchen & Cooking","my":"မီးဖိုချောင်နှင့်ချက်ပြုတ်ပစ္စည်းများ"}', 'Cookware, kitchen tools, tableware and food storage', '{"th":"เครื่องครัว อุปกรณ์ครัว จานชาม และที่เก็บอาหาร","en":"Cookware, kitchen tools, tableware and food storage","my":"ချက်ပြုတ်အိုး၊ မီးဖိုချောင်သုံးကိရိယာ၊ စားပွဲတင်ပစ္စည်းနှင့် အစားအစာသိုလှောင်ပစ္စည်း"}', NULL, true),
('c0000001-0000-0000-0000-000000000007', 'Fashion & Clothing', 'fashion-clothing', 'shirt', NULL, 7, '{"th":"แฟชั่นและเครื่องแต่งกาย","en":"Fashion & Clothing","my":"ဖက်ရှင်နှင့်အဝတ်အထည်"}', 'Men, women and kids fashion, shoes, bags and jewelry', '{"th":"แฟชั่นชาย หญิง เด็ก รองเท้า กระเป๋า และเครื่องประดับ","en":"Men, women and kids fashion, shoes, bags and jewelry","my":"အမျိုးသား၊ အမျိုးသမီး၊ ကလေးဖက်ရှင်၊ ဖိနပ်၊ အိတ် နှင့် ရတနာပစ္စည်းများ"}', NULL, true),
('c0000001-0000-0000-0000-000000000008', 'Beauty & Personal Care', 'beauty-personal-care', 'sparkles', NULL, 8, '{"th":"ความงามและการดูแลส่วนบุคคล","en":"Beauty & Personal Care","my":"အလှအပနှင့်ကိုယ်ရေးကိုယ်တာစောင့်ရှောက်မှု"}', 'Skincare, makeup, hair care, fragrance and personal care', '{"th":"ดูแลผิว เครื่องสำอาง ดูแลเส้นผม น้ำหอม และการดูแลส่วนบุคคล","en":"Skincare, makeup, hair care, fragrance and personal care","my":"အသားအရေပြုစုခြင်း၊ မိတ်ကပ်၊ ဆံပင်ပြုစုခြင်း၊ ရေမွှေးနှင့် ကိုယ်ရေးကိုယ်တာစောင့်ရှောက်မှု"}', NULL, true),
('c0000001-0000-0000-0000-000000000009', 'Health & Wellness', 'health-wellness', 'heart-pulse', NULL, 9, '{"th":"สุขภาพและความเป็นอยู่ที่ดี","en":"Health & Wellness","my":"ကျန်းမာရေးနှင့်ကောင်းကျိုး"}', 'Health devices, first aid, wellness and personal health', '{"th":"อุปกรณ์สุขภาพ ปฐมพยาบาล และผลิตภัณฑ์เพื่อสุขภาพ","en":"Health devices, first aid, wellness and personal health","my":"ကျန်းမာရေးကိရိယာ၊ ရှေးဦးသူနာပြုစုခြင်းနှင့် ကျန်းမာရေးထုတ်ကုန်များ"}', NULL, true),
('c0000001-0000-0000-0000-000000000010', 'Food & Beverage', 'food-beverage', 'utensils-crossed', NULL, 10, '{"th":"อาหารและเครื่องดื่ม","en":"Food & Beverage","my":"အစားအစာနှင့်ဖျော်ရည်"}', 'Snacks, beverages, dry food and cooking ingredients', '{"th":"ขนม เครื่องดื่ม อาหารแห้ง และวัตถุดิบปรุงอาหาร","en":"Snacks, beverages, dry food and cooking ingredients","my":"မုန့်များ၊ ဖျော်ရည်၊ အခြောက်အစားအစာနှင့် ချက်ပြုတ်ပစ္စည်းများ"}', NULL, true),
('c0000001-0000-0000-0000-000000000011', 'Mother & Baby', 'mother-baby', 'baby', NULL, 11, '{"th":"แม่และเด็ก","en":"Mother & Baby","my":"မိခင်နှင့်ကလေး"}', 'Baby clothing, diapers, feeding, strollers and baby care', '{"th":"เสื้อผ้าเด็ก ผ้าอ้อม อุปกรณ์ให้นม รถเข็น และการดูแลทารก","en":"Baby clothing, diapers, feeding, strollers and baby care","my":"ကလေးအဝတ်အထည်၊ ဒိုင်ပါ၊ နို့တိုက်ပစ္စည်း၊ တွန်းလှည်းနှင့် ကလေးပြုစုခြင်း"}', NULL, true),
('c0000001-0000-0000-0000-000000000012', 'Sports & Outdoor', 'sports-outdoor', 'dumbbell', NULL, 12, '{"th":"กีฬาและกิจกรรมกลางแจ้ง","en":"Sports & Outdoor","my":"အားကစားနှင့်ပြင်ပ"}', 'Fitness, running, cycling, camping and outdoor recreation', '{"th":"ฟิตเนส วิ่ง ปั่นจักรยาน แคมป์ปิ้ง และกิจกรรมกลางแจ้ง","en":"Fitness, running, cycling, camping and outdoor recreation","my":"ကြံ့ခိုင်မှု၊ ပြေးခြင်း၊ စက်ဘီးစီးခြင်း၊ စခန်းချခြင်းနှင့် ပြင်ပအပန်းဖြေခြင်း"}', NULL, true),
('c0000001-0000-0000-0000-000000000013', 'Automotive & Motorcycle', 'automotive-motorcycle', 'car', NULL, 13, '{"th":"ยานยนต์และมอเตอร์ไซค์","en":"Automotive & Motorcycle","my":"ကားနှင့်ဆိုင်ကယ်ဖြည့်စွက်ပစ္စည်းများ"}', 'Car and motorcycle accessories, parts, tires and car care', '{"th":"อุปกรณ์เสริมรถยนต์ มอเตอร์ไซค์ อะไหล่ ยาง และการดูแลรถ","en":"Car and motorcycle accessories, parts, tires and car care","my":"ကားနှင့် ဆိုင်ကယ်ဖြည့်စွက်ပစ္စည်း၊ အစိတ်အပိုင်း၊ တာယာနှင့် ကားပြုစုခြင်း"}', NULL, true),
('c0000001-0000-0000-0000-000000000014', 'Pet Supplies', 'pet-supplies', 'paw-print', NULL, 14, '{"th":"อุปกรณ์สำหรับสัตว์เลี้ยง","en":"Pet Supplies","my":"အိမ်မွေးတိရစ္ဆာန်ပစ္စည်းများ"}', 'Food, toys and care products for pets', '{"th":"อาหาร ของเล่น และผลิตภัณฑ์ดูแลสัตว์เลี้ยง","en":"Food, toys and care products for pets","my":"အိမ်မွေးတိရစ္ဆာန်အစားအစာ၊ ကစားကွင်းနှင့် ပြုစုစောင့်ရှောက်ရေးပစ္စည်းများ"}', NULL, true),
('c0000001-0000-0000-0000-000000000015', 'Lifestyle, Hobbies & Others', 'lifestyle-hobbies', 'palette', NULL, 15, '{"th":"ไลฟ์สไตล์ งานอดิเรก และอื่น ๆ","en":"Lifestyle, Hobbies & Others","my":"နေထိုင်မှုပုံစံ၊ အပန်းဖြေနှင့်အခြား"}', 'Books, toys, crafts, music, collectibles, travel and other products', '{"th":"หนังสือ ของเล่น งานฝีมือ ดนตรี ของสะสม ท่องเที่ยว และสินค้าอื่น ๆ","en":"Books, toys, crafts, music, collectibles, travel and other products","my":"စာအုပ်၊ ကစားကွင်း၊ လက်မှုပညာ၊ တေးဂီတ၊ စုဆောင်းပစ္စည်းများ၊ ခရီးသွားခြင်းနှင့် အခြားထုတ်ကုန်များ"}', NULL, true)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, parent_id = EXCLUDED.parent_id, sort_order = EXCLUDED.sort_order, names = EXCLUDED.names, description = EXCLUDED.description, description_names = EXCLUDED.description_names, image_url = EXCLUDED.image_url, is_active = EXCLUDED.is_active, updated_at = NOW();
INSERT INTO categories (id, name, slug, icon, parent_id, sort_order, names, description, description_names, image_url, is_active) VALUES
('c1000001-0000-0000-0000-000000000001', 'Headphones & Speakers', 'headphones-speakers', 'headphones', 'c0000001-0000-0000-0000-000000000001', 1, '{"th":"หูฟังและลำโพง","en":"Headphones & Speakers","my":"နားကြပ်နှင့်စပီကာ"}', 'Headphones, earphones and speakers', '{"th":"หูฟัง หูฟังอินเอียร์ และลำโพง","en":"Headphones, earphones and speakers","my":"နားကြပ်၊ နားကြပ်ငယ်နှင့် စပီကာများ"}', NULL, true),
('c1000001-0000-0000-0000-000000000002', 'Cameras & Accessories', 'cameras-accessories', 'camera', 'c0000001-0000-0000-0000-000000000001', 2, '{"th":"กล้องและอุปกรณ์เสริม","en":"Cameras & Accessories","my":"ကင်မရာနှင့်ဖြည့်စွက်ပစ္စည်းများ"}', 'Cameras, lenses and accessories', '{"th":"กล้อง เลนส์ และอุปกรณ์เสริม","en":"Cameras, lenses and accessories","my":"ကင်မရာ၊ မှန်ဘီလူးနှင့် ဖြည့်စွက်ပစ္စည်းများ"}', NULL, true),
('c1000001-0000-0000-0000-000000000003', 'Smart Watches', 'smart-watches', 'watch', 'c0000001-0000-0000-0000-000000000001', 3, '{"th":"สมาร์ทวอทช์","en":"Smart Watches","my":"စမတ်နာရီများ"}', 'Smart watches and wearables', '{"th":"สมาร์ทวอทช์และอุปกรณ์สวมใส่","en":"Smart watches and wearables","my":"စမတ်နာရီနှင့် ဝတ်ဆင်နိုင်သော ကိရိယာများ"}', NULL, true),
('c1000001-0000-0000-0000-000000000004', 'Other Electronics', 'other-electronics', 'plug', 'c0000001-0000-0000-0000-000000000001', 4, '{"th":"อิเล็กทรอนิกส์อื่น ๆ","en":"Other Electronics","my":"အခြားအီလက်ထရွန်နစ်ပစ္စည်းများ"}', 'Other electronic devices', '{"th":"อุปกรณ์อิเล็กทรอนิกส์อื่น ๆ","en":"Other electronic devices","my":"အခြားအီလက်ထရွန်နစ်ပစ္စည်းများ"}', NULL, true),
('c1000002-0000-0000-0000-000000000001', 'Laptops', 'laptops', 'laptop', 'c0000001-0000-0000-0000-000000000002', 1, '{"th":"แล็ปท็อป","en":"Laptops","my":"လက်တော့ပ်များ"}', 'Laptops and notebooks', '{"th":"แล็ปท็อปและโน้ตบุ๊ก","en":"Laptops and notebooks","my":"လက်တော့ပ်နှင့် မှတ်စုစာအုပ်များ"}', NULL, true),
('c1000002-0000-0000-0000-000000000002', 'Desktop Computers', 'desktop-computers', 'monitor', 'c0000001-0000-0000-0000-000000000002', 2, '{"th":"คอมพิวเตอร์ตั้งโต๊ะ","en":"Desktop Computers","my":"ဒက်စ်တော့ကွန်ပျူတာများ"}', 'Desktop computers', '{"th":"คอมพิวเตอร์ตั้งโต๊ะ","en":"Desktop computers","my":"ဒက်စ်တော့ကွန်ပျူတာများ"}', NULL, true),
('c1000002-0000-0000-0000-000000000003', 'Monitors', 'monitors', 'monitor', 'c0000001-0000-0000-0000-000000000002', 3, '{"th":"จอภาพ","en":"Monitors","my":"မော်နီတာများ"}', 'Monitors and displays', '{"th":"จอภาพและหน้าจอ","en":"Monitors and displays","my":"မော်နီတာနှင့် ဖန်သားပြင်များ"}', NULL, true),
('c1000002-0000-0000-0000-000000000004', 'Keyboards & Mice', 'keyboards-mice', 'keyboard', 'c0000001-0000-0000-0000-000000000002', 4, '{"th":"คีย์บอร์ดและเมาส์","en":"Keyboards & Mice","my":"ကီးဘုတ်နှင့်မောက်စ်များ"}', 'Keyboards and mice', '{"th":"คีย์บอร์ดและเมาส์","en":"Keyboards and mice","my":"ကီးဘုတ်နှင့် မောက်စ်များ"}', NULL, true),
('c1000002-0000-0000-0000-000000000005', 'Storage', 'storage', 'hard-drive', 'c0000001-0000-0000-0000-000000000002', 5, '{"th":"อุปกรณ์จัดเก็บข้อมูล","en":"Storage","my":"သိုလှောင်ပစ္စည်းများ"}', 'Storage devices', '{"th":"อุปกรณ์จัดเก็บข้อมูล","en":"Storage devices","my":"သိုလှောင်ကိရိယာများ"}', NULL, true),
('c1000002-0000-0000-0000-000000000006', 'Computer Accessories', 'computer-accessories', 'mouse', 'c0000001-0000-0000-0000-000000000002', 6, '{"th":"อุปกรณ์เสริมคอมพิวเตอร์","en":"Computer Accessories","my":"ကွန်ပျူတာဖြည့်စွက်ပစ္စည်းများ"}', 'Computer accessories', '{"th":"อุปกรณ์เสริมคอมพิวเตอร์","en":"Computer accessories","my":"ကွန်ပျူတာဖြည့်စွက်ပစ္စည်းများ"}', NULL, true),
('c1000003-0000-0000-0000-000000000001', 'Mobile Phones', 'mobile-phones', 'smartphone', 'c0000001-0000-0000-0000-000000000003', 1, '{"th":"โทรศัพท์มือถือ","en":"Mobile Phones","my":"မိုဘိုင်းဖုန်းများ"}', 'Mobile phones', '{"th":"โทรศัพท์มือถือ","en":"Mobile phones","my":"မိုဘိုင်းဖုန်းများ"}', NULL, true),
('c1000003-0000-0000-0000-000000000002', 'Tablets', 'tablets', 'tablet', 'c0000001-0000-0000-0000-000000000003', 2, '{"th":"แท็บเล็ต","en":"Tablets","my":"တက်ဘလက်များ"}', 'Tablets', '{"th":"แท็บเล็ต","en":"Tablets","my":"တက်ဘလက်များ"}', NULL, true),
('c1000003-0000-0000-0000-000000000003', 'Phone Cases', 'phone-cases', 'smartphone', 'c0000001-0000-0000-0000-000000000003', 3, '{"th":"เคสโทรศัพท์","en":"Phone Cases","my":"ဖုန်းအိတ်များ"}', 'Phone cases and covers', '{"th":"เคสและฝาครอบโทรศัพท์","en":"Phone cases and covers","my":"ဖုန်းအိတ်နှင့် ဖုံးများ"}', NULL, true),
('c1000003-0000-0000-0000-000000000004', 'Screen Protectors', 'screen-protectors', 'shield', 'c0000001-0000-0000-0000-000000000003', 4, '{"th":"ฟิล์มกันรอย","en":"Screen Protectors","my":"ဖန်သားကာပစ္စည်းများ"}', 'Screen protectors', '{"th":"ฟิล์มกันรอย","en":"Screen protectors","my":"ဖန်သားကာပစ္စည်းများ"}', NULL, true),
('c1000003-0000-0000-0000-000000000005', 'Chargers & Cables', 'chargers-cables', 'plug', 'c0000001-0000-0000-0000-000000000003', 5, '{"th":"ที่ชาร์จและสายชาร์จ","en":"Chargers & Cables","my":"အားသွင်းကိရိယာနှင့်ကြိုးများ"}', 'Chargers and cables', '{"th":"ที่ชาร์จและสายชาร์จ","en":"Chargers and cables","my":"အားသွင်းကိရိယာနှင့် ကြိုးများ"}', NULL, true),
('c1000003-0000-0000-0000-000000000006', 'Power Banks', 'power-banks', 'battery-charging', 'c0000001-0000-0000-0000-000000000003', 6, '{"th":"พาวเวอร์แบงค์","en":"Power Banks","my":"ပါဝါဘန့်များ"}', 'Power banks', '{"th":"พาวเวอร์แบงค์","en":"Power banks","my":"ပါဝါဘန့်များ"}', NULL, true),
('c1000004-0000-0000-0000-000000000001', 'Refrigerators', 'refrigerators', 'refrigerator', 'c0000001-0000-0000-0000-000000000004', 1, '{"th":"ตู้เย็น","en":"Refrigerators","my":"ရေခဲသေတ္တာများ"}', 'Refrigerators', '{"th":"ตู้เย็น","en":"Refrigerators","my":"ရေခဲသေတ္တာများ"}', NULL, true),
('c1000004-0000-0000-0000-000000000002', 'Washing Machines', 'washing-machines', 'washing-machine', 'c0000001-0000-0000-0000-000000000004', 2, '{"th":"เครื่องซักผ้า","en":"Washing Machines","my":"အဝတ်လျှော်စက်များ"}', 'Washing machines', '{"th":"เครื่องซักผ้า","en":"Washing machines","my":"အဝတ်လျှော်စက်များ"}', NULL, true),
('c1000004-0000-0000-0000-000000000003', 'Air Conditioners', 'air-conditioners', 'wind', 'c0000001-0000-0000-0000-000000000004', 3, '{"th":"เครื่องปรับอากาศ","en":"Air Conditioners","my":"လေအေးပေးစက်များ"}', 'Air conditioners', '{"th":"เครื่องปรับอากาศ","en":"Air conditioners","my":"လေအေးပေးစက်များ"}', NULL, true),
('c1000004-0000-0000-0000-000000000004', 'Fans', 'fans', 'fan', 'c0000001-0000-0000-0000-000000000004', 4, '{"th":"พัดลม","en":"Fans","my":"ပန်ကာများ"}', 'Fans', '{"th":"พัดลม","en":"Fans","my":"ပန်ကာများ"}', NULL, true),
('c1000004-0000-0000-0000-000000000005', 'Vacuum Cleaners', 'vacuum-cleaners', 'vacuum', 'c0000001-0000-0000-0000-000000000004', 5, '{"th":"เครื่องดูดฝุ่น","en":"Vacuum Cleaners","my":"ဖုန်စုပ်စက်များ"}', 'Vacuum cleaners', '{"th":"เครื่องดูดฝุ่น","en":"Vacuum cleaners","my":"ဖုန်စုပ်စက်များ"}', NULL, true),
('c1000005-0000-0000-0000-000000000001', 'Furniture', 'furniture', 'armchair', 'c0000001-0000-0000-0000-000000000005', 1, '{"th":"เฟอร์นิเจอร์","en":"Furniture","my":"ဖာနီကျားပစ္စည်းများ"}', 'Furniture', '{"th":"เฟอร์นิเจอร์","en":"Furniture","my":"ဖာနီကျားပစ္စည်းများ"}', NULL, true),
('c1000005-0000-0000-0000-000000000002', 'Home Decor', 'home-decor', 'lamp', 'c0000001-0000-0000-0000-000000000005', 2, '{"th":"ของตกแต่งบ้าน","en":"Home Decor","my":"အိမ်အလှဆင်ပစ္စည်းများ"}', 'Home decor', '{"th":"ของตกแต่งบ้าน","en":"Home decor","my":"အိမ်အလှဆင်ပစ္စည်းများ"}', NULL, true),
('c1000005-0000-0000-0000-000000000003', 'Storage & Organization', 'storage-organization', 'package', 'c0000001-0000-0000-0000-000000000005', 3, '{"th":"ที่เก็บของและจัดระเบียบ","en":"Storage & Organization","my":"သိုလှောင်နှင့်စီမံပစ္စည်းများ"}', 'Storage and organization', '{"th":"ที่เก็บของและจัดระเบียบ","en":"Storage and organization","my":"သိုလှောင်နှင့် စီမံပစ္စည်းများ"}', NULL, true),
('c1000005-0000-0000-0000-000000000004', 'Bathroom', 'bathroom', 'bath', 'c0000001-0000-0000-0000-000000000005', 4, '{"th":"ห้องน้ำ","en":"Bathroom","my":"ရေချိုးခန်း"}', 'Bathroom essentials', '{"th":"อุปกรณ์ห้องน้ำ","en":"Bathroom essentials","my":"ရေချိုးခန်း လိုအပ်ချက်များ"}', NULL, true),
('c1000005-0000-0000-0000-000000000005', 'Bedding', 'bedding', 'bed', 'c0000001-0000-0000-0000-000000000005', 5, '{"th":"เครื่องนอน","en":"Bedding","my":"အိပ်ရာခင်းများ"}', 'Bedding and linens', '{"th":"เครื่องนอนและผ้าปู","en":"Bedding and linens","my":"အိပ်ရာခင်းနှင့် အိပ်ရာပစ္စည်းများ"}', NULL, true),
('c1000006-0000-0000-0000-000000000001', 'Cookware', 'cookware', 'cooking-pot', 'c0000001-0000-0000-0000-000000000006', 1, '{"th":"เครื่องครัว","en":"Cookware","my":"ချက်ပြုတ်အိုးများ"}', 'Cookware and pots', '{"th":"เครื่องครัวและหม้อ","en":"Cookware and pots","my":"ချက်ပြုတ်အိုးနှင့် ဒယ်အိုးများ"}', NULL, true),
('c1000006-0000-0000-0000-000000000002', 'Kitchen Tools', 'kitchen-tools', 'utensils', 'c0000001-0000-0000-0000-000000000006', 2, '{"th":"อุปกรณ์ครัว","en":"Kitchen Tools","my":"မီးဖိုချောင်သုံးကိရိယာများ"}', 'Kitchen tools and utensils', '{"th":"อุปกรณ์ครัวและเครื่องใช้","en":"Kitchen tools and utensils","my":"မီးဖိုချောင်သုံး ကိရိယာများ"}', NULL, true),
('c1000006-0000-0000-0000-000000000003', 'Kitchen Appliances', 'kitchen-appliances', 'microwave', 'c0000001-0000-0000-0000-000000000006', 3, '{"th":"เครื่องใช้ไฟฟ้าในครัว","en":"Kitchen Appliances","my":"မီးဖိုချောင်လျှပ်စစ်ပစ္စည်းများ"}', 'Kitchen appliances', '{"th":"เครื่องใช้ไฟฟ้าในครัว","en":"Kitchen appliances","my":"မီးဖိုချောင် လျှပ်စစ်ပစ္စည်းများ"}', NULL, true),
('c1000006-0000-0000-0000-000000000004', 'Tableware', 'tableware', 'utensils-crossed', 'c0000001-0000-0000-0000-000000000006', 4, '{"th":"จานชามและอุปกรณ์บนโต๊ะอาหาร","en":"Tableware","my":"စားပွဲတင်ပစ္စည်းများ"}', 'Tableware and dinnerware', '{"th":"จานชามและอุปกรณ์บนโต๊ะอาหาร","en":"Tableware and dinnerware","my":"စားပွဲတင် ပန်းကန်ခွက်ယောက်"}', NULL, true),
('c1000006-0000-0000-0000-000000000005', 'Food Storage', 'food-storage', 'package', 'c0000001-0000-0000-0000-000000000006', 5, '{"th":"ที่เก็บอาหาร","en":"Food Storage","my":"အစားအစာသိုလှောင်ပစ္စည်းများ"}', 'Food storage containers', '{"th":"ภาชนะเก็บอาหาร","en":"Food storage containers","my":"အစားအစာ သိုလှောင်ဘူးများ"}', NULL, true),
('c1000007-0000-0000-0000-000000000001', 'Men''s Clothing', 'mens-clothing', 'shirt', 'c0000001-0000-0000-0000-000000000007', 1, '{"th":"เสื้อผ้าผู้ชาย","en":"Men''s Clothing","my":"အမျိုးသားအဝတ်အထည်"}', 'Men''s clothing', '{"th":"เสื้อผ้าผู้ชาย","en":"Men''s clothing","my":"အမျိုးသားအဝတ်အထည်"}', NULL, true),
('c1000007-0000-0000-0000-000000000002', 'Women''s Clothing', 'womens-clothing', 'shirt', 'c0000001-0000-0000-0000-000000000007', 2, '{"th":"เสื้อผ้าผู้หญิง","en":"Women''s Clothing","my":"အမျိုးသမီးအဝတ်အထည်"}', 'Women''s clothing', '{"th":"เสื้อผ้าผู้หญิง","en":"Women''s clothing","my":"အမျိုးသမီးအဝတ်အထည်"}', NULL, true),
('c1000007-0000-0000-0000-000000000003', 'Kids'' Clothing', 'kids-clothing', 'shirt', 'c0000001-0000-0000-0000-000000000007', 3, '{"th":"เสื้อผ้าเด็ก","en":"Kids'' Clothing","my":"ကလေးအဝတ်အထည်"}', 'Kids'' clothing', '{"th":"เสื้อผ้าเด็ก","en":"Kids'' clothing","my":"ကလေးအဝတ်အထည်"}', NULL, true),
('c1000007-0000-0000-0000-000000000004', 'Shoes', 'shoes', 'footprints', 'c0000001-0000-0000-0000-000000000007', 4, '{"th":"รองเท้า","en":"Shoes","my":"ဖိနပ်များ"}', 'Shoes and footwear', '{"th":"รองเท้า","en":"Shoes and footwear","my":"ဖိနပ်များ"}', NULL, true),
('c1000007-0000-0000-0000-000000000005', 'Bags', 'bags', 'shopping-bag', 'c0000001-0000-0000-0000-000000000007', 5, '{"th":"กระเป๋า","en":"Bags","my":"အိတ်များ"}', 'Bags and handbags', '{"th":"กระเป๋า","en":"Bags and handbags","my":"အိတ်များ"}', NULL, true),
('c1000007-0000-0000-0000-000000000006', 'Jewelry', 'jewelry', 'gem', 'c0000001-0000-0000-0000-000000000007', 6, '{"th":"เครื่องประดับ","en":"Jewelry","my":"ရတနာများ"}', 'Jewelry', '{"th":"เครื่องประดับ","en":"Jewelry","my":"ရတနာများ"}', NULL, true),
('c1000007-0000-0000-0000-000000000007', 'Fashion Accessories', 'fashion-accessories', 'glasses', 'c0000001-0000-0000-0000-000000000007', 7, '{"th":"เครื่องประดับแฟชั่น","en":"Fashion Accessories","my":"ဖက်ရှင်ဖြည့်စွက်ပစ္စည်းများ"}', 'Fashion accessories', '{"th":"เครื่องประดับแฟชั่น","en":"Fashion accessories","my":"ဖက်ရှင် ဖြည့်စွက်ပစ္စည်းများ"}', NULL, true),
('c1000008-0000-0000-0000-000000000001', 'Skincare', 'skincare', 'sparkles', 'c0000001-0000-0000-0000-000000000008', 1, '{"th":"ดูแลผิว","en":"Skincare","my":"အသားအရေပြုစုခြင်း"}', 'Skincare products', '{"th":"ผลิตภัณฑ์ดูแลผิว","en":"Skincare products","my":"အသားအရေ ပြုစုခြင်း ထုတ်ကုန်များ"}', NULL, true),
('c1000008-0000-0000-0000-000000000002', 'Makeup', 'makeup', 'palette', 'c0000001-0000-0000-0000-000000000008', 2, '{"th":"เครื่องสำอาง","en":"Makeup","my":"မိတ်ကပ်"}', 'Makeup and cosmetics', '{"th":"เครื่องสำอาง","en":"Makeup and cosmetics","my":"မိတ်ကပ် အလှကုန်များ"}', NULL, true),
('c1000008-0000-0000-0000-000000000003', 'Hair Care', 'hair-care', 'scissors', 'c0000001-0000-0000-0000-000000000008', 3, '{"th":"ดูแลเส้นผม","en":"Hair Care","my":"ဆံပင်ပြုစုခြင်း"}', 'Hair care products', '{"th":"ผลิตภัณฑ์ดูแลเส้นผม","en":"Hair care products","my":"ဆံပင် ပြုစုခြင်း ထုတ်ကုန်များ"}', NULL, true),
('c1000008-0000-0000-0000-000000000004', 'Fragrance', 'fragrance', 'wind', 'c0000001-0000-0000-0000-000000000008', 4, '{"th":"น้ำหอม","en":"Fragrance","my":"ရေမွှေးများ"}', 'Fragrances', '{"th":"น้ำหอม","en":"Fragrances","my":"ရေမွှေးများ"}', NULL, true),
('c1000008-0000-0000-0000-000000000005', 'Personal Care', 'personal-care', 'heart', 'c0000001-0000-0000-0000-000000000008', 5, '{"th":"การดูแลส่วนบุคคล","en":"Personal Care","my":"ကိုယ်ရေးကိုယ်တာစောင့်ရှောက်မှု"}', 'Personal care products', '{"th":"ผลิตภัณฑ์ดูแลส่วนบุคคล","en":"Personal care products","my":"ကိုယ်ရေးကိုယ်တာ စောင့်ရှောက်မှု ထုတ်ကုန်များ"}', NULL, true),
('c1000009-0000-0000-0000-000000000001', 'Health Devices', 'health-devices', 'heart-pulse', 'c0000001-0000-0000-0000-000000000009', 1, '{"th":"อุปกรณ์สุขภาพ","en":"Health Devices","my":"ကျန်းမာရေးကိရိယာများ"}', 'Health devices and monitors', '{"th":"อุปกรณ์สุขภาพและเครื่องวัด","en":"Health devices and monitors","my":"ကျန်းမာရေးကိရိယာနှင့် စောင့်ကြည့်ကိရိယာများ"}', NULL, true),
('c1000009-0000-0000-0000-000000000002', 'First Aid', 'first-aid', 'cross', 'c0000001-0000-0000-0000-000000000009', 2, '{"th":"ปฐมพยาบาล","en":"First Aid","my":"ရှေးဦးသူနာပြုစုခြင်း"}', 'First aid supplies', '{"th":"อุปกรณ์ปฐมพยาบาล","en":"First aid supplies","my":"ရှေးဦးသူနာပြုစုခြင်း ပစ္စည်းများ"}', NULL, true),
('c1000009-0000-0000-0000-000000000003', 'Mobility & Care', 'mobility-care', 'accessibility', 'c0000001-0000-0000-0000-000000000009', 3, '{"th":"อุปกรณ์ช่วยเหลือและดูแล","en":"Mobility & Care","my":"လှုပ်ရှားမှုနှင့် စောင့်ရှောက်မှု"}', 'Mobility and care equipment', '{"th":"อุปกรณ์ช่วยเหลือและดูแล","en":"Mobility and care equipment","my":"လှုပ်ရှားမှုနှင့် စောင့်ရှောက်မှု ကိရိယာများ"}', NULL, true),
('c1000009-0000-0000-0000-000000000004', 'Wellness', 'wellness', 'leaf', 'c0000001-0000-0000-0000-000000000009', 4, '{"th":"สุขภาพองค์รวม","en":"Wellness","my":"ကောင်းကျိုးချမ်းသာ"}', 'Wellness and supplements', '{"th":"ผลิตภัณฑ์เพื่อสุขภาพองค์รวมและอาหารเสริม","en":"Wellness and supplements","my":"ကောင်းကျိုးချမ်းသာနှင့် ဖြည့်စွက်စာများ"}', NULL, true),
('c1000010-0000-0000-0000-000000000001', 'Snacks', 'snacks', 'cookie', 'c0000001-0000-0000-0000-000000000010', 1, '{"th":"ขนมขบเคี้ยว","en":"Snacks","my":"မုန့်များ"}', 'Snacks and treats', '{"th":"ขนมขบเคี้ยว","en":"Snacks and treats","my":"မုန့်များနှင့် အစားအစာများ"}', NULL, true),
('c1000010-0000-0000-0000-000000000002', 'Beverages', 'beverages', 'cup-soda', 'c0000001-0000-0000-0000-000000000010', 2, '{"th":"เครื่องดื่ม","en":"Beverages","my":"ဖျော်ရည်များ"}', 'Beverages and drinks', '{"th":"เครื่องดื่ม","en":"Beverages and drinks","my":"ဖျော်ရည်နှင့် သောက်စရာများ"}', NULL, true),
('c1000010-0000-0000-0000-000000000003', 'Coffee & Tea', 'coffee-tea', 'coffee', 'c0000001-0000-0000-0000-000000000010', 3, '{"th":"กาแฟและชา","en":"Coffee & Tea","my":"ကော်ဖီနှင့်လက်ဖက်ရည်"}', 'Coffee and tea', '{"th":"กาแฟและชา","en":"Coffee and tea","my":"ကော်ဖီနှင့် လက်ဖက်ရည်"}', NULL, true),
('c1000010-0000-0000-0000-000000000004', 'Dry Food', 'dry-food', 'package', 'c0000001-0000-0000-0000-000000000010', 4, '{"th":"อาหารแห้ง","en":"Dry Food","my":"အခြောက်အစားအစာ"}', 'Dry food and staples', '{"th":"อาหารแห้งและอาหารหลัก","en":"Dry food and staples","my":"အခြောက်အစားအစာနှင့် အဓိကအစားအစာများ"}', NULL, true),
('c1000010-0000-0000-0000-000000000005', 'Cooking Ingredients', 'cooking-ingredients', 'cooking-pot', 'c0000001-0000-0000-0000-000000000010', 5, '{"th":"วัตถุดิบปรุงอาหาร","en":"Cooking Ingredients","my":"ချက်ပြုတ်ပစ္စည်းများ"}', 'Cooking ingredients and seasonings', '{"th":"วัตถุดิบปรุงอาหารและเครื่องปรุง","en":"Cooking ingredients and seasonings","my":"ချက်ပြုတ်ပစ္စည်းနှင့် ဟင်းခတ်အမွှေးအကြိုင်များ"}', NULL, true),
('c1000011-0000-0000-0000-000000000001', 'Baby Clothing', 'baby-clothing', 'shirt', 'c0000001-0000-0000-0000-000000000011', 1, '{"th":"เสื้อผ้าเด็กทารก","en":"Baby Clothing","my":"ကလေးအဝတ်အထည်"}', 'Baby clothing', '{"th":"เสื้อผ้าเด็กทารก","en":"Baby clothing","my":"ကလေးအဝတ်အထည်"}', NULL, true),
('c1000011-0000-0000-0000-000000000002', 'Diapers', 'diapers', 'package', 'c0000001-0000-0000-0000-000000000011', 2, '{"th":"ผ้าอ้อม","en":"Diapers","my":"ဒိုင်ပါများ"}', 'Diapers and wipes', '{"th":"ผ้าอ้อมและกระดาษเปียก","en":"Diapers and wipes","my":"ဒိုင်ပါနှင့် စိုစွတ်သုတ်ပစ္စည်းများ"}', NULL, true),
('c1000011-0000-0000-0000-000000000003', 'Feeding', 'feeding', 'milk', 'c0000001-0000-0000-0000-000000000011', 3, '{"th":"อุปกรณ์ให้นมและอาหาร","en":"Feeding","my":"နို့တိုက်ခြင်းနှင့် အစာကျွေးခြင်း"}', 'Feeding and nursing', '{"th":"อุปกรณ์ให้นมและอาหารเด็ก","en":"Feeding and nursing","my":"နို့တိုက်ခြင်းနှင့် အစာကျွေးခြင်း"}', NULL, true),
('c1000011-0000-0000-0000-000000000004', 'Strollers', 'strollers', 'baby', 'c0000001-0000-0000-0000-000000000011', 4, '{"th":"รถเข็นเด็ก","en":"Strollers","my":"ကလေးတွန်းလှည်းများ"}', 'Strollers and carriers', '{"th":"รถเข็นเด็ก","en":"Strollers and carriers","my":"ကလေးတွန်းလှည်းများ"}', NULL, true),
('c1000011-0000-0000-0000-000000000005', 'Car Seats', 'car-seats', 'car', 'c0000001-0000-0000-0000-000000000011', 5, '{"th":"คาร์ซีท","en":"Car Seats","my":"ကားထိုင်ခုံများ"}', 'Car seats for babies', '{"th":"คาร์ซีทสำหรับเด็ก","en":"Car seats for babies","my":"ကလေးကားထိုင်ခုံများ"}', NULL, true),
('c1000011-0000-0000-0000-000000000006', 'Baby Care', 'baby-care', 'heart', 'c0000001-0000-0000-0000-000000000011', 6, '{"th":"การดูแลทารก","en":"Baby Care","my":"ကလေးပြုစုခြင်း"}', 'Baby care and hygiene', '{"th":"การดูแลและสุขอนามัยทารก","en":"Baby care and hygiene","my":"ကလေးပြုစုခြင်းနှင့် သန့်ရှင်းရေး"}', NULL, true),
('c1000012-0000-0000-0000-000000000001', 'Fitness', 'fitness', 'dumbbell', 'c0000001-0000-0000-0000-000000000012', 1, '{"th":"ฟิตเนส","en":"Fitness","my":"ကြံ့ခိုင်မှု"}', 'Fitness equipment', '{"th":"อุปกรณ์ฟิตเนส","en":"Fitness equipment","my":"ကြံ့ခိုင်မှုကိရိယာများ"}', NULL, true),
('c1000012-0000-0000-0000-000000000002', 'Running', 'running', 'person-standing', 'c0000001-0000-0000-0000-000000000012', 2, '{"th":"วิ่ง","en":"Running","my":"ပြေးခြင်း"}', 'Running gear', '{"th":"อุปกรณ์วิ่ง","en":"Running gear","my":"ပြေးခြင်း ပစ္စည်းများ"}', NULL, true),
('c1000012-0000-0000-0000-000000000003', 'Football', 'football', 'circle-dot', 'c0000001-0000-0000-0000-000000000012', 3, '{"th":"ฟุตบอล","en":"Football","my":"ဘောလုံး"}', 'Football gear', '{"th":"อุปกรณ์ฟุตบอล","en":"Football gear","my":"ဘောလုံးပစ္စည်းများ"}', NULL, true),
('c1000012-0000-0000-0000-000000000004', 'Cycling', 'cycling', 'bike', 'c0000001-0000-0000-0000-000000000012', 4, '{"th":"ปั่นจักรยาน","en":"Cycling","my":"စက်ဘီးစီးခြင်း"}', 'Cycling gear', '{"th":"อุปกรณ์ปั่นจักรยาน","en":"Cycling gear","my":"စက်ဘီးစီးခြင်း ပစ္စည်းများ"}', NULL, true),
('c1000012-0000-0000-0000-000000000005', 'Camping', 'camping', 'tent', 'c0000001-0000-0000-0000-000000000012', 5, '{"th":"แคมป์ปิ้ง","en":"Camping","my":"စခန်းချခြင်း"}', 'Camping equipment', '{"th":"อุปกรณ์แคมป์ปิ้ง","en":"Camping equipment","my":"စခန်းချခြင်း ပစ္စည်းများ"}', NULL, true),
('c1000012-0000-0000-0000-000000000006', 'Outdoor Recreation', 'outdoor-recreation', 'mountain', 'c0000001-0000-0000-0000-000000000012', 6, '{"th":"กิจกรรมกลางแจ้ง","en":"Outdoor Recreation","my":"ပြင်ပအပန်းဖြေခြင်း"}', 'Outdoor recreation', '{"th":"กิจกรรมกลางแจ้ง","en":"Outdoor recreation","my":"ပြင်ပအပန်းဖြေခြင်း"}', NULL, true),
('c1000013-0000-0000-0000-000000000001', 'Car Accessories', 'car-accessories', 'car', 'c0000001-0000-0000-0000-000000000013', 1, '{"th":"อุปกรณ์เสริมรถยนต์","en":"Car Accessories","my":"ကားဖြည့်စွက်ပစ္စည်းများ"}', 'Car accessories', '{"th":"อุปกรณ์เสริมรถยนต์","en":"Car accessories","my":"ကားဖြည့်စွက်ပစ္စည်းများ"}', NULL, true),
('c1000013-0000-0000-0000-000000000002', 'Motorcycle Accessories', 'motorcycle-accessories', 'bike', 'c0000001-0000-0000-0000-000000000013', 2, '{"th":"อุปกรณ์เสริมมอเตอร์ไซค์","en":"Motorcycle Accessories","my":"ဆိုင်ကယ်ဖြည့်စွက်ပစ္စည်းများ"}', 'Motorcycle accessories', '{"th":"อุปกรณ์เสริมมอเตอร์ไซค์","en":"Motorcycle accessories","my":"ဆိုင်ကယ် ဖြည့်စွက်ပစ္စည်းများ"}', NULL, true),
('c1000013-0000-0000-0000-000000000003', 'Auto Parts', 'auto-parts', 'wrench', 'c0000001-0000-0000-0000-000000000013', 3, '{"th":"อะไหล่รถยนต์","en":"Auto Parts","my":"ကားအစိတ်အပိုင်းများ"}', 'Auto parts', '{"th":"อะไหล่รถยนต์","en":"Auto parts","my":"ကားအစိတ်အပိုင်းများ"}', NULL, true),
('c1000013-0000-0000-0000-000000000004', 'Tires & Wheels', 'tires-wheels', 'circle', 'c0000001-0000-0000-0000-000000000013', 4, '{"th":"ยางและล้อ","en":"Tires & Wheels","my":"တာယာနှင့်ဘီးများ"}', 'Tires and wheels', '{"th":"ยางและล้อ","en":"Tires and wheels","my":"တာယာနှင့် ဘီးများ"}', NULL, true),
('c1000013-0000-0000-0000-000000000005', 'Car Care', 'car-care', 'sparkles', 'c0000001-0000-0000-0000-000000000013', 5, '{"th":"ดูแลรักษารถยนต์","en":"Car Care","my":"ကားပြုစုခြင်း"}', 'Car care products', '{"th":"ผลิตภัณฑ์ดูแลรักษารถยนต์","en":"Car care products","my":"ကားပြုစုခြင်း ထုတ်ကုန်များ"}', NULL, true),
('c1000014-0000-0000-0000-000000000001', 'Dog Supplies', 'dog-supplies', 'paw-print', 'c0000001-0000-0000-0000-000000000014', 1, '{"th":"อุปกรณ์สุนัข","en":"Dog Supplies","my":"ခွေးပစ္စည်းများ"}', 'Dog supplies', '{"th":"อุปกรณ์สุนัข","en":"Dog supplies","my":"ခွေးပစ္စည်းများ"}', NULL, true),
('c1000014-0000-0000-0000-000000000002', 'Cat Supplies', 'cat-supplies', 'paw-print', 'c0000001-0000-0000-0000-000000000014', 2, '{"th":"อุปกรณ์แมว","en":"Cat Supplies","my":"ကြောင်ပစ္စည်းများ"}', 'Cat supplies', '{"th":"อุปกรณ์แมว","en":"Cat supplies","my":"ကြောင်ပစ္စည်းများ"}', NULL, true),
('c1000014-0000-0000-0000-000000000003', 'Pet Food', 'pet-food', 'bone', 'c0000001-0000-0000-0000-000000000014', 3, '{"th":"อาหารสัตว์เลี้ยง","en":"Pet Food","my":"အိမ်မွေးတိရစ္ဆာန်အစားအစာ"}', 'Pet food', '{"th":"อาหารสัตว์เลี้ยง","en":"Pet food","my":"အိမ်မွေးတိရစ္ဆာန်အစားအစာ"}', NULL, true),
('c1000014-0000-0000-0000-000000000004', 'Pet Toys', 'pet-toys', 'gamepad-2', 'c0000001-0000-0000-0000-000000000014', 4, '{"th":"ของเล่นสัตว์เลี้ยง","en":"Pet Toys","my":"အိမ်မွေးတိရစ္ဆာန်ကစားကွင်းများ"}', 'Pet toys', '{"th":"ของเล่นสัตว์เลี้ยง","en":"Pet toys","my":"အိမ်မွေး တိရစ္ဆာန်ကစားကွင်းများ"}', NULL, true),
('c1000014-0000-0000-0000-000000000005', 'Pet Care', 'pet-care', 'heart', 'c0000001-0000-0000-0000-000000000014', 5, '{"th":"ดูแลสัตว์เลี้ยง","en":"Pet Care","my":"အိမ်မွေးတိရစ္ဆာန်ပြုစုခြင်း"}', 'Pet care and health', '{"th":"การดูแลและสุขภาพสัตว์เลี้ยง","en":"Pet care and health","my":"အိမ်မွေးတိရစ္ဆာန် ပြုစုခြင်းနှင့် ကျန်းမာရေး"}', NULL, true),
('c1000015-0000-0000-0000-000000000001', 'Books', 'books', 'book-open', 'c0000001-0000-0000-0000-000000000015', 1, '{"th":"หนังสือ","en":"Books","my":"စာအုပ်များ"}', 'Books', '{"th":"หนังสือ","en":"Books","my":"စာအုပ်များ"}', NULL, true),
('c1000015-0000-0000-0000-000000000002', 'Toys & Games', 'toys-games', 'gamepad-2', 'c0000001-0000-0000-0000-000000000015', 2, '{"th":"ของเล่นและเกม","en":"Toys & Games","my":"ကစားကွင်းနှင့်ဂိမ်းများ"}', 'Toys and games', '{"th":"ของเล่นและเกม","en":"Toys and games","my":"ကစားကွင်းနှင့် ဂိမ်းများ"}', NULL, true),
('c1000015-0000-0000-0000-000000000003', 'Arts & Crafts', 'arts-crafts', 'palette', 'c0000001-0000-0000-0000-000000000015', 3, '{"th":"งานศิลปะและงานฝีมือ","en":"Arts & Crafts","my":"အနုပညာနှင့်လက်မှုပညာ"}', 'Arts and crafts', '{"th":"งานศิลปะและงานฝีมือ","en":"Arts and crafts","my":"အနုပညာ နှင့် လက်မှုပညာ"}', NULL, true),
('c1000015-0000-0000-0000-000000000004', 'Musical Instruments', 'musical-instruments', 'music', 'c0000001-0000-0000-0000-000000000015', 4, '{"th":"เครื่องดนตรี","en":"Musical Instruments","my":"တေးဂီတတူရိယာများ"}', 'Musical instruments', '{"th":"เครื่องดนตรี","en":"Musical instruments","my":"တေးဂီတ တူရိယာများ"}', NULL, true),
('c1000015-0000-0000-0000-000000000005', 'Collectibles', 'collectibles', 'gem', 'c0000001-0000-0000-0000-000000000015', 5, '{"th":"ของสะสม","en":"Collectibles","my":"စုဆောင်းပစ္စည်းများ"}', 'Collectibles', '{"th":"ของสะสม","en":"Collectibles","my":"စုဆောင်းပစ္စည်းများ"}', NULL, true),
('c1000015-0000-0000-0000-000000000006', 'Travel', 'travel', 'plane', 'c0000001-0000-0000-0000-000000000015', 6, '{"th":"ท่องเที่ยว","en":"Travel","my":"ခရီးသွားခြင်း"}', 'Travel accessories', '{"th":"อุปกรณ์ท่องเที่ยว","en":"Travel accessories","my":"ခရီးသွား ဖြည့်စွက်ပစ္စည်းများ"}', NULL, true),
('c1000015-0000-0000-0000-000000000007', 'Other Products', 'other-products', 'package', 'c0000001-0000-0000-0000-000000000015', 7, '{"th":"สินค้าอื่น ๆ","en":"Other Products","my":"အခြားထုတ်ကုန်များ"}', 'Other products', '{"th":"สินค้าอื่น ๆ","en":"Other products","my":"အခြားထုတ်ကုန်များ"}', NULL, true)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, parent_id = EXCLUDED.parent_id, sort_order = EXCLUDED.sort_order, names = EXCLUDED.names, description = EXCLUDED.description, description_names = EXCLUDED.description_names, image_url = EXCLUDED.image_url, is_active = EXCLUDED.is_active, updated_at = NOW();
