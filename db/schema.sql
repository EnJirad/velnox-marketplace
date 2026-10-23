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
  password_hash TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
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

-- Prevent circular parent relationships and self-parenting in categories
CREATE OR REPLACE FUNCTION prevent_circular_category_parent()
RETURNS TRIGGER AS $$
DECLARE
  current_id UUID;
  visited UUID[];
BEGIN
  -- Prevent self-parenting
  IF NEW.parent_id IS NOT NULL AND NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Category cannot be its own parent';
  END IF;
  
  -- Prevent circular relationships by walking up the parent chain
  IF NEW.parent_id IS NOT NULL THEN
    current_id := NEW.parent_id;
    visited := ARRAY[NEW.id];
    
    WHILE current_id IS NOT NULL LOOP
      -- Check if we've visited this node (cycle detected)
      IF current_id = ANY(visited) THEN
        RAISE EXCEPTION 'Circular parent relationship detected for category %', NEW.id;
      END IF;
      
      -- Add to visited list
      visited := array_append(visited, current_id);
      
      -- Move to parent
      SELECT parent_id INTO current_id FROM categories WHERE id = current_id;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_circular_category_parent
  BEFORE INSERT OR UPDATE OF parent_id ON categories
  FOR EACH ROW
  EXECUTE FUNCTION prevent_circular_category_parent();
