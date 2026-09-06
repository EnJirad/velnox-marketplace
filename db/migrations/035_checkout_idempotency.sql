-- 035_checkout_idempotency.sql
-- Idempotency guard for POST /api/customer/checkout.
--
-- Each checkout page session generates a request_key (UUID). The unique
-- (user_id, request_key) constraint guarantees a double-submit — or a client
-- retry after a lost response — can never create a second set of orders:
--
--   1. Inside the checkout transaction the worker INSERTs its key with
--      ON CONFLICT DO NOTHING. If the INSERT returns no row, another request
--      already claimed this key, so the transaction aborts without touching
--      stock or the cart.
--   2. The full response of the first successful request is snapshotted in
--      `response`, so a duplicate returns exactly the same result (including
--      the Stripe redirect for online payment) instead of a fresh order.
--
-- Created with IF NOT EXISTS + startup ensure (same convention as the
-- variant tables / VelRepeat V2) so it also applies to existing databases.

CREATE TABLE IF NOT EXISTS checkout_requests (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL,
    request_key TEXT NOT NULL,
    order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
    response    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, request_key)
);

CREATE INDEX IF NOT EXISTS idx_checkout_requests_order ON checkout_requests (order_id);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_user ON checkout_requests (user_id);