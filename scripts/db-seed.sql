-- ============================================================================
-- VELNOX MVP — DETERMINISTIC DEVELOPMENT SEED
-- ============================================================================
-- Contains PLATFORM CONFIGURATION ONLY (the master category tree). It creates
-- no user, seller, product, order or payment — fake marketplace data is not
-- allowed in this repository, and the MVP's tests build their own fixtures.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING. Re-running never overwrites an
-- edited category.
--
-- Development/test only: refuses a database whose name does not end in
-- `_dev` or `_test`. `scripts/db-reset.sh --seed` runs it after a reset.
-- ============================================================================

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() !~* '_(dev|test)$' THEN
    RAISE EXCEPTION
      'REFUSING SEED: database "%" does not end in _dev or _test.',
      current_database()
      USING HINT = 'Seed data is for disposable development/test databases only.';
  END IF;
END $$;

INSERT INTO categories (slug, name, names, sort_order, is_active) VALUES
  ('home',        'ของใช้ในบ้าน',      '{"th":"ของใช้ในบ้าน","en":"Home & Living"}',   10, TRUE),
  ('electronics', 'อิเล็กทรอนิกส์',    '{"th":"อิเล็กทรอนิกส์","en":"Electronics"}',    20, TRUE),
  ('fashion',     'แฟชั่น',            '{"th":"แฟชั่น","en":"Fashion"}',                30, TRUE),
  ('beauty',      'ความงาม',           '{"th":"ความงาม","en":"Beauty"}',               40, TRUE),
  ('food',        'อาหารและเครื่องดื่ม', '{"th":"อาหารและเครื่องดื่ม","en":"Food & Beverage"}', 50, TRUE),
  ('other',       'อื่น ๆ',            '{"th":"อื่น ๆ","en":"Other"}',                60, TRUE)
ON CONFLICT (slug) DO NOTHING;