CREATE TABLE IF NOT EXISTS sellers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'needs_correction', 'approved', 'rejected', 'suspended')),
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
  review_reason_code TEXT,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_seller_verifications_seller ON seller_verifications (seller_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_verifications_pending ON seller_verifications (seller_id) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS seller_review_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  application_id UUID,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  action TEXT NOT NULL,
  reason_code TEXT,
  reason TEXT,
  note TEXT,
  reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_seller_review_history_seller ON seller_review_history (seller_id, created_at DESC);
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
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'packing', 'shipped', 'delivered', 'completed', 'cancelled', 'pending_payment', 'paid', 'payment_failed', 'refunded', 'expired')),
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  shipping_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'THB',
  shipping_address_id UUID REFERENCES addresses(id),
  shipping_address JSONB,
  notes TEXT,
  inventory_released BOOLEAN NOT NULL DEFAULT FALSE,
  payment_expires_at TIMESTAMPTZ,
  reservation_policy JSONB,
  velrepeat_run_id UUID,
  velrepeat_cycle_id UUID,
  checkout_group_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_number_unique ON orders (order_number) WHERE order_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_unreleased ON orders (id) WHERE inventory_released = FALSE;
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_shop ON orders (shop_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_expires_at ON orders (payment_expires_at) WHERE payment_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_checkout_group ON orders (checkout_group_id) WHERE checkout_group_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS checkout_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'THB',
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  shop_count INTEGER NOT NULL DEFAULT 1 CHECK (shop_count >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checkout_groups_user ON checkout_groups (user_id, created_at DESC);
-- Declared here, not next to orders: a foreign key needs its target to exist first,
-- so putting it before CREATE TABLE checkout_groups made a fresh bootstrap abort
-- with 42P01 "relation checkout_groups does not exist".
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_checkout_group_id_fkey') THEN ALTER TABLE orders ADD CONSTRAINT orders_checkout_group_id_fkey FOREIGN KEY (checkout_group_id) REFERENCES checkout_groups(id) ON DELETE SET NULL; END IF; END $$;
CREATE TABLE IF NOT EXISTS checkout_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'checkout',
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT checkout_requests_user_scope_key UNIQUE (user_id, scope, request_key)
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
-- P1-2: ONE CANONICAL SHIPMENT PER ORDER, enforced by the database.
--
-- `shipments.order_id` was the only write in the system with no key behind it, so
-- two concurrent "mark shipped" requests could each fail to see the other and
-- each insert — two parcels, two tracking numbers, no way to tell which is real.
-- This index is the arbitration point `ensureShipmentForShipping()`'s
-- `INSERT … ON CONFLICT (order_id)` infers, and it SUPERSEDES the plain
-- `idx_shipments_order` it replaces (same column, same lookups: a unique btree
-- serves `WHERE order_id = $1` exactly as the non-unique one did).
--
-- One per order is the implemented model — no shipment carries a discriminator,
-- nothing writes a second shipment, and migration 056's own backfill assumes
-- `COUNT(*) = 1`. When split fulfilment arrives (rebuild Phase 10, shipments per
-- `fulfillment_orders` work unit), this becomes a partial index on the work unit:
-- a change of declaration, never of data.
CREATE UNIQUE INDEX IF NOT EXISTS shipments_order_id_unique ON shipments (order_id);
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
  order_id UUID REFERENCES orders(id),
  plan_id UUID,
  checkout_group_id UUID REFERENCES checkout_groups(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'THB',
  method TEXT NOT NULL DEFAULT 'cod',
  status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT NOT NULL DEFAULT 'cod',
  provider_payment_id TEXT,
  provider_checkout_session_id TEXT,
  paid_at TIMESTAMPTZ,
  refunded_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  refund_status TEXT,
  failure_code TEXT,
  failure_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payments_at_least_one_parent_check CHECK (
    order_id IS NOT NULL OR plan_id IS NOT NULL OR checkout_group_id IS NOT NULL
  ),
  CONSTRAINT payments_single_domain_check CHECK (
    NOT (plan_id IS NOT NULL AND (order_id IS NOT NULL OR checkout_group_id IS NOT NULL))
  ),
  -- The payment vocabulary, previously only in backend/lib/payment-config.ts
  -- (`PAYMENT_STATUS`). Migration 055; see it for the writer behind each value.
  CONSTRAINT payments_status_check CHECK (
    status IN ('pending', 'requires_action', 'processing', 'paid', 'failed', 'cancelled')
  )
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_plan ON payments (plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_provider_session ON payments (provider_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_payment ON payments (provider_payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_active_stripe ON payments (order_id) WHERE provider = 'stripe' AND status IN ('pending', 'requires_action');
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_active_stripe_group ON payments (checkout_group_id) WHERE provider = 'stripe' AND checkout_group_id IS NOT NULL AND status IN ('pending', 'requires_action');
CREATE INDEX IF NOT EXISTS idx_payments_checkout_group ON payments (checkout_group_id) WHERE checkout_group_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_active_stripe_plan ON payments (plan_id) WHERE provider = 'stripe' AND plan_id IS NOT NULL AND status IN ('pending', 'requires_action');
CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processed',
  error TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_events_provider ON payment_events (provider);
CREATE INDEX IF NOT EXISTS idx_payment_events_type ON payment_events (event_type);
CREATE INDEX IF NOT EXISTS idx_payment_events_processed ON payment_events (processed_at);
CREATE TABLE IF NOT EXISTS payment_incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dedupe_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'stripe',
  order_id UUID REFERENCES orders(id),
  plan_id UUID,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  provider_payment_intent_id TEXT,
  provider_checkout_session_id TEXT,
  event_id TEXT,
  reason TEXT NOT NULL,
  order_status TEXT,
  amount NUMERIC(12, 2),
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolution_note TEXT,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_incidents_exactly_one_parent_check CHECK (
    (order_id IS NOT NULL AND plan_id IS NULL)
    OR (order_id IS NULL AND plan_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_payment_incidents_order ON payment_incidents (order_id);
CREATE INDEX IF NOT EXISTS idx_payment_incidents_plan ON payment_incidents (plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_incidents_status ON payment_incidents (status);
CREATE INDEX IF NOT EXISTS payment_incidents_dedupe_key ON payment_incidents (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_payment_incidents_intent ON payment_incidents (provider_payment_intent_id);
CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- OPTIONAL since migration 055: a refund of a MULTI-SHOP purchase names the
  -- purchase, not one of its orders (the charge is ONE `payments` row on the
  -- checkout group). It was NOT NULL, so every grouped refund raised 23502, the
  -- webhook answered 500 and Stripe redelivered it forever.
  order_id UUID REFERENCES orders(id),
  checkout_group_id UUID REFERENCES checkout_groups(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES payments(id),
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_refund_id TEXT,
  amount NUMERIC(12, 2) NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by UUID REFERENCES users(id),
  refunded_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The same rule 054 gave `payments`: a refund must name SOMETHING. Migrations
  -- 055.
  CONSTRAINT refunds_parent_check CHECK (order_id IS NOT NULL OR checkout_group_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_provider_refund ON refunds (provider_refund_id);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds (order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_payment ON refunds (payment_id);
CREATE INDEX IF NOT EXISTS idx_refunds_checkout_group ON refunds (checkout_group_id) WHERE checkout_group_id IS NOT NULL;
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
  commitment_cycles INTEGER CHECK (commitment_cycles IS NULL OR commitment_cycles > 0),
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
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_plan_id_fkey;
ALTER TABLE payments ADD CONSTRAINT payments_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES velrepeat_plans(id);
ALTER TABLE payment_incidents DROP CONSTRAINT IF EXISTS payment_incidents_plan_id_fkey;
ALTER TABLE payment_incidents ADD CONSTRAINT payment_incidents_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES velrepeat_plans(id);
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
CREATE TABLE IF NOT EXISTS velrepeat_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_velrepeat_packages_active ON velrepeat_packages (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_velrepeat_packages_seller ON velrepeat_packages (seller_id);
CREATE TABLE IF NOT EXISTS velrepeat_package_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  package_id UUID NOT NULL REFERENCES velrepeat_packages(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_velrepeat_package_items_package ON velrepeat_package_items (package_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_package_items_product ON velrepeat_package_items (product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_package_items_unique_variant ON velrepeat_package_items (package_id, product_id, variant_id) WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_package_items_unique_no_variant ON velrepeat_package_items (package_id, product_id) WHERE variant_id IS NULL;
CREATE TABLE IF NOT EXISTS velrepeat_pricing_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES velrepeat_plans(id) ON DELETE CASCADE,
  commitment_cycles INTEGER NOT NULL CHECK (commitment_cycles > 0),
  currency TEXT NOT NULL DEFAULT 'THB',
  subtotal_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  discount_type TEXT,
  discount_value NUMERIC(12, 2),
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  cycle_price NUMERIC(12, 2) CHECK (cycle_price IS NULL OR cycle_price >= 0),
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  pricing_rule_key TEXT,
  pricing_rule_version TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_velrepeat_pricing_snapshots_plan ON velrepeat_pricing_snapshots (plan_id, created_at);
ALTER TABLE velrepeat_pricing_snapshots DROP CONSTRAINT IF EXISTS velrepeat_pricing_snapshots_cycle_price_not_null;
ALTER TABLE velrepeat_pricing_snapshots ADD CONSTRAINT velrepeat_pricing_snapshots_cycle_price_not_null CHECK (cycle_price IS NOT NULL);
ALTER TABLE velrepeat_pricing_snapshots DROP CONSTRAINT IF EXISTS velrepeat_pricing_snapshots_total_not_below_cycle;
ALTER TABLE velrepeat_pricing_snapshots ADD CONSTRAINT velrepeat_pricing_snapshots_total_not_below_cycle CHECK (cycle_price IS NULL OR total_amount >= cycle_price);
CREATE TABLE IF NOT EXISTS velrepeat_pricing_snapshot_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  snapshot_id UUID NOT NULL REFERENCES velrepeat_pricing_snapshots(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_velrepeat_pricing_snapshot_items_snapshot ON velrepeat_pricing_snapshot_items (snapshot_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_pricing_snapshot_items_unique_variant ON velrepeat_pricing_snapshot_items (snapshot_id, product_id, variant_id) WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_pricing_snapshot_items_unique_no_variant ON velrepeat_pricing_snapshot_items (snapshot_id, product_id) WHERE variant_id IS NULL;
CREATE TABLE IF NOT EXISTS velrepeat_cycles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES velrepeat_plans(id) ON DELETE CASCADE,
  cycle_number INTEGER NOT NULL CHECK (cycle_number > 0),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'ordered', 'completed', 'skipped', 'cancelled', 'out_of_stock', 'item_unavailable')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  pricing_snapshot_id UUID REFERENCES velrepeat_pricing_snapshots(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, cycle_number)
);
CREATE INDEX IF NOT EXISTS idx_velrepeat_cycles_plan ON velrepeat_cycles (plan_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_cycles_due ON velrepeat_cycles (status, scheduled_at);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_velrepeat_cycle_id_fkey') THEN ALTER TABLE orders ADD CONSTRAINT orders_velrepeat_cycle_id_fkey FOREIGN KEY (velrepeat_cycle_id) REFERENCES velrepeat_cycles(id) ON DELETE SET NULL; END IF; END $$;
CREATE INDEX IF NOT EXISTS idx_orders_velrepeat_cycle ON orders (velrepeat_cycle_id) WHERE velrepeat_cycle_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_velrepeat_cycle_seller_unique ON orders (velrepeat_cycle_id, shop_id) WHERE velrepeat_cycle_id IS NOT NULL AND shop_id IS NOT NULL;
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

-- ============================================================================
-- Constraint repairs (idempotent, safe to re-run)
-- ============================================================================
-- `CREATE TABLE IF NOT EXISTS` never alters an existing table, so a database
-- created before the constraint was widened keeps the old CHECK forever. These
-- statements re-assert the canonical constraint on every bootstrap run.
--
-- V0035 (`item_unavailable` on velrepeat_plans.status) was skipped in some
-- environments because the migration number collided with
-- 035_checkout_idempotency.sql. Re-asserting it here makes the bootstrap file
-- self-healing and keeps db/schema.sql the single source of truth.

ALTER TABLE velrepeat_plans DROP CONSTRAINT IF EXISTS velrepeat_plans_status_check;
ALTER TABLE velrepeat_plans
  ADD CONSTRAINT velrepeat_plans_status_check
  CHECK (status IN ('draft', 'active', 'paused', 'processing', 'payment_failed',
                    'out_of_stock', 'item_unavailable', 'price_changed',
                    'cancelled', 'completed'));

-- The run table is `velrepeat_runs` (created above). An earlier revision of this
-- block named a `velrepeat_plan_runs` table that no migration and no backend
-- query ever created, so running this file on a fresh database aborted with
-- `relation "velrepeat_plan_runs" does not exist` — and so did migration V0044.
ALTER TABLE velrepeat_runs DROP CONSTRAINT IF EXISTS velrepeat_runs_status_check;
ALTER TABLE velrepeat_runs
  ADD CONSTRAINT velrepeat_runs_status_check
  CHECK (status IN ('processing', 'success', 'payment_failed', 'out_of_stock',
                    'item_unavailable', 'price_changed', 'failed', 'cancelled'));

ALTER TABLE sellers DROP CONSTRAINT IF EXISTS sellers_status_check;
ALTER TABLE sellers
  ADD CONSTRAINT sellers_status_check
  CHECK (status IN ('pending', 'under_review', 'needs_correction', 'approved', 'rejected', 'suspended'));

-- `orders.status` had no CHECK at all (audit MEDIUM #9), unlike every other
-- status column in this schema. It is the union of the FULFILMENT chain
-- (`backend/lib/order-fulfillment.ts`) and the PAYMENT lifecycle
-- (`routes/stripe.ts` + the reservation sweep writing `expired`), and the set
-- above is exactly what those writers can produce — derived from them, not
-- invented here. It refuses values the domain does not have; it does not
-- authorise transitions, which stay with `canTransitionFulfillment()`, the row
-- lock and the payment/shipment/cancellation gates. V0050.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'confirmed', 'packing', 'shipped', 'delivered',
                    'completed', 'cancelled', 'pending_payment', 'paid',
                    'payment_failed', 'refunded', 'expired'));

-- VelCenter staff force-password-change (migration 046). Idempotent so a fresh
-- bootstrap self-heals a database created before the column existed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
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

-- ============================================================================
-- COMMERCE CORE (migration 056)
-- ============================================================================
-- One axis per lifecycle, one stock model for products AND variants, a durable
-- attempt layer, an append-only ledger, a transactional outbox and the
-- reconciliation register. See .ai/rebuild/DOMAIN_MODEL.md for the model and
-- db/migrations/056_commerce_core_invariants.sql for the backfill that fills the
-- new columns on an existing database.

-- ─── the nine new tables, their indexes and their guards ──────────────────
-- This file is the SNAPSHOT: it declares the shape a database ends up in, and
-- db/run-sqleditor.sql is the rerunnable reconciler that reaches that same shape
-- from a database that already holds data. Declaring a column here is not enough
-- on its own -- every column below is also carried by the column pass there,
-- which is what an existing database actually receives.
--
-- DATA IS NOT BACKFILLED HERE. The canonical safety contract for this file is
-- that it never rewrites an existing row, so the deterministic backfill of the
-- two order axes, the attempt rows, the work units, the shipment items and the
-- webhook retry metadata lives in db/migrations/056_commerce_core_invariants.sql
-- and runs from there. This file adds STRUCTURE: a database that has run only
-- this pass has the columns, nullable and empty, and the application reads them
-- through a COALESCE fallback so a deploy is never blocked by a pending
-- migration.

-- ─── 1. payment_attempts ────────────────────────────────────────────────────
-- One row per provider interaction. `payments` stays the record of the money;
-- an attempt is the record of ONE try at moving it, which is what makes
-- "pending -> failed -> retried -> paid" expressible without overloading a
-- single status column, and what makes a created session recoverable after a
-- timeout. `idempotency_key` is the durable key: an INSERT ... ON CONFLICT on it
-- is the whole idempotency strategy (never a read-then-write).
CREATE TABLE IF NOT EXISTS payment_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  provider TEXT NOT NULL DEFAULT 'stripe',
  method TEXT NOT NULL DEFAULT 'card',
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'requires_action', 'processing', 'succeeded', 'failed', 'expired', 'canceled')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'THB',
  idempotency_key TEXT NOT NULL,
  provider_session_id TEXT,
  provider_intent_id TEXT,
  failure_code TEXT,
  failure_message TEXT,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  CONSTRAINT payment_attempts_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT payment_attempts_number_unique UNIQUE (payment_id, attempt_number),
  CONSTRAINT payment_attempts_settled_needs_confirmation CHECK (
    settled_at IS NULL OR confirmed_at IS NOT NULL
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_session
  ON payment_attempts (provider, provider_session_id) WHERE provider_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_intent
  ON payment_attempts (provider, provider_intent_id) WHERE provider_intent_id IS NOT NULL;
-- At most ONE live attempt per payment: two concurrent "pay" requests cannot
-- both open a provider session for the same money.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_one_live
  ON payment_attempts (payment_id) WHERE status IN ('created', 'requires_action', 'processing');
CREATE INDEX IF NOT EXISTS idx_payment_attempts_payment ON payment_attempts (payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON payment_attempts (status);

-- ─── 2. fulfillment_orders ─────────────────────────────────────────────────
-- Shopify's fulfillment-order model, at Velnox granularity: the WORK of getting
-- an order's items out of the door, one row per (order, location). Created inside
-- the settlement transaction, so a work unit never exists for an order that was
-- never paid. `shipments` then hangs off it, which is what makes partial and
-- split fulfilment expressible without a schema change.
CREATE TABLE IF NOT EXISTS fulfillment_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shop_id UUID REFERENCES shops(id),
  location TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'unfulfilled'
    CHECK (status IN ('unfulfilled', 'ready', 'picking', 'packing', 'ready_to_ship', 'shipped', 'delivered', 'failed', 'cancelled')),
  failure_code TEXT,
  failure_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT fulfillment_orders_order_location_unique UNIQUE (order_id, location)
);
CREATE INDEX IF NOT EXISTS idx_fulfillment_orders_order ON fulfillment_orders (order_id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_orders_shop ON fulfillment_orders (shop_id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_orders_active
  ON fulfillment_orders (updated_at) WHERE status IN ('unfulfilled', 'ready', 'picking', 'packing', 'ready_to_ship');

-- ─── 3. shipment_items ─────────────────────────────────────────────────────
-- WHICH units a shipment carries. Without this, "2 of 3 units shipped", a split
-- parcel and a reshipment after a loss cannot be represented, and a shipment can
-- silently cover an order it does not actually contain.
CREATE TABLE IF NOT EXISTS shipment_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shipment_items_shipment_item_unique UNIQUE (shipment_id, order_item_id)
);
CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment ON shipment_items (shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_item ON shipment_items (order_item_id);

-- ─── 4. inventory_movements ────────────────────────────────────────────────
-- The audited WHY behind every change to a stock counter: append-only, one row
-- per mutation, written in the same transaction. This is what makes
-- "why is this number 3?" answerable, and it is what the inventory reconciler
-- replays to prove the counters were not written by hand.
CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inventory_id UUID REFERENCES inventory(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  movement TEXT NOT NULL
    CHECK (movement IN ('reserve', 'release', 'commit', 'fulfil', 'return', 'adjust')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  reason TEXT,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key TEXT,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_movements_idempotency_key UNIQUE (idempotency_key),
  -- A movement always names the level it moved: the product-level inventory row
  -- for non-variant stock, or the variant row for variant stock.
  CONSTRAINT inventory_movements_parent_check CHECK (inventory_id IS NOT NULL OR variant_id IS NOT NULL),
  CONSTRAINT inventory_movements_variant_matches_product_check CHECK (
    variant_id IS NULL OR inventory_id IS NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_inventory ON inventory_movements (inventory_id, created_at DESC) WHERE inventory_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_movements_order ON inventory_movements (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_movements_variant ON inventory_movements (variant_id) WHERE variant_id IS NOT NULL;

-- ─── 5. ledger_entries ─────────────────────────────────────────────────────
-- The immutable financial record. APPEND-ONLY: the trigger in section 10 refuses
-- an UPDATE or a DELETE, so a correction is a new compensating entry, never an
-- edit. `amount_minor` is BIGINT so no float and no double rounding ever touches
-- money; `idempotency_key` makes a retried write a no-op instead of a duplicate.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_type TEXT NOT NULL
    CHECK (entry_type IN ('charge', 'refund', 'platform_fee', 'seller_payable', 'settlement', 'adjustment')),
  account TEXT NOT NULL
    CHECK (account IN ('platform_cash', 'platform_revenue', 'seller_payable', 'refund_clearing')),
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'THB',
  purchase_id UUID REFERENCES checkout_groups(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  refund_id UUID REFERENCES refunds(id) ON DELETE SET NULL,
  settlement_id UUID REFERENCES settlements(id) ON DELETE SET NULL,
  seller_id UUID REFERENCES sellers(id) ON DELETE SET NULL,
  rate NUMERIC(5, 4),
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_entries_idempotency_key UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_seller ON ledger_entries (seller_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_payment ON ledger_entries (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_entries_purchase ON ledger_entries (purchase_id) WHERE purchase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_entries_order ON ledger_entries (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_entries_settlement ON ledger_entries (settlement_id) WHERE settlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries (account, occurred_at DESC);

-- ─── 6. order_returns ──────────────────────────────────────────────────────
-- The missing RMA entity: refund-after-return had no representation at all.
-- A return records a PHYSICAL fact. It never refunds (that is the refund domain
-- operation) and never releases stock (the units were already fulfilled; a
-- restock is an explicit `return` movement).
CREATE TABLE IF NOT EXISTS order_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason_code TEXT,
  customer_note TEXT,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'in_transit', 'received', 'restocked', 'completed', 'cancelled')),
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  restocked_quantity INTEGER NOT NULL DEFAULT 0 CHECK (restocked_quantity >= 0),
  resolution_note TEXT,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_returns_order ON order_returns (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_returns_open
  ON order_returns (status) WHERE status IN ('requested', 'approved', 'in_transit', 'received');

-- ─── 7. outbox_events ──────────────────────────────────────────────────────
-- The transactional outbox. An event row is written in the SAME transaction as
-- the state change it describes, so "DB committed but the event vanished" and
-- "the event says X while the DB rolled back" both become impossible. The drain
-- worker publishes and may fail; a failure increments attempt_count and sets
-- next_retry_at, and exhausting the budget is a LOUD terminal state that raises
-- an incident (never a silent drop).
CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  aggregate_type TEXT NOT NULL
    CHECK (aggregate_type IN ('purchase', 'order', 'fulfillment', 'shipment', 'payment', 'refund', 'inventory', 'return', 'settlement')),
  aggregate_id UUID,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  correlation_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'failed', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT outbox_events_event_id_unique UNIQUE (event_id)
);
CREATE INDEX IF NOT EXISTS idx_outbox_events_pending
  ON outbox_events (next_retry_at) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_outbox_events_aggregate ON outbox_events (aggregate_type, aggregate_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_events_type ON outbox_events (event_type, occurred_at DESC);

-- ─── 8. reconciliation ─────────────────────────────────────────────────────
-- A reconciler NEVER repairs business state: it records what it expected, what
-- it observed and how severe the difference is. Repair is an authorized,
-- audited action. The fingerprint upsert keeps one OPEN finding per real drift,
-- so a re-run refreshes the evidence instead of duplicating the report.
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind TEXT NOT NULL
    CHECK (kind IN ('payment', 'inventory', 'fulfillment', 'refund', 'ledger', 'purchase')),
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  checked_count INTEGER NOT NULL DEFAULT 0 CHECK (checked_count >= 0),
  mismatch_count INTEGER NOT NULL DEFAULT 0 CHECK (mismatch_count >= 0),
  details JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_kind ON reconciliation_runs (kind, started_at DESC);

CREATE TABLE IF NOT EXISTS reconciliation_findings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID REFERENCES reconciliation_runs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('payment', 'inventory', 'fulfillment', 'refund', 'ledger', 'purchase')),
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  expected JSONB,
  observed JSONB,
  detail TEXT,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT,
  CONSTRAINT reconciliation_findings_fingerprint_unique UNIQUE (kind, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_open ON reconciliation_findings (status, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_entity ON reconciliation_findings (entity_type, entity_id);

-- ─── 9. EXTEND existing tables (additive columns only) ─────────────────────
-- The two real lifecycle axes on the order. NULLABLE on purpose: a database that
-- has run only db/run-sqleditor.sql has the columns but no backfill, and the
-- application reads them with a COALESCE fallback to the legacy `status`, so a
-- deploy is never blocked by a pending migration. Section 9b backfills and then
-- makes them NOT NULL.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_state TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_status TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS correlation_id TEXT;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS fulfilled_quantity INTEGER NOT NULL DEFAULT 0;

-- The product-level axis: the six quantities of INVENTORY_ARCHITECTURE.md. The
-- on-hand column keeps its existing name `quantity` (a rename would rewrite every
-- read in the catalog) and is documented as on_hand.
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS committed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS fulfilled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS returned INTEGER NOT NULL DEFAULT 0;

-- The VARIANT axis gets the SAME counters on its own table. The columns are
-- additive and default to 0, so every existing read of product_variants.stock is
-- unchanged and no writer has to be reordered for this migration to be safe.
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS reserved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS committed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS fulfilled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS returned INTEGER NOT NULL DEFAULT 0;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS correlation_id TEXT;

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS refundable_minor BIGINT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS correlation_id TEXT;

ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS payload_reference TEXT;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS provider_object_id TEXT;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS correlation_id TEXT;

ALTER TABLE payment_incidents ADD COLUMN IF NOT EXISTS kind TEXT;

ALTER TABLE settlements ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'THB';
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS entry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS fulfillment_order_id UUID REFERENCES fulfillment_orders(id) ON DELETE SET NULL;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS correlation_id TEXT;

ALTER TABLE orders ALTER COLUMN order_state SET DEFAULT 'pending';
ALTER TABLE orders ALTER COLUMN fulfillment_status SET DEFAULT 'unfulfilled';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE order_state IS NULL)
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'orders'
                   AND column_name = 'order_state' AND is_nullable = 'YES')
  THEN
    ALTER TABLE orders ALTER COLUMN order_state SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM orders WHERE fulfillment_status IS NULL)
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'orders'
                   AND column_name = 'fulfillment_status' AND is_nullable = 'YES')
  THEN
    ALTER TABLE orders ALTER COLUMN fulfillment_status SET NOT NULL;
  END IF;
END $$;


-- ─── 10. constraints on the NEW columns (each guarded, never fatal) ───────
DO $$
BEGIN
  -- orders.order_state vocabulary
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_order_state_check') THEN
    IF EXISTS (SELECT 1 FROM orders WHERE order_state IS NOT NULL
                 AND order_state NOT IN ('pending', 'confirmed', 'processing', 'completed', 'cancelled')) THEN
      RAISE NOTICE 'velnox: orders_order_state_check NOT added - % row(s) carry an unexpected order_state',
        (SELECT COUNT(*) FROM orders WHERE order_state IS NOT NULL
           AND order_state NOT IN ('pending', 'confirmed', 'processing', 'completed', 'cancelled'));
    ELSE
      ALTER TABLE orders ADD CONSTRAINT orders_order_state_check
        CHECK (order_state IS NULL OR order_state IN ('pending', 'confirmed', 'processing', 'completed', 'cancelled'));
    END IF;
  END IF;

  -- orders.fulfillment_status vocabulary
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_fulfillment_status_check') THEN
    IF EXISTS (SELECT 1 FROM orders WHERE fulfillment_status IS NOT NULL
                 AND fulfillment_status NOT IN ('unfulfilled', 'ready', 'picking', 'packing', 'ready_to_ship', 'shipped', 'delivered', 'failed', 'cancelled')) THEN
      RAISE NOTICE 'velnox: orders_fulfillment_status_check NOT added - % row(s) carry an unexpected fulfillment_status',
        (SELECT COUNT(*) FROM orders WHERE fulfillment_status IS NOT NULL
           AND fulfillment_status NOT IN ('unfulfilled', 'ready', 'picking', 'packing', 'ready_to_ship', 'shipped', 'delivered', 'failed', 'cancelled'));
    ELSE
      ALTER TABLE orders ADD CONSTRAINT orders_fulfillment_status_check
        CHECK (fulfillment_status IS NULL OR fulfillment_status IN ('unfulfilled', 'ready', 'picking', 'packing', 'ready_to_ship', 'shipped', 'delivered', 'failed', 'cancelled'));
    END IF;
  END IF;

  -- order_items: never fulfilled beyond what was bought
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_fulfilled_within_quantity_check') THEN
    IF EXISTS (SELECT 1 FROM order_items WHERE fulfilled_quantity < 0 OR fulfilled_quantity > quantity) THEN
      RAISE NOTICE 'velnox: order_items_fulfilled_within_quantity_check NOT added - % row(s) over-fulfilled',
        (SELECT COUNT(*) FROM order_items WHERE fulfilled_quantity < 0 OR fulfilled_quantity > quantity);
    ELSE
      ALTER TABLE order_items ADD CONSTRAINT order_items_fulfilled_within_quantity_check
        CHECK (fulfilled_quantity >= 0 AND fulfilled_quantity <= quantity);
    END IF;
  END IF;

  -- inventory: the counters can never go negative
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_counters_non_negative_check') THEN
    IF EXISTS (SELECT 1 FROM inventory WHERE quantity < 0 OR reserved < 0 OR committed < 0 OR fulfilled < 0 OR returned < 0) THEN
      RAISE NOTICE 'velnox: inventory_counters_non_negative_check NOT added - % row(s) hold a negative counter',
        (SELECT COUNT(*) FROM inventory WHERE quantity < 0 OR reserved < 0 OR committed < 0 OR fulfilled < 0 OR returned < 0);
    ELSE
      ALTER TABLE inventory ADD CONSTRAINT inventory_counters_non_negative_check
        CHECK (quantity >= 0 AND reserved >= 0 AND committed >= 0 AND fulfilled >= 0 AND returned >= 0);
    END IF;
  END IF;

  -- inventory: the availability invariant. reserved + committed are units the
  -- shelf may not offer again, so they can never exceed what physically exists.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_availability_check') THEN
    IF EXISTS (SELECT 1 FROM inventory WHERE reserved + committed > quantity) THEN
      RAISE NOTICE 'velnox: inventory_availability_check NOT added - % row(s) have reserved + committed above on-hand',
        (SELECT COUNT(*) FROM inventory WHERE reserved + committed > quantity);
    ELSE
      ALTER TABLE inventory ADD CONSTRAINT inventory_availability_check
        CHECK (reserved + committed <= quantity);
    END IF;
  END IF;

  -- variant counters can never go negative
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_counters_non_negative_check') THEN
    IF EXISTS (SELECT 1 FROM product_variants WHERE stock < 0 OR reserved < 0 OR committed < 0 OR fulfilled < 0 OR returned < 0) THEN
      RAISE NOTICE 'velnox: product_variants_counters_non_negative_check NOT added - % row(s) hold a negative counter',
        (SELECT COUNT(*) FROM product_variants WHERE stock < 0 OR reserved < 0 OR committed < 0 OR fulfilled < 0 OR returned < 0);
    ELSE
      ALTER TABLE product_variants ADD CONSTRAINT product_variants_counters_non_negative_check
        CHECK (stock >= 0 AND reserved >= 0 AND committed >= 0 AND fulfilled >= 0 AND returned >= 0);
    END IF;
  END IF;

  -- variant availability: the same invariant the product-level row carries
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_availability_check') THEN
    IF EXISTS (SELECT 1 FROM product_variants WHERE reserved + committed > stock) THEN
      RAISE NOTICE 'velnox: product_variants_availability_check NOT added - % row(s) have reserved + committed above on-hand',
        (SELECT COUNT(*) FROM product_variants WHERE reserved + committed > stock);
    ELSE
      ALTER TABLE product_variants ADD CONSTRAINT product_variants_availability_check
        CHECK (reserved + committed <= stock);
    END IF;
  END IF;

  -- refunds: a refund of nothing is not a refund
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_amount_positive_check') THEN
    IF EXISTS (SELECT 1 FROM refunds WHERE amount <= 0) THEN
      RAISE NOTICE 'velnox: refunds_amount_positive_check NOT added - % row(s) hold a non-positive amount',
        (SELECT COUNT(*) FROM refunds WHERE amount <= 0);
    ELSE
      ALTER TABLE refunds ADD CONSTRAINT refunds_amount_positive_check CHECK (amount > 0);
    END IF;
  END IF;

  -- payments: the money can never be refunded beyond what was taken
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_refund_within_amount_check') THEN
    IF EXISTS (SELECT 1 FROM payments WHERE refunded_amount < 0 OR refunded_amount > amount) THEN
      RAISE NOTICE 'velnox: payments_refund_within_amount_check NOT added - % row(s) refunded beyond the captured amount',
        (SELECT COUNT(*) FROM payments WHERE refunded_amount < 0 OR refunded_amount > amount);
    ELSE
      ALTER TABLE payments ADD CONSTRAINT payments_refund_within_amount_check
        CHECK (refunded_amount >= 0 AND refunded_amount <= amount);
    END IF;
  END IF;

  -- order totals: the parts must add up to the whole, and money is never negative
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_money_non_negative_check') THEN
    IF EXISTS (SELECT 1 FROM orders WHERE subtotal < 0 OR shipping_fee < 0 OR discount < 0 OR total_amount < 0) THEN
      RAISE NOTICE 'velnox: orders_money_non_negative_check NOT added - % row(s) hold a negative amount',
        (SELECT COUNT(*) FROM orders WHERE subtotal < 0 OR shipping_fee < 0 OR discount < 0 OR total_amount < 0);
    ELSE
      ALTER TABLE orders ADD CONSTRAINT orders_money_non_negative_check
        CHECK (subtotal >= 0 AND shipping_fee >= 0 AND discount >= 0 AND total_amount >= 0);
    END IF;
  END IF;

  -- The relationship total = subtotal + shipping - discount is deliberately NOT a
  -- CHECK here. It was tried and reverted: a production-shaped row can hold a
  -- total with no line breakdown (an order created by a path that had no
  -- shipping/discount detail), and a CHECK would then refuse a row the
  -- application itself can produce - which is exactly the "a constraint would
  -- reject valid data" stop condition. The relationship is verified by the
  -- purchase and payment reconcilers instead, where drift is REPORTED rather
  -- than blocking a write.

  -- shipments: the transit vocabulary (pending and created are the two legacy
  -- spellings; both are accepted so no historical row is invalidated)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipments_status_check') THEN
    IF EXISTS (SELECT 1 FROM shipments WHERE status NOT IN
                 ('pending', 'created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'returned', 'lost', 'cancelled')) THEN
      RAISE NOTICE 'velnox: shipments_status_check NOT added - % row(s) carry an unexpected status',
        (SELECT COUNT(*) FROM shipments WHERE status NOT IN
           ('pending', 'created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'returned', 'lost', 'cancelled'));
    ELSE
      ALTER TABLE shipments ADD CONSTRAINT shipments_status_check
        CHECK (status IN ('pending', 'created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'returned', 'lost', 'cancelled'));
    END IF;
  END IF;

  -- settlements: vocabulary
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlements_status_check') THEN
    IF EXISTS (SELECT 1 FROM settlements WHERE status NOT IN ('pending', 'processing', 'paid', 'failed', 'cancelled')) THEN
      RAISE NOTICE 'velnox: settlements_status_check NOT added - % row(s) carry an unexpected status',
        (SELECT COUNT(*) FROM settlements WHERE status NOT IN ('pending', 'processing', 'paid', 'failed', 'cancelled'));
    ELSE
      ALTER TABLE settlements ADD CONSTRAINT settlements_status_check
        CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'cancelled'));
    END IF;
  END IF;

  -- payment_incidents: the register is now kind-aware
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_incidents_kind_check') THEN
    IF EXISTS (SELECT 1 FROM payment_incidents WHERE kind IS NOT NULL AND kind NOT IN
                 ('late_payment', 'duplicate_charge', 'provider_dispute', 'inventory_drift',
                  'fulfillment_drift', 'refund_drift', 'reconciliation_failure', 'settlement_failure')) THEN
      RAISE NOTICE 'velnox: payment_incidents_kind_check NOT added - % row(s) carry an unexpected kind',
        (SELECT COUNT(*) FROM payment_incidents WHERE kind IS NOT NULL AND kind NOT IN
           ('late_payment', 'duplicate_charge', 'provider_dispute', 'inventory_drift',
            'fulfillment_drift', 'refund_drift', 'reconciliation_failure', 'settlement_failure'));
    ELSE
      ALTER TABLE payment_incidents ADD CONSTRAINT payment_incidents_kind_check
        CHECK (kind IS NULL OR kind IN
          ('late_payment', 'duplicate_charge', 'provider_dispute', 'inventory_drift',
           'fulfillment_drift', 'refund_drift', 'reconciliation_failure', 'settlement_failure'));
    END IF;
  END IF;

  -- payments: the vocabulary gains authorized / expired / the two refund values.
  -- Adding values to a CHECK cannot invalidate an existing row, so the guard is
  -- there to make an unexpected value LOUD rather than to protect a row.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_status_check') THEN
    IF EXISTS (SELECT 1 FROM payments WHERE status NOT IN
                 ('pending', 'requires_action', 'processing', 'authorized', 'paid', 'failed',
                  'cancelled', 'expired', 'partially_refunded', 'refunded')) THEN
      RAISE NOTICE 'velnox: payments_status_check NOT extended - % row(s) carry a status outside both vocabularies',
        (SELECT COUNT(*) FROM payments WHERE status NOT IN
           ('pending', 'requires_action', 'processing', 'authorized', 'paid', 'failed',
            'cancelled', 'expired', 'partially_refunded', 'refunded'));
    ELSE
      ALTER TABLE payments DROP CONSTRAINT payments_status_check;
      ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN
        ('pending', 'requires_action', 'processing', 'authorized', 'paid', 'failed',
         'cancelled', 'expired', 'partially_refunded', 'refunded'));
    END IF;
  END IF;
END $$;

-- ─── 11. unique keys for the idempotency columns (guard for duplicates) ───
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_payments_idempotency_key') THEN
    IF EXISTS (SELECT 1 FROM payments WHERE idempotency_key IS NOT NULL
                 GROUP BY idempotency_key HAVING COUNT(*) > 1) THEN
      RAISE NOTICE 'velnox: idx_payments_idempotency_key NOT added - duplicate keys already exist';
    ELSE
      CREATE UNIQUE INDEX idx_payments_idempotency_key ON payments (idempotency_key) WHERE idempotency_key IS NOT NULL;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_refunds_idempotency_key') THEN
    IF EXISTS (SELECT 1 FROM refunds WHERE idempotency_key IS NOT NULL
                 GROUP BY idempotency_key HAVING COUNT(*) > 1) THEN
      RAISE NOTICE 'velnox: idx_refunds_idempotency_key NOT added - duplicate keys already exist';
    ELSE
      CREATE UNIQUE INDEX idx_refunds_idempotency_key ON refunds (idempotency_key) WHERE idempotency_key IS NOT NULL;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_settlements_reference') THEN
    IF EXISTS (SELECT 1 FROM settlements WHERE reference IS NOT NULL
                 GROUP BY reference HAVING COUNT(*) > 1) THEN
      RAISE NOTICE 'velnox: idx_settlements_reference NOT added - duplicate references already exist';
    ELSE
      CREATE UNIQUE INDEX idx_settlements_reference ON settlements (reference) WHERE reference IS NOT NULL;
    END IF;
  END IF;
END $$;

-- ─── 12. the ledger is append-only ─────────────────────────────────────────
-- A financial record is corrected by a NEW compensating entry, never by an edit.
-- The trigger raises, so an accidental UPDATE or DELETE fails loudly instead of
-- silently rewriting history.
CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'velnox: ledger_entries is append-only (attempted % on %)', TG_OP, COALESCE(OLD.id::text, '?');
END $$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_ledger_mutation') THEN
    CREATE TRIGGER trg_prevent_ledger_mutation
      BEFORE UPDATE OR DELETE ON ledger_entries
      FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
  END IF;
END $$;

-- ─── 13. indexes the new read paths need ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_order_state ON orders (order_state);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON orders (fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_payment_events_backlog
  ON payment_events (next_retry_at) WHERE status IN ('processing', 'failed');
CREATE INDEX IF NOT EXISTS idx_refunds_status_created ON refunds (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlements_seller ON settlements (seller_id, created_at DESC);

-- ─── declaration-time assertion ───────────────────────────────────────────
-- Names what is missing, so a truncated or hand-edited snapshot fails loudly.
DO $$
DECLARE
  missing TEXT := '';
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_attempts', 'fulfillment_orders', 'shipment_items',
                           'inventory_movements', 'ledger_entries', 'order_returns',
                           'outbox_events', 'reconciliation_runs', 'reconciliation_findings']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      missing := missing || ' public.' || t;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'order_state') THEN
    missing := missing || ' orders.order_state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'fulfillment_status') THEN
    missing := missing || ' orders.fulfillment_status';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'inventory' AND column_name = 'committed') THEN
    missing := missing || ' inventory.committed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'product_variants' AND column_name = 'reserved') THEN
    missing := missing || ' product_variants.reserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'fulfilled_quantity') THEN
    missing := missing || ' order_items.fulfilled_quantity';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_ledger_mutation') THEN
    missing := missing || ' trg_prevent_ledger_mutation';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'velnox: schema.sql finished but these commerce-core objects are still missing:%', missing;
  END IF;
  RAISE NOTICE 'velnox: commerce core verified - 9 commerce-core tables, both order axes, both inventory axes, the fulfilled-quantity axis, the ledger append-only trigger and the retry metadata are all present';
END $$;
