-- 038_product_reviews_unique.sql
-- P1 #6 — enforce one review per user per product at the database level.
--
-- The review create endpoint used a SELECT→INSERT/UPDATE pattern, so two
-- concurrent requests for the same (product, user) could both pass the
-- existence check and insert duplicate reviews. This migration:
--
--   1. Removes existing duplicates (keeps the newest review per product+user;
--      ties broken by keeping the lower id) so the constraint can be added.
--   2. Adds a UNIQUE(product_id, user_id) constraint so the race can never
--      produce duplicates again.
--   3. Recomputes products.rating / review_count for affected products so
--      catalog aggregates stay correct after the dedupe.
--
-- Additive + idempotent. Never drops data beyond the duplicate rows themselves.

-- ── 1. Dedupe existing duplicates ─────────────────────────────────────────
-- Keep the newest review per (product_id, user_id); when created_at ties,
-- keep the row with the lower id. After this DELETE exactly one row survives
-- per (product_id, user_id).
DELETE FROM product_reviews a
USING product_reviews b
WHERE a.product_id = b.product_id
  AND a.user_id = b.user_id
  AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id > b.id));

-- ── 2. Unique constraint (idempotent) ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_product_reviews_product_user'
  ) THEN
    ALTER TABLE product_reviews
      ADD CONSTRAINT uq_product_reviews_product_user UNIQUE (product_id, user_id);
  END IF;
END $$;

-- ── 3. Recompute aggregates for products whose reviews were touched ───────
UPDATE products p
SET rating = COALESCE(
      (SELECT AVG(rating)::numeric(3,2) FROM product_reviews r
       WHERE r.product_id = p.id AND r.status = 'approved'),
      p.rating),
    review_count = (SELECT COUNT(*) FROM product_reviews r
                    WHERE r.product_id = p.id AND r.status = 'approved')
WHERE p.id IN (SELECT DISTINCT product_id FROM product_reviews);