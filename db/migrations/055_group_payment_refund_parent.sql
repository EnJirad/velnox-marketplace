-- =============================================================
-- Migration: V0055
-- Date: 2026-10-06
-- Description: A refund of a MULTI-SHOP purchase has no single order —
--              `refunds.order_id` becomes optional, `refunds.checkout_group_id`
--              is added, and the parent rule becomes "at least one parent".
--              Also constrains `payments.status` to the vocabulary the payment
--              domain actually writes.
--
-- WHY THIS FILE IS NEEDED
-- -----------------------
-- 1. REFUNDING A MULTI-SHOP PURCHASE WAS IMPOSSIBLE (23502).
--    One checkout = ONE charge = N per-shop orders (migration 054). The charge
--    is recorded as ONE `payments` row with `order_id IS NULL,
--    checkout_group_id = <group>`, and 054 deliberately made
--    `payments.order_id` nullable for exactly that reason.
--
--    `refunds` was never given the same treatment: `refunds.order_id` is
--    declared `NOT NULL`. So `syncRefundFromStripe()` (backend/routes/stripe.ts)
--    — which inserts the refund row from the payment's own parent — raised
--
--        ERROR: 23502: null value in column "order_id" of relation "refunds"
--                       violates not-null constraint
--
--    on every refund of a grouped charge. Reproduced against a real database
--    with `-v ON_ERROR_STOP=1 -v VERBOSITY=verbose`: exit 1, 0 rows written.
--    The INSERT is inside a transaction, so the whole sync rolled back, the
--    webhook handler threw, the endpoint answered 500, and Stripe redelivered
--    the identical event forever. The customer's money was gone, no refund was
--    ever recorded, and the order could not be moved to `refunded`.
--
--    `lockOrderRow(client, null)` was what ran first in that transaction, which
--    locks nothing — so the one transaction in the system that moves money back
--    was also the one transaction with no serialisation at all.
--
-- 2. `refunds` HAD NO WAY TO NAME A PURCHASE. `idx_refunds_order` indexes the
--    single order, and the operator route resolved the payment with
--    `WHERE order_id = $1` — a predicate that matches nothing for a grouped
--    charge, so the refund route answered 404 and there was no route at all to
--    return the customer's money. A refund of a purchase is a fact about the
--    PURCHASE, so it needs the purchase's own key.
--
-- 3. `payments.status` HAD NO CHECK. Every sibling status column in this schema
--    has one (`orders.status` since 050, `sellers.status`, `verification_status`,
--    `velrepeat_plans.status`), while the payment vocabulary lived only in
--    `backend/lib/payment-config.ts` (`PAYMENT_STATUS`). Free text means a typo
--    or a stale code path stores a payment state no reader knows, and the status
--    fold would then have no defined answer for it.
--
-- WHAT IT CHANGES
-- ---------------
--   1. `refunds.order_id` DROP NOT NULL — WIDENS what the column accepts, so it
--      cannot reject a row that used to be insertable and cannot touch stored
--      rows. This is a no-op on a database that already allows NULL.
--   2. `refunds.checkout_group_id UUID REFERENCES checkout_groups(id)
--      ON DELETE SET NULL` + a partial index. Additive.
--   3. `refunds_parent_check CHECK (order_id IS NOT NULL OR
--      checkout_group_id IS NOT NULL)` — the same rule 054 gave `payments`: a
--      refund must name SOMETHING, so no refund can become parentless. Existing
--      rows all carry `order_id` (NOT NULL until step 1), so this cannot fail.
--   4. `payments_status_check` on the SEVEN values the code actually writes,
--      derived from the writers and not invented:
--          pending          COD order row            routes/cart.ts
--          requires_action  session created          routes/stripe.ts
--          processing       handed to the provider   lib/payment-config.ts
--          paid             settlement webhook       routes/stripe.ts
--          failed           failure webhook          routes/stripe.ts
--          cancelled        cancel / expiry sweep    routes/cart.ts, jobs/
--
--      ADDED CONDITIONALLY, and this is deliberate: unlike 050 (which NARROWS
--      `orders.status` and therefore *must* fail loudly on an out-of-vocabulary
--      row), an ADD CONSTRAINT here would abort a `ON_ERROR_STOP` run of
--      `db/run-sqleditor.sql` — including the reconciliation assertion at the
--      end of it — on a database whose history predates this vocabulary. So a
--      database holding such a row keeps working and says so:
--          NOTICE: velnox: payments_status_check NOT added - N row(s) hold a
--                  status outside the vocabulary
--      Inspect them with:
--          SELECT status, count(*) FROM payments
--           WHERE status NOT IN ('pending','requires_action','processing',
--                                'paid','failed','cancelled')
--           GROUP BY status;
--      then decide, as a business question, what those rows are. Do not coerce
--      them.
--
-- WHAT IT DOES NOT DO
-- -------------------
--   • It does NOT rewrite, delete or re-parent any existing refund row.
--   • It does NOT drop a column, table, index or constraint.
--   • It does NOT move `refunds` money state into `payments` or vice versa.
--   • It does NOT authorise a new transition. `payments_status_check` only
--     refuses a value the domain does not have; the webhook, the order-row lock
--     and the payment gates remain the only transition authority.
--
-- ROLLBACK
-- --------
--   ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_parent_check;
--   ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
--   DROP INDEX IF EXISTS idx_refunds_checkout_group;
--   ALTER TABLE refunds DROP COLUMN IF EXISTS checkout_group_id;
--   ALTER TABLE refunds ALTER COLUMN order_id SET NOT NULL;   -- only if no
--                                                              -- group refund exists
--
-- Idempotent: every statement is guarded by its own existence check, so
-- re-running is harmless. The same statements are mirrored into `db/schema.sql`
-- (so a fresh bootstrap has them) and `db/run-sqleditor.sql` (so an existing
-- database self-heals — `CREATE TABLE IF NOT EXISTS` never alters a table).
--
-- Affected: `refunds` (order_id, +checkout_group_id, +index, +check), `payments`
-- (+check). No row is written by this file.
-- =============================================================

