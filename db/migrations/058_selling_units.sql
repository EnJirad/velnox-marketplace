-- ============================================================================
--   058 - Selling units: sell a product by the piece, the set or the pack.
-- ============================================================================
-- WHY
--   The marketplace had ONE way to sell a product: one piece at `products.price`
--   (or `product_variants.price`). The owner's requirement is that a product can
--   also be sold as a named SET or PACK with its own price — the same bottle at
--   ฿10, a Set 6 at ฿55, a Set 12 at ฿100 — without inventing a second stock
--   system, a wholesale account, a permission or a minimum-order engine.
--
-- THE MODEL IN ONE LINE
--   A selling unit has its own `pieces` and its own price; INVENTORY IS ONLY
--   EVER COUNTED IN BASE PIECES.
--
-- WHAT THIS DOES (purely additive)
--   * Creates `product_selling_units` — the seller-authored set/pack definitions.
--   * Adds `selling_unit_id` / `selling_unit_pieces` / `selling_unit_name` to
--     `cart_items` and to `order_items`.
--   * Widens the cart line key from (product, variant) to
--     (product, variant, selling unit), under the SAME index name.
--
-- THE SEMANTICS (the whole contract)
--   * `quantity`           = number of SELLING UNITS — pieces, or sets/packs.
--   * `price` / `subtotal` = per SELLING UNIT (`subtotal = quantity * price`).
--   * `selling_unit_pieces`= BASE pieces per selling unit; **1 for every
--     pre-existing row**, which is why legacy lines keep exactly their old
--     meaning: 3 pieces still consumes 3 base units.
--   * BASE UNITS           = `quantity * selling_unit_pieces` — the ONLY
--     quantity `inventory`, `product_variants.stock` and `products.sold_count`
--     ever see (backend/lib/inventory.ts).
--
-- ONE STOCK AUTHORITY (the invariant this migration must not break)
--   No stock column is added anywhere. A pack of 12 reserves 12, settles 12 and
--   counts 12 sold, through the SAME single release/commit/sold_count path that
--   already exists. There is no per-pack stock, no second counter and no second
--   settlement path — and there must never be one.
--
-- WHY THE CART KEY HAD TO BE WIDENED
--   `idx_cart_items_unique` keyed a line by (cart_id, product_id, variant).
--   With selling units that key merges two DIFFERENT lines: "1 set" and "1
--   piece" of one product are the same key, so adding a set to a cart holding the
--   plain line would silently add to the wrong line. The key is replaced — never
--   relaxed — under the same name, so distinct lines stay distinct and the
--   object count is unchanged.
--
-- WHY `selling_unit_pieces` IS STORED ON BOTH LINE TABLES
--   The line must stay honest after the seller edits or retires the definition:
--   a line whose pack was later redefined to 24 pieces must still consume the 12
--   it actually sold. The snapshot columns are the authority for base units;
--   `selling_unit_id` is only a convenience reference (`ON DELETE SET NULL`), so
--   deleting a definition can never rewrite history or change stock arithmetic.
--
-- CONTRACT — additive, rerunnable, NEVER data-destructive
--   * No DROP TABLE, no DROP COLUMN, no TRUNCATE, no DELETE, no type change.
--   * Every statement is existence-guarded, so a second run changes nothing.
--   * Existing rows are untouched: the new columns are either NULL or default 1.
--   * Retiring a definition is `status = 'inactive'`, never a DELETE.
--
-- VERIFICATION
--   * `db/schema.sql` declares the same objects (canonical snapshot).
--   * `db/run-sqleditor.sql` carries the same guarded passes, so a fresh
--     bootstrap and an existing database converge —
--     backend/tests/db-run-sqleditor-reconciler.test.ts proves the parity and
--     db/verify-reconciler.sh proves the behaviour against real databases.
--   * `db/verify-reconciler.sh`'s CANON is 76|302|347|823.
-- ============================================================================

-- 1. The selling-unit definitions a seller authors.
CREATE TABLE IF NOT EXISTS product_selling_units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  pieces INTEGER NOT NULL CHECK (pieces > 0),
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Cart lines: which selling unit, and how many base pieces it is worth.
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS selling_unit_id UUID;
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS selling_unit_pieces INTEGER DEFAULT 1 NOT NULL;
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS selling_unit_name TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS selling_unit_id UUID;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS selling_unit_pieces INTEGER DEFAULT 1 NOT NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS selling_unit_name TEXT;

-- 3. Indexes. `idx_cart_items_unique` is replaced only when its key does not
--    already carry `selling_unit_id`, so a fresh database never drops anything.
CREATE INDEX IF NOT EXISTS idx_product_selling_units_product ON public.product_selling_units (product_id);
CREATE INDEX IF NOT EXISTS idx_product_selling_units_live ON public.product_selling_units (product_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_product_selling_units_variant ON public.product_selling_units (variant_id) WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_selling_units_unique ON public.product_selling_units (product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), pieces) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_cart_items_selling_unit ON public.cart_items (selling_unit_id) WHERE selling_unit_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_cart_items_unique'
       AND indexdef LIKE '%selling_unit_id%'
  ) THEN
    DROP INDEX IF EXISTS public.idx_cart_items_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_items_unique ON public.cart_items (cart_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(selling_unit_id, '00000000-0000-0000-0000-000000000000'::uuid));
    RAISE NOTICE 'velnox: idx_cart_items_unique widened to include selling_unit_id - a set and a piece of one product are now distinct cart lines';
  END IF;
END $$;

-- 4. Foreign keys, guarded on both the constraint name and the column's
--    existence so this file's statement order can never be the reason a run fails.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_selling_unit_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='cart_items' AND column_name='selling_unit_id')
  AND to_regclass('public.product_selling_units') IS NOT NULL THEN
  ALTER TABLE public.cart_items ADD CONSTRAINT cart_items_selling_unit_id_fkey
    FOREIGN KEY (selling_unit_id) REFERENCES public.product_selling_units(id) ON DELETE SET NULL;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_selling_unit_id_fkey')
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='order_items' AND column_name='selling_unit_id')
  AND to_regclass('public.product_selling_units') IS NOT NULL THEN
  ALTER TABLE public.order_items ADD CONSTRAINT order_items_selling_unit_id_fkey
    FOREIGN KEY (selling_unit_id) REFERENCES public.product_selling_units(id) ON DELETE SET NULL;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_selling_units_product_id_fkey') THEN
  ALTER TABLE public.product_selling_units ADD CONSTRAINT product_selling_units_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_selling_units_variant_id_fkey') THEN
  ALTER TABLE public.product_selling_units ADD CONSTRAINT product_selling_units_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;
END IF; END $$;
