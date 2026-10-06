# MIGRATION_PLAN.md — schema changes, phasing, safety, rollback

> **§39 conflict, flagged.** The brief lists `db/run-update.sql` as a schema sync
> target. `AGENTS.md` rule 4 and `.ai/AI_RULES.md` §6 say that file is
> **deprecated — never recreate, update, or depend on it**. The repository wins:
> only `db/schema.sql`, `db/run-sqleditor.sql` and a new file under
> `db/migrations/` are written. `db/run-update.sql` remains absent.

---

## 1. What the migration must not do (§43)

It must not: drop a table or a column, `TRUNCATE`, `DELETE`, rewrite a financial
row, change an existing column's type, tighten an existing CHECK over data whose
values are unknown from this workspace, or apply a constraint that could destroy a
valid row. Every statement is **additive or guarded**; the single exception is
documented in §4.

---

## 2. Schema change set

### 2.1 New tables (11)

`payment_attempts`, `fulfillment_orders`, `shipment_items`, `inventory_movements`,
`ledger_entries`, `order_returns`, `outbox_events`, `reconciliation_runs`,
`reconciliation_findings`, `idempotency_keys` (a generic durable key store for
operations that are not checkout/payment), `correlation_requests` *(optional — only
if the request-id middleware needs server-side persistence; otherwise the id lives
on the rows that matter and the table is not created)*.

### 2.2 Extended tables (7) — all `ADD COLUMN IF NOT EXISTS`

| Table | Added |
|---|---|
| `orders` | `order_state`, `fulfillment_status` (+ CHECKs), `currency` (if absent), `correlation_id` |
| `order_items` | `fulfilled_quantity` (int NOT NULL DEFAULT 0, CHECK 0..quantity) |
| `inventory` | `variant_id`, `committed`, `fulfilled`, `returned` (+ CHECKs) |
| `payments` | `idempotency_key`, `correlation_id` |
| `refunds` | `idempotency_key` (UNIQUE), `refundable_minor`, `correlation_id`, CHECK `amount > 0` |
| `payment_events` | `received_at`, `attempt_count`, `next_retry_at`, `payload_reference`, `provider_object_id`, `last_error_at`, `correlation_id` |
| `payment_incidents` | `kind` |
| `settlements` | `currency`, `period_start`, `period_end`, `reference` (UNIQUE), `paid_at`, `updated_at`, `entry_count`, status CHECK |
| `shipments` | `fulfillment_order_id`, `shipped_at`, `delivered_at`, `correlation_id`, status CHECK |

### 2.3 Vocabulary extensions (guarded, never destructive)

* `payments_status_check` — replaced to add `authorized` and `expired` and the two
  refund values. **Guard:** count rows whose `status` is not in the NEW set *and*
  not in the OLD set; if any exist, raise a `NOTICE`, name them, and **skip** the
  replacement instead of aborting under `ON_ERROR_STOP` (the same conditional
  pattern migration 055 established, and for the same reason: production is
  unreadable from this workspace). Adding values to a CHECK cannot invalidate an
  existing row, so this replacement is safe by construction; the guard exists to
  make an unexpected value loud rather than fatal.
* `orders_order_state_check`, `orders_fulfillment_status_check`,
  `shipments_status_check`, `fulfillment_orders_status_check` — **new** columns,
  so the constraints only ever see the values the backfill wrote.
* `orders_status_check` — **NOT touched.** The legacy 12-value CHECK stays exactly
  as it is: the projection mapper is total over it, and tightening it would risk
  existing rows (§43).

### 2.4 Backfill (deterministic, single pass, idempotent)

