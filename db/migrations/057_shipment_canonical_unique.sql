-- ============================================================================
--   057 - Shipment canonical uniqueness: one canonical shipment per order.
-- ============================================================================
-- WHY (audit finding P1-2, .ai/audit/FINAL_GAP_REPORT.md)
--   Shipment creation was the ONE non-idempotent write in the codebase:
--   `ensureShipmentForShipping()` (backend/lib/order-fulfillment.ts) ran a bare
--   `SELECT ... LIMIT 1` and then `INSERT INTO shipments (...)`, and
--   `shipments.order_id` had no key behind it — only the non-unique
--   `idx_shipments_order`. Two concurrent "mark shipped" requests for the same
--   order could therefore each fail to see the other and each insert, and the
--   database accepted both rows. An operator reading the shipping queue could
--   book two parcels, and the tracking number shown depended on which row a
--   query happened to pick.
--
-- WHAT THIS DOES
--   Adds `shipments_order_id_unique`, the unique index behind the writer's
--   `INSERT ... ON CONFLICT (order_id) DO UPDATE`, and removes the now-redundant
--   non-unique index on the same column. Nothing else changes: no column, no
--   default, no row, no constraint on any other table.
--
-- WHY ONE PER ORDER IS THE INVARIANT TODAY (and how it changes later)
--   This is not a guess:
--     * `shipments` carries NO discriminator (no direction, no type, no kind) —
--       there is no column that could distinguish two shipments of one order;
--     * ONE writer exists in the whole backend (`order-fulfillment.ts`), and it
--       is the only `INSERT INTO shipments` in non-test code;
--     * migration 056's own backfill asserts the model —
--       `(SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id) = 1` — before
--       it credits an order's items to a shipment;
--     * `.ai/audit/FINAL_GAP_REPORT.md` P1-5 records the limitation as fact:
--       one order -> one shipment, permanently.
--   When split fulfilment arrives (rebuild Phase 10: shipments hang off
--   `fulfillment_orders`, and `shipment_items` names the units carried), the
--   uniqueness moves to the work unit and/or the claim on
--   `order_items.fulfilled_quantity` — see .ai/rebuild/STATE_MACHINES.md S1/F4.
--   That step DROPS this index and creates the replacement in one migration; it
--   is a change of declaration, never of data.
--
-- CONTRACT — additive, rerunnable, and NEVER data-destructive
--   * No DROP TABLE, no DROP COLUMN, no TRUNCATE, no DELETE, no type change.
--   * The unique index is created ONLY when the table holds no `order_id` with
--     more than one row. A database whose history already contains duplicates
--     gets a NOTICE naming the count and the index is SKIPPED — resolving
--     duplicates is a business decision (which parcel is the real one?), never an
--     automated delete, and aborting the run would block every other migration
--     behind an unverifiable guess. Shipment creation stays correct there too:
--     the runtime takes the `orders` row lock and falls back to the un-keyed
--     INSERT (see `shipmentsHaveCanonicalUniqueIndex()` in
--     backend/lib/order-fulfillment.ts).
--   * The redundant `idx_shipments_order` (same column, same lookups) is dropped
--     ONLY once `shipments_order_id_unique` is really present, so a
--     duplicate-holding database keeps a usable index instead of losing both.
--   * Rerunnable: both steps are existence-guarded, and a second run changes
--     nothing.
--
-- VERIFICATION
--   * `db/run-sqleditor.sql` carries the same guarded pass, so a fresh bootstrap
--     and an existing database converge (see
--     backend/tests/db-run-sqleditor-reconciler.test.ts).
--   * `db/schema.sql` declares the unique index, so the snapshot states the
--     invariant too.
--   * Object counts are unchanged by design (one index out, one index in), which
--     is why `db/verify-reconciler.sh`'s CANON stays 75|296|339|807.
-- ============================================================================

DO $$
DECLARE dup_orders INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'shipments_order_id_unique') THEN
    SELECT COUNT(*) INTO dup_orders FROM (
      SELECT order_id FROM public.shipments GROUP BY order_id HAVING COUNT(*) > 1
    ) AS duplicated;
    IF dup_orders > 0 THEN
      RAISE NOTICE 'velnox: shipments_order_id_unique NOT created - % order(s) already carry more than one shipment row. Shipment creation stays serialised by the orders row lock; resolve which row is the real parcel (a business decision, never an automated delete) and rerun.', dup_orders;
    ELSE
      CREATE UNIQUE INDEX IF NOT EXISTS shipments_order_id_unique ON public.shipments (order_id);
      RAISE NOTICE 'velnox: shipments_order_id_unique present - one canonical shipment per order is now enforced by the database';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'shipments_order_id_unique')
     AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_shipments_order') THEN
    DROP INDEX public.idx_shipments_order;
  END IF;
END $$;
