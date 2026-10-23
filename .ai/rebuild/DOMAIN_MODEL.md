# DOMAIN_MODEL.md — entities, fields, invariants

> Every table named **EXISTS** is already in `db/schema.sql` and is being kept
> (re-scoped, not duplicated). Every table named **NEW** is created by this
> rebuild's migration. Every **EXTENDED** table gains columns or constraints.
> Nothing in this document creates a second authority for anything.

---

## 1. Identity and ownership chain

```
users.id ──┐
           ├─> carts.user_id                 (UNIQUE user_id — one active cart)
           ├─> checkout_groups.user_id       (Purchase owner; ON DELETE CASCADE)
           ├─> orders.user_id                (SellerOrder owner; the ownership key of every customer read)
           └─> addresses.user_id             (ownership-checked before a snapshot is taken)

shops.id ──┐
           ├─> orders.shop_id                (one SellerOrder per shop per purchase)
           ├─> order_items.shop_id           (line-level shop, denormalised for seller reads)
           └─> fulfillment_orders.shop_id    (NEW — who does the work)

sellers.id ─┬─> ledger_entries.seller_id     (NEW — who is owed)
            └─> settlements.seller_id        (EXTENDED — who was paid)
```

**Ownership is a WHERE clause, never an after-the-fact check.** Every customer
read of a purchase resolves `user_id` in the predicate (as
`readOwnedCheckoutGroup` already does), so a foreign id is indistinguishable
from a missing one. Every seller read resolves `shop_id → sellers.user_id`.
Every admin read requires `orders.manage` (Velcenter permission).

---

## 2. Purchase (`checkout_groups`) — EXISTS

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | = the purchase id used in every URL and every audit row |
| `user_id` | uuid NOT NULL | owner; customer reads are scoped by it |
| `total_amount` | numeric(12,2) | **server-computed**; must equal `SUM(member orders.total_amount)` |
| `currency` | text | one currency per purchase |
| `item_count` | int ≥ 0 | informational |
| `shop_count` | int ≥ 1 | informational |
| `created_at` | timestamptz | |

**EXTENDED (this rebuild):** `subtotal_amount`, `shipping_fee`, `discount_amount`,
`priced_at`, `quote_version` — the **server-computed quote** the customer
accepted, so a later price edit cannot silently disagree with what was charged
(audit finding: `priceChanged` is flagged but not persisted).

**Invariants**
* `I-P1` every member order of a purchase has the same `user_id` and `currency`
  (DB-enforced once the backfill proves existing data satisfies it).
* `I-P2` `checkout_groups.total_amount = SUM(orders.total_amount)` over its
  members — verified by the payment reconciliation job, not by a trigger
  (a trigger would fight the settlement path that re-derives the sum).
* `I-P3` a purchase is **paid as a unit**: at most one live provider session
  (`idx_payments_one_active_stripe_group`), and settlement moves every member or
  none.

---

## 3. SellerOrder (`orders`) — EXISTS, re-scoped

| Column | Rule |
|---|---|
| `id` | PK. One row per (purchase, shop). |
| `user_id`, `shop_id` | ownership + fulfilment owner |
| `order_number` | 18 digits, `TEXT`, generated server-side, `UNIQUE` partial index, SAVEPOINT retry on collision |
| `status` | **DEPRECATED as an input — derived projection** (see `STATE_MACHINES.md` §5) |
| `order_state` | **NEW** — the order axis: `pending｜confirmed｜processing｜completed｜cancelled` |
| `fulfillment_status` | **NEW** — the fulfillment axis: `unfulfilled｜ready｜picking｜packing｜ready_to_ship｜shipped｜delivered｜failed｜cancelled` |
| `subtotal`, `shipping_fee`, `discount`, `total_amount` | numeric(12,2), server-computed, `CHECK (>= 0)` |
| `currency` | must match the purchase |
| `shipping_address_id`, `shipping_address` | DB-row snapshot, never a client object |
| `inventory_released` | exactly-once release claim (keep) |
| `payment_expires_at`, `reservation_policy` | fixed 30-minute reservation (keep) |
| `checkout_group_id` | FK → `checkout_groups` ON DELETE SET NULL (keep) |
| `renumbered_at`? no | — |

