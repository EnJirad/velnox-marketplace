-- ============================================================================
-- VELNOX MARKETPLACE — CANONICAL MVP SCHEMA
-- ============================================================================
-- This file is the single source of truth for the MVP database. It replaces the
-- pre-MVP pair `db/schema.sql` + `db/run-sqleditor.sql` AT CUTOVER (see
-- `db/mvp/cutover.md`). Until then the pre-MVP pair stays frozen and untouched
-- because the deployed backend still reads it; nothing here is applied to
-- production.
--
-- Properties this schema is built to hold:
--   * ONE order status axis: pending_payment → paid → processing → shipped →
--     delivered, plus cancelled. Transitions are enforced by a trigger.
--   * ONE stock authority: `inventory`, keyed (product_id, variant_id).
--     `product_variants` carries NO stock column.
--   * ONE seller per cart and per order, enforced by composite foreign keys.
--   * Approval is part of the product lifecycle (`status`); `approval_status`
--     is a GENERATED projection so it can never disagree with `status`.
--   * Money is NUMERIC(12,2) everywhere. No floating point, no string money.
--   * No extension is required (gen_random_uuid() is built in since PG13).
--
-- Destructive work is never part of this file: it only creates. A development
-- or test database is rebuilt from it by `db/mvp/reset.sql` (fail-closed).
-- ============================================================================

-- ─── 1. IDENTITY ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL CHECK (btrim(email) <> ''),
  name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'seller', 'admin', 'owner')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- An admin/owner without a password could never authenticate; the MVP uses
  -- email + password only (Google OAuth is parked, see db/mvp/cutover.md).
  CONSTRAINT users_admin_requires_password
    CHECK (role NOT IN ('admin', 'owner') OR password_hash IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_users_staff ON users (role) WHERE role IN ('admin', 'owner');

CREATE TABLE IF NOT EXISTS revoked_tokens (
  token_id TEXT PRIMARY KEY CHECK (btrim(token_id) <> ''),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT revoked_tokens_expiry_after_revocation CHECK (expires_at > revoked_at)
);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON revoked_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens (expires_at);

-- ─── 2. SELLER ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS seller_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  store_name TEXT NOT NULL CHECK (btrim(store_name) <> ''),
  slug TEXT NOT NULL UNIQUE CHECK (btrim(slug) <> ''),
  description TEXT,
  logo_url TEXT,
  -- Lifecycle: pending → approved → suspended. `rejected` is required so a
  -- failed application has a terminal state instead of staying pending forever.
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  rejection_reason TEXT,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  suspended_at TIMESTAMPTZ,
  suspension_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT seller_profiles_approved_requires_evidence
    CHECK (status <> 'approved' OR approved_at IS NOT NULL),
  CONSTRAINT seller_profiles_rejected_requires_reason
    CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
  CONSTRAINT seller_profiles_suspended_requires_evidence
    CHECK (status <> 'suspended' OR suspended_at IS NOT NULL),
  -- A seller can never be the reviewer of their own application.
  CONSTRAINT seller_profiles_no_self_approval
    CHECK (approved_by IS NULL OR approved_by <> user_id)
);
CREATE INDEX IF NOT EXISTS idx_seller_profiles_status ON seller_profiles (status, created_at DESC);

-- ─── 3. CATALOG ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (btrim(slug) <> ''),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  names JSONB NOT NULL DEFAULT '{}',
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  icon TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT categories_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent_active ON categories (parent_id, is_active);

CREATE OR REPLACE FUNCTION prevent_circular_category_parent()
RETURNS TRIGGER AS $$
DECLARE
  current_id UUID;
  visited UUID[];
BEGIN
  IF NEW.parent_id IS NOT NULL AND NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Category cannot be its own parent';
  END IF;

  IF NEW.parent_id IS NOT NULL THEN
    current_id := NEW.parent_id;
    visited := ARRAY[NEW.id];

    WHILE current_id IS NOT NULL LOOP
      IF current_id = ANY(visited) THEN
        RAISE EXCEPTION 'Circular parent relationship detected for category %', NEW.id;
      END IF;
      visited := array_append(visited, current_id);
      SELECT parent_id INTO current_id FROM categories WHERE id = current_id;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_circular_category_parent ON categories;
