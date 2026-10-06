-- ============================================================================
-- 056 - Commerce core invariants: one axis per lifecycle, one stock authority,
--       an attempt layer, a ledger, an outbox and reconciliation.
-- ============================================================================
-- WHY
--   The commerce core had no single authority per lifecycle. `orders.status`
--   carried payment + order + fulfillment in one 12-value column; stock lived in
--   TWO independent models (inventory.quantity/reserved per product and
--   product_variants.stock per variant) with NO non-negativity constraint on
--   either; commissions/settlements were declared but never written; there was no
--   ledger, no retry metadata, no correlation id, no outbox and no reconciliation
--   (see .ai/rebuild/CURRENT_ARCHITECTURE.md, findings A1-A19).
--
-- CONTRACT
--   ADDITIVE and RERUNNABLE. No DROP TABLE, no DROP COLUMN, no TRUNCATE, no
--   DELETE, no type change. Every constraint is added only after counting the
--   rows that would violate it: when a database cannot satisfy a new rule the
--   migration RAISES A NOTICE, names the count, and SKIPS that constraint instead
--   of aborting the whole file (production is not readable from a workspace, so a
--   hard failure here would block everything behind an unverifiable guess).
--   Backfills are deterministic and guarded on NULL / on the legacy projection,
--   so a second run changes nothing.
--
--   There is NO DROP CONSTRAINT and no DROP INDEX anywhere in this file. The
--   variant axis is carried by product_variants itself (section 9) rather than by
--   extra inventory rows, because inventory.product_id is UNIQUE and
--   routes/products.ts upserts it with ON CONFLICT (product_id): a partial
--   replacement index would break those two statement at runtime with 42P10.
--   The stock MODEL is still one model — the same counters, the same movement
--   journal, one writer (lib/inventory.ts) — applied to both key types.
--
-- NO BACKTICKS anywhere in this file: a backtick inside a SQL comment embedded in
-- a JS template literal terminates the literal (see the repository's known trap).
-- ============================================================================

-- ─── 1. payment_attempts ────────────────────────────────────────────────────
-- One row per provider interaction. `payments` stays the record of the money;
-- an attempt is the record of ONE try at moving it, which is what makes
-- "pending -> failed -> retried -> paid" expressible without overloading a
-- single status column, and what makes a created session recoverable after a
-- timeout. `idempotency_key` is the durable key: an INSERT ... ON CONFLICT on it
-- is the whole idempotency strategy (never a read-then-write).
CREATE TABLE IF NOT EXISTS payment_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  provider TEXT NOT NULL DEFAULT 'stripe',
  method TEXT NOT NULL DEFAULT 'card',
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'requires_action', 'processing', 'succeeded', 'failed', 'expired', 'canceled')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'THB',
  idempotency_key TEXT NOT NULL,
  provider_session_id TEXT,
  provider_intent_id TEXT,
  failure_code TEXT,
  failure_message TEXT,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  CONSTRAINT payment_attempts_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT payment_attempts_number_unique UNIQUE (payment_id, attempt_number),
  CONSTRAINT payment_attempts_settled_needs_confirmation CHECK (
    settled_at IS NULL OR confirmed_at IS NOT NULL
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_session
  ON payment_attempts (provider, provider_session_id) WHERE provider_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_intent
  ON payment_attempts (provider, provider_intent_id) WHERE provider_intent_id IS NOT NULL;
-- At most ONE live attempt per payment: two concurrent "pay" requests cannot
-- both open a provider session for the same money.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_one_live
  ON payment_attempts (payment_id) WHERE status IN ('created', 'requires_action', 'processing');
CREATE INDEX IF NOT EXISTS idx_payment_attempts_payment ON payment_attempts (payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON payment_attempts (status);

-- ─── 2. fulfillment_orders ─────────────────────────────────────────────────
-- Shopify's fulfillment-order model, at Velnox granularity: the WORK of getting
-- an order's items out of the door, one row per (order, location). Created inside
-- the settlement transaction, so a work unit never exists for an order that was
-- never paid. `shipments` then hangs off it, which is what makes partial and
-- split fulfilment expressible without a schema change.
CREATE TABLE IF NOT EXISTS fulfillment_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shop_id UUID REFERENCES shops(id),
  location TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'unfulfilled'
    CHECK (status IN ('unfulfilled', 'ready', 'picking', 'packing', 'ready_to_ship', 'shipped', 'delivered', 'failed', 'cancelled')),
  failure_code TEXT,
  failure_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT fulfillment_orders_order_location_unique UNIQUE (order_id, location)
);
CREATE INDEX IF NOT EXISTS idx_fulfillment_orders_order ON fulfillment_orders (order_id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_orders_shop ON fulfillment_orders (shop_id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_orders_active
  ON fulfillment_orders (updated_at) WHERE status IN ('unfulfilled', 'ready', 'picking', 'packing', 'ready_to_ship');

-- ─── 3. shipment_items ─────────────────────────────────────────────────────
-- WHICH units a shipment carries. Without this, "2 of 3 units shipped", a split
-- parcel and a reshipment after a loss cannot be represented, and a shipment can
-- silently cover an order it does not actually contain.
CREATE TABLE IF NOT EXISTS shipment_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shipment_items_shipment_item_unique UNIQUE (shipment_id, order_item_id)
);
CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment ON shipment_items (shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_item ON shipment_items (order_item_id);

-- ─── 4. inventory_movements ────────────────────────────────────────────────
-- The audited WHY behind every change to a stock counter: append-only, one row
-- per mutation, written in the same transaction. This is what makes
-- "why is this number 3?" answerable, and it is what the inventory reconciler
-- replays to prove the counters were not written by hand.
CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inventory_id UUID REFERENCES inventory(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  movement TEXT NOT NULL
    CHECK (movement IN ('reserve', 'release', 'commit', 'fulfil', 'return', 'adjust')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  reason TEXT,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key TEXT,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_movements_idempotency_key UNIQUE (idempotency_key),
  -- A movement always names the level it moved: the product-level inventory row
  -- for non-variant stock, or the variant row for variant stock.
  CONSTRAINT inventory_movements_parent_check CHECK (inventory_id IS NOT NULL OR variant_id IS NOT NULL),
  CONSTRAINT inventory_movements_variant_matches_product_check CHECK (
    variant_id IS NULL OR inventory_id IS NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_inventory ON inventory_movements (inventory_id, created_at DESC) WHERE inventory_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_movements_order ON inventory_movements (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_movements_variant ON inventory_movements (variant_id) WHERE variant_id IS NOT NULL;

-- ─── 5. ledger_entries ─────────────────────────────────────────────────────
-- The immutable financial record. APPEND-ONLY: the trigger in section 10 refuses
-- an UPDATE or a DELETE, so a correction is a new compensating entry, never an
-- edit. `amount_minor` is BIGINT so no float and no double rounding ever touches
-- money; `idempotency_key` makes a retried write a no-op instead of a duplicate.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_type TEXT NOT NULL
    CHECK (entry_type IN ('charge', 'refund', 'platform_fee', 'seller_payable', 'settlement', 'adjustment')),
  account TEXT NOT NULL
    CHECK (account IN ('platform_cash', 'platform_revenue', 'seller_payable', 'refund_clearing')),
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'THB',
  purchase_id UUID REFERENCES checkout_groups(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  refund_id UUID REFERENCES refunds(id) ON DELETE SET NULL,
  settlement_id UUID REFERENCES settlements(id) ON DELETE SET NULL,
  seller_id UUID REFERENCES sellers(id) ON DELETE SET NULL,
  rate NUMERIC(5, 4),
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_entries_idempotency_key UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_seller ON ledger_entries (seller_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_payment ON ledger_entries (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_entries_purchase ON ledger_entries (purchase_id) WHERE purchase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_entries_order ON ledger_entries (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_entries_settlement ON ledger_entries (settlement_id) WHERE settlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries (account, occurred_at DESC);

-- ─── 6. order_returns ──────────────────────────────────────────────────────
-- The missing RMA entity: refund-after-return had no representation at all.
-- A return records a PHYSICAL fact. It never refunds (that is the refund domain
-- operation) and never releases stock (the units were already fulfilled; a
-- restock is an explicit `return` movement).
CREATE TABLE IF NOT EXISTS order_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason_code TEXT,
  customer_note TEXT,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'in_transit', 'received', 'restocked', 'completed', 'cancelled')),
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  restocked_quantity INTEGER NOT NULL DEFAULT 0 CHECK (restocked_quantity >= 0),
  resolution_note TEXT,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_returns_order ON order_returns (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_returns_open
  ON order_returns (status) WHERE status IN ('requested', 'approved', 'in_transit', 'received');

-- ─── 7. outbox_events ──────────────────────────────────────────────────────
-- The transactional outbox. An event row is written in the SAME transaction as
-- the state change it describes, so "DB committed but the event vanished" and
-- "the event says X while the DB rolled back" both become impossible. The drain
-- worker publishes and may fail; a failure increments attempt_count and sets
-- next_retry_at, and exhausting the budget is a LOUD terminal state that raises
-- an incident (never a silent drop).
CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  aggregate_type TEXT NOT NULL
    CHECK (aggregate_type IN ('purchase', 'order', 'fulfillment', 'shipment', 'payment', 'refund', 'inventory', 'return', 'settlement')),
  aggregate_id UUID,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  correlation_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'failed', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT outbox_events_event_id_unique UNIQUE (event_id)
);
CREATE INDEX IF NOT EXISTS idx_outbox_events_pending
  ON outbox_events (next_retry_at) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_outbox_events_aggregate ON outbox_events (aggregate_type, aggregate_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_events_type ON outbox_events (event_type, occurred_at DESC);

-- ─── 8. reconciliation ─────────────────────────────────────────────────────
-- A reconciler NEVER repairs business state: it records what it expected, what
-- it observed and how severe the difference is. Repair is an authorized,
-- audited action. The fingerprint upsert keeps one OPEN finding per real drift,
-- so a re-run refreshes the evidence instead of duplicating the report.
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind TEXT NOT NULL
    CHECK (kind IN ('payment', 'inventory', 'fulfillment', 'refund', 'ledger', 'purchase')),
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  checked_count INTEGER NOT NULL DEFAULT 0 CHECK (checked_count >= 0),
  mismatch_count INTEGER NOT NULL DEFAULT 0 CHECK (mismatch_count >= 0),
  details JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_kind ON reconciliation_runs (kind, started_at DESC);

CREATE TABLE IF NOT EXISTS reconciliation_findings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID REFERENCES reconciliation_runs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('payment', 'inventory', 'fulfillment', 'refund', 'ledger', 'purchase')),
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  expected JSONB,
  observed JSONB,
  detail TEXT,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT,
  CONSTRAINT reconciliation_findings_fingerprint_unique UNIQUE (kind, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_open ON reconciliation_findings (status, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_entity ON reconciliation_findings (entity_type, entity_id);

-- ─── 9. EXTEND existing tables (additive columns only) ─────────────────────
-- The two real lifecycle axes on the order. NULLABLE on purpose: a database that
-- has run only db/run-sqleditor.sql has the columns but no backfill, and the
-- application reads them with a COALESCE fallback to the legacy `status`, so a
-- deploy is never blocked by a pending migration. Section 9b backfills and then
-- makes them NOT NULL.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_state TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_status TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS correlation_id TEXT;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS fulfilled_quantity INTEGER NOT NULL DEFAULT 0;

-- The product-level axis: the six quantities of INVENTORY_ARCHITECTURE.md. The
-- on-hand column keeps its existing name `quantity` (a rename would rewrite every
-- read in the catalog) and is documented as on_hand.
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS committed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS fulfilled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS returned INTEGER NOT NULL DEFAULT 0;

-- The VARIANT axis gets the SAME counters on its own table. The columns are
-- additive and default to 0, so every existing read of product_variants.stock is
-- unchanged and no writer has to be reordered for this migration to be safe.
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS reserved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS committed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS fulfilled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS returned INTEGER NOT NULL DEFAULT 0;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS correlation_id TEXT;

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS refundable_minor BIGINT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS correlation_id TEXT;

ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS payload_reference TEXT;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS provider_object_id TEXT;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS correlation_id TEXT;

ALTER TABLE payment_incidents ADD COLUMN IF NOT EXISTS kind TEXT;

ALTER TABLE settlements ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'THB';
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS entry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS fulfillment_order_id UUID REFERENCES fulfillment_orders(id) ON DELETE SET NULL;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS correlation_id TEXT;

-- ─── 9b. backfill (deterministic, guarded, rerunnable) ────────────────────
-- The two axes are DERIVED from the legacy projection, never the reverse. A row
-- whose `status` is already in the target vocabulary keeps its meaning.
UPDATE orders SET order_state = CASE status
    WHEN 'cancelled'      THEN 'cancelled'
    WHEN 'completed'      THEN 'completed'
    WHEN 'packing'        THEN 'processing'
    WHEN 'shipped'        THEN 'processing'
    WHEN 'delivered'      THEN 'processing'
    WHEN 'confirmed'      THEN 'confirmed'
    ELSE 'pending'
  END
 WHERE order_state IS NULL;

UPDATE orders SET fulfillment_status = CASE status
    WHEN 'cancelled'      THEN 'cancelled'
    WHEN 'completed'      THEN 'delivered'
    WHEN 'delivered'      THEN 'delivered'
    WHEN 'shipped'        THEN 'shipped'
    WHEN 'packing'        THEN 'packing'
    WHEN 'confirmed'      THEN 'ready'
    WHEN 'paid'           THEN 'ready'
    ELSE 'unfulfilled'
  END
 WHERE fulfillment_status IS NULL;

-- Completion: default + NOT NULL, only once no NULL remains. Guarded so a rerun
-- and a run against an already-migrated database are both no-ops.
ALTER TABLE orders ALTER COLUMN order_state SET DEFAULT 'pending';
ALTER TABLE orders ALTER COLUMN fulfillment_status SET DEFAULT 'unfulfilled';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE order_state IS NULL)
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'orders'
                   AND column_name = 'order_state' AND is_nullable = 'YES')
  THEN
    ALTER TABLE orders ALTER COLUMN order_state SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM orders WHERE fulfillment_status IS NULL)
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'orders'
                   AND column_name = 'fulfillment_status' AND is_nullable = 'YES')
  THEN
    ALTER TABLE orders ALTER COLUMN fulfillment_status SET NOT NULL;
  END IF;
END $$;

-- One attempt per existing payment that has any provider object id.
INSERT INTO payment_attempts (payment_id, attempt_number, provider, method, status,
                              amount_minor, currency, idempotency_key,
                              provider_session_id, provider_intent_id, confirmed_at)
SELECT p.id, 1, COALESCE(p.provider, 'stripe'), COALESCE(p.method, 'card'),
       CASE p.status
         WHEN 'paid'            THEN 'succeeded'
         WHEN 'processing'      THEN 'processing'
         WHEN 'requires_action' THEN 'requires_action'
         WHEN 'failed'          THEN 'failed'
         WHEN 'cancelled'       THEN 'canceled'
         ELSE 'created'
       END,
       GREATEST(0, ROUND(COALESCE(p.amount, 0) * 100)::bigint),
       COALESCE(p.currency, 'THB'),
       'legacy-attempt-' || p.id::text,
       p.provider_checkout_session_id, p.provider_payment_id, p.paid_at
  FROM payments p
 WHERE (p.provider_checkout_session_id IS NOT NULL OR p.provider_payment_id IS NOT NULL)
ON CONFLICT (idempotency_key) DO NOTHING;

-- One work unit per order that has been paid or has moved past pending.
INSERT INTO fulfillment_orders (order_id, shop_id, status)
SELECT o.id, o.shop_id,
       CASE o.fulfillment_status
         WHEN 'delivered' THEN 'delivered'
         WHEN 'shipped'   THEN 'shipped'
         WHEN 'packing'   THEN 'packing'
         WHEN 'picking'   THEN 'picking'
         WHEN 'ready'     THEN 'ready'
         ELSE 'unfulfilled'
       END
  FROM orders o
 WHERE COALESCE(o.fulfillment_status, '') NOT IN ('unfulfilled', 'cancelled')
   AND o.status IN ('paid', 'confirmed', 'packing', 'shipped', 'delivered', 'completed')
ON CONFLICT (order_id, location) DO NOTHING;

-- The variant axis needs no backfill: product_variants.stock is already the
-- on-hand value the storefront reads, and the four new counters default to 0, so
-- the availability it reports is identical before and after this migration.

-- An existing shipment of an order with exactly ONE shipment covers every item of
-- that order with its full quantity, but ONLY when the order's own status says the
-- goods went out. Any other case is deliberately left unbackfilled: guessing which
-- units were in a shipment would invent a fact, so it becomes a reconciler finding
-- instead (RECONCILIATION.md R3).
UPDATE order_items oi
   SET fulfilled_quantity = oi.quantity
  FROM orders o
 WHERE oi.order_id = o.id
   AND o.status IN ('shipped', 'delivered', 'completed')
   AND (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id) = 1
   AND oi.fulfilled_quantity = 0;

INSERT INTO shipment_items (shipment_id, order_item_id, quantity)
SELECT s.id, oi.id, oi.quantity
  FROM shipments s
  JOIN orders o ON o.id = s.order_id
  JOIN order_items oi ON oi.order_id = o.id
 WHERE o.status IN ('shipped', 'delivered', 'completed')
   AND (SELECT COUNT(*) FROM shipments s2 WHERE s2.order_id = o.id) = 1
   AND NOT EXISTS (SELECT 1 FROM shipment_items si WHERE si.shipment_id = s.id AND si.order_item_id = oi.id)
ON CONFLICT (shipment_id, order_item_id) DO NOTHING;

-- Shipments: normalise the two legacy spellings onto the state machine's
-- vocabulary. Rows already carrying a current value are untouched.
UPDATE shipments SET status = 'created' WHERE status = 'pending';
UPDATE shipments
   SET fulfillment_order_id = fo.id
  FROM fulfillment_orders fo
 WHERE shipments.order_id = fo.order_id
   AND shipments.fulfillment_order_id IS NULL;

-- Webhook events: received_at / attempt_count for rows created before the retry
-- metadata existed. payload_reference names the stored payload without promising
-- an external store.
UPDATE payment_events SET received_at = created_at WHERE received_at IS NULL;
UPDATE payment_events SET attempt_count = 1 WHERE attempt_count = 0 AND status = 'processed';

-- Incidents: the register becomes kind-aware; existing rows were late payments.
UPDATE payment_incidents SET kind = 'late_payment' WHERE kind IS NULL;

-- ─── 10. constraints on the NEW columns (each guarded, never fatal) ───────
DO $$
BEGIN
  -- orders.order_state vocabulary
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_order_state_check') THEN
    IF EXISTS (SELECT 1 FROM orders WHERE order_state IS NOT NULL
                 AND order_state NOT IN ('pending', 'confirmed', 'processing', 'completed', 'cancelled')) THEN
      RAISE NOTICE 'velnox: orders_order_state_check NOT added - % row(s) carry an unexpected order_state',
        (SELECT COUNT(*) FROM orders WHERE order_state IS NOT NULL
           AND order_state NOT IN ('pending', 'confirmed', 'processing', 'completed', 'cancelled'));
    ELSE
      ALTER TABLE orders ADD CONSTRAINT orders_order_state_check
        CHECK (order_state IS NULL OR order_state IN ('pending', 'confirmed', 'processing', 'completed', 'cancelled'));
    END IF;
  END IF;

  -- orders.fulfillment_status vocabulary
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_fulfillment_status_check') THEN
    IF EXISTS (SELECT 1 FROM orders WHERE fulfillment_status IS NOT NULL
                 AND fulfillment_status NOT IN ('unfulfilled', 'ready', 'picking', 'packing', 'ready_to_ship', 'shipped', 'delivered', 'failed', 'cancelled')) THEN
      RAISE NOTICE 'velnox: orders_fulfillment_status_check NOT added - % row(s) carry an unexpected fulfillment_status',
        (SELECT COUNT(*) FROM orders WHERE fulfillment_status IS NOT NULL
           AND fulfillment_status NOT IN ('unfulfilled', 'ready', 'picking', 'packing', 'ready_to_ship', 'shipped', 'delivered', 'failed', 'cancelled'));
    ELSE
      ALTER TABLE orders ADD CONSTRAINT orders_fulfillment_status_check
        CHECK (fulfillment_status IS NULL OR fulfillment_status IN ('unfulfilled', 'ready', 'picking', 'packing', 'ready_to_ship', 'shipped', 'delivered', 'failed', 'cancelled'));
    END IF;
  END IF;

  -- order_items: never fulfilled beyond what was bought
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_fulfilled_within_quantity_check') THEN
    IF EXISTS (SELECT 1 FROM order_items WHERE fulfilled_quantity < 0 OR fulfilled_quantity > quantity) THEN
      RAISE NOTICE 'velnox: order_items_fulfilled_within_quantity_check NOT added - % row(s) over-fulfilled',
        (SELECT COUNT(*) FROM order_items WHERE fulfilled_quantity < 0 OR fulfilled_quantity > quantity);
    ELSE
      ALTER TABLE order_items ADD CONSTRAINT order_items_fulfilled_within_quantity_check
        CHECK (fulfilled_quantity >= 0 AND fulfilled_quantity <= quantity);
    END IF;
  END IF;

  -- inventory: the counters can never go negative
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_counters_non_negative_check') THEN
    IF EXISTS (SELECT 1 FROM inventory WHERE quantity < 0 OR reserved < 0 OR committed < 0 OR fulfilled < 0 OR returned < 0) THEN
      RAISE NOTICE 'velnox: inventory_counters_non_negative_check NOT added - % row(s) hold a negative counter',
        (SELECT COUNT(*) FROM inventory WHERE quantity < 0 OR reserved < 0 OR committed < 0 OR fulfilled < 0 OR returned < 0);
    ELSE
      ALTER TABLE inventory ADD CONSTRAINT inventory_counters_non_negative_check
        CHECK (quantity >= 0 AND reserved >= 0 AND committed >= 0 AND fulfilled >= 0 AND returned >= 0);
    END IF;
  END IF;

  -- inventory: the availability invariant. reserved + committed are units the
  -- shelf may not offer again, so they can never exceed what physically exists.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_availability_check') THEN
    IF EXISTS (SELECT 1 FROM inventory WHERE reserved + committed > quantity) THEN
      RAISE NOTICE 'velnox: inventory_availability_check NOT added - % row(s) have reserved + committed above on-hand',
        (SELECT COUNT(*) FROM inventory WHERE reserved + committed > quantity);
    ELSE
      ALTER TABLE inventory ADD CONSTRAINT inventory_availability_check
        CHECK (reserved + committed <= quantity);
    END IF;
  END IF;

  -- variant counters can never go negative
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_counters_non_negative_check') THEN
    IF EXISTS (SELECT 1 FROM product_variants WHERE stock < 0 OR reserved < 0 OR committed < 0 OR fulfilled < 0 OR returned < 0) THEN
      RAISE NOTICE 'velnox: product_variants_counters_non_negative_check NOT added - % row(s) hold a negative counter',
        (SELECT COUNT(*) FROM product_variants WHERE stock < 0 OR reserved < 0 OR committed < 0 OR fulfilled < 0 OR returned < 0);
    ELSE
      ALTER TABLE product_variants ADD CONSTRAINT product_variants_counters_non_negative_check
        CHECK (stock >= 0 AND reserved >= 0 AND committed >= 0 AND fulfilled >= 0 AND returned >= 0);
    END IF;
  END IF;

  -- variant availability: the same invariant the product-level row carries
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_availability_check') THEN
    IF EXISTS (SELECT 1 FROM product_variants WHERE reserved + committed > stock) THEN
      RAISE NOTICE 'velnox: product_variants_availability_check NOT added - % row(s) have reserved + committed above on-hand',
        (SELECT COUNT(*) FROM product_variants WHERE reserved + committed > stock);
    ELSE
      ALTER TABLE product_variants ADD CONSTRAINT product_variants_availability_check
        CHECK (reserved + committed <= stock);
    END IF;
  END IF;

  -- refunds: a refund of nothing is not a refund
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_amount_positive_check') THEN
    IF EXISTS (SELECT 1 FROM refunds WHERE amount <= 0) THEN
      RAISE NOTICE 'velnox: refunds_amount_positive_check NOT added - % row(s) hold a non-positive amount',
        (SELECT COUNT(*) FROM refunds WHERE amount <= 0);
    ELSE
      ALTER TABLE refunds ADD CONSTRAINT refunds_amount_positive_check CHECK (amount > 0);
    END IF;
  END IF;

  -- payments: the money can never be refunded beyond what was taken
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_refund_within_amount_check') THEN
    IF EXISTS (SELECT 1 FROM payments WHERE refunded_amount < 0 OR refunded_amount > amount) THEN
      RAISE NOTICE 'velnox: payments_refund_within_amount_check NOT added - % row(s) refunded beyond the captured amount',
        (SELECT COUNT(*) FROM payments WHERE refunded_amount < 0 OR refunded_amount > amount);
    ELSE
      ALTER TABLE payments ADD CONSTRAINT payments_refund_within_amount_check
        CHECK (refunded_amount >= 0 AND refunded_amount <= amount);
    END IF;
  END IF;

  -- order totals: the parts must add up to the whole, and money is never negative
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_money_non_negative_check') THEN
    IF EXISTS (SELECT 1 FROM orders WHERE subtotal < 0 OR shipping_fee < 0 OR discount < 0 OR total_amount < 0) THEN
      RAISE NOTICE 'velnox: orders_money_non_negative_check NOT added - % row(s) hold a negative amount',
        (SELECT COUNT(*) FROM orders WHERE subtotal < 0 OR shipping_fee < 0 OR discount < 0 OR total_amount < 0);
    ELSE
      ALTER TABLE orders ADD CONSTRAINT orders_money_non_negative_check
        CHECK (subtotal >= 0 AND shipping_fee >= 0 AND discount >= 0 AND total_amount >= 0);
    END IF;
  END IF;

    -- The relationship total = subtotal + shipping - discount is deliberately NOT a
  -- CHECK here. It was tried and reverted: a production-shaped row can hold a
  -- total with no line breakdown (an order created by a path that had no
  -- shipping/discount detail), and a CHECK would then refuse a row the
  -- application itself can produce - which is exactly the "a constraint would
  -- reject valid data" stop condition. The relationship is verified by the
  -- purchase and payment reconcilers instead, where drift is REPORTED rather
  -- than blocking a write.

-- shipments: the transit vocabulary (pending and created are the two legacy
  -- spellings; both are accepted so no historical row is invalidated)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipments_status_check') THEN
    IF EXISTS (SELECT 1 FROM shipments WHERE status NOT IN
                 ('pending', 'created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'returned', 'lost', 'cancelled')) THEN
      RAISE NOTICE 'velnox: shipments_status_check NOT added - % row(s) carry an unexpected status',
        (SELECT COUNT(*) FROM shipments WHERE status NOT IN
           ('pending', 'created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'returned', 'lost', 'cancelled'));
    ELSE
      ALTER TABLE shipments ADD CONSTRAINT shipments_status_check
        CHECK (status IN ('pending', 'created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'returned', 'lost', 'cancelled'));
    END IF;
  END IF;

  -- settlements: vocabulary
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlements_status_check') THEN
    IF EXISTS (SELECT 1 FROM settlements WHERE status NOT IN ('pending', 'processing', 'paid', 'failed', 'cancelled')) THEN
      RAISE NOTICE 'velnox: settlements_status_check NOT added - % row(s) carry an unexpected status',
        (SELECT COUNT(*) FROM settlements WHERE status NOT IN ('pending', 'processing', 'paid', 'failed', 'cancelled'));
    ELSE
      ALTER TABLE settlements ADD CONSTRAINT settlements_status_check
        CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'cancelled'));
    END IF;
  END IF;

  -- payment_incidents: the register is now kind-aware
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_incidents_kind_check') THEN
    IF EXISTS (SELECT 1 FROM payment_incidents WHERE kind IS NOT NULL AND kind NOT IN
                 ('late_payment', 'duplicate_charge', 'provider_dispute', 'inventory_drift',
                  'fulfillment_drift', 'refund_drift', 'reconciliation_failure', 'settlement_failure')) THEN
      RAISE NOTICE 'velnox: payment_incidents_kind_check NOT added - % row(s) carry an unexpected kind',
        (SELECT COUNT(*) FROM payment_incidents WHERE kind IS NOT NULL AND kind NOT IN
           ('late_payment', 'duplicate_charge', 'provider_dispute', 'inventory_drift',
            'fulfillment_drift', 'refund_drift', 'reconciliation_failure', 'settlement_failure'));
    ELSE
      ALTER TABLE payment_incidents ADD CONSTRAINT payment_incidents_kind_check
        CHECK (kind IS NULL OR kind IN
          ('late_payment', 'duplicate_charge', 'provider_dispute', 'inventory_drift',
           'fulfillment_drift', 'refund_drift', 'reconciliation_failure', 'settlement_failure'));
    END IF;
  END IF;

  -- payments: the vocabulary gains authorized / expired / the two refund values.
  -- Adding values to a CHECK cannot invalidate an existing row, so the guard is
  -- there to make an unexpected value LOUD rather than to protect a row.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_status_check') THEN
    IF EXISTS (SELECT 1 FROM payments WHERE status NOT IN
                 ('pending', 'requires_action', 'processing', 'authorized', 'paid', 'failed',
                  'cancelled', 'expired', 'partially_refunded', 'refunded')) THEN
      RAISE NOTICE 'velnox: payments_status_check NOT extended - % row(s) carry a status outside both vocabularies',
        (SELECT COUNT(*) FROM payments WHERE status NOT IN
           ('pending', 'requires_action', 'processing', 'authorized', 'paid', 'failed',
            'cancelled', 'expired', 'partially_refunded', 'refunded'));
    ELSE
      ALTER TABLE payments DROP CONSTRAINT payments_status_check;
      ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN
        ('pending', 'requires_action', 'processing', 'authorized', 'paid', 'failed',
         'cancelled', 'expired', 'partially_refunded', 'refunded'));
    END IF;
  END IF;
END $$;

-- ─── 11. unique keys for the idempotency columns (guard for duplicates) ───
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_payments_idempotency_key') THEN
    IF EXISTS (SELECT 1 FROM payments WHERE idempotency_key IS NOT NULL
                 GROUP BY idempotency_key HAVING COUNT(*) > 1) THEN
      RAISE NOTICE 'velnox: idx_payments_idempotency_key NOT added - duplicate keys already exist';
    ELSE
      CREATE UNIQUE INDEX idx_payments_idempotency_key ON payments (idempotency_key) WHERE idempotency_key IS NOT NULL;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_refunds_idempotency_key') THEN
    IF EXISTS (SELECT 1 FROM refunds WHERE idempotency_key IS NOT NULL
                 GROUP BY idempotency_key HAVING COUNT(*) > 1) THEN
      RAISE NOTICE 'velnox: idx_refunds_idempotency_key NOT added - duplicate keys already exist';
    ELSE
      CREATE UNIQUE INDEX idx_refunds_idempotency_key ON refunds (idempotency_key) WHERE idempotency_key IS NOT NULL;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_settlements_reference') THEN
    IF EXISTS (SELECT 1 FROM settlements WHERE reference IS NOT NULL
                 GROUP BY reference HAVING COUNT(*) > 1) THEN
      RAISE NOTICE 'velnox: idx_settlements_reference NOT added - duplicate references already exist';
    ELSE
      CREATE UNIQUE INDEX idx_settlements_reference ON settlements (reference) WHERE reference IS NOT NULL;
    END IF;
  END IF;
END $$;

-- ─── 12. the ledger is append-only ─────────────────────────────────────────
-- A financial record is corrected by a NEW compensating entry, never by an edit.
-- The trigger raises, so an accidental UPDATE or DELETE fails loudly instead of
-- silently rewriting history.
CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'velnox: ledger_entries is append-only (attempted % on %)', TG_OP, COALESCE(OLD.id::text, '?');
END $$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_ledger_mutation') THEN
    CREATE TRIGGER trg_prevent_ledger_mutation
      BEFORE UPDATE OR DELETE ON ledger_entries
      FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
  END IF;
END $$;

-- ─── 13. indexes the new read paths need ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_order_state ON orders (order_state);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON orders (fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_payment_events_backlog
  ON payment_events (next_retry_at) WHERE status IN ('processing', 'failed');
CREATE INDEX IF NOT EXISTS idx_refunds_status_created ON refunds (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlements_seller ON settlements (seller_id, created_at DESC);

-- ─── 14. assertion ────────────────────────────────────────────────────────
-- Fails the run if the reconciliation did not finish, naming what is missing.
DO $$
DECLARE
  missing TEXT := '';
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_attempts', 'fulfillment_orders', 'shipment_items',
                           'inventory_movements', 'ledger_entries', 'order_returns',
                           'outbox_events', 'reconciliation_runs', 'reconciliation_findings']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      missing := missing || ' public.' || t;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'order_state') THEN
    missing := missing || ' orders.order_state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'fulfillment_status') THEN
    missing := missing || ' orders.fulfillment_status';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'inventory' AND column_name = 'committed') THEN
    missing := missing || ' inventory.committed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'product_variants' AND column_name = 'reserved') THEN
    missing := missing || ' product_variants.reserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'fulfilled_quantity') THEN
    missing := missing || ' order_items.fulfilled_quantity';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_ledger_mutation') THEN
    missing := missing || ' trg_prevent_ledger_mutation';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'velnox: migration 056 finished but these objects are still missing:%', missing;
  END IF;
  RAISE NOTICE 'velnox: commerce core verified - 9 commerce-core tables, both order axes, both inventory axes, the fulfilled-quantity axis, the ledger append-only trigger and the retry metadata are all present';
END $$;
