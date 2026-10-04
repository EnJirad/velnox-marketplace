-- ============================================================================
-- Velnox - Neon SQL Editor bootstrap / reconciler
-- ============================================================================
-- PURPOSE
--   SAFE TO RUN REPEATEDLY in the Neon SQL Editor. Every run is additive: it
--   creates what is missing and leaves everything else alone.
--
--     table missing       -> CREATE TABLE IF NOT EXISTS
--     column missing      -> ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--     index missing       -> CREATE INDEX IF NOT EXISTS
--     constraint missing  -> added once, guarded on pg_constraint
--     foreign key missing -> added once, guarded on pg_constraint
--     trigger missing     -> created once, guarded on pg_trigger
--     function present    -> CREATE OR REPLACE (canonical body)
--
-- SAFETY CONTRACT
--   Never DROPs a table, never DROPs a column, never TRUNCATEs, never DELETEs
--   and never rewrites existing rows. Running this against production adds only
--   what that database is missing.
--
--   Errors are NOT swallowed: there is no EXCEPTION handler anywhere below, so
--   an unfixable problem stops the run instead of reporting a false success.
--
-- ORDERING
--   Tables, then columns, then indexes, then unique/check constraints, then
--   foreign keys, then triggers. Nothing here may depend on an object an earlier
--   part might not have created yet: an index is created only after its column
--   pass, a foreign key only after both of its tables, so a fresh database and an
--   old one converge on the same schema.
--
-- EXECUTION
--   Run the ENTIRE file, every run. Do not select part of it. The whole point is
--   that the column pass sits AFTER the table section, so a database whose
--   `orders` already exists but lacks `checkout_group_id` gets the column added;
--   running only the statements you expect to matter reproduces exactly the bug
--   this file is built to fix. Part 7 reports and Part 8 asserts the result.
--
-- VERIFICATION
--   Part 7 prints the state of the objects this schema depends on; it is
--   read-only and cannot change anything. Part 8 then ASSERTS: if checkout_groups,
--   either group column, a group index or a group foreign key is still absent
--   when the run reaches the end, it raises and the run FAILS. A green run means
--   the database really was reconciled, not that the script stayed quiet.
--
-- db/schema.sql stays the canonical schema SNAPSHOT. This file is the
-- rerunnable reconciler and additionally carries the additive passes below.
-- ============================================================================

-- Pin the schema. db/schema.sql - and therefore the table section below - uses
-- unqualified names, which is the convention every migration and every backend
-- query in this repo uses. Without this, the name `orders` resolves against
-- whatever search_path the session happens to have, so the run could create or
-- alter a table in a schema other than the one Part 4 and Part 7 verify. Pinning
-- it makes the unqualified names below mean public.orders, deterministically,
-- rather than assuming it.
SET search_path = public, pg_catalog;

-- ============================================================================
-- PART 1 - schema snapshot (create what is missing; never touch what exists)
-- ============================================================================
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
CREATE TABLE IF NOT EXISTS auth_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_id)
);
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