**Invariants**
* `I-O1` `order_state` and `fulfillment_status` are always inside their vocabularies
  (DB CHECK), and a terminal order (`completed`/`cancelled`) never leaves it.
* `I-O2` `fulfillment_status = 'shipped'` **implies** at least one `shipments` row
  with a carrier and tracking number (enforced by the transition, verified by the
  fulfillment reconciler).
* `I-O3` `total_amount = subtotal + shipping_fee - discount` (DB CHECK).
* `I-O4` an order may only reach `fulfillment_status='packing'` or beyond when a
  settled payment exists (the existing `assertPaymentConfirmedForConfirmation`
  rule, kept, now expressed against the attempt-aware covering set).

---

## 4. OrderItem (`order_items`) — EXISTS

Already correct: immutable snapshots (`product_name_snapshot`,
`variant_name_snapshot`, `image_url_snapshot`), the purchased `price` and
`subtotal`, the `variant_id`, and a `shop_id` for seller reads.
**EXTENDED:** `fulfilled_quantity` (int ≥ 0, ≤ `quantity`) so partial
fulfillment is expressible without touching the commercial line.

`I-I1` `subtotal = price × quantity` (CHECK).
`I-I2` `SUM(fulfilled_quantity) ≤ quantity` for every item (CHECK + the
fulfillment reconciler).

---

## 5. Payment (`payments`) and PaymentAttempt (`payment_attempts`) — EXISTS / NEW

`payments` keeps: `order_id` | `checkout_group_id` | `plan_id` (at-least-one
parent), `amount`, `currency`, `method`, `status`, `provider`,
`provider_payment_id`, `provider_checkout_session_id`, `paid_at`,
`refunded_amount`, `refund_status`, `failure_code`, `failure_message`, `metadata`.

**`payments.status` vocabulary is EXTENDED** to
`UNPAID｜PENDING｜AUTHORIZED｜PROCESSING｜PAID｜FAILED｜EXPIRED｜PARTIALLY_REFUNDED｜REFUNDED`
(lower-cased, matching the existing writers, and adding the two that were
missing: `authorized`, `expired`; `partially_refunded`/`refunded` are folded into
the **payment** row too, where today they live only in `refund_status`).

**`payment_attempts` (NEW)** — one row per provider interaction:

| Column | Rule |
|---|---|
| `id` uuid PK | |
| `payment_id` uuid NOT NULL FK → payments(id) ON DELETE CASCADE | |
| `attempt_number` int NOT NULL | 1,2,3… per payment, `UNIQUE(payment_id, attempt_number)` |
| `provider` text NOT NULL | `stripe` today; the seam for a second provider |
| `method` text NOT NULL | `card｜promptpay｜cod` |
| `status` text NOT NULL CHECK | `created｜requires_action｜processing｜succeeded｜failed｜expired｜canceled` |
| `amount_minor` bigint NOT NULL | integer minor units — no float |
| `currency` text NOT NULL | |
| `idempotency_key` text NOT NULL **UNIQUE** | durable, DB-enforced |
| `provider_session_id` text | `UNIQUE(provider, provider_session_id)` partial |
| `provider_intent_id` text | `UNIQUE(provider, provider_intent_id)` partial |
| `failure_code`, `failure_message` | last provider error |
| `created_at`, `updated_at`, `confirmed_at`, `settled_at` | |

**Invariants**
* `I-PAY1` a payment with `status='paid'` has `paid_at IS NOT NULL` and at least
  one `succeeded` attempt.