-- ── 1. refunds.order_id becomes optional ─────────────────────────────────
-- Widen only: an existing NOT NULL is dropped, never added.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'refunds'
       AND column_name = 'order_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE refunds ALTER COLUMN order_id DROP NOT NULL;
  END IF;
END $$;

-- ── 2. refunds.checkout_group_id + a partial index ───────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'refunds' AND column_name = 'checkout_group_id'
  ) THEN
    ALTER TABLE refunds
      ADD COLUMN checkout_group_id UUID REFERENCES checkout_groups(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_refunds_checkout_group
  ON refunds (checkout_group_id) WHERE checkout_group_id IS NOT NULL;

-- ── 3. a refund must name SOMETHING ──────────────────────────────────────
-- The direct analogue of `payments_at_least_one_parent_check` (054). It cannot
-- fail on an existing database: every stored refund row has an `order_id`,
-- because that column was NOT NULL until step 1 of this same file.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'refunds_parent_check'
  ) THEN
    ALTER TABLE refunds
      ADD CONSTRAINT refunds_parent_check
      CHECK (order_id IS NOT NULL OR checkout_group_id IS NOT NULL);
  END IF;
END $$;

-- ── 4. payments.status vocabulary (conditional; never aborts) ────────────
DO $$
DECLARE offenders BIGINT;
BEGIN
  SELECT count(*) INTO offenders
    FROM payments
   WHERE status NOT IN ('pending', 'requires_action', 'processing', 'paid', 'failed', 'cancelled');

  IF offenders > 0 THEN
    RAISE NOTICE
      'velnox: payments_status_check NOT added - % row(s) hold a status outside the vocabulary. Inspect: SELECT status, count(*) FROM payments WHERE status NOT IN (''pending'',''requires_action'',''processing'',''paid'',''failed'',''cancelled'') GROUP BY status;',
      offenders;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_status_check') THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_status_check
      CHECK (status IN ('pending', 'requires_action', 'processing', 'paid', 'failed', 'cancelled'));
    RAISE NOTICE 'velnox: payments_status_check added';
  ELSE
    RAISE NOTICE 'velnox: payments_status_check already present';
  END IF;
END $$;
