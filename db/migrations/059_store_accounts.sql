-- ============================================================================
--   059 - Store accounts: wholesale is for approved shops, retail stays public.
-- ============================================================================
-- WHY
--   Migration 058 let a product be sold by the piece or by the set/pack, and
--   every pack it published was visible to everyone. The owner's requirement is
--   a SECOND buyer track: community shops order wholesale, and a wholesale pack
--   and its price are visible only to a shop whose account the platform has
--   APPROVED. Nothing about the retail path may change.
--
-- THE MODEL IN ONE LINE
--   Wholesale is a property of a SELLING UNIT (`is_wholesale`), and a store
--   account is an approved row in `store_accounts`; an unapproved viewer simply
--   never receives the wholesale rows.
--
-- WHAT THIS DOES (purely additive)
--   * Creates `store_accounts` — the buyer-side store application/review record.
--   * Adds `product_selling_units.is_wholesale BOOLEAN NOT NULL DEFAULT FALSE`.
--
-- WHY THE DEFAULT MAKES THE RETAIL PATH UNTOUCHED
--   Every existing set/pack gets `is_wholesale = false`, i.e. exactly what it
--   was: public. No catalog payload changes for an anonymous or ordinary
--   customer, no price changes, no cart or checkout behaviour changes. Only a
--   unit the seller has explicitly marked wholesale is gated — so the gate
--   cannot take something away from a buyer who could already see it.
--
-- WHY NO SECOND PRICE TABLE
--   A wholesale unit already carries its own `price` and `pieces`. Adding a
--   store-only price column would create a second money authority and a
--   resolution matrix (which price wins for whom). The wholesale price IS the
--   unit's price, and only approved shops can see or buy that unit.
--
-- WHY ONE ROW PER USER
--   `idx_store_accounts_user` is UNIQUE on `user_id`: an account applies once,
--   is reviewed once, and a re-application after a rejection UPDATES that row
--   (status back to 'pending') instead of stacking duplicates a reviewer would
--   have to reconcile by hand.
--
-- WHY THE STATUS IS A CHECK, NOT A BOOLEAN
--   'pending' is a real state, not "not yet approved": it is what the review
--   queue reads, and `approved` is the only value that grants wholesale access.
--   A boolean would force the queue to infer "pending" from a null timestamp.
--
-- CONTRACT — additive, rerunnable, NEVER data-destructive
--   * No DROP TABLE, no DROP COLUMN, no TRUNCATE, no DELETE, no type change.
--   * Every statement is existence-guarded, so a second run changes nothing.
--   * Existing `product_selling_units` rows keep their exact meaning (public).
--
-- VERIFICATION
--   * `db/schema.sql` declares the same objects (canonical snapshot).
--   * `db/run-sqleditor.sql` carries the same guarded passes, so a fresh
--     bootstrap and an existing database converge —
--     backend/tests/db-run-sqleditor-reconciler.test.ts proves the parity and
--     db/verify-reconciler.sh proves the behaviour against real databases.
--   * `db/verify-reconciler.sh`'s CANON becomes 77|305|352|837.
-- ============================================================================

-- 1. The buyer-side store account: who applied, and what a reviewer decided.
--    `tax_id` is deliberately absent: invoice / tax requirements are an owner
--    decision that has not been made, and a column nothing reads is a column
--    that lies about the product. Add it with the invoice feature.
CREATE TABLE IF NOT EXISTS store_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_name TEXT NOT NULL CHECK (length(btrim(store_name)) > 0),
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  address TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_accounts_user ON public.store_accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_store_accounts_status ON public.store_accounts (status, created_at DESC);

-- 2. The wholesale gate on a selling unit. FALSE for every existing row, so
--    every set/pack that is live today stays exactly as visible as it was.
ALTER TABLE public.product_selling_units ADD COLUMN IF NOT EXISTS is_wholesale BOOLEAN DEFAULT FALSE NOT NULL;

-- 2b. The live-definition key gains the AUDIENCE. Without this a seller who marks
--     "แพ็ค 12" wholesale could no longer ALSO sell a retail "แพ็ค 12": the two
--     rows would collide on (product, variant, pieces) and the seller would be
--     forced to publish one price for both audiences, which is exactly what the
--     gate exists to avoid. Replaced under the SAME index name, so the object
--     count is unchanged and an already-correct key is left alone.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_product_selling_units_unique'
       AND indexdef LIKE '%is_wholesale%'
  ) THEN
    DROP INDEX IF EXISTS public.idx_product_selling_units_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_selling_units_unique ON public.product_selling_units (product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), pieces, is_wholesale) WHERE status = 'active';
    RAISE NOTICE 'velnox: idx_product_selling_units_unique keyed on is_wholesale';
  END IF;
END $$;

-- 3. Foreign keys, guarded on both the constraint name and the table's
--    existence so this file's statement order can never be the reason a run fails.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_accounts_user_id_fkey')
  AND to_regclass('public.store_accounts') IS NOT NULL THEN
  ALTER TABLE public.store_accounts ADD CONSTRAINT store_accounts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_accounts_reviewed_by_fkey')
  AND to_regclass('public.store_accounts') IS NOT NULL THEN
  ALTER TABLE public.store_accounts ADD CONSTRAINT store_accounts_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;
END IF; END $$;