* `I-PAY2` `refunded_amount ≥ 0` and `refunded_amount ≤ amount` (DB CHECK).
* `I-PAY3` at most one attempt per payment may hold a **live** status
  (`created｜requires_action｜processing`) — partial UNIQUE index, replacing the
  current per-order index's coarse equivalent.
* `I-PAY4` a group payment has `order_id IS NULL` and `checkout_group_id NOT NULL`;
  a single-shop payment has `order_id NOT NULL`. Never both, never neither.
* `I-PAY5` **never** stores a card number, CVV, expiry, full PAN or raw
  credential — only provider object ids.

---

## 6. Refund (`refunds`) and Return (`order_returns`) — EXISTS / NEW

`refunds` keeps: `order_id` nullable, `checkout_group_id` nullable, `payment_id`,
`provider`, `provider_refund_id` (UNIQUE), `amount`, `reason`, `status`,
`requested_by`, `refunded_at`, `failure_reason`.

**EXTENDED:** `idempotency_key` (**UNIQUE**, durable), `refundable_minor`
(snapshot of what was refundable when the refund was created), `correlation_id`,
and `CHECK (amount > 0)`.

**Invariants**
* `I-R1` `SUM(succeeded refunds of a payment) ≤ payments.amount` — verified by the
  refund reconciler **and** guarded transactionally by the refund service under
  the payment row lock.
* `I-R2` `refund.amount` is computed from the **refundable amount** (captured
  minus already-refunded), never from `orders.total_amount` automatically.
* `I-R3` a refund is `pending` until the provider confirms it; only
  `charge.refunded` / `refund.updated` may move it to `succeeded`.

**`order_returns` (NEW)** — the missing RMA entity: `id`, `order_id` NOT NULL,
`order_item_id` nullable (whole-order return when NULL), `quantity`,
`reason_code`, `customer_note`, `status CHECK ('requested｜approved｜rejected｜
in_transit｜received｜restocked｜completed｜cancelled')`, `requested_by`,
`decided_by`, `decided_at`, `received_at`, `restocked_quantity`,
`created_at`, `updated_at`.
`I-RT1` restocking is an inventory **movement** (`return`), never a direct
column write.

---

## 7. FulfillmentOrder (`fulfillment_orders`) and Shipment — NEW / EXISTS+EXTENDED

**`fulfillment_orders` (NEW)**

| Column | Rule |
|---|---|
| `id` uuid PK | |
| `order_id` uuid NOT NULL FK → orders(id) ON DELETE CASCADE | |
| `shop_id` uuid | the fulfilling seller |
| `location` text NOT NULL DEFAULT `'default'` | one per (order, location) — room for multi-warehouse |
| `status` text NOT NULL CHECK | `unfulfilled｜ready｜picking｜packing｜ready_to_ship｜shipped｜delivered｜failed｜cancelled` |
| `failure_code`, `failure_note` | why it failed |
| `created_at`, `updated_at`, `completed_at` | |
| UNIQUE `(order_id, location)` | one work unit per order per location (today: exactly one per order) |

Created **inside the settlement transaction** for a paid order (and at
order-creation for a COD order once COD is enabled). Backfilled for every
existing order that has been paid or has moved past `pending`.

**`shipments` EXTENDED:** `fulfillment_order_id` (FK), `status` gains a CHECK over
`created｜picked_up｜in_transit｜out_for_delivery｜delivered｜returned｜lost｜cancelled`,
`shipped_at`, `delivered_at`, `correlation_id`.
Backfill: `pending|created` → `created`; every other value (there are none today)
→ `created` with the original kept in a note.

**`shipment_items` (NEW):** `shipment_id` FK, `order_item_id` FK, `quantity`
(`CHECK (quantity > 0)`), `UNIQUE(shipment_id, order_item_id)`. A shipment is
therefore *partial by construction*: it names the units it carries, and
`order_items.fulfilled_quantity` is advanced by exactly those quantities inside
the same transaction.