CREATE TABLE IF NOT EXISTS sellers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'needs_correction', 'approved', 'rejected', 'suspended')),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending','verified','rejected','suspended')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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
CREATE TABLE IF NOT EXISTS checkout_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'THB',
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  shop_count INTEGER NOT NULL DEFAULT 1 CHECK (shop_count >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Declared here, not next to orders: a foreign key needs its target to exist first,
-- so putting it before CREATE TABLE checkout_groups made a fresh bootstrap abort
-- with 42P01 "relation checkout_groups does not exist".
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
CREATE TABLE IF NOT EXISTS tracking_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'info',
  description TEXT,
  location TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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
  )
);
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
CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id),
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
CREATE TABLE IF NOT EXISTS customer_wishlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, product_id)
);
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
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);
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
CREATE TABLE IF NOT EXISTS option_value_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  option_value_id UUID NOT NULL REFERENCES product_option_values(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS product_variant_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  option_value_id UUID NOT NULL REFERENCES product_option_values(id) ON DELETE CASCADE,
  UNIQUE (variant_id, option_value_id)
);
CREATE TABLE IF NOT EXISTS product_attributes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_velrepeat_run_id_fkey') THEN ALTER TABLE orders ADD CONSTRAINT orders_velrepeat_run_id_fkey FOREIGN KEY (velrepeat_run_id) REFERENCES velrepeat_runs(id) ON DELETE SET NULL; END IF; END $$;
CREATE TABLE IF NOT EXISTS velrepeat_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES velrepeat_plans(id) ON DELETE CASCADE,
  run_id UUID REFERENCES velrepeat_runs(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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
CREATE TABLE IF NOT EXISTS velrepeat_package_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  package_id UUID NOT NULL REFERENCES velrepeat_packages(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_velrepeat_cycle_id_fkey') THEN ALTER TABLE orders ADD CONSTRAINT orders_velrepeat_cycle_id_fkey FOREIGN KEY (velrepeat_cycle_id) REFERENCES velrepeat_cycles(id) ON DELETE SET NULL; END IF; END $$;
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


-- The run table is `velrepeat_runs` (created above). An earlier revision of this
-- block named a `velrepeat_plan_runs` table that no migration and no backend
-- query ever created, so running this file on a fresh database aborted with
-- `relation "velrepeat_plan_runs" does not exist` — and so did migration V0044.


-- `orders.status` had no CHECK at all (audit MEDIUM #9), unlike every other
-- status column in this schema. It is the union of the FULFILMENT chain
-- (`backend/lib/order-fulfillment.ts`) and the PAYMENT lifecycle
-- (`routes/stripe.ts` + the reservation sweep writing `expired`), and the set
-- above is exactly what those writers can produce — derived from them, not
-- invented here. It refuses values the domain does not have; it does not
-- authorise transitions, which stay with `canTransitionFulfillment()`, the row
-- lock and the payment/shipment/cancellation gates. V0050.

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
-- PART 2 - column pass: add every column the database is missing
-- ============================================================================
-- CREATE TABLE IF NOT EXISTS does NOT reconcile an existing table, so each
-- column is also added explicitly. A NOT NULL column that has no DEFAULT is
-- added nullable first and promoted afterwards, because a populated table
-- cannot take a NOT NULL column with no value to give it.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS name TEXT DEFAULT '' NOT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS cover_url TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'customer' NOT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' NOT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.auth_identities ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.auth_identities ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.auth_identities ADD COLUMN IF NOT EXISTS provider VARCHAR(50);
ALTER TABLE public.auth_identities ADD COLUMN IF NOT EXISTS provider_id VARCHAR(255);
ALTER TABLE public.auth_identities ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.auth_identities ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}';
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.customer_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS label TEXT DEFAULT 'Home' NOT NULL;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS recipient_name TEXT DEFAULT '' NOT NULL;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS line1 TEXT;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS line2 TEXT;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS subdistrict TEXT;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'TH' NOT NULL;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.carts ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.carts ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.carts ADD COLUMN IF NOT EXISTS total_items INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.carts ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12, 2) DEFAULT 0 NOT NULL;
ALTER TABLE public.carts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.media ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.media ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE public.media ADD COLUMN IF NOT EXISTS key TEXT;
ALTER TABLE public.media ADD COLUMN IF NOT EXISTS content_type TEXT;
ALTER TABLE public.media ADD COLUMN IF NOT EXISTS size INTEGER;
ALTER TABLE public.media ADD COLUMN IF NOT EXISTS uploaded_by UUID;
ALTER TABLE public.media ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS parent_id UUID;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS names JSONB DEFAULT '{}';
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS description_names JSONB DEFAULT '{}';
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE NOT NULL;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'needs_correction', 'approved', 'rejected', 'suspended')) NOT NULL;
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending','verified','rejected','suspended')) NOT NULL;
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.seller_verifications ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.seller_verifications ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.seller_verifications ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'unverified' CHECK (status IN ('unverified','pending','verified','rejected','suspended')) NOT NULL;
ALTER TABLE public.seller_verifications ADD COLUMN IF NOT EXISTS verification_type TEXT DEFAULT 'identity' NOT NULL;
ALTER TABLE public.seller_verifications ADD COLUMN IF NOT EXISTS evidence_urls JSONB DEFAULT '[]';
ALTER TABLE public.seller_verifications ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE public.seller_verifications ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE public.seller_verifications ADD COLUMN IF NOT EXISTS reviewed_by UUID;
ALTER TABLE public.seller_verifications ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE public.seller_verifications ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE public.seller_verifications ADD COLUMN IF NOT EXISTS review_reason_code TEXT;
ALTER TABLE public.seller_verifications ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE public.seller_verifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.seller_verifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.seller_review_history ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.seller_review_history ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.seller_review_history ADD COLUMN IF NOT EXISTS application_id UUID;
ALTER TABLE public.seller_review_history ADD COLUMN IF NOT EXISTS previous_status TEXT;
ALTER TABLE public.seller_review_history ADD COLUMN IF NOT EXISTS new_status TEXT;
ALTER TABLE public.seller_review_history ADD COLUMN IF NOT EXISTS action TEXT;
ALTER TABLE public.seller_review_history ADD COLUMN IF NOT EXISTS reason_code TEXT;
ALTER TABLE public.seller_review_history ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.seller_review_history ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.seller_review_history ADD COLUMN IF NOT EXISTS reviewer_id UUID;
ALTER TABLE public.seller_review_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS logo TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS cover TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS rating NUMERIC(3, 2);
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS product_count INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS address_line1 TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS address_line2 TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS subdistrict TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'TH' NOT NULL;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS shop_id UUID;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '' NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS short_description TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(12, 2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'THB' NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'ชิ้น' NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS supplier TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft' NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS rating NUMERIC(3, 2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sold_count INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category_id TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vrepeat_enabled BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vrepeat_weekly_enabled BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vrepeat_monthly_enabled BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vrepeat_weekly_price NUMERIC(12, 2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vrepeat_monthly_price NUMERIC(12, 2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vrepeat_weekly_qty INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vrepeat_monthly_qty INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vrepeat_min_qty INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vrepeat_max_qty INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS featured_variant_id UUID;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending','verified','rejected','suspended')) NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2);
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(12, 2);
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2);
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')) NOT NULL;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS options JSONB DEFAULT '{}';
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS cart_id UUID;
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1 NOT NULL;
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2);
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS alt TEXT DEFAULT '' NOT NULL;
ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS image_type TEXT DEFAULT 'gallery' NOT NULL;
ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.product_variant_images ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.product_variant_images ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE public.product_variant_images ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.product_variant_images ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE public.product_variant_images ADD COLUMN IF NOT EXISTS alt TEXT DEFAULT '';
ALTER TABLE public.product_variant_images ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE public.product_variant_images ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.product_variant_images ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.product_verifications ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.product_verifications ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.product_verifications ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'unverified' CHECK (status IN ('unverified','pending','verified','rejected','suspended')) NOT NULL;
ALTER TABLE public.product_verifications ADD COLUMN IF NOT EXISTS verification_type TEXT DEFAULT 'standard' NOT NULL;
ALTER TABLE public.product_verifications ADD COLUMN IF NOT EXISTS evidence_urls JSONB DEFAULT '[]';
ALTER TABLE public.product_verifications ADD COLUMN IF NOT EXISTS evidence_notes TEXT;
ALTER TABLE public.product_verifications ADD COLUMN IF NOT EXISTS category_requirements JSONB DEFAULT '{}';
ALTER TABLE public.product_verifications ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE public.product_verifications ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE public.product_verifications ADD COLUMN IF NOT EXISTS reviewed_by UUID;
ALTER TABLE public.product_verifications ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE public.product_verifications ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE public.product_verifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.product_verifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS reserved INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS reorder_level INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 5 NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.seller_settings ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.seller_settings ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.seller_settings ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';
ALTER TABLE public.seller_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.seller_analytics ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.seller_analytics ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.seller_analytics ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE public.seller_analytics ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.seller_analytics ADD COLUMN IF NOT EXISTS orders INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.seller_analytics ADD COLUMN IF NOT EXISTS revenue NUMERIC(12, 2) DEFAULT 0 NOT NULL;
ALTER TABLE public.seller_analytics ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.seller_goals ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.seller_goals ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.seller_goals ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.seller_goals ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.seller_goals ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'other' NOT NULL;
ALTER TABLE public.seller_goals ADD COLUMN IF NOT EXISTS period TEXT DEFAULT 'monthly' NOT NULL;
ALTER TABLE public.seller_goals ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'ครั้ง' NOT NULL;
ALTER TABLE public.seller_goals ADD COLUMN IF NOT EXISTS target_value NUMERIC(14, 2) DEFAULT 0 NOT NULL;
ALTER TABLE public.seller_goals ADD COLUMN IF NOT EXISTS current_value NUMERIC(14, 2) DEFAULT 0 NOT NULL;
ALTER TABLE public.seller_goals ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ;
ALTER TABLE public.seller_goals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.seller_goals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shop_id UUID;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_number TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'packing', 'shipped', 'delivered', 'completed', 'cancelled', 'pending_payment', 'paid', 'payment_failed', 'refunded', 'expired')) NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12, 2) DEFAULT 0 NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(12, 2) DEFAULT 0 NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount NUMERIC(12, 2) DEFAULT 0 NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12, 2) DEFAULT 0 NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'THB' NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_address_id UUID;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_address JSONB;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS inventory_released BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS reservation_policy JSONB;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS velrepeat_run_id UUID;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS velrepeat_cycle_id UUID;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS checkout_group_id UUID;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.checkout_groups ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.checkout_groups ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.checkout_groups ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12, 2) DEFAULT 0 NOT NULL;
ALTER TABLE public.checkout_groups ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'THB' NOT NULL;
ALTER TABLE public.checkout_groups ADD COLUMN IF NOT EXISTS item_count INTEGER DEFAULT 0 CHECK (item_count >= 0) NOT NULL;
ALTER TABLE public.checkout_groups ADD COLUMN IF NOT EXISTS shop_count INTEGER DEFAULT 1 CHECK (shop_count >= 1) NOT NULL;
ALTER TABLE public.checkout_groups ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.checkout_requests ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.checkout_requests ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.checkout_requests ADD COLUMN IF NOT EXISTS request_key TEXT;
ALTER TABLE public.checkout_requests ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'checkout' NOT NULL;
ALTER TABLE public.checkout_requests ADD COLUMN IF NOT EXISTS order_id UUID;
ALTER TABLE public.checkout_requests ADD COLUMN IF NOT EXISTS response JSONB;
ALTER TABLE public.checkout_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS order_id UUID;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS shop_id UUID;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS product_name_snapshot TEXT DEFAULT '' NOT NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS variant_name_snapshot TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS image_url_snapshot TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS product_name TEXT DEFAULT '' NOT NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1 NOT NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12, 2) DEFAULT 0 NOT NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS order_id UUID;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS carrier TEXT DEFAULT '' NOT NULL;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS tracking_number TEXT;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' NOT NULL;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS estimated_delivery_date DATE;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.tracking_events ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.tracking_events ADD COLUMN IF NOT EXISTS shipment_id UUID;
ALTER TABLE public.tracking_events ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'info' NOT NULL;
ALTER TABLE public.tracking_events ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.tracking_events ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE public.tracking_events ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS order_id UUID;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS plan_id UUID;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS checkout_group_id UUID;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2) DEFAULT 0 NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'THB' NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS method TEXT DEFAULT 'cod' NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'cod' NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS provider_payment_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS provider_checkout_session_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(12, 2) DEFAULT 0 NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS refund_status TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS failure_code TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS failure_message TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.payment_events ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.payment_events ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE public.payment_events ADD COLUMN IF NOT EXISTS event_id TEXT;
ALTER TABLE public.payment_events ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE public.payment_events ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'processed' NOT NULL;
ALTER TABLE public.payment_events ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE public.payment_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.payment_events ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}';
ALTER TABLE public.payment_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.payment_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'stripe' NOT NULL;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS order_id UUID;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS plan_id UUID;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS payment_id UUID;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS provider_payment_intent_id TEXT;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS provider_checkout_session_id TEXT;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS event_id TEXT;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS order_status TEXT;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2);
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open' NOT NULL;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS resolution_note TEXT;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS resolved_by UUID;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.payment_incidents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS order_id UUID;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS payment_id UUID;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'stripe' NOT NULL;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS provider_refund_id TEXT;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2);
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' NOT NULL;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS requested_by UUID;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.commissions ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.commissions ADD COLUMN IF NOT EXISTS order_id UUID;
ALTER TABLE public.commissions ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.commissions ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2);
ALTER TABLE public.commissions ADD COLUMN IF NOT EXISTS rate NUMERIC(5, 4) DEFAULT 0.05 NOT NULL;
ALTER TABLE public.commissions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2);
ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' NOT NULL;
ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS shop_id UUID;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS frequency TEXT DEFAULT 'monthly' NOT NULL;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' NOT NULL;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS next_due_date TIMESTAMPTZ;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS department_id UUID;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'staff' CHECK (role IN ('admin', 'manager', 'staff')) NOT NULL;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employee_id TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]' NOT NULL;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS key TEXT;
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS value JSONB;
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS key TEXT;
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS value JSONB;
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS action TEXT;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS entity_id UUID;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}';
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.moderation_records ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.moderation_records ADD COLUMN IF NOT EXISTS moderator_id UUID;
ALTER TABLE public.moderation_records ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE public.moderation_records ADD COLUMN IF NOT EXISTS entity_id UUID;
ALTER TABLE public.moderation_records ADD COLUMN IF NOT EXISTS action TEXT;
ALTER TABLE public.moderation_records ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.moderation_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS data JSONB;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.customer_wishlist ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.customer_wishlist ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.customer_wishlist ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.customer_wishlist ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.behavioral_events ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.behavioral_events ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.behavioral_events ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE public.behavioral_events ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE public.behavioral_events ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE public.behavioral_events ADD COLUMN IF NOT EXISTS entity_id UUID;
ALTER TABLE public.behavioral_events ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE public.behavioral_events ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.behavioral_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.customer_events ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.customer_events ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.customer_events ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE public.customer_events ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.customer_events ADD COLUMN IF NOT EXISTS category_id TEXT;
ALTER TABLE public.customer_events ADD COLUMN IF NOT EXISTS shop_id UUID;
ALTER TABLE public.customer_events ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE public.customer_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS key TEXT;
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS value TEXT;
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS updated_by UUID;

ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS id BIGSERIAL;
ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS migration_name TEXT;
ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.revoked_tokens ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.revoked_tokens ADD COLUMN IF NOT EXISTS token_id TEXT;
ALTER TABLE public.revoked_tokens ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.revoked_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.revoked_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS shop_id UUID;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS package_type TEXT;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS quantity_total INTEGER;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS quantity_delivered INTEGER DEFAULT 0 CHECK (quantity_delivered >= 0) NOT NULL;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12, 2);
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS regular_unit_price NUMERIC(12, 2);
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2) DEFAULT 0 NOT NULL;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12, 2);
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'THB' NOT NULL;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'paid', 'active', 'paused', 'completed', 'cancelled', 'refunded')) NOT NULL;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS interval_days INTEGER DEFAULT 7 NOT NULL;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS payment_id UUID;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.vrepeat_packages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.vrepeat_deliveries ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.vrepeat_deliveries ADD COLUMN IF NOT EXISTS package_id UUID;
ALTER TABLE public.vrepeat_deliveries ADD COLUMN IF NOT EXISTS delivery_number INTEGER;
ALTER TABLE public.vrepeat_deliveries ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1 CHECK (quantity > 0) NOT NULL;
ALTER TABLE public.vrepeat_deliveries ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE public.vrepeat_deliveries ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
ALTER TABLE public.vrepeat_deliveries ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE public.vrepeat_deliveries ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'shipped', 'delivered', 'failed', 'cancelled')) NOT NULL;
ALTER TABLE public.vrepeat_deliveries ADD COLUMN IF NOT EXISTS tracking_number TEXT;
ALTER TABLE public.vrepeat_deliveries ADD COLUMN IF NOT EXISTS order_id UUID;
ALTER TABLE public.vrepeat_deliveries ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.vrepeat_deliveries ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.vrepeat_deliveries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS shop_id UUID;
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS order_id UUID;
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS rating INTEGER;
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS comment TEXT;
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]';
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')) NOT NULL;
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.product_reviews ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.product_option_groups ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.product_option_groups ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.product_option_groups ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.product_option_groups ADD COLUMN IF NOT EXISTS display_type TEXT DEFAULT 'text' CHECK (display_type IN ('text', 'color', 'image', 'button')) NOT NULL;
ALTER TABLE public.product_option_groups ADD COLUMN IF NOT EXISTS required BOOLEAN DEFAULT TRUE NOT NULL;
ALTER TABLE public.product_option_groups ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.product_option_groups ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.product_option_groups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.product_option_values ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.product_option_values ADD COLUMN IF NOT EXISTS option_group_id UUID;
ALTER TABLE public.product_option_values ADD COLUMN IF NOT EXISTS value TEXT;
ALTER TABLE public.product_option_values ADD COLUMN IF NOT EXISTS label TEXT DEFAULT '' NOT NULL;
ALTER TABLE public.product_option_values ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.product_option_values ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT TRUE NOT NULL;
ALTER TABLE public.product_option_values ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.product_option_values ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.option_value_images ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.option_value_images ADD COLUMN IF NOT EXISTS option_value_id UUID;
ALTER TABLE public.option_value_images ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE public.option_value_images ADD COLUMN IF NOT EXISTS alt TEXT DEFAULT '' NOT NULL;
ALTER TABLE public.option_value_images ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.option_value_images ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.product_variant_values ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.product_variant_values ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE public.product_variant_values ADD COLUMN IF NOT EXISTS option_value_id UUID;