```sql
-- orders: derive the two real axes from the legacy value. Never the reverse.
order_state        := CASE status
                        WHEN 'cancelled' THEN 'cancelled'
                        WHEN 'completed' THEN 'completed'
                        WHEN 'packing'   THEN 'processing'
                        WHEN 'shipped'   THEN 'processing'
                        WHEN 'delivered' THEN 'processing'
                        WHEN 'confirmed' THEN 'confirmed'
                        ELSE 'pending' END
fulfillment_status := CASE status
                        WHEN 'cancelled'      THEN 'cancelled'
                        WHEN 'completed'      THEN 'delivered'
                        WHEN 'delivered'      THEN 'delivered'
                        WHEN 'shipped'        THEN 'shipped'
                        WHEN 'packing'        THEN 'packing'
                        WHEN 'confirmed'      THEN 'ready'
                        WHEN 'paid'           THEN 'ready'
                        WHEN 'refunded'       THEN 'unfulfilled'
                        WHEN 'payment_failed' THEN 'unfulfilled'
                        WHEN 'expired'        THEN 'unfulfilled'
                        ELSE 'unfulfilled' END
```
then `UPDATE … WHERE order_state IS NULL` so a second run changes nothing.

* `payment_attempts` — one row per existing `payments` row that has a provider
  session or intent id, with `idempotency_key = 'legacy-attempt-' || payments.id`,
  `status` mapped from `payments.status`, `attempt_number = 1`.
* `fulfillment_orders` — one row per order with `order_state` in
  (`confirmed`,`processing`,`completed`) or `status='paid'`.
* `inventory` — one row per `product_variants` row
  (`on_hand = stock, reserved = 0, committed = 0, fulfilled = 0, returned = 0`),
  and the existing product rows keep their values (`quantity` = `on_hand`;
  `committed/fulfilled/returned` default 0).
* `shipments` — `status` normalised to the new vocabulary (`pending|created` →
  `created`; anything else → `created` with the original preserved in the row's
  existing fields).
* `payment_events` — `received_at = created_at`, `attempt_count = 1 WHERE
  status='processed' ELSE 0`.
* `shipment_items` — for an order with exactly one shipment, attach that
  shipment to all of the order's items with their full quantities, and set
  `order_items.fulfilled_quantity = quantity` only for orders whose legacy status
  was `shipped`/`delivered`/`completed`. **Any other case is left unbackfilled**
  and reported as a reconciler finding, because guessing which units were in a
  shipment would invent a fact.

**Idempotency of the backfill** is the acceptance criterion: running the whole
file a second and a third time must change nothing (the existing
`db/run-sqleditor.sql` contract), and `db/verify-reconciler.sh` plus a new
backfill-assertion scenario prove it.

### 2.5 The one `DROP CONSTRAINT`

`ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_product_id_key;`
replaced by the two partial UNIQUE indexes. Justification: the existing constraint
makes it **structurally impossible** to store a second row for another variant of
the same product, i.e. it forbids the target model. The replacement is
**stronger in practice** (each product still has exactly one non-variant row, each
variant has exactly one row) and no data is lost. Guarded:
only drop when both replacement indexes exist, and the operation is inside the
same `DO $$` block so a partial apply is impossible.

### 2.6 Where each change is written

| File | Content |
|---|---|
| `db/migrations/056_commerce_core_invariants.sql` | the whole change set, in dependency order, guarded and rerunnable |
| `db/schema.sql` | the same objects added to the SNAPSHOT (declaration parity) |
| `db/run-sqleditor.sql` | the additive reconciler passes for an EXISTING database |
| `db/verify-reconciler.sh` | the canonical count assertion updated (currently `66\|244\|258\|653`) + new scenarios |
| `backend/tests/helpers/canonical-schema.ts` | parity assertion coverage for the new objects |

---

## 3. Phases (§42) — the order in which this is built

Each phase ends with: `git diff --check` clean, `bun --filter @velnox/backend
typecheck`, the affected tests green on a freshly reconciled disposable database,
and an updated `FINAL_VERIFICATION.md` row. **No phase starts before the previous
one's gate passes.**

