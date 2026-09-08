-- 037_inventory_release_flag.sql
-- Idempotent inventory release guard for payment failure / expiry.
--
-- When a Stripe checkout expires or payment fails, the order's reserved
-- inventory must be restored. But webhooks can be delivered more than once
-- and cancellation endpoints can be called by multiple actors (customer,
-- seller, Stripe). The `inventory_released` flag ensures that stock is
-- restored at most once per order, regardless of how many times the
-- release path is invoked.
--
-- Only SET to true inside the same transaction that decrements inventory
-- so that a rollback also prevents the flag from being set.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS inventory_released BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index: only index unreleased rows (the hot path for release
-- lookups); released rows are terminal and rarely queried by this flag.
CREATE INDEX IF NOT EXISTS idx_orders_unreleased
  ON orders (id) WHERE inventory_released = FALSE;