ALTER TABLE public.product_attributes ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.product_attributes ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.product_attributes ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.product_attributes ADD COLUMN IF NOT EXISTS value TEXT;
ALTER TABLE public.product_attributes ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE public.product_attributes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS shop_id UUID;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS last_message TEXT;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived')) NOT NULL;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS conversation_id UUID;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS sender_id UUID;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS sender_role TEXT DEFAULT 'customer' CHECK (sender_role IN ('customer', 'seller')) NOT NULL;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'read')) NOT NULL;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'processing', 'payment_failed', 'out_of_stock', 'item_unavailable', 'price_changed', 'cancelled', 'completed')) NOT NULL;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS frequency_type TEXT;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS interval_value INTEGER DEFAULT 30 CHECK (interval_value > 0) NOT NULL;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS commitment_cycles INTEGER;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS shipping_address_id UUID;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS shipping_address JSONB;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cod' NOT NULL;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS payment_method_ref TEXT;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'THB' NOT NULL;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Asia/Bangkok' NOT NULL;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.velrepeat_plans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.velrepeat_items ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.velrepeat_items ADD COLUMN IF NOT EXISTS plan_id UUID;
ALTER TABLE public.velrepeat_items ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.velrepeat_items ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE public.velrepeat_items ADD COLUMN IF NOT EXISTS shop_id UUID;
ALTER TABLE public.velrepeat_items ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.velrepeat_items ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1 CHECK (quantity > 0) NOT NULL;
ALTER TABLE public.velrepeat_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12, 2);
ALTER TABLE public.velrepeat_items ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'THB' NOT NULL;
ALTER TABLE public.velrepeat_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.velrepeat_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.velrepeat_runs ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.velrepeat_runs ADD COLUMN IF NOT EXISTS plan_id UUID;
ALTER TABLE public.velrepeat_runs ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
ALTER TABLE public.velrepeat_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.velrepeat_runs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE public.velrepeat_runs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'success', 'payment_failed', 'out_of_stock', 'item_unavailable', 'price_changed', 'failed', 'cancelled')) NOT NULL;
ALTER TABLE public.velrepeat_runs ADD COLUMN IF NOT EXISTS order_id UUID;
ALTER TABLE public.velrepeat_runs ADD COLUMN IF NOT EXISTS error_code TEXT;
ALTER TABLE public.velrepeat_runs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE public.velrepeat_runs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE public.velrepeat_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.velrepeat_events ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.velrepeat_events ADD COLUMN IF NOT EXISTS plan_id UUID;
ALTER TABLE public.velrepeat_events ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE public.velrepeat_events ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE public.velrepeat_events ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE public.velrepeat_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.velrepeat_packages ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.velrepeat_packages ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.velrepeat_packages ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.velrepeat_packages ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.velrepeat_packages ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE NOT NULL;
ALTER TABLE public.velrepeat_packages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE public.velrepeat_packages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.velrepeat_packages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.velrepeat_package_items ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.velrepeat_package_items ADD COLUMN IF NOT EXISTS package_id UUID;
ALTER TABLE public.velrepeat_package_items ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.velrepeat_package_items ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE public.velrepeat_package_items ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1 CHECK (quantity > 0) NOT NULL;
ALTER TABLE public.velrepeat_package_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.velrepeat_package_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.velrepeat_pricing_snapshots ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.velrepeat_pricing_snapshots ADD COLUMN IF NOT EXISTS plan_id UUID;
ALTER TABLE public.velrepeat_pricing_snapshots ADD COLUMN IF NOT EXISTS commitment_cycles INTEGER;
ALTER TABLE public.velrepeat_pricing_snapshots ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'THB' NOT NULL;
ALTER TABLE public.velrepeat_pricing_snapshots ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(12, 2) DEFAULT 0 CHECK (subtotal_amount >= 0) NOT NULL;
ALTER TABLE public.velrepeat_pricing_snapshots ADD COLUMN IF NOT EXISTS discount_type TEXT;
ALTER TABLE public.velrepeat_pricing_snapshots ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12, 2);
ALTER TABLE public.velrepeat_pricing_snapshots ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2) DEFAULT 0 CHECK (discount_amount >= 0) NOT NULL;
ALTER TABLE public.velrepeat_pricing_snapshots ADD COLUMN IF NOT EXISTS cycle_price NUMERIC(12, 2);
ALTER TABLE public.velrepeat_pricing_snapshots ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12, 2);
ALTER TABLE public.velrepeat_pricing_snapshots ADD COLUMN IF NOT EXISTS pricing_rule_key TEXT;
ALTER TABLE public.velrepeat_pricing_snapshots ADD COLUMN IF NOT EXISTS pricing_rule_version TEXT;
ALTER TABLE public.velrepeat_pricing_snapshots ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE public.velrepeat_pricing_snapshots ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.velrepeat_pricing_snapshot_items ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.velrepeat_pricing_snapshot_items ADD COLUMN IF NOT EXISTS snapshot_id UUID;
ALTER TABLE public.velrepeat_pricing_snapshot_items ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.velrepeat_pricing_snapshot_items ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE public.velrepeat_pricing_snapshot_items ADD COLUMN IF NOT EXISTS quantity INTEGER;
ALTER TABLE public.velrepeat_pricing_snapshot_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12, 2);
ALTER TABLE public.velrepeat_pricing_snapshot_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(12, 2);
ALTER TABLE public.velrepeat_pricing_snapshot_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE public.velrepeat_cycles ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();
ALTER TABLE public.velrepeat_cycles ADD COLUMN IF NOT EXISTS plan_id UUID;
ALTER TABLE public.velrepeat_cycles ADD COLUMN IF NOT EXISTS cycle_number INTEGER;
ALTER TABLE public.velrepeat_cycles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'ordered', 'completed', 'skipped', 'cancelled', 'out_of_stock', 'item_unavailable')) NOT NULL;
ALTER TABLE public.velrepeat_cycles ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE public.velrepeat_cycles ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.velrepeat_cycles ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE public.velrepeat_cycles ADD COLUMN IF NOT EXISTS pricing_snapshot_id UUID;
ALTER TABLE public.velrepeat_cycles ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE public.velrepeat_cycles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE public.velrepeat_cycles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

-- Promote the columns that were added nullable because they are NOT NULL
-- without a DEFAULT. This runs only when no NULL remains, so it can never
-- fail on real data; when NULLs are present it says so out loud instead of
-- silently leaving the schema different from the canonical one.

DO $$
DECLARE
  t TEXT; c TEXT; n BIGINT;
BEGIN
  SELECT 'users','email' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'auth_identities','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'auth_identities','provider' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'auth_identities','provider_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'auth_identities','email' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'customer_profiles','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'addresses','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'addresses','phone' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'addresses','line1' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'addresses','city' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'addresses','state' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'addresses','postal_code' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'carts','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'media','url' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'media','key' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'media','content_type' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'media','size' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'categories','name' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'categories','slug' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'sellers','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'seller_verifications','seller_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'seller_review_history','seller_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'seller_review_history','new_status' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'seller_review_history','action' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'shops','seller_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'shops','name' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'shops','slug' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'products','shop_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'products','name' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'products','slug' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'products','price' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_variants','product_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_variants','name' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_variants','price' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'cart_items','cart_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'cart_items','product_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'cart_items','price' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_images','product_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_images','url' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_variant_images','variant_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_variant_images','product_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_variant_images','url' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_verifications','product_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'inventory','product_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'seller_settings','seller_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'seller_analytics','seller_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'seller_analytics','date' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'seller_goals','seller_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'seller_goals','title' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'orders','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'checkout_groups','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'checkout_requests','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'checkout_requests','request_key' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'order_items','order_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'order_items','product_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'order_items','price' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'shipments','order_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'tracking_events','shipment_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'payment_events','provider' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'payment_events','event_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'payment_events','event_type' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'payment_incidents','dedupe_key' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'payment_incidents','reason' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'refunds','order_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'refunds','amount' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'commissions','order_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'commissions','seller_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'commissions','amount' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'settlements','seller_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'settlements','amount' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'subscriptions','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'departments','name' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'employees','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'company_settings','key' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'company_settings','value' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'system_settings','key' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'system_settings','value' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'audit_logs','action' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'audit_logs','entity_type' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'moderation_records','entity_type' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'moderation_records','entity_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'moderation_records','action' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'notifications','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'notifications','type' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'notifications','title' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'notifications','message' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'customer_wishlist','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'customer_wishlist','product_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'behavioral_events','session_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'behavioral_events','event_type' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'customer_events','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'customer_events','event_type' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'platform_settings','value' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'schema_migrations','migration_name' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'revoked_tokens','token_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'revoked_tokens','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'revoked_tokens','expires_at' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'vrepeat_packages','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'vrepeat_packages','product_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'vrepeat_packages','shop_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'vrepeat_packages','seller_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'vrepeat_packages','package_type' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'vrepeat_packages','quantity_total' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'vrepeat_packages','unit_price' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'vrepeat_packages','regular_unit_price' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'vrepeat_packages','total_amount' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'vrepeat_deliveries','package_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'vrepeat_deliveries','delivery_number' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'vrepeat_deliveries','scheduled_at' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_reviews','product_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_reviews','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_reviews','rating' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_option_groups','product_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_option_groups','name' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_option_values','option_group_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_option_values','value' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'option_value_images','option_value_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'option_value_images','url' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_variant_values','variant_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_variant_values','option_value_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_attributes','product_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_attributes','name' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'product_attributes','value' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'conversations','customer_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'conversations','seller_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'conversations','shop_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'chat_messages','conversation_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'chat_messages','sender_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'chat_messages','body' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_plans','user_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_plans','frequency_type' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_plans','next_run_at' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_items','plan_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_items','product_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_items','shop_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_items','seller_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_items','unit_price' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_runs','plan_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_runs','scheduled_for' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_events','plan_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_events','event_type' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_packages','seller_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_packages','name' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_package_items','package_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_package_items','product_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_pricing_snapshots','plan_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_pricing_snapshots','commitment_cycles' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_pricing_snapshots','total_amount' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_pricing_snapshot_items','snapshot_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_pricing_snapshot_items','quantity' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_pricing_snapshot_items','unit_price' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_pricing_snapshot_items','line_total' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_cycles','plan_id' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_cycles','cycle_number' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
  SELECT 'velrepeat_cycles','scheduled_at' INTO t,c;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NULL', t, c) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', t, c);
  ELSE
    RAISE NOTICE 'velnox: %.% kept nullable - % row(s) have no value for it', t, c, n;
  END IF;
END $$;