CREATE TRIGGER trg_prevent_circular_category_parent
  BEFORE INSERT OR UPDATE OF parent_id ON categories
  FOR EACH ROW
  EXECUTE FUNCTION prevent_circular_category_parent();

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES seller_profiles(id) ON DELETE RESTRICT,
  category_slug TEXT REFERENCES categories(slug) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  slug TEXT NOT NULL UNIQUE CHECK (btrim(slug) <> ''),
  description TEXT NOT NULL DEFAULT '',
  -- Base price. A product with variants prices each variant in
  -- product_variants; this value remains the base/default price.
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  -- Lifecycle: draft → submitted → approved → published, submitted → rejected,
  -- rejected → draft|submitted (edit and resubmit).
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'published', 'rejected')),
  -- GENERATED: approval is a projection of the lifecycle, never a second
  -- writable axis that could drift from it.
  approval_status TEXT GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('approved', 'published') THEN 'approved'
      WHEN status = 'rejected' THEN 'rejected'
      ELSE 'pending'
    END
  ) STORED,
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT products_submitted_requires_evidence
    CHECK (status NOT IN ('submitted', 'approved', 'published') OR submitted_at IS NOT NULL),
  CONSTRAINT products_approved_requires_evidence
    CHECK (status <> 'approved' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CONSTRAINT products_published_requires_evidence
    CHECK (status <> 'published' OR (approved_at IS NOT NULL AND published_at IS NOT NULL)),
  CONSTRAINT products_rejected_requires_reason
    CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
  -- Target for the composite FKs below: an order/cart line can never pair a
  -- product with another seller.
  CONSTRAINT products_id_seller_unique UNIQUE (id, seller_id)
);
CREATE INDEX IF NOT EXISTS idx_products_seller ON products (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_status ON products (status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_slug);
CREATE INDEX IF NOT EXISTS idx_products_public ON products (created_at DESC) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL CHECK (btrim(url) <> ''),
  alt TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images (product_id, sort_order);

CREATE TABLE IF NOT EXISTS product_variants (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  sku TEXT,
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The composite PK lets every stock / cart line point at the exact
  -- (product, variant) pair without a second lookup.
  PRIMARY KEY (product_id, id),
  CONSTRAINT product_variants_id_unique UNIQUE (id),
  CONSTRAINT product_variants_name_unique UNIQUE (product_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_sku
  ON product_variants (product_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_variants_status ON product_variants (product_id, status);

-- ONE stock authority. A base-product row has variant_id IS NULL; a variant row
-- carries the variant. The unique expression index makes the pair unique in
-- both cases, and the CHECKs make negative / over-reserved stock impossible.
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_reserved_within_stock CHECK (reserved <= quantity),
  CONSTRAINT inventory_variant_belongs_to_product
    FOREIGN KEY (product_id, variant_id)
    REFERENCES product_variants (product_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_scope_unique
  ON inventory (product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ─── 4. MEDIA REGISTRY (R2) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key TEXT NOT NULL UNIQUE CHECK (btrim(object_key) <> ''),
  url TEXT NOT NULL CHECK (btrim(url) <> ''),
  content_type TEXT NOT NULL CHECK (btrim(content_type) <> ''),
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 10485760),
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media (uploaded_by);

-- ─── 5. CUSTOMER ADDRESS ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Home',
  recipient_name TEXT NOT NULL CHECK (btrim(recipient_name) <> ''),
  phone TEXT NOT NULL CHECK (btrim(phone) <> ''),
  line1 TEXT NOT NULL CHECK (btrim(line1) <> ''),
  line2 TEXT,
  subdistrict TEXT,
  district TEXT,
  city TEXT NOT NULL CHECK (btrim(city) <> ''),
  state TEXT NOT NULL CHECK (btrim(state) <> ''),
  postal_code TEXT NOT NULL CHECK (btrim(postal_code) <> ''),
  country CHAR(2) NOT NULL DEFAULT 'TH',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_one_default
  ON addresses (user_id) WHERE is_default;

-- ─── 6. CART (ONE CART PER BUYER PER SELLER) ────────────────────────────────

CREATE TABLE IF NOT EXISTS carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES seller_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT carts_one_per_seller UNIQUE (user_id, seller_id),
  CONSTRAINT carts_id_seller_unique UNIQUE (id, seller_id)
);
CREATE INDEX IF NOT EXISTS idx_carts_seller ON carts (seller_id);

CREATE TABLE IF NOT EXISTS cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL,
  -- Denormalised seller_id, locked by the two composite FKs below: it must
  -- equal the cart's seller AND the product's seller, so a cart line can never
  -- mix sellers (D4: one checkout = one seller).
  seller_id UUID NOT NULL,
  product_id UUID NOT NULL,
  variant_id UUID,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  -- Display snapshot only. Checkout re-reads the authoritative price.
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cart_items_cart_fk
    FOREIGN KEY (cart_id, seller_id) REFERENCES carts (id, seller_id) ON DELETE CASCADE,
  CONSTRAINT cart_items_product_fk
    FOREIGN KEY (product_id, seller_id) REFERENCES products (id, seller_id) ON DELETE CASCADE,
  CONSTRAINT cart_items_variant_fk
    FOREIGN KEY (product_id, variant_id) REFERENCES product_variants (product_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_items_unique_line
  ON cart_items (cart_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items (cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product ON cart_items (product_id);

-- ─── 7. ORDERS (ONE SELLER PER ORDER) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 18 digits, digits only: the public identifier (generateOrderNumber()).
  order_number TEXT NOT NULL UNIQUE CHECK (order_number ~ '^[0-9]{18}$'),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_id UUID NOT NULL REFERENCES seller_profiles(id) ON DELETE RESTRICT,
  -- ONE canonical status axis. No second order/payment/fulfilment axis.
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled')),
  subtotal NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0),
  shipping_fee NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'THB',
  -- Immutable snapshot of the delivery address; never re-read from addresses.
  shipping_address JSONB NOT NULL,
  notes TEXT,
  -- Set at cancellation-checkout: the sweep may release the reservation once
  -- this past. One canonical writer; no inventory_released flag.
  payment_expires_at TIMESTAMPTZ,
  -- Written once when the payment settles. Informational snapshot only: the
  -- authority for payment state is `payments`.
  payment_reference TEXT,
  paid_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT orders_total_matches_parts CHECK (total_amount = subtotal + shipping_fee),
  CONSTRAINT orders_paid_requires_evidence
    CHECK (status NOT IN ('paid', 'processing', 'shipped', 'delivered') OR paid_at IS NOT NULL),
  CONSTRAINT orders_shipped_requires_evidence
    CHECK (status NOT IN ('shipped', 'delivered') OR shipped_at IS NOT NULL),
  CONSTRAINT orders_delivered_requires_evidence
    CHECK (status <> 'delivered' OR delivered_at IS NOT NULL),
  CONSTRAINT orders_cancelled_requires_evidence
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CONSTRAINT orders_id_seller_unique UNIQUE (id, seller_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_expiry
  ON orders (payment_expires_at) WHERE status = 'pending_payment';

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  seller_id UUID NOT NULL,
  product_id UUID NOT NULL,
  variant_id UUID,
  -- Immutable sale snapshot. History is never recomputed from current prices.
  product_name TEXT NOT NULL CHECK (btrim(product_name) <> ''),
  variant_name TEXT,
  image_url TEXT,
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  subtotal NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_items_order_fk
    FOREIGN KEY (order_id, seller_id) REFERENCES orders (id, seller_id) ON DELETE CASCADE,
  CONSTRAINT order_items_product_fk
    FOREIGN KEY (product_id, seller_id) REFERENCES products (id, seller_id) ON DELETE RESTRICT,
  -- A sold variant cannot be deleted; retire it with status='inactive'.
  CONSTRAINT order_items_variant_fk
    FOREIGN KEY (product_id, variant_id) REFERENCES product_variants (product_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_items_subtotal_matches CHECK (subtotal = unit_price * quantity)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items (product_id);

CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  carrier TEXT NOT NULL DEFAULT '',
  tracking_number TEXT,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shipments_delivered_requires_shipped CHECK (delivered_at IS NULL OR shipped_at IS NOT NULL)
);

-- ─── 8. CHECKOUT IDEMPOTENCY ────────────────────────────────────────────────
-- Created after orders because it references orders(id).

CREATE TABLE IF NOT EXISTS checkout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL CHECK (btrim(request_key) <> ''),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT checkout_requests_user_key UNIQUE (user_id, request_key)
);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_order ON checkout_requests (order_id);

-- ─── 9. PAYMENTS (STRIPE TEST MODE, SERVER-AUTHORITATIVE) ───────────────────

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'requires_action', 'processing', 'paid', 'failed', 'cancelled')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'THB',
  method TEXT CHECK (method IS NULL OR method IN ('card', 'promptpay')),
  provider_checkout_session_id TEXT UNIQUE,
  provider_payment_intent_id TEXT UNIQUE,
  failure_code TEXT,
  failure_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payments_paid_requires_evidence CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments (order_id, created_at DESC);
-- At most ONE live Stripe session per order: a retry reuses or replaces it,
-- never opens a second payable URL in parallel (the proven production guard).
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_active_stripe
  ON payments (order_id) WHERE provider = 'stripe' AND status IN ('pending', 'requires_action');

-- One row per provider event = the idempotency claim. The webhook inserts here
-- with ON CONFLICT (event_id) DO NOTHING, then settles inside a transaction.
CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe')),
  event_id TEXT NOT NULL UNIQUE CHECK (btrim(event_id) <> ''),
  event_type TEXT NOT NULL CHECK (btrim(event_type) <> ''),
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'failed')),
  error TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_events_type ON payment_events (event_type);
CREATE INDEX IF NOT EXISTS idx_payment_events_processed ON payment_events (processed_at);

-- ─── 10. AUDIT ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (btrim(action) <> ''),
  entity_type TEXT NOT NULL CHECK (btrim(entity_type) <> ''),
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);

-- ─── 11. LIFECYCLE ENFORCEMENT ──────────────────────────────────────────────
--
-- The state machines live in the database, not only in a projection module.
-- They are the ONE definition; Phase 3 must not restate them in a second place.

CREATE OR REPLACE FUNCTION require_approved_seller_for_product()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM seller_profiles
      WHERE id = NEW.seller_id AND status = 'approved'
    ) THEN
      RAISE EXCEPTION 'seller % is not approved; only an approved seller can create or list a product', NEW.seller_id
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- Ownership is immutable: a product is created for one seller and can never
  -- be transferred to another. Transfer, if it is ever needed, is a separate
  -- audited operation, not a column update.
  IF NEW.seller_id IS DISTINCT FROM OLD.seller_id THEN
    RAISE EXCEPTION 'product ownership is immutable: seller_id cannot change from % to %', OLD.seller_id, NEW.seller_id
      USING ERRCODE = '23514';
  END IF;

  -- Rejection / takedown is always allowed, even for a suspended seller: an
  -- admin must be able to remove a product that a suspended seller published.
  IF NEW.status <> 'rejected'
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.seller_id IS DISTINCT FROM OLD.seller_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM seller_profiles
      WHERE id = NEW.seller_id AND status = 'approved'
    ) THEN
      RAISE EXCEPTION 'seller % is not approved; a suspended seller cannot submit, publish or transfer a product', NEW.seller_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_approved_seller ON products;