| Phase | Deliverable | Gate |
|---|---|---|
| 1 Audit | `CURRENT_ARCHITECTURE.md` | evidence lines exist for every claim |
| 2 Research | `PRODUCTION_COMMERCE_RESEARCH.md` | WHAT/WHY/PROBLEM/HOW per source |
| 3 Domain model | `DOMAIN_MODEL.md` + `STATE_MACHINES.md` | every entity has one writer |
| 4 DB invariants | migration 056 + both canonical files + reconciler counts | fresh bootstrap exit 0; rerun changes nothing; `db:verify` 100 % |
| 5 Checkout | server quote persisted on the purchase; price/stock re-resolution | unit + DB tests; no client value used |
| 6 Purchase / Order | `order_state` + projection + creation rules | transition tests; projection totality test |
| 7 Payment | `payment_attempts` lifecycle + settlement writes attempt/ledger/outbox | settlement tests; late-payment incident preserved |
| 8 Inventory | one authority, six axes, movements, guarded checks | concurrency test (last unit); movement-replay test |
| 9 Seller orders | seller surface reads the four axes, ownership predicates | leak test (seller cannot see another shop's row) |
| 10 Fulfillment | `fulfillment_orders`, partial shipment, `shipment_items` | over-ship refused; partial fulfilment test |
| 11 Refund / cancellation | refund domain op + the 7-step cancel orchestration + returns | duplicate refund; cancel-after-paid; return→refund |
| 12 Events / webhooks | outbox + event catalogue + `payment_events` retry fields + stale reclaim | duplicate/retry/out-of-order/concurrent-webhook tests |
| 13 Reconciliation | six reconcilers + jobs + admin reads | each reconciler finds a planted inconsistency and repairs nothing |
| 14 Frontend | derive every label from the domain axes; no client state decisions | typecheck + `i18n:check` + both storefront pages |
| 15 E2E | the §35/§36 matrix | counts reported honestly; provider-dependent rows BLOCKED if no keys |
| 16 Legacy cleanup | dead code/tables confirmed unused, then removed | dependency grep + full suite green before each deletion |
| 17 Production verification | migration applied to the canonical database, reconcilers run | owner action; reported BLOCKED until it happens |

---

## 4. Rollback

Every change is additive, so rollback is **forward-only by design** and does not
need a destructive script:

| Change | Rollback |
|---|---|
| new tables | unused by old code; drop only after the new code is gone (and only with owner approval) |
| new columns | old code ignores them; nullable/defaulted so no insert breaks |
| new constraints on new columns | dropping them is safe |
| the one `DROP CONSTRAINT` on `inventory` | re-adding it requires deleting the new variant rows — **this is the only irreversible step in the set**, so it is applied last, in its own `DO $$` block, and must be preceded by a verified count of variant rows |
| backfills | idempotent `WHERE … IS NULL`; reversing them means setting the new columns back to NULL, which the app tolerates |
| `payments_status_check` replacement | re-adding the old CHECK requires no row to hold `authorized`/`expired`; the guard reports the count before it applies |

**Application-order safety.** The backend must tolerate a database older than the
build (the `to_jsonb(...) ->> 'col'` pattern already used on the payment path is
the mechanism) and a database newer than the build (new columns unused). No deploy
will 500 because a migration has not run yet.

---

## 5. Verification of the migration itself

1. Fresh empty database + `db/run-sqleditor.sql` → exit 0, then run it twice more
   → no change (byte-level `pg_dump --schema-only` comparison).
2. A database seeded with **legacy-shaped** data (orders in each of the 12 legacy
   statuses, variant products, a multi-shop purchase with a group payment, a
   refund with `order_id NULL`) + the reconciler → exit 0, all rows preserved, and
   the backfill produces the intended axes.
3. `db/verify-reconciler.sh` → updated canonical counts, all scenarios PASS.
4. The full backend suite against the reconciled disposable database.
5. `bun run db:verify` and the four-app typecheck + build.