-- ============================================================================
-- PART 2c - relax an over-strict NOT NULL
-- ============================================================================
-- A column that schema.sql no longer declares NOT NULL has, by definition,
-- become optional. Migration 054 is the live case: it made payments.order_id
-- nullable so one payment can cover several orders, but an older database still
-- holds NOT NULL and would reject that row. Dropping a NOT NULL only widens what
-- the column accepts and never touches stored rows. Primary-key columns are
-- excluded because Postgres refuses to make them nullable.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.is_nullable = 'NO'
       AND NOT EXISTS (
             SELECT 1 FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage k
               ON k.constraint_name = tc.constraint_name
              AND k.constraint_schema = tc.constraint_schema
            WHERE tc.table_schema = 'public' AND tc.table_name = c.table_name
              AND tc.constraint_type = 'PRIMARY KEY'
              AND k.column_name = c.column_name)
       AND (c.table_name, c.column_name) IN (
             ('users','id'), ('users','avatar'), ('users','cover_url'), ('users','phone'),
             ('users','department'), ('users','password_hash'), ('auth_identities','id'), ('customer_profiles','id'),
             ('customer_profiles','date_of_birth'), ('customer_profiles','gender'), ('customer_profiles','preferences'), ('addresses','id'),
             ('addresses','line2'), ('addresses','subdistrict'), ('addresses','district'), ('addresses','latitude'),
             ('addresses','longitude'), ('carts','id'), ('media','id'), ('media','uploaded_by'),
             ('categories','id'), ('categories','icon'), ('categories','parent_id'), ('categories','names'),
             ('categories','description'), ('categories','description_names'), ('categories','image_url'), ('sellers','id'),
             ('sellers','verified_at'), ('seller_verifications','id'), ('seller_verifications','evidence_urls'), ('seller_verifications','submitted_at'),
             ('seller_verifications','reviewed_at'), ('seller_verifications','reviewed_by'), ('seller_verifications','rejection_reason'), ('seller_verifications','suspension_reason'),
             ('seller_verifications','review_reason_code'), ('seller_verifications','review_note'), ('seller_review_history','id'), ('seller_review_history','application_id'),
             ('seller_review_history','previous_status'), ('seller_review_history','reason_code'), ('seller_review_history','reason'), ('seller_review_history','note'),
             ('seller_review_history','reviewer_id'), ('shops','id'), ('shops','description'), ('shops','logo'),
             ('shops','cover'), ('shops','rating'), ('shops','address_line1'), ('shops','address_line2'),
             ('shops','subdistrict'), ('shops','district'), ('shops','city'), ('shops','state'),
             ('shops','postal_code'), ('shops','phone'), ('shops','email'), ('shops','category'),
             ('products','id'), ('products','short_description'), ('products','compare_at_price'), ('products','supplier'),
             ('products','rejection_reason'), ('products','rating'), ('products','category_id'), ('products','vrepeat_weekly_price'),
             ('products','vrepeat_monthly_price'), ('products','vrepeat_weekly_qty'), ('products','vrepeat_monthly_qty'), ('products','vrepeat_min_qty'),
             ('products','vrepeat_max_qty'), ('products','featured_variant_id'), ('products','verified_at'), ('product_variants','id'),
             ('product_variants','sku'), ('product_variants','compare_at_price'), ('product_variants','discount_percent'), ('product_variants','options'),
             ('cart_items','id'), ('cart_items','variant_id'), ('product_images','id'), ('product_images','variant_id'),
             ('product_variant_images','id'), ('product_variant_images','alt'), ('product_variant_images','storage_key'), ('product_verifications','id'),
             ('product_verifications','evidence_urls'), ('product_verifications','evidence_notes'), ('product_verifications','category_requirements'), ('product_verifications','submitted_at'),
             ('product_verifications','reviewed_at'), ('product_verifications','reviewed_by'), ('product_verifications','rejection_reason'), ('product_verifications','suspension_reason'),
             ('inventory','id'), ('seller_settings','id'), ('seller_settings','settings'), ('seller_analytics','id'),
             ('seller_goals','id'), ('seller_goals','description'), ('seller_goals','due_date'), ('orders','id'),
             ('orders','shop_id'), ('orders','order_number'), ('orders','shipping_address_id'), ('orders','shipping_address'),
             ('orders','notes'), ('orders','payment_expires_at'), ('orders','reservation_policy'), ('orders','velrepeat_run_id'),
             ('orders','velrepeat_cycle_id'), ('orders','checkout_group_id'), ('checkout_groups','id'), ('checkout_requests','id'),
             ('checkout_requests','order_id'), ('checkout_requests','response'), ('order_items','id'), ('order_items','shop_id'),
             ('order_items','variant_id'), ('order_items','variant_name_snapshot'), ('order_items','image_url_snapshot'), ('shipments','id'),
             ('shipments','tracking_number'), ('shipments','estimated_delivery_date'), ('tracking_events','id'), ('tracking_events','description'),
             ('tracking_events','location'), ('payments','id'), ('payments','order_id'), ('payments','plan_id'),
             ('payments','checkout_group_id'), ('payments','provider_payment_id'), ('payments','provider_checkout_session_id'), ('payments','paid_at'),
             ('payments','refund_status'), ('payments','failure_code'), ('payments','failure_message'), ('payments','metadata'),
             ('payment_events','id'), ('payment_events','error'), ('payment_events','payload'), ('payment_incidents','id'),
             ('payment_incidents','order_id'), ('payment_incidents','plan_id'), ('payment_incidents','payment_id'), ('payment_incidents','provider_payment_intent_id'),
             ('payment_incidents','provider_checkout_session_id'), ('payment_incidents','event_id'), ('payment_incidents','order_status'), ('payment_incidents','amount'),
             ('payment_incidents','currency'), ('payment_incidents','resolution_note'), ('payment_incidents','resolved_by'), ('payment_incidents','resolved_at'),
             ('refunds','id'), ('refunds','payment_id'), ('refunds','provider_refund_id'), ('refunds','reason'),
             ('refunds','requested_by'), ('refunds','refunded_at'), ('refunds','failure_reason'), ('commissions','id'),
             ('settlements','id'), ('subscriptions','id'), ('subscriptions','product_id'), ('subscriptions','seller_id'),
             ('subscriptions','shop_id'), ('subscriptions','next_due_date'), ('subscriptions','metadata'), ('departments','id'),
             ('departments','description'), ('employees','id'), ('employees','department_id'), ('employees','employee_id'),
             ('company_settings','id'), ('company_settings','description'), ('system_settings','id'), ('system_settings','description'),
             ('audit_logs','id'), ('audit_logs','user_id'), ('audit_logs','entity_id'), ('audit_logs','details'),
             ('audit_logs','ip_address'), ('moderation_records','id'), ('moderation_records','moderator_id'), ('moderation_records','reason'),
             ('notifications','id'), ('notifications','body'), ('notifications','data'), ('notifications','metadata'),
             ('customer_wishlist','id'), ('behavioral_events','id'), ('behavioral_events','user_id'), ('behavioral_events','entity_type'),
             ('behavioral_events','entity_id'), ('behavioral_events','metadata'), ('customer_events','id'), ('customer_events','product_id'),
             ('customer_events','category_id'), ('customer_events','shop_id'), ('customer_events','metadata'), ('platform_settings','key'),
             ('platform_settings','description'), ('platform_settings','updated_by'), ('schema_migrations','id'), ('revoked_tokens','id'),
             ('vrepeat_packages','id'), ('vrepeat_packages','variant_id'), ('vrepeat_packages','started_at'), ('vrepeat_packages','completed_at'),
             ('vrepeat_packages','payment_id'), ('vrepeat_packages','metadata'), ('vrepeat_deliveries','id'), ('vrepeat_deliveries','shipped_at'),
             ('vrepeat_deliveries','delivered_at'), ('vrepeat_deliveries','tracking_number'), ('vrepeat_deliveries','order_id'), ('vrepeat_deliveries','notes'),
             ('product_reviews','id'), ('product_reviews','shop_id'), ('product_reviews','order_id'), ('product_reviews','title'),
             ('product_reviews','comment'), ('product_reviews','images'), ('product_option_groups','id'), ('product_option_values','id'),
             ('product_option_values','image_url'), ('option_value_images','id'), ('product_variant_values','id'), ('product_attributes','id'),
             ('conversations','id'), ('conversations','product_id'), ('conversations','last_message'), ('conversations','last_message_at'),
             ('chat_messages','id'), ('chat_messages','read_at'), ('velrepeat_plans','id'), ('velrepeat_plans','commitment_cycles'),
             ('velrepeat_plans','ended_at'), ('velrepeat_plans','shipping_address_id'), ('velrepeat_plans','shipping_address'), ('velrepeat_plans','payment_method_ref'),
             ('velrepeat_plans','notes'), ('velrepeat_plans','metadata'), ('velrepeat_items','id'), ('velrepeat_items','variant_id'),
             ('velrepeat_runs','id'), ('velrepeat_runs','completed_at'), ('velrepeat_runs','order_id'), ('velrepeat_runs','error_code'),
             ('velrepeat_runs','error_message'), ('velrepeat_runs','metadata'), ('velrepeat_events','id'), ('velrepeat_events','run_id'),
             ('velrepeat_events','metadata'), ('velrepeat_packages','id'), ('velrepeat_packages','description'), ('velrepeat_packages','metadata'),
             ('velrepeat_package_items','id'), ('velrepeat_package_items','variant_id'), ('velrepeat_pricing_snapshots','id'), ('velrepeat_pricing_snapshots','discount_type'),
             ('velrepeat_pricing_snapshots','discount_value'), ('velrepeat_pricing_snapshots','cycle_price'), ('velrepeat_pricing_snapshots','pricing_rule_key'), ('velrepeat_pricing_snapshots','pricing_rule_version'),
             ('velrepeat_pricing_snapshots','metadata'), ('velrepeat_pricing_snapshot_items','id'), ('velrepeat_pricing_snapshot_items','product_id'), ('velrepeat_pricing_snapshot_items','variant_id'),
             ('velrepeat_cycles','id'), ('velrepeat_cycles','started_at'), ('velrepeat_cycles','completed_at'), ('velrepeat_cycles','pricing_snapshot_id'),
             ('velrepeat_cycles','metadata')
       )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', r.table_name, r.column_name);
  END LOOP;
END $$;