CREATE TRIGGER trg_products_approved_seller
  BEFORE INSERT OR UPDATE OF seller_id, status ON products
  FOR EACH ROW
  EXECUTE FUNCTION require_approved_seller_for_product();

CREATE OR REPLACE FUNCTION enforce_product_status_transition()
RETURNS TRIGGER AS $$
DECLARE
  allowed BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft', 'submitted') THEN
      RAISE EXCEPTION 'a product must be created as draft or submitted (got %)', NEW.status
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  allowed :=
       (OLD.status = 'draft'     AND NEW.status = 'submitted')
    OR (OLD.status = 'submitted' AND NEW.status IN ('approved', 'rejected'))
    OR (OLD.status = 'approved'  AND NEW.status IN ('published', 'rejected'))
    OR (OLD.status = 'published' AND NEW.status IN ('draft', 'rejected'))
    OR (OLD.status = 'rejected'  AND NEW.status IN ('draft', 'submitted'));

  IF NOT allowed THEN
    RAISE EXCEPTION 'illegal product status transition: % → %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_status_transition ON products;
CREATE TRIGGER trg_products_status_transition
  BEFORE INSERT OR UPDATE OF status ON products
  FOR EACH ROW
  EXECUTE FUNCTION enforce_product_status_transition();

CREATE OR REPLACE FUNCTION require_approved_seller_for_order()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM seller_profiles
    WHERE id = NEW.seller_id AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'seller % is not approved; an order cannot be created for a suspended seller', NEW.seller_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_approved_seller ON orders;