`I-F1` `SUM(shipment_items.quantity) per order_item ≤ order_items.quantity`.
`I-F2` no two shipments can carry the same `order_item` beyond its quantity
(guarded UPDATE on `fulfilled_quantity`, claimed atomically).
`I-F3` `fulfillment_status='shipped'` implies a shipment with carrier + tracking.

---

## 8. InventoryLevels (`inventory`) and InventoryMovement — EXTENDED / NEW

**`inventory` EXTENDED** — the ONE stock authority for products **and** variants:

| Column | Meaning |
|---|---|
| `product_id` | NOT NULL (kept) |
| `variant_id` | **NEW** nullable FK → product_variants(id) ON DELETE CASCADE |
| `on_hand` | physical units under the seller's control (was `quantity`) |
| `reserved` | held by an open, not-yet-paid order |
| `committed` | **NEW** — paid, not yet handed to a carrier |
| `fulfilled` | **NEW** — handed to a carrier / delivered |
| `returned` | **NEW** — units returned (counter; restocking adds back to `on_hand`) |
| `reorder_level`, `low_stock_threshold`, `updated_at` | kept |

* Uniqueness: partial UNIQUE on `(product_id) WHERE variant_id IS NULL` and on
  `(variant_id) WHERE variant_id IS NOT NULL`. The legacy
  `inventory_product_id_key` UNIQUE is replaced by exactly those two — the single
  documented `DROP CONSTRAINT`, because it structurally blocks two variants of one
  product from each having a row.
* Derived, never stored: `available = on_hand − reserved − committed`.
* `CHECK` per counter `>= 0`, plus `CHECK (reserved + committed <= on_hand)`.
* `product_variants.stock` is kept and becomes a **derived projection** = variant's
  `available` (one writer: `lib/inventory.ts`), so the storefront's existing read
  path keeps working unchanged.

**`inventory_movements` (NEW)** — the auditable *why*:
`id`, `inventory_id` FK, `product_id`, `variant_id`, `movement CHECK
('reserve｜release｜commit｜fulfil｜return｜adjust')`, `quantity int > 0`,
`order_id`, `order_item_id`, `reason`, `actor_user_id`, `idempotency_key`
(UNIQUE, nullable), `correlation_id`, `created_at`.
Invariant `I-INV1`: every mutation of `inventory` writes exactly one movement row
in the same transaction; a movement row is never updated or deleted.

---

## 9. The ledger, payable and settlement — NEW / EXTENDED

**`ledger_entries` (NEW, append-only)**

| Column | Rule |
|---|---|
| `id` uuid PK | |
| `entry_type` CHECK | `charge｜refund｜platform_fee｜seller_payable｜settlement｜adjustment` |
| `account` CHECK | `platform_cash｜platform_revenue｜seller_payable｜refund_clearing` |
| `direction` CHECK | `debit｜credit` |
| `amount_minor` bigint > 0 | integer minor units |
| `currency` | |
| `seller_id`, `order_id`, `payment_id`, `refund_id`, `settlement_id`, `purchase_id` | nullable FKs, exactly the ones the entry needs |
| `idempotency_key` text **UNIQUE** | makes a retried write a no-op, not a duplicate |
| `correlation_id` | the request/event that caused it |
| `occurred_at`, `created_at` | |

`I-L1` the ledger is **append-only**: no `UPDATE`, no `DELETE` in any code path.
A correction is a new `adjustment` entry.
`I-L2` for each `seller_id`, `seller_payable` credits − settlements ≥ 0
(the payable never goes negative) — verified by the reconciliation job.
`I-L3` `platform_fee` + `seller_payable` = `charge` for the same payment.

**`settlements` EXTENDED:** `currency`, `period_start`, `period_end`,
`reference` (UNIQUE), `paid_at`, `updated_at`, `entry_count`,
`status CHECK ('pending｜processing｜paid｜failed｜cancelled')`.
A settlement is **derived from** ledger `seller_payable` entries (it records
which entries it paid through the `ledger_entries.settlement_id` link), never from
a read-time estimate.

