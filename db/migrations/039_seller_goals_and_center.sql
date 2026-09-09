-- 039_seller_goals_and_center.sql
-- P1 #4 — missing Seller/Center API support.
--
--   1. seller_goals — per-seller business goals (VelSeller Goals tab).
--      Previously the Goals UI called /api/seller/goals* which had no backend
--      table at all.
--   2. users.department — company department on the user row (VelCenter
--      staff/users tabs assign departments to employees).
--   3. employees.permissions — per-employee permission codes (VelCenter
--      staff tab permission editor).
--
-- Additive + idempotent. Never drops data.

-- ── 1. Seller goals ────────────────────────────────────────────────────────
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

-- ── 2. users.department ────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department TEXT;

-- ── 3. employees.permissions + employee_id ─────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]';

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employee_id TEXT;