CREATE TRIGGER trg_orders_approved_seller
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION require_approved_seller_for_order();

CREATE OR REPLACE FUNCTION require_published_product_for_order_item()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM products
    WHERE id = NEW.product_id AND seller_id = NEW.seller_id AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'product % is not published; an unapproved/unpublished product can never enter an order', NEW.product_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM product_variants
    WHERE product_id = NEW.product_id AND id = NEW.variant_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'variant % is not active', NEW.variant_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_items_published_product ON order_items;
CREATE TRIGGER trg_order_items_published_product
  BEFORE INSERT ON order_items
  FOR EACH ROW
  EXECUTE FUNCTION require_published_product_for_order_item();

CREATE OR REPLACE FUNCTION enforce_order_status_transition()
RETURNS TRIGGER AS $$
DECLARE
  allowed BOOLEAN := FALSE;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  allowed :=
       (OLD.status = 'pending_payment' AND NEW.status IN ('paid', 'cancelled'))
    OR (OLD.status = 'paid'            AND NEW.status IN ('processing', 'cancelled'))
    OR (OLD.status = 'processing'      AND NEW.status IN ('shipped', 'cancelled'))
    OR (OLD.status = 'shipped'         AND NEW.status = 'delivered');

  IF NOT allowed THEN
    RAISE EXCEPTION 'illegal order status transition: % → %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_status_transition ON orders;
CREATE TRIGGER trg_orders_status_transition
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION enforce_order_status_transition();
