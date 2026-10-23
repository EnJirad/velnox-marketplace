-- Migration: V0043
-- Date: 2026-09-15
-- Description:
-- Sync the sellers.status CHECK constraint with the backend state machine and
-- add a seller review-history table.
--
-- Reason:
-- backend/routes/seller.ts validates a documented state machine
-- (pending → under_review → approved | needs_correction | rejected) but the
-- PostgreSQL constraint created in 011_seller_status_constraint.sql only allows
-- ('pending','approved','rejected','suspended'). Any write of 'under_review' or
-- 'needs_correction' therefore failed with a CHECK violation, so a VelCenter
-- reviewer could never move an application into review or request a correction.
-- This migration is the DB half of that fix; the application half lives in
-- backend/routes/seller.ts.
--
-- Affected:
--   sellers                    (status CHECK constraint)
--   seller_verifications       (structured review reason columns)
--   seller_review_history      (new)
--
-- Note: product_verifications is intentionally left untouched. Velnox runs ONE
-- verification system (seller/shop identity). The product tables remain in place
-- for historical data but are no longer written to.

-- ── 1. sellers.status — canonical review lifecycle ──────────────────────────
-- Normalize legacy values that are outside the canonical set.
UPDATE sellers SET status = 'pending' WHERE status NOT IN
  ('pending', 'under_review', 'needs_correction', 'approved', 'rejected', 'suspended');

ALTER TABLE sellers DROP CONSTRAINT IF EXISTS sellers_status_check;

ALTER TABLE sellers
  ADD CONSTRAINT sellers_status_check
  CHECK (status IN ('pending', 'under_review', 'needs_correction', 'approved', 'rejected', 'suspended'));

-- ── 2. seller_verifications — structured review reasons ────────────────────
ALTER TABLE seller_verifications ADD COLUMN IF NOT EXISTS review_reason_code TEXT;
ALTER TABLE seller_verifications ADD COLUMN IF NOT EXISTS review_note TEXT;

-- ── 3. seller_review_history — review audit trail ──────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_seller_review_history_seller
  ON seller_review_history (seller_id, created_at DESC);