-- ============================================================================
-- PART 3 - indexes
-- ============================================================================
-- These run AFTER the column pass on purpose. On an old database the table
-- already exists while the column an index is built on does not, and an index
-- created before that column is added would abort the whole run. IF NOT EXISTS
-- then makes each of these a no-op on every run after the first.

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email);
CREATE INDEX IF NOT EXISTS idx_auth_identities_provider ON public.auth_identities (provider, provider_id);
CREATE INDEX IF NOT EXISTS idx_auth_identities_email ON public.auth_identities (email);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON public.addresses (user_id);
CREATE INDEX IF NOT EXISTS idx_media_key ON public.media (key);
CREATE INDEX IF NOT EXISTS idx_media_owner ON public.media (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_media_owner_key ON public.media (uploaded_by, key);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON public.categories (slug);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON public.categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent_active ON public.categories (parent_id, is_active);
CREATE INDEX IF NOT EXISTS idx_sellers_user ON public.sellers (user_id);
CREATE INDEX IF NOT EXISTS idx_seller_verifications_seller ON public.seller_verifications (seller_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_verifications_pending ON public.seller_verifications (seller_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_seller_review_history_seller ON public.seller_review_history (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shops_slug ON public.shops (slug);
CREATE INDEX IF NOT EXISTS idx_shops_seller ON public.shops (seller_id);
CREATE INDEX IF NOT EXISTS idx_products_shop ON public.products (shop_id);
CREATE INDEX IF NOT EXISTS idx_products_shop_status ON public.products (shop_id, status);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON public.products (status);
CREATE INDEX IF NOT EXISTS idx_products_featured ON public.products (featured) WHERE featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_slug ON public.products (slug);
CREATE INDEX IF NOT EXISTS idx_products_price ON public.products (price);
CREATE INDEX IF NOT EXISTS idx_products_vrepeat ON public.products (vrepeat_enabled) WHERE vrepeat_enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_verification ON public.products (verification_status);
CREATE INDEX IF NOT EXISTS idx_products_featured_variant ON public.products (featured_variant_id) WHERE featured_variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_status ON public.product_variants (product_id, status);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON public.cart_items (cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_variant ON public.cart_items (variant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_items_unique ON public.cart_items (cart_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_product_images_product ON public.product_images (product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_type ON public.product_images (product_id, image_type);
CREATE INDEX IF NOT EXISTS idx_product_images_variant ON public.product_images (variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_variant_images_variant ON public.product_variant_images (variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_images_product ON public.product_variant_images (product_id);
CREATE INDEX IF NOT EXISTS idx_product_verifications_product ON public.product_verifications (product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_verifications_pending ON public.product_verifications (product_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_seller_analytics_seller_date ON public.seller_analytics (seller_id, date);
CREATE INDEX IF NOT EXISTS idx_seller_goals_seller ON public.seller_goals (seller_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_number_unique ON public.orders (order_number) WHERE order_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_unreleased ON public.orders (id) WHERE inventory_released = FALSE;
CREATE INDEX IF NOT EXISTS idx_orders_user ON public.orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_shop ON public.orders (shop_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_expires_at ON public.orders (payment_expires_at) WHERE payment_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_checkout_group ON public.orders (checkout_group_id) WHERE checkout_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checkout_groups_user ON public.checkout_groups (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_order ON public.checkout_requests (order_id);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_user ON public.checkout_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_shop ON public.order_items (shop_id);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON public.shipments (order_id);
CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment ON public.tracking_events (shipment_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_payments_order ON public.payments (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_plan ON public.payments (plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_provider_session ON public.payments (provider_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_payment ON public.payments (provider_payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_active_stripe ON public.payments (order_id) WHERE provider = 'stripe' AND status IN ('pending', 'requires_action');
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_active_stripe_group ON public.payments (checkout_group_id) WHERE provider = 'stripe' AND checkout_group_id IS NOT NULL AND status IN ('pending', 'requires_action');
CREATE INDEX IF NOT EXISTS idx_payments_checkout_group ON public.payments (checkout_group_id) WHERE checkout_group_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_active_stripe_plan ON public.payments (plan_id) WHERE provider = 'stripe' AND plan_id IS NOT NULL AND status IN ('pending', 'requires_action');
CREATE INDEX IF NOT EXISTS idx_payment_events_provider ON public.payment_events (provider);
CREATE INDEX IF NOT EXISTS idx_payment_events_type ON public.payment_events (event_type);
CREATE INDEX IF NOT EXISTS idx_payment_events_processed ON public.payment_events (processed_at);
CREATE INDEX IF NOT EXISTS idx_payment_incidents_order ON public.payment_incidents (order_id);
CREATE INDEX IF NOT EXISTS idx_payment_incidents_plan ON public.payment_incidents (plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_incidents_status ON public.payment_incidents (status);
CREATE INDEX IF NOT EXISTS payment_incidents_dedupe_key ON public.payment_incidents (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_payment_incidents_intent ON public.payment_incidents (provider_payment_intent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_provider_refund ON public.refunds (provider_refund_id);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON public.refunds (order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_payment ON public.refunds (payment_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_next_due ON public.subscriptions (next_due_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications (user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications (user_id, read) WHERE read = FALSE;
CREATE INDEX IF NOT EXISTS idx_customer_wishlist_user ON public.customer_wishlist (user_id);
CREATE INDEX IF NOT EXISTS idx_customer_wishlist_product ON public.customer_wishlist (product_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_user ON public.behavioral_events (user_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_session ON public.behavioral_events (session_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_type ON public.behavioral_events (event_type);
CREATE INDEX IF NOT EXISTS idx_behavioral_entity ON public.behavioral_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_time ON public.behavioral_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_customer_events_user ON public.customer_events (user_id);
CREATE INDEX IF NOT EXISTS idx_customer_events_type ON public.customer_events (event_type);
CREATE INDEX IF NOT EXISTS idx_customer_events_product ON public.customer_events (product_id);
CREATE INDEX IF NOT EXISTS idx_customer_events_user_type ON public.customer_events (user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_customer_events_created ON public.customer_events (created_at);
CREATE INDEX IF NOT EXISTS idx_platform_settings_key ON public.platform_settings (key);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_id ON public.revoked_tokens (token_id);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON public.revoked_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON public.revoked_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_user ON public.vrepeat_packages (user_id);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_product ON public.vrepeat_packages (product_id);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_shop ON public.vrepeat_packages (shop_id);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_seller ON public.vrepeat_packages (seller_id);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_status ON public.vrepeat_packages (status);
CREATE INDEX IF NOT EXISTS idx_vrepeat_packages_user_status ON public.vrepeat_packages (user_id, status);
CREATE INDEX IF NOT EXISTS idx_vrepeat_deliveries_package ON public.vrepeat_deliveries (package_id);
CREATE INDEX IF NOT EXISTS idx_vrepeat_deliveries_status ON public.vrepeat_deliveries (status);
CREATE INDEX IF NOT EXISTS idx_vrepeat_deliveries_scheduled ON public.vrepeat_deliveries (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_vrepeat_deliveries_order ON public.vrepeat_deliveries (order_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON public.product_reviews (product_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_user ON public.product_reviews (user_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_status ON public.product_reviews (product_id, status);
CREATE INDEX IF NOT EXISTS idx_option_groups_product ON public.product_option_groups (product_id);
CREATE INDEX IF NOT EXISTS idx_option_values_group ON public.product_option_values (option_group_id);
CREATE INDEX IF NOT EXISTS idx_option_value_images_value ON public.option_value_images (option_value_id);
CREATE INDEX IF NOT EXISTS idx_variant_values_variant ON public.product_variant_values (variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_values_option_value ON public.product_variant_values (option_value_id);
CREATE INDEX IF NOT EXISTS idx_product_attributes_product ON public.product_attributes (product_id);
CREATE INDEX IF NOT EXISTS idx_conversations_customer ON public.conversations (customer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_seller ON public.conversations (seller_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_shop ON public.conversations (shop_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON public.chat_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_unread ON public.chat_messages (conversation_id, sender_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_velrepeat_plans_user ON public.velrepeat_plans (user_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_plans_user_status ON public.velrepeat_plans (user_id, status);
CREATE INDEX IF NOT EXISTS idx_velrepeat_plans_due ON public.velrepeat_plans (status, next_run_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_velrepeat_items_plan ON public.velrepeat_items (plan_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_items_product ON public.velrepeat_items (product_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_items_variant ON public.velrepeat_items (variant_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_items_shop ON public.velrepeat_items (shop_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_items_unique_variant ON public.velrepeat_items (plan_id, product_id, variant_id) WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_items_unique_no_variant ON public.velrepeat_items (plan_id, product_id) WHERE variant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_velrepeat_runs_plan ON public.velrepeat_runs (plan_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_runs_status ON public.velrepeat_runs (status);
CREATE INDEX IF NOT EXISTS idx_velrepeat_runs_scheduled ON public.velrepeat_runs (scheduled_for);
CREATE INDEX IF NOT EXISTS idx_velrepeat_runs_order ON public.velrepeat_runs (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_velrepeat_run ON public.orders (velrepeat_run_id) WHERE velrepeat_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_velrepeat_events_plan ON public.velrepeat_events (plan_id, created_at);
CREATE INDEX IF NOT EXISTS idx_velrepeat_events_type ON public.velrepeat_events (event_type);
CREATE INDEX IF NOT EXISTS idx_velrepeat_events_run ON public.velrepeat_events (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_velrepeat_packages_active ON public.velrepeat_packages (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_velrepeat_packages_seller ON public.velrepeat_packages (seller_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_package_items_package ON public.velrepeat_package_items (package_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_package_items_product ON public.velrepeat_package_items (product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_package_items_unique_variant ON public.velrepeat_package_items (package_id, product_id, variant_id) WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_package_items_unique_no_variant ON public.velrepeat_package_items (package_id, product_id) WHERE variant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_velrepeat_pricing_snapshots_plan ON public.velrepeat_pricing_snapshots (plan_id, created_at);
CREATE INDEX IF NOT EXISTS idx_velrepeat_pricing_snapshot_items_snapshot ON public.velrepeat_pricing_snapshot_items (snapshot_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_pricing_snapshot_items_unique_variant ON public.velrepeat_pricing_snapshot_items (snapshot_id, product_id, variant_id) WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_pricing_snapshot_items_unique_no_variant ON public.velrepeat_pricing_snapshot_items (snapshot_id, product_id) WHERE variant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_velrepeat_cycles_plan ON public.velrepeat_cycles (plan_id);
CREATE INDEX IF NOT EXISTS idx_velrepeat_cycles_due ON public.velrepeat_cycles (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_orders_velrepeat_cycle ON public.orders (velrepeat_cycle_id) WHERE velrepeat_cycle_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_velrepeat_cycle_seller_unique ON public.orders (velrepeat_cycle_id, shop_id) WHERE velrepeat_cycle_id IS NOT NULL AND shop_id IS NOT NULL;

-- ============================================================================
-- PART 4 - foreign keys
-- ============================================================================
-- Added only when the constraint is absent AND both the column and the
-- referenced table exist, so the order of this file can never be the reason
-- a run fails.

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_identities_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='auth_identities' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.auth_identities ADD CONSTRAINT auth_identities_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_profiles_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='customer_profiles' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.customer_profiles ADD CONSTRAINT customer_profiles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'addresses_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='addresses' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.addresses ADD CONSTRAINT addresses_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carts_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='carts' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.carts ADD CONSTRAINT carts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_uploaded_by_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='media' AND column_name='uploaded_by')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.media ADD CONSTRAINT media_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES public.users(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_parent_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='categories' AND column_name='parent_id')
  AND to_regclass('public.categories') IS NOT NULL THEN
  ALTER TABLE public.categories ADD CONSTRAINT categories_parent_id_fkey
    FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sellers_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='sellers' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.sellers ADD CONSTRAINT sellers_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_verifications_seller_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='seller_verifications' AND column_name='seller_id')
  AND to_regclass('public.sellers') IS NOT NULL THEN
  ALTER TABLE public.seller_verifications ADD CONSTRAINT seller_verifications_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_verifications_reviewed_by_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='seller_verifications' AND column_name='reviewed_by')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.seller_verifications ADD CONSTRAINT seller_verifications_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES public.users(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_review_history_seller_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='seller_review_history' AND column_name='seller_id')
  AND to_regclass('public.sellers') IS NOT NULL THEN
  ALTER TABLE public.seller_review_history ADD CONSTRAINT seller_review_history_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_review_history_reviewer_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='seller_review_history' AND column_name='reviewer_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.seller_review_history ADD CONSTRAINT seller_review_history_reviewer_id_fkey
    FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_seller_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='shops' AND column_name='seller_id')
  AND to_regclass('public.sellers') IS NOT NULL THEN
  ALTER TABLE public.shops ADD CONSTRAINT shops_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_shop_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='products' AND column_name='shop_id')
  AND to_regclass('public.shops') IS NOT NULL THEN
  ALTER TABLE public.products ADD CONSTRAINT products_shop_id_fkey
    FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_variants' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_cart_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='cart_items' AND column_name='cart_id')
  AND to_regclass('public.carts') IS NOT NULL THEN
  ALTER TABLE public.cart_items ADD CONSTRAINT cart_items_cart_id_fkey
    FOREIGN KEY (cart_id) REFERENCES public.carts(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='cart_items' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.cart_items ADD CONSTRAINT cart_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_variant_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='cart_items' AND column_name='variant_id')
  AND to_regclass('public.product_variants') IS NOT NULL THEN
  ALTER TABLE public.cart_items ADD CONSTRAINT cart_items_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_images_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_images' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.product_images ADD CONSTRAINT product_images_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_images_variant_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_images' AND column_name='variant_id')
  AND to_regclass('public.product_variants') IS NOT NULL THEN
  ALTER TABLE public.product_images ADD CONSTRAINT product_images_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variant_images_variant_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_variant_images' AND column_name='variant_id')
  AND to_regclass('public.product_variants') IS NOT NULL THEN
  ALTER TABLE public.product_variant_images ADD CONSTRAINT product_variant_images_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variant_images_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_variant_images' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.product_variant_images ADD CONSTRAINT product_variant_images_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_verifications_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_verifications' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.product_verifications ADD CONSTRAINT product_verifications_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_verifications_reviewed_by_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_verifications' AND column_name='reviewed_by')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.product_verifications ADD CONSTRAINT product_verifications_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES public.users(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='inventory' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.inventory ADD CONSTRAINT inventory_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_settings_seller_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='seller_settings' AND column_name='seller_id')
  AND to_regclass('public.sellers') IS NOT NULL THEN
  ALTER TABLE public.seller_settings ADD CONSTRAINT seller_settings_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_analytics_seller_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='seller_analytics' AND column_name='seller_id')
  AND to_regclass('public.sellers') IS NOT NULL THEN
  ALTER TABLE public.seller_analytics ADD CONSTRAINT seller_analytics_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_goals_seller_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='seller_goals' AND column_name='seller_id')
  AND to_regclass('public.sellers') IS NOT NULL THEN
  ALTER TABLE public.seller_goals ADD CONSTRAINT seller_goals_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='orders' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.orders ADD CONSTRAINT orders_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_shop_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='orders' AND column_name='shop_id')
  AND to_regclass('public.shops') IS NOT NULL THEN
  ALTER TABLE public.orders ADD CONSTRAINT orders_shop_id_fkey
    FOREIGN KEY (shop_id) REFERENCES public.shops(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_shipping_address_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='orders' AND column_name='shipping_address_id')
  AND to_regclass('public.addresses') IS NOT NULL THEN
  ALTER TABLE public.orders ADD CONSTRAINT orders_shipping_address_id_fkey
    FOREIGN KEY (shipping_address_id) REFERENCES public.addresses(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_groups_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='checkout_groups' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.checkout_groups ADD CONSTRAINT checkout_groups_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_requests_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='checkout_requests' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.checkout_requests ADD CONSTRAINT checkout_requests_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_requests_order_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='checkout_requests' AND column_name='order_id')
  AND to_regclass('public.orders') IS NOT NULL THEN
  ALTER TABLE public.checkout_requests ADD CONSTRAINT checkout_requests_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_order_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='order_items' AND column_name='order_id')
  AND to_regclass('public.orders') IS NOT NULL THEN
  ALTER TABLE public.order_items ADD CONSTRAINT order_items_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='order_items' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.order_items ADD CONSTRAINT order_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_shop_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='order_items' AND column_name='shop_id')
  AND to_regclass('public.shops') IS NOT NULL THEN
  ALTER TABLE public.order_items ADD CONSTRAINT order_items_shop_id_fkey
    FOREIGN KEY (shop_id) REFERENCES public.shops(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_variant_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='order_items' AND column_name='variant_id')
  AND to_regclass('public.product_variants') IS NOT NULL THEN
  ALTER TABLE public.order_items ADD CONSTRAINT order_items_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipments_order_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='shipments' AND column_name='order_id')
  AND to_regclass('public.orders') IS NOT NULL THEN
  ALTER TABLE public.shipments ADD CONSTRAINT shipments_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracking_events_shipment_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='tracking_events' AND column_name='shipment_id')
  AND to_regclass('public.shipments') IS NOT NULL THEN
  ALTER TABLE public.tracking_events ADD CONSTRAINT tracking_events_shipment_id_fkey
    FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_order_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='payments' AND column_name='order_id')
  AND to_regclass('public.orders') IS NOT NULL THEN
  ALTER TABLE public.payments ADD CONSTRAINT payments_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_checkout_group_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='payments' AND column_name='checkout_group_id')
  AND to_regclass('public.checkout_groups') IS NOT NULL THEN
  ALTER TABLE public.payments ADD CONSTRAINT payments_checkout_group_id_fkey
    FOREIGN KEY (checkout_group_id) REFERENCES public.checkout_groups(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_incidents_order_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='payment_incidents' AND column_name='order_id')
  AND to_regclass('public.orders') IS NOT NULL THEN
  ALTER TABLE public.payment_incidents ADD CONSTRAINT payment_incidents_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_incidents_payment_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='payment_incidents' AND column_name='payment_id')
  AND to_regclass('public.payments') IS NOT NULL THEN
  ALTER TABLE public.payment_incidents ADD CONSTRAINT payment_incidents_payment_id_fkey
    FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_incidents_resolved_by_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='payment_incidents' AND column_name='resolved_by')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.payment_incidents ADD CONSTRAINT payment_incidents_resolved_by_fkey
    FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_order_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='refunds' AND column_name='order_id')
  AND to_regclass('public.orders') IS NOT NULL THEN
  ALTER TABLE public.refunds ADD CONSTRAINT refunds_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_payment_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='refunds' AND column_name='payment_id')
  AND to_regclass('public.payments') IS NOT NULL THEN
  ALTER TABLE public.refunds ADD CONSTRAINT refunds_payment_id_fkey
    FOREIGN KEY (payment_id) REFERENCES public.payments(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_requested_by_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='refunds' AND column_name='requested_by')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.refunds ADD CONSTRAINT refunds_requested_by_fkey
    FOREIGN KEY (requested_by) REFERENCES public.users(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commissions_order_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='commissions' AND column_name='order_id')
  AND to_regclass('public.orders') IS NOT NULL THEN
  ALTER TABLE public.commissions ADD CONSTRAINT commissions_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commissions_seller_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='commissions' AND column_name='seller_id')
  AND to_regclass('public.sellers') IS NOT NULL THEN
  ALTER TABLE public.commissions ADD CONSTRAINT commissions_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES public.sellers(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlements_seller_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='settlements' AND column_name='seller_id')
  AND to_regclass('public.sellers') IS NOT NULL THEN
  ALTER TABLE public.settlements ADD CONSTRAINT settlements_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES public.sellers(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='subscriptions' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='subscriptions' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_seller_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='subscriptions' AND column_name='seller_id')
  AND to_regclass('public.sellers') IS NOT NULL THEN
  ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES public.sellers(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_shop_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='subscriptions' AND column_name='shop_id')
  AND to_regclass('public.shops') IS NOT NULL THEN
  ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_shop_id_fkey
    FOREIGN KEY (shop_id) REFERENCES public.shops(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='employees' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.employees ADD CONSTRAINT employees_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_department_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='employees' AND column_name='department_id')
  AND to_regclass('public.departments') IS NOT NULL THEN
  ALTER TABLE public.employees ADD CONSTRAINT employees_department_id_fkey
    FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='audit_logs' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'moderation_records_moderator_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='moderation_records' AND column_name='moderator_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.moderation_records ADD CONSTRAINT moderation_records_moderator_id_fkey
    FOREIGN KEY (moderator_id) REFERENCES public.users(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='notifications' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_wishlist_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='customer_wishlist' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.customer_wishlist ADD CONSTRAINT customer_wishlist_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_wishlist_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='customer_wishlist' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.customer_wishlist ADD CONSTRAINT customer_wishlist_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'behavioral_events_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='behavioral_events' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.behavioral_events ADD CONSTRAINT behavioral_events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_events_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='customer_events' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.customer_events ADD CONSTRAINT customer_events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_events_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='customer_events' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.customer_events ADD CONSTRAINT customer_events_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_events_shop_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='customer_events' AND column_name='shop_id')
  AND to_regclass('public.shops') IS NOT NULL THEN
  ALTER TABLE public.customer_events ADD CONSTRAINT customer_events_shop_id_fkey
    FOREIGN KEY (shop_id) REFERENCES public.shops(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_updated_by_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='platform_settings' AND column_name='updated_by')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES public.users(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'revoked_tokens_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='revoked_tokens' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.revoked_tokens ADD CONSTRAINT revoked_tokens_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vrepeat_packages_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='vrepeat_packages' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.vrepeat_packages ADD CONSTRAINT vrepeat_packages_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vrepeat_packages_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='vrepeat_packages' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.vrepeat_packages ADD CONSTRAINT vrepeat_packages_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vrepeat_packages_variant_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='vrepeat_packages' AND column_name='variant_id')
  AND to_regclass('public.product_variants') IS NOT NULL THEN
  ALTER TABLE public.vrepeat_packages ADD CONSTRAINT vrepeat_packages_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vrepeat_packages_shop_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='vrepeat_packages' AND column_name='shop_id')
  AND to_regclass('public.shops') IS NOT NULL THEN
  ALTER TABLE public.vrepeat_packages ADD CONSTRAINT vrepeat_packages_shop_id_fkey
    FOREIGN KEY (shop_id) REFERENCES public.shops(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vrepeat_packages_seller_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='vrepeat_packages' AND column_name='seller_id')
  AND to_regclass('public.sellers') IS NOT NULL THEN
  ALTER TABLE public.vrepeat_packages ADD CONSTRAINT vrepeat_packages_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES public.sellers(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vrepeat_packages_payment_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='vrepeat_packages' AND column_name='payment_id')
  AND to_regclass('public.payments') IS NOT NULL THEN
  ALTER TABLE public.vrepeat_packages ADD CONSTRAINT vrepeat_packages_payment_id_fkey
    FOREIGN KEY (payment_id) REFERENCES public.payments(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vrepeat_deliveries_package_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='vrepeat_deliveries' AND column_name='package_id')
  AND to_regclass('public.vrepeat_packages') IS NOT NULL THEN
  ALTER TABLE public.vrepeat_deliveries ADD CONSTRAINT vrepeat_deliveries_package_id_fkey
    FOREIGN KEY (package_id) REFERENCES public.vrepeat_packages(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vrepeat_deliveries_order_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='vrepeat_deliveries' AND column_name='order_id')
  AND to_regclass('public.orders') IS NOT NULL THEN
  ALTER TABLE public.vrepeat_deliveries ADD CONSTRAINT vrepeat_deliveries_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_reviews_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_reviews' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.product_reviews ADD CONSTRAINT product_reviews_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_reviews_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_reviews' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.product_reviews ADD CONSTRAINT product_reviews_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_reviews_shop_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_reviews' AND column_name='shop_id')
  AND to_regclass('public.shops') IS NOT NULL THEN
  ALTER TABLE public.product_reviews ADD CONSTRAINT product_reviews_shop_id_fkey
    FOREIGN KEY (shop_id) REFERENCES public.shops(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_reviews_order_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_reviews' AND column_name='order_id')
  AND to_regclass('public.orders') IS NOT NULL THEN
  ALTER TABLE public.product_reviews ADD CONSTRAINT product_reviews_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_option_groups_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_option_groups' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.product_option_groups ADD CONSTRAINT product_option_groups_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_option_values_option_group_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_option_values' AND column_name='option_group_id')
  AND to_regclass('public.product_option_groups') IS NOT NULL THEN
  ALTER TABLE public.product_option_values ADD CONSTRAINT product_option_values_option_group_id_fkey
    FOREIGN KEY (option_group_id) REFERENCES public.product_option_groups(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'option_value_images_option_value_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='option_value_images' AND column_name='option_value_id')
  AND to_regclass('public.product_option_values') IS NOT NULL THEN
  ALTER TABLE public.option_value_images ADD CONSTRAINT option_value_images_option_value_id_fkey
    FOREIGN KEY (option_value_id) REFERENCES public.product_option_values(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variant_values_variant_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_variant_values' AND column_name='variant_id')
  AND to_regclass('public.product_variants') IS NOT NULL THEN
  ALTER TABLE public.product_variant_values ADD CONSTRAINT product_variant_values_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variant_values_option_value_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_variant_values' AND column_name='option_value_id')
  AND to_regclass('public.product_option_values') IS NOT NULL THEN
  ALTER TABLE public.product_variant_values ADD CONSTRAINT product_variant_values_option_value_id_fkey
    FOREIGN KEY (option_value_id) REFERENCES public.product_option_values(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_attributes_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='product_attributes' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.product_attributes ADD CONSTRAINT product_attributes_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_customer_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='conversations' AND column_name='customer_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.conversations ADD CONSTRAINT conversations_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_seller_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='conversations' AND column_name='seller_id')
  AND to_regclass('public.sellers') IS NOT NULL THEN
  ALTER TABLE public.conversations ADD CONSTRAINT conversations_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_shop_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='conversations' AND column_name='shop_id')
  AND to_regclass('public.shops') IS NOT NULL THEN
  ALTER TABLE public.conversations ADD CONSTRAINT conversations_shop_id_fkey
    FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='conversations' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.conversations ADD CONSTRAINT conversations_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_conversation_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='chat_messages' AND column_name='conversation_id')
  AND to_regclass('public.conversations') IS NOT NULL THEN
  ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_sender_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='chat_messages' AND column_name='sender_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_plans_user_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_plans' AND column_name='user_id')
  AND to_regclass('public.users') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_plans ADD CONSTRAINT velrepeat_plans_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_plans_shipping_address_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_plans' AND column_name='shipping_address_id')
  AND to_regclass('public.addresses') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_plans ADD CONSTRAINT velrepeat_plans_shipping_address_id_fkey
    FOREIGN KEY (shipping_address_id) REFERENCES public.addresses(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_items_plan_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_items' AND column_name='plan_id')
  AND to_regclass('public.velrepeat_plans') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_items ADD CONSTRAINT velrepeat_items_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.velrepeat_plans(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_items_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_items' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_items ADD CONSTRAINT velrepeat_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_items_variant_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_items' AND column_name='variant_id')
  AND to_regclass('public.product_variants') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_items ADD CONSTRAINT velrepeat_items_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_items_shop_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_items' AND column_name='shop_id')
  AND to_regclass('public.shops') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_items ADD CONSTRAINT velrepeat_items_shop_id_fkey
    FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_items_seller_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_items' AND column_name='seller_id')
  AND to_regclass('public.sellers') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_items ADD CONSTRAINT velrepeat_items_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_runs_plan_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_runs' AND column_name='plan_id')
  AND to_regclass('public.velrepeat_plans') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_runs ADD CONSTRAINT velrepeat_runs_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.velrepeat_plans(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_runs_order_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_runs' AND column_name='order_id')
  AND to_regclass('public.orders') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_runs ADD CONSTRAINT velrepeat_runs_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_events_plan_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_events' AND column_name='plan_id')
  AND to_regclass('public.velrepeat_plans') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_events ADD CONSTRAINT velrepeat_events_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.velrepeat_plans(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_events_run_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_events' AND column_name='run_id')
  AND to_regclass('public.velrepeat_runs') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_events ADD CONSTRAINT velrepeat_events_run_id_fkey
    FOREIGN KEY (run_id) REFERENCES public.velrepeat_runs(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_packages_seller_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_packages' AND column_name='seller_id')
  AND to_regclass('public.sellers') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_packages ADD CONSTRAINT velrepeat_packages_seller_id_fkey
    FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_package_items_package_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_package_items' AND column_name='package_id')
  AND to_regclass('public.velrepeat_packages') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_package_items ADD CONSTRAINT velrepeat_package_items_package_id_fkey
    FOREIGN KEY (package_id) REFERENCES public.velrepeat_packages(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_package_items_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_package_items' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_package_items ADD CONSTRAINT velrepeat_package_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_package_items_variant_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_package_items' AND column_name='variant_id')
  AND to_regclass('public.product_variants') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_package_items ADD CONSTRAINT velrepeat_package_items_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_pricing_snapshots_plan_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_pricing_snapshots' AND column_name='plan_id')
  AND to_regclass('public.velrepeat_plans') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_pricing_snapshots ADD CONSTRAINT velrepeat_pricing_snapshots_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.velrepeat_plans(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_pricing_snapshot_items_snapshot_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_pricing_snapshot_items' AND column_name='snapshot_id')
  AND to_regclass('public.velrepeat_pricing_snapshots') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_pricing_snapshot_items ADD CONSTRAINT velrepeat_pricing_snapshot_items_snapshot_id_fkey
    FOREIGN KEY (snapshot_id) REFERENCES public.velrepeat_pricing_snapshots(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_pricing_snapshot_items_product_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_pricing_snapshot_items' AND column_name='product_id')
  AND to_regclass('public.products') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_pricing_snapshot_items ADD CONSTRAINT velrepeat_pricing_snapshot_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_pricing_snapshot_items_variant_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_pricing_snapshot_items' AND column_name='variant_id')
  AND to_regclass('public.product_variants') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_pricing_snapshot_items ADD CONSTRAINT velrepeat_pricing_snapshot_items_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_cycles_plan_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_cycles' AND column_name='plan_id')
  AND to_regclass('public.velrepeat_plans') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_cycles ADD CONSTRAINT velrepeat_cycles_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.velrepeat_plans(id) ON DELETE CASCADE;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_cycles_pricing_snapshot_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='velrepeat_cycles' AND column_name='pricing_snapshot_id')
  AND to_regclass('public.velrepeat_pricing_snapshots') IS NOT NULL THEN
  ALTER TABLE public.velrepeat_cycles ADD CONSTRAINT velrepeat_cycles_pricing_snapshot_id_fkey
    FOREIGN KEY (pricing_snapshot_id) REFERENCES public.velrepeat_pricing_snapshots(id) ON DELETE SET NULL;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_plan_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='payments' AND column_name='plan_id')
  AND to_regclass('public.velrepeat_plans') IS NOT NULL THEN
  ALTER TABLE public.payments ADD CONSTRAINT payments_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES velrepeat_plans(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_incidents_plan_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='payment_incidents' AND column_name='plan_id')
  AND to_regclass('public.velrepeat_plans') IS NOT NULL THEN
  ALTER TABLE public.payment_incidents ADD CONSTRAINT payment_incidents_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES velrepeat_plans(id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_checkout_group_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='orders' AND column_name='checkout_group_id')
  AND to_regclass('public.checkout_groups') IS NOT NULL THEN
  ALTER TABLE public.orders ADD CONSTRAINT orders_checkout_group_id_fkey
    FOREIGN KEY (checkout_group_id) REFERENCES checkout_groups(id) ON DELETE SET NULL;
END IF; END $$;

-- ============================================================================
-- PART 5 - unique + check constraints
-- ============================================================================
-- Postgres names an inline UNIQUE <table>_<column>_key and a table-level
-- UNIQUE (a, b) <table>_a_b_key, so the guard uses the name the snapshot
-- would already have produced. Reusing it is what stops a duplicate from
-- being created under a second name.

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_key')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='users' AND column_name='email') THEN
  ALTER TABLE public.users ADD CONSTRAINT users_email_key UNIQUE (email);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_profiles_user_id_key')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='customer_profiles' AND column_name='user_id') THEN
  ALTER TABLE public.customer_profiles ADD CONSTRAINT customer_profiles_user_id_key UNIQUE (user_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carts_user_id_key')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='carts' AND column_name='user_id') THEN
  ALTER TABLE public.carts ADD CONSTRAINT carts_user_id_key UNIQUE (user_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_key_key')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='media' AND column_name='key') THEN
  ALTER TABLE public.media ADD CONSTRAINT media_key_key UNIQUE (key);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_slug_key')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='categories' AND column_name='slug') THEN
  ALTER TABLE public.categories ADD CONSTRAINT categories_slug_key UNIQUE (slug);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_slug_key')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='shops' AND column_name='slug') THEN
  ALTER TABLE public.shops ADD CONSTRAINT shops_slug_key UNIQUE (slug);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_slug_key')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='products' AND column_name='slug') THEN
  ALTER TABLE public.products ADD CONSTRAINT products_slug_key UNIQUE (slug);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_product_id_key')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='inventory' AND column_name='product_id') THEN
  ALTER TABLE public.inventory ADD CONSTRAINT inventory_product_id_key UNIQUE (product_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_settings_seller_id_key')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='seller_settings' AND column_name='seller_id') THEN
  ALTER TABLE public.seller_settings ADD CONSTRAINT seller_settings_seller_id_key UNIQUE (seller_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_events_event_id_key')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='payment_events' AND column_name='event_id') THEN
  ALTER TABLE public.payment_events ADD CONSTRAINT payment_events_event_id_key UNIQUE (event_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_incidents_dedupe_key_key')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='payment_incidents' AND column_name='dedupe_key') THEN
  ALTER TABLE public.payment_incidents ADD CONSTRAINT payment_incidents_dedupe_key_key UNIQUE (dedupe_key);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_settings_key_key')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='company_settings' AND column_name='key') THEN
  ALTER TABLE public.company_settings ADD CONSTRAINT company_settings_key_key UNIQUE (key);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'system_settings_key_key')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='system_settings' AND column_name='key') THEN
  ALTER TABLE public.system_settings ADD CONSTRAINT system_settings_key_key UNIQUE (key);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schema_migrations_migration_name_key')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='schema_migrations' AND column_name='migration_name') THEN
  ALTER TABLE public.schema_migrations ADD CONSTRAINT schema_migrations_migration_name_key UNIQUE (migration_name);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'revoked_tokens_token_id_key')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='revoked_tokens' AND column_name='token_id') THEN
  ALTER TABLE public.revoked_tokens ADD CONSTRAINT revoked_tokens_token_id_key UNIQUE (token_id);
END IF; END $$;
-- Migration 054 superseded this check. Left in place it would reject exactly the
-- payment this schema exists to allow: one payment covering several orders.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_exactly_one_parent_check;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_identities_provider_provider_id_key') THEN
  ALTER TABLE public.auth_identities ADD CONSTRAINT auth_identities_provider_provider_id_key UNIQUE (provider, provider_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_analytics_seller_id_date_key') THEN
  ALTER TABLE public.seller_analytics ADD CONSTRAINT seller_analytics_seller_id_date_key UNIQUE (seller_id, date);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_requests_user_scope_key') THEN
  ALTER TABLE public.checkout_requests ADD CONSTRAINT checkout_requests_user_scope_key UNIQUE (user_id, scope, request_key);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_at_least_one_parent_check') THEN
  ALTER TABLE public.payments ADD CONSTRAINT payments_at_least_one_parent_check CHECK (order_id IS NOT NULL OR plan_id IS NOT NULL OR checkout_group_id IS NOT NULL);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_single_domain_check') THEN
  ALTER TABLE public.payments ADD CONSTRAINT payments_single_domain_check CHECK (NOT (plan_id IS NOT NULL AND (order_id IS NOT NULL OR checkout_group_id IS NOT NULL)));
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_incidents_exactly_one_parent_check') THEN
  ALTER TABLE public.payment_incidents ADD CONSTRAINT payment_incidents_exactly_one_parent_check CHECK ((order_id IS NOT NULL AND plan_id IS NULL) OR (order_id IS NULL AND plan_id IS NOT NULL));
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_wishlist_user_id_product_id_key') THEN
  ALTER TABLE public.customer_wishlist ADD CONSTRAINT customer_wishlist_user_id_product_id_key UNIQUE (user_id, product_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vrepeat_deliveries_package_id_delivery_number_key') THEN
  ALTER TABLE public.vrepeat_deliveries ADD CONSTRAINT vrepeat_deliveries_package_id_delivery_number_key UNIQUE (package_id, delivery_number);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_reviews_product_id_user_id_key') THEN
  ALTER TABLE public.product_reviews ADD CONSTRAINT product_reviews_product_id_user_id_key UNIQUE (product_id, user_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variant_values_variant_id_option_value_id_key') THEN
  ALTER TABLE public.product_variant_values ADD CONSTRAINT product_variant_values_variant_id_option_value_id_key UNIQUE (variant_id, option_value_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_customer_id_shop_id_key') THEN
  ALTER TABLE public.conversations ADD CONSTRAINT conversations_customer_id_shop_id_key UNIQUE (customer_id, shop_id);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_runs_plan_id_scheduled_for_key') THEN
  ALTER TABLE public.velrepeat_runs ADD CONSTRAINT velrepeat_runs_plan_id_scheduled_for_key UNIQUE (plan_id, scheduled_for);
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'velrepeat_cycles_plan_id_cycle_number_key') THEN
  ALTER TABLE public.velrepeat_cycles ADD CONSTRAINT velrepeat_cycles_plan_id_cycle_number_key UNIQUE (plan_id, cycle_number);
END IF; END $$;

-- ============================================================================
-- PART 5c - CHECKs that schema.sql deliberately re-declares
-- ============================================================================
-- These six checks are re-declared in schema.sql because their definition
-- changed. An older database still holds the previous definition under the same
-- name, so a name-only guard would silently keep it and reject a value the
-- canonical schema allows. Postgres normalises the desired definition through a
-- throwaway temp table, so the stored one is compared to it exactly: when they
-- already match this is a no-op and no lock is taken on the real table.
DO $$
DECLARE have TEXT; want TEXT;
BEGIN
  CREATE TEMP TABLE velnox_defn_probe_1 (LIKE public.velrepeat_pricing_snapshots) ON COMMIT DROP;
  ALTER TABLE velnox_defn_probe_1 ADD CONSTRAINT velnox_defn_probe_ck CHECK (cycle_price IS NOT NULL);
  SELECT pg_get_constraintdef(oid) INTO want
    FROM pg_constraint WHERE conname = 'velnox_defn_probe_ck';
  SELECT pg_get_constraintdef(oid) INTO have FROM pg_constraint WHERE conname = 'velrepeat_pricing_snapshots_cycle_price_not_null';
  IF have IS NULL THEN
    ALTER TABLE public.velrepeat_pricing_snapshots ADD CONSTRAINT velrepeat_pricing_snapshots_cycle_price_not_null CHECK (cycle_price IS NOT NULL);
  ELSIF have IS DISTINCT FROM want THEN
    RAISE NOTICE 'velnox: %.% had a stored definition that db/schema.sql no longer declares; applying the canonical one', 'velrepeat_pricing_snapshots', 'velrepeat_pricing_snapshots_cycle_price_not_null';
    ALTER TABLE public.velrepeat_pricing_snapshots DROP CONSTRAINT velrepeat_pricing_snapshots_cycle_price_not_null;
    ALTER TABLE public.velrepeat_pricing_snapshots ADD CONSTRAINT velrepeat_pricing_snapshots_cycle_price_not_null CHECK (cycle_price IS NOT NULL);
  END IF;
END $$;
DO $$
DECLARE have TEXT; want TEXT;
BEGIN
  CREATE TEMP TABLE velnox_defn_probe_2 (LIKE public.velrepeat_pricing_snapshots) ON COMMIT DROP;
  ALTER TABLE velnox_defn_probe_2 ADD CONSTRAINT velnox_defn_probe_ck CHECK (cycle_price IS NULL OR total_amount >= cycle_price);
  SELECT pg_get_constraintdef(oid) INTO want
    FROM pg_constraint WHERE conname = 'velnox_defn_probe_ck';
  SELECT pg_get_constraintdef(oid) INTO have FROM pg_constraint WHERE conname = 'velrepeat_pricing_snapshots_total_not_below_cycle';
  IF have IS NULL THEN
    ALTER TABLE public.velrepeat_pricing_snapshots ADD CONSTRAINT velrepeat_pricing_snapshots_total_not_below_cycle CHECK (cycle_price IS NULL OR total_amount >= cycle_price);
  ELSIF have IS DISTINCT FROM want THEN
    RAISE NOTICE 'velnox: %.% had a stored definition that db/schema.sql no longer declares; applying the canonical one', 'velrepeat_pricing_snapshots', 'velrepeat_pricing_snapshots_total_not_below_cycle';
    ALTER TABLE public.velrepeat_pricing_snapshots DROP CONSTRAINT velrepeat_pricing_snapshots_total_not_below_cycle;
    ALTER TABLE public.velrepeat_pricing_snapshots ADD CONSTRAINT velrepeat_pricing_snapshots_total_not_below_cycle CHECK (cycle_price IS NULL OR total_amount >= cycle_price);
  END IF;
END $$;
DO $$
DECLARE have TEXT; want TEXT;
BEGIN
  CREATE TEMP TABLE velnox_defn_probe_3 (LIKE public.velrepeat_plans) ON COMMIT DROP;
  ALTER TABLE velnox_defn_probe_3 ADD CONSTRAINT velnox_defn_probe_ck CHECK (status IN ('draft', 'active', 'paused', 'processing', 'payment_failed', 'out_of_stock', 'item_unavailable', 'price_changed', 'cancelled', 'completed'));
  SELECT pg_get_constraintdef(oid) INTO want
    FROM pg_constraint WHERE conname = 'velnox_defn_probe_ck';
  SELECT pg_get_constraintdef(oid) INTO have FROM pg_constraint WHERE conname = 'velrepeat_plans_status_check';
  IF have IS NULL THEN
    ALTER TABLE public.velrepeat_plans ADD CONSTRAINT velrepeat_plans_status_check CHECK (status IN ('draft', 'active', 'paused', 'processing', 'payment_failed', 'out_of_stock', 'item_unavailable', 'price_changed', 'cancelled', 'completed'));
  ELSIF have IS DISTINCT FROM want THEN
    RAISE NOTICE 'velnox: %.% had a stored definition that db/schema.sql no longer declares; applying the canonical one', 'velrepeat_plans', 'velrepeat_plans_status_check';
    ALTER TABLE public.velrepeat_plans DROP CONSTRAINT velrepeat_plans_status_check;
    ALTER TABLE public.velrepeat_plans ADD CONSTRAINT velrepeat_plans_status_check CHECK (status IN ('draft', 'active', 'paused', 'processing', 'payment_failed', 'out_of_stock', 'item_unavailable', 'price_changed', 'cancelled', 'completed'));
  END IF;
END $$;
DO $$
DECLARE have TEXT; want TEXT;
BEGIN
  CREATE TEMP TABLE velnox_defn_probe_4 (LIKE public.velrepeat_runs) ON COMMIT DROP;
  ALTER TABLE velnox_defn_probe_4 ADD CONSTRAINT velnox_defn_probe_ck CHECK (status IN ('processing', 'success', 'payment_failed', 'out_of_stock', 'item_unavailable', 'price_changed', 'failed', 'cancelled'));
  SELECT pg_get_constraintdef(oid) INTO want
    FROM pg_constraint WHERE conname = 'velnox_defn_probe_ck';
  SELECT pg_get_constraintdef(oid) INTO have FROM pg_constraint WHERE conname = 'velrepeat_runs_status_check';
  IF have IS NULL THEN
    ALTER TABLE public.velrepeat_runs ADD CONSTRAINT velrepeat_runs_status_check CHECK (status IN ('processing', 'success', 'payment_failed', 'out_of_stock', 'item_unavailable', 'price_changed', 'failed', 'cancelled'));
  ELSIF have IS DISTINCT FROM want THEN
    RAISE NOTICE 'velnox: %.% had a stored definition that db/schema.sql no longer declares; applying the canonical one', 'velrepeat_runs', 'velrepeat_runs_status_check';
    ALTER TABLE public.velrepeat_runs DROP CONSTRAINT velrepeat_runs_status_check;
    ALTER TABLE public.velrepeat_runs ADD CONSTRAINT velrepeat_runs_status_check CHECK (status IN ('processing', 'success', 'payment_failed', 'out_of_stock', 'item_unavailable', 'price_changed', 'failed', 'cancelled'));
  END IF;
END $$;
DO $$
DECLARE have TEXT; want TEXT;
BEGIN
  CREATE TEMP TABLE velnox_defn_probe_5 (LIKE public.sellers) ON COMMIT DROP;
  ALTER TABLE velnox_defn_probe_5 ADD CONSTRAINT velnox_defn_probe_ck CHECK (status IN ('pending', 'under_review', 'needs_correction', 'approved', 'rejected', 'suspended'));
  SELECT pg_get_constraintdef(oid) INTO want
    FROM pg_constraint WHERE conname = 'velnox_defn_probe_ck';
  SELECT pg_get_constraintdef(oid) INTO have FROM pg_constraint WHERE conname = 'sellers_status_check';
  IF have IS NULL THEN
    ALTER TABLE public.sellers ADD CONSTRAINT sellers_status_check CHECK (status IN ('pending', 'under_review', 'needs_correction', 'approved', 'rejected', 'suspended'));
  ELSIF have IS DISTINCT FROM want THEN
    RAISE NOTICE 'velnox: %.% had a stored definition that db/schema.sql no longer declares; applying the canonical one', 'sellers', 'sellers_status_check';
    ALTER TABLE public.sellers DROP CONSTRAINT sellers_status_check;
    ALTER TABLE public.sellers ADD CONSTRAINT sellers_status_check CHECK (status IN ('pending', 'under_review', 'needs_correction', 'approved', 'rejected', 'suspended'));
  END IF;
END $$;
DO $$
DECLARE have TEXT; want TEXT;
BEGIN
  CREATE TEMP TABLE velnox_defn_probe_6 (LIKE public.orders) ON COMMIT DROP;
  ALTER TABLE velnox_defn_probe_6 ADD CONSTRAINT velnox_defn_probe_ck CHECK (status IN ('pending', 'confirmed', 'packing', 'shipped', 'delivered', 'completed', 'cancelled', 'pending_payment', 'paid', 'payment_failed', 'refunded', 'expired'));
  SELECT pg_get_constraintdef(oid) INTO want
    FROM pg_constraint WHERE conname = 'velnox_defn_probe_ck';
  SELECT pg_get_constraintdef(oid) INTO have FROM pg_constraint WHERE conname = 'orders_status_check';
  IF have IS NULL THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending', 'confirmed', 'packing', 'shipped', 'delivered', 'completed', 'cancelled', 'pending_payment', 'paid', 'payment_failed', 'refunded', 'expired'));
  ELSIF have IS DISTINCT FROM want THEN
    RAISE NOTICE 'velnox: %.% had a stored definition that db/schema.sql no longer declares; applying the canonical one', 'orders', 'orders_status_check';
    ALTER TABLE public.orders DROP CONSTRAINT orders_status_check;
    ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending', 'confirmed', 'packing', 'shipped', 'delivered', 'completed', 'cancelled', 'pending_payment', 'paid', 'payment_failed', 'refunded', 'expired'));
  END IF;
END $$;

-- ============================================================================
-- PART 6 - triggers
-- ============================================================================
-- A bare CREATE TRIGGER fails on the second run. Guarded on pg_trigger so
-- the trigger is created exactly once and never duplicated.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_prevent_circular_category_parent' AND tgrelid = to_regclass('public.categories') AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_prevent_circular_category_parent
      BEFORE INSERT OR UPDATE OF parent_id ON categories
  FOR EACH ROW
  EXECUTE FUNCTION prevent_circular_category_parent();
  END IF;
END $$;

-- ============================================================================
-- PART 7 - verification (read-only; reports, never raises)
-- ============================================================================
-- Safe to leave in the file: every statement below is a SELECT.

SELECT 'checkout_groups' AS object, to_regclass('public.checkout_groups') IS NOT NULL AS ok;
-- The exact shape PART 8 asserts: table | column | type. Not the column NAME --
-- a column that exists under the wrong type is what a stale database carries,
-- and the name alone would report that as reconciled.
SELECT c.table_name, c.column_name, c.udt_name AS data_type
FROM information_schema.columns c
WHERE c.table_schema='public'
  AND c.column_name='checkout_group_id'
  AND c.table_name IN ('orders','payments')
ORDER BY c.table_name;
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public'
  AND indexname IN ('idx_checkout_groups_user','idx_orders_checkout_group','idx_payments_checkout_group',
                    'idx_payments_one_active_stripe_group')
ORDER BY indexname;
-- What each group foreign key actually points at, and what it does on delete.
-- Name-only would accept a same-named constraint on the wrong parent.
SELECT con.conname,
       (SELECT rel.relname FROM pg_class rel WHERE rel.oid = con.confrelid) AS references_table,
       con.confdeltype AS on_delete,
       CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete_action
FROM pg_constraint con
WHERE con.conname IN ('orders_checkout_group_id_fkey','payments_checkout_group_id_fkey')
ORDER BY con.conname;
SELECT 'tables' AS metric, count(*)::text AS value FROM information_schema.tables WHERE table_schema='public'
UNION ALL SELECT 'columns', count(*)::text FROM information_schema.columns WHERE table_schema='public'
UNION ALL SELECT 'constraints', count(*)::text FROM pg_constraint c
UNION ALL SELECT 'indexes', count(*)::text FROM pg_indexes WHERE schemaname='public';

-- ============================================================================
-- PART 8 - assertion (fails the run if reconciliation did not finish)
-- ============================================================================
-- PART 7 only REPORTS. This one FAILS. A run that ends here without an error
-- has verified, against the live catalog, that the objects the checkout flow
-- reads and writes all exist AND are the shape the code binds: the
-- checkout_groups table, both group columns as `uuid`, the four group indexes
-- covering those columns, and the two group foreign keys pointing at
-- checkout_groups(id) ON DELETE SET NULL.
--
-- WHY TYPE AND TARGET ARE ASSERTED, NOT JUST THE NAME
-- ---------------------------------------------------
-- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS <name> <type>` is a no-op when a
-- column of that NAME already exists under a DIFFERENT type, and a foreign key
-- is dropped by name-check alone never. Both pass a name-only verification and
-- both then fail at runtime as `42703`/`42804` in the payment path. Existence is
-- the minimum this file is allowed to claim.
--
-- It raises rather than returning a row, so it cannot be overlooked, and it
-- has no EXCEPTION handler, so nothing here can swallow the failure.
DO $$
DECLARE
  missing TEXT := '';
BEGIN
  IF to_regclass('public.checkout_groups') IS NULL THEN
    missing := missing || ' public.checkout_groups';
  END IF;
  -- Columns: present AND typed `uuid`. The code binds a UUID string, and the
  -- reported production failure (42703 on this very column) is what a missing
  -- column looks like, so a type-only mismatch has to fail here, loudly.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='orders'
                   AND column_name='checkout_group_id' AND udt_name='uuid') THEN
    missing := missing || ' public.orders.checkout_group_id (uuid)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='payments'
                   AND column_name='checkout_group_id' AND udt_name='uuid') THEN
    missing := missing || ' public.payments.checkout_group_id (uuid)';
  END IF;
  -- Indexes: present AND built on the column they exist for. An index of the
  -- right name over the wrong column passes a name check and serves nothing.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_checkout_groups_user') THEN
    missing := missing || ' idx_checkout_groups_user';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_orders_checkout_group'
                   AND indexdef LIKE '%(checkout_group_id)%') THEN
    missing := missing || ' idx_orders_checkout_group (on checkout_group_id)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_payments_checkout_group'
                   AND indexdef LIKE '%(checkout_group_id)%') THEN
    missing := missing || ' idx_payments_checkout_group (on checkout_group_id)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_payments_one_active_stripe_group'
                   AND indexdef LIKE '%(checkout_group_id)%') THEN
    missing := missing || ' idx_payments_one_active_stripe_group (on checkout_group_id)';
  END IF;
  -- Foreign keys: present AND pointing at checkout_groups(id) ON DELETE SET
  -- NULL, which is the architecture's rule (a deleted group must not take a
  -- payment row with it). `confrelid` is resolved through pg_class, so a
  -- same-named key on another parent is reported, not accepted.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint con
                 JOIN pg_class rel ON rel.oid = con.confrelid
                 WHERE con.conname='orders_checkout_group_id_fkey'
                   AND rel.relname='checkout_groups' AND con.confdeltype='n') THEN
    missing := missing || ' orders_checkout_group_id_fkey (-> checkout_groups ON DELETE SET NULL)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint con
                 JOIN pg_class rel ON rel.oid = con.confrelid
                 WHERE con.conname='payments_checkout_group_id_fkey'
                   AND rel.relname='checkout_groups' AND con.confdeltype='n') THEN
    missing := missing || ' payments_checkout_group_id_fkey (-> checkout_groups ON DELETE SET NULL)';
  END IF;
  IF missing <> '' THEN
    RAISE EXCEPTION 'velnox: run-sqleditor.sql finished but these objects are still missing or have the wrong shape:%', missing;
  END IF;
  RAISE NOTICE 'velnox: reconciliation verified - checkout_groups, both group columns as uuid, 4 indexes on checkout_group_id and 2 foreign keys ON DELETE SET NULL are all present';
END $$;
