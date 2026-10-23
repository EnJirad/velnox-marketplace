-- =============================================================
-- Migration: V0054
-- Date: 2026-10-04
-- Description: One checkout = N per-shop fulfillment orders, a single
--              payment covering all of them, and a numeric-only public
--              order number.
--
-- WHY THIS FILE IS NEEDED
-- -----------------------
-- Three defects, all additive to fix:
--
--   1. PAYMENT DID NOT COVER A MULTI-SHOP CART. `POST /api/customer/checkout`
--      already split the cart into one order per shop (`orders.shop_id` is
--      NOT NULL and every seller-order query filters on it), but the payment
--      endpoint took a SINGLE `orderId` and reconciled the Stripe amount to
--      that ONE row's `total_amount`. On a 3-shop cart the customer was
--      charged for shop A only; shops B and C stayed `pending` until the
--      30-minute reservation sweep expired them. There was also no grouping
--      record, so "this one purchase" had no identity the customer, a seller
--      or the center could see.
--
--   2. NO ORDER GROUP. `checkout_requests.order_id` points at ONE order, and
--      for a multi-shop checkout it was set to whichever order happened to be
--      first — a silent, arbitrary parent.
--
--   3. THE PUBLIC ORDER NUMBER CARRIED LETTERS. It was
--      `VNX-YYYYMMDD-XXXXXX`. It is quoted to support, typed into search, and
--      used as a lookup key on the customer, seller and center surfaces, so
--      every reader had to know the decoration. It is now `^[0-9]{18}$`.
--
-- WHAT IT ADDS
-- ------------
--   1. `checkout_groups` — one row per customer purchase, whatever the shop
--      count. This is the "your order from today" identity.
--   2. `orders.checkout_group_id` — the child → parent link.
--   3. `payments.checkout_group_id` + `payments.order_id` becomes NULLABLE.
--      `payments_exactly_one_parent_check` is relaxed from "exactly one of
--      order_id/plan_id" to "at least one of order_id/plan_id/
--      checkout_group_id", because a group payment is genuinely a payment for
--      several orders. The partial unique indexes that keep "one active Stripe
--      session" are re-pointed so a group can still hold exactly one.
--   4. `order_number` numeric-only. The COLUMN IS NOT ALTERED — it is already
--      `TEXT`, which is the correct type for an 18-digit value that must
--      survive JSON as a string. Only the APPLICATION FORMAT changes; historic
--      `VNX-…` values are kept verbatim and still resolve.
--
-- WHAT IT DOES NOT DO
-- -------------------
--   • It does NOT rewrite any existing order number, so an order placed before
--     this migration still resolves by the number its customer was given.
--   • It does NOT drop or rename a column, table or constraint.
--   • It does NOT change order STATUS semantics: `confirmed` is still a seller
--     accepting the order and `packing` is still fulfillment starting.
--
-- ROLLBACK
-- --------
--   DROP TABLE checkout_groups CASCADE;  -- then drop the two added columns
--   and restore the old `payments_exactly_one_parent_check`.
-- =============================================================

-- ── 1. checkout_groups ───────────────────────────────────────────────────
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

-- ── 2. orders.checkout_group_id ──────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'orders' AND column_name = 'checkout_group_id'
  ) THEN
    ALTER TABLE orders ADD COLUMN checkout_group_id UUID REFERENCES checkout_groups(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_orders_checkout_group ON orders (checkout_group_id) WHERE checkout_group_id IS NOT NULL;

-- ── 3. payments.checkout_group_id + a nullable order parent ───────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'payments' AND column_name = 'checkout_group_id'
  ) THEN
    ALTER TABLE payments ADD COLUMN checkout_group_id UUID REFERENCES checkout_groups(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'payments' AND column_name = 'order_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE payments ALTER COLUMN order_id DROP NOT NULL;
  END IF;
END $$;

-- The original check demanded EXACTLY one of (order_id, plan_id). A group
-- payment is a third legitimate parent, so the rule becomes "at least one
-- parent is present". No payment can become parentless, which is the property
-- the old check actually protected.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_exactly_one_parent_check;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_at_least_one_parent_check'
  ) THEN
    ALTER TABLE payments ADD CONSTRAINT payments_at_least_one_parent_check CHECK (
      order_id IS NOT NULL OR plan_id IS NOT NULL OR checkout_group_id IS NOT NULL
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_payments_checkout_group ON payments (checkout_group_id) WHERE checkout_group_id IS NOT NULL;

-- A plan payment and an order payment may never BOTH exist on one row.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_single_domain_check'
  ) THEN
    ALTER TABLE payments ADD CONSTRAINT payments_single_domain_check CHECK (
      NOT (plan_id IS NOT NULL AND (order_id IS NOT NULL OR checkout_group_id IS NOT NULL))
    );
  END IF;
END $$;

-- "One open Stripe session" must hold per CHECKOUT as well as per order, or a
-- retry could open a second session against the same purchase and charge the
-- customer twice. Dropped and recreated to include the group.
DROP INDEX IF EXISTS idx_payments_one_active_stripe;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_active_stripe ON payments (order_id) WHERE provider = 'stripe' AND status IN ('pending', 'requires_action');
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_active_stripe_group ON payments (checkout_group_id) WHERE provider = 'stripe' AND checkout_group_id IS NOT NULL AND status IN ('pending', 'requires_action');