**Seller money is separate from customer money (§17):** a `charge` creates
`platform_cash` and `seller_payable`; the seller is paid only by a settlement.
Customer payment implies **nothing** about the seller having been paid.

---

## 10. Events

**`outbox_events` (NEW)** — the transactional domain-event log:

`id`, `event_id` uuid UNIQUE, `aggregate_type CHECK ('purchase｜order｜
fulfillment｜shipment｜payment｜refund｜inventory｜return')`, `aggregate_id`,
`event_type` text, `payload jsonb`, `correlation_id`, `occurred_at`,
`status CHECK ('pending｜published｜failed｜dead')`, `attempt_count int ≥ 0`,
`next_retry_at`, `last_error`, `published_at`, `created_at`.

Event vocabulary (minimum): `PurchaseCreated`, `OrderCreated`, `PaymentPending`,
`PaymentConfirmed`, `PaymentFailed`, `PaymentExpired`, `InventoryReserved`,
`InventoryReleased`, `InventoryCommitted`, `OrderConfirmed`, `OrderCancelled`,
`FulfillmentCreated`, `FulfillmentStarted`, `ShipmentCreated`, `ShipmentShipped`,
`ShipmentDelivered`, `ReturnRequested`, `ReturnReceived`, `RefundCreated`,
`RefundCompleted`, `LedgerEntryRecorded`, `SettlementPaid`.

**`payment_events` EXTENDED** (the provider-event store, §22):
`received_at` (NEW, default now, backfilled from `created_at`),
`attempt_count` (NEW, default 0/backfilled 1 for processed rows),
`next_retry_at` (NEW), `payload_reference` (NEW), `provider_object_id` (NEW),
`last_error_at` (NEW), `correlation_id` (NEW). The existing `event_id UNIQUE`
claim, `status` and `error` columns stay exactly as they are.

**`payment_incidents` EXTENDED:** `kind` (NEW; `late_payment｜duplicate_charge｜
inventory_drift｜fulfillment_drift｜refund_drift｜reconciliation_failure`) so the
incident register covers the whole rebuild, not only late payments.

---

## 11. Reconciliation

**`reconciliation_runs` (NEW):** `id`, `kind CHECK ('payment｜inventory｜
fulfillment｜refund｜ledger｜purchase')`, `scope` (NULL = all), `status CHECK
('running｜completed｜failed')`, `started_at`, `finished_at`, `checked_count`,
`mismatch_count`, `error`, `correlation_id`.

**`reconciliation_findings` (NEW):** `id`, `run_id` FK, `kind`, `severity CHECK
('info｜warning｜critical')`, `entity_type`, `entity_id`, `expected`, `observed`,
`detail`, `fingerprint` (UNIQUE per kind+entity+fingerprint → one open finding per
real drift), `status CHECK ('open｜resolved｜ignored')`, `detected_at`,
`resolved_at`, `resolved_by`, `resolution_note`.

`I-RC1` a reconciler **never writes business state**. It writes findings. A human
(or an explicit, separately-audited repair job) resolves them.

---

## 12. What each entity must NOT do

| Entity | Forbidden |
|---|---|
| Cart | becoming the order; being the price authority at checkout |
| Purchase | holding a fulfillment status |
| SellerOrder | holding a payment status; being written by a seller route directly |
| Payment | holding a customer identity or a card detail |
| Attempt | outliving its payment; being created without an idempotency key |
| FulfillmentOrder | existing before the order is payable; shipping without items |
| Shipment | carrying more units than the item has; being created twice for one claim |
| Inventory | being mutated without a movement row; going negative |
| Ledger | being updated or deleted |
| Settlement | being computed at read time from orders |
| Outbox | being written outside the state-change transaction |
| Reconciler | repairing data silently |
