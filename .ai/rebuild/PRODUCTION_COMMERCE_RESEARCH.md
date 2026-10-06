# PRODUCTION_COMMERCE_RESEARCH.md — public architecture principles, restated for Velnox

> **Scope of this document.** It records *principles* that are publicly documented
> (Stripe API docs, Shopify fulfillment/inventory/payout docs, Amazon marketplace
> sellers' documentation, Lazada's public seller/partner documentation, and the
> general literature on OMS / event-driven commerce). It contains **no proprietary
> source code, no reverse engineering, and no claim about any company's internal
> implementation.** Where a behaviour is only observable as a *contract* (an API
> response, a webhook payload, a documented state), it is described as a contract.
>
> Method for every section: **WHAT THEY DO · WHY · WHAT PROBLEM IT SOLVES ·
> HOW VELNOX SHOULD IMPLEMENT THE SAME PRINCIPLE.**
>
> Authority: `db/schema.sql` + source are authoritative for Velnox behaviour.
> This file is design input only.

---

## 1. MARKETPLACE — one purchase, many sellers

### Lazada (public seller/partner documentation)
* **WHAT** — A customer checks out a cart that can span many sellers. The public
  contract shows one customer order with per-seller "packages"/"sub-orders"; each
  seller sees only their own part, ships it separately with its own tracking, and
  the customer's payment is taken once for the whole checkout.
* **WHY** — Fulfilment is per-seller (different warehouses, carriers, SLAs), but
  the customer's intent and money are per-checkout. Coupling them either way
  produces a broken experience.
* **WHAT PROBLEM** — (a) Charging per sub-order means N charges for one intent —
  reconciliation and refunds become combinatorial; (b) charging per checkout but
  fulfilling per sub-order means the payment must be able to *cover* rows it is
  not attached to; (c) showing one seller another seller's rows leaks commercial
  data.
* **HOW VELNOX** — `checkout_groups` **is** the purchase aggregate already; the
  money row (`payments`) may name the group (`checkout_group_id`) while
  `order_id IS NULL`. This is the correct model and it is **already the root cause
  fix of §70** — the remaining defect is that the *fold* (which status a single
  order should report) and the *failure/expiry* paths were blind to it. Every
  per-order money read must go through ONE covering-set resolver
  (`backend/lib/payment-attempt.ts`), and every write must resolve its scope
  **server-side from the order row**, never from a request parameter.

### Amazon Marketplace (public seller documentation)
* **WHAT** — Seller-facing order objects are a *projection* of the customer order,
  filtered by seller. Order state the seller sees (Unshipped/PartiallyShipped/
  Shipped/Canceled) is a **fulfillment** vocabulary, not a payment one; payment
  status is not a seller-visible state machine.
* **WHY** — Each party needs one question answered: the seller "what must I ship?",
  the customer "where is my money and my parcel?", the platform "what is owed?".
  One shared status column cannot answer three questions.
* **WHAT PROBLEM** — A single status column becomes a superset: every consumer
  must interpret values it does not own, and every new state breaks every reader.
* **HOW VELNOX** — Separate axes: **payment** (in `payments`/`payment_attempts`),
  **order** (`orders.order_state`), **fulfillment** (`orders.fulfillment_status` +
  `fulfillment_orders`), **shipment** (`shipments.status`). `orders.status` is
  demoted to a **derived compatibility projection** maintained by exactly one
  function so the four existing frontends keep rendering.

### Shopify (public marketplace/Shopify Plus documentation)
* **WHAT** — Shopify separates "order" from "fulfillment order": an order is a
  commercial record; a **fulfillment order** is "the work to be done to fulfil
  some of its line items from a location", and a fulfillment (shipment) is created
  against it. Partial and split fulfilment are first-class.
* **WHY** — Fulfilment is an operational process with its own retries, locations
  and partial outcomes; making it a field on the order forces the order to model
  warehouse reality.
* **WHAT PROBLEM** — Without it you cannot express "2 of 3 units shipped", "ships
  from two warehouses", "line item removed before shipping", "reshipment after a
  lost parcel" — each becomes a schema change.
* **HOW VELNOX** — Introduce `fulfillment_orders` (one per order × location;
  today effectively one per order) and `shipment_items` so a shipment carries
  quantities per `order_item`. `shipments` gains `fulfillment_order_id`.

---

## 2. COMMERCE / CHECKOUT — the server is the pricing authority

### Shopify checkout (public docs + published checkout API contract)
* **WHAT** — Checkout computes totals server-side from the cart lines, the
  shipping method, the tax rules and the applied discounts; the client *renders*
  a computed total. Draft-order/order-edit APIs exist precisely because the
  computed snapshot is a durable fact, not an input.
* **WHY** — Price is a business fact; a client-supplied amount is an
  authorization bypass waiting to happen.
* **WHAT PROBLEM** — Client-supplied totals allow arbitrary underpayment; stale
  snapshots allow charging a price the customer never saw.
* **HOW VELNOX** — Already correct in shape (`POST /api/customer/checkout`
  re-reads `products.price` and re-derives totals; Stripe line items are built
  from `orders.total_amount`). Remaining gaps: (a) price changes are *flagged*
  (`priceChanged`) rather than being an explicit `PRICE_CHANGED` domain outcome
  with a recomputed purchase snapshot; (b) no persisted **checkout quote** — the
  customer is charged the value on the order row, not an auditable quote that the
  customer accepted. Add an explicit server-computed purchase snapshot on
  `checkout_groups` (`subtotal/shipping/discount/total/currency` + `priced_at`).

### Amazon (public seller fee documentation)
* **WHAT** — Fees (referral/fulfilment) are computed per line item, recorded, and
  visible to the seller per order; a fee is never re-derived at payout time from
  an order that could have been refunded since.
* **WHY** — A payout is a financial event; it needs a record of the inputs.
* **WHAT PROBLEM** — Deriving money at settlement time from mutated order rows
  makes the ledger unreconcilable: the same order yields two different answers on
  two days.
* **HOW VELNOX** — `commissions` and `settlements` exist in `db/schema.sql` with
  **zero writers** (audit finding A7) and three different rates in code
  (`0.03`, `0.05` default, `0`). Replace with an **immutable `ledger_entries`**
  written inside the same transaction as the state change, plus
  `seller_settlements` derived from ledger rows.

---

## 3. PAYMENT — the provider event is the authority

### Stripe (public API docs)
* **WHAT** — Documented contract, all of it public:
  1. A `PaymentIntent` has its own status lifecycle
     (`requires_payment_method → requires_confirmation → requires_action →
     processing → succeeded` / `canceled`) and an `amount_capturable` /
     `amount_received` split (manual capture exists).
  2. `Checkout Session` is a *hosted redirect* front-end to that intent; its
     `payment_status` can be `unpaid` for delayed-notification methods.
  3. Webhooks are delivered **at least once**, are **signed**, may be
     **duplicated**, may arrive **out of order**, and are **retried** on non-2xx.
     The documented contract is: verify signature → handle idempotently → return
     2xx.
  4. The `Idempotency-Key` header makes a retried write replay its first result.
  5. Refunds are created against a charge/intent, may be partial, have their own
     status, and cannot exceed the captured amount.
  6. The browser redirect is explicitly **not** proof of payment; the docs tell
     integrators to fulfil from the webhook.
* **WHY** — Networks, timeouts and phone crashes are normal. The only durable
  witness of "money moved" is the provider's own signed event.
* **WHAT PROBLEM** — (a) Redirect-as-proof pays for orders that were never paid;
  (b) processing an unverified webhook lets anyone mark orders paid; (c)
  processing the same webhook twice double-settles; (d) an out-of-order event
  (e.g. `payment_intent.canceled` after `succeeded`) can un-pay a paid order;
  (e) refunding more than captured creates a real loss.
* **HOW VELNOX** — The repository already implements the core correctly
  (`constructEventAsync` over raw bytes, `payment_events` `event_id` UNIQUE claim,
  500-on-failure for redelivery, test-mode-only key classification, refunds
  webhook-confirmed). What is **missing** and must be added: a durable
  `payment_attempts` row that separates *attempt → provider session → processing →
  confirmed → settled*; an explicit `authorized`/`expired` payment vocabulary;
  `attempt_count`/`next_retry_at` on `payment_events`; and an **out-of-order
  guard** (monotonic transition rules that refuse a backwards move).

---

## 4. INVENTORY — reservations, not decrements

### Shopify (public inventory docs)
* **WHAT** — Inventory is tracked per **inventory item × location**. Documented
  quantities: `available`, `incoming`, `committed`, `reserved`, `damaged`,
  `on_hand`, `quality_control`, `safe_stock`. `committed` = "ordered, not yet
  fulfilled"; `reserved` = "held while checkout completes"; `available` is what
  new orders may take. Movements are explicit operations
  (reserve/commit/release/adjust) and there is a **reconciliation** concept.
* **WHY** — Sellable quantity is a *derived* fact from several counters that
  change at different moments in the lifecycle; storing a single "stock" number
  forces every stage to mutate the same number, so the number stops meaning
  anything.
* **WHAT PROBLEM** — (a) A single `stock` cannot distinguish "held by an unpaid
  order" from "sold, not shipped" from "returned" — so a release, a commit and a
  return all look identical and any one of them can restore sold stock;
  (b) decrement-on-reserve makes paid-but-unshipped indistinguishable from
  physically gone, breaking returns and reconciliation; (c) without a DB-level
  non-negative guarantee, a race materialises negative stock.
* **HOW VELNOX** — Today: `inventory(quantity, reserved)` per **product** and
  `product_variants.stock` per variant — **two different models, no shared
  authority, no `committed`/`fulfilled`/`returned`, and no `CHECK` on either**
  (audit finding A3). Target: ONE `inventory` table keyed by
  (product, optional variant) carrying `on_hand`, `reserved`, `committed`,
  `fulfilled`, `returned`, with `available` **derived** (`on_hand - reserved -
  committed`), a DB `CHECK` per counter `>= 0` and
  `reserved + committed <= on_hand`; every mutation writes an
  `inventory_movements` row in the same transaction.

---

## 5. FULFILLMENT — the process has its own state machine

### Shopify fulfillment orders (public docs)
* **WHAT** — A fulfillment order carries a status (`open`, `in_progress`,
  `scheduled`, `on_hold`, `closed`, `cancelled`, `incomplete`) and a
  "request status" (`unsubmitted`, `submitted`, `accepted`, `rejected`); a
  fulfillment is created *against* it, may be partial, and can itself be split,
  merged or moved to another location. Carrier handoff is a distinct event from
  "we finished packing".
* **WHY** — Warehouse work and carrier transit are different processes with
  different failure modes ("I can't find the item" vs "the parcel is lost").
* **WHAT PROBLEM** — Collapsing them means a lost parcel is recorded as a
  warehouse failure and vice-versa, so the remediation (reship vs refund) cannot
  be chosen correctly.
* **HOW VELNOX** — Split the axes: `fulfillment_status` for warehouse work
  (unfulfilled → ready → picking → packing → ready_to_ship → shipped → delivered /
  failed) and `shipments.status` for transit (created → picked_up → in_transit →
  out_for_delivery → delivered / returned / lost). Today `orders.status` mixes
  payment + warehouse + transit into one 12-value column (audit finding A2).

---

## 6. WEBHOOKS / EVENTS — durable, idempotent, retryable, ordered

### Stripe (public docs) + Shopify (public webhook docs)
* **WHAT** — Both publish: signed payloads, at-least-once delivery, retries with
  backoff for a bounded period, duplicate delivery as a normal event, no ordering
  guarantee, and a delivery-log surface an operator can inspect. Shopify adds
  documented HMAC verification and a topic-per-event contract.
* **WHY** — The network is not transactional. A receiver must be able to answer
  "was this already handled?" durably, and must be able to *prove* to itself what
  it received.
* **WHAT PROBLEM** — (a) "receive → update DB → forget" makes duplicate and
  late events undiagnosable; (b) a handler that returns 2xx after a failed write
  loses money silently (the provider stops retrying); (c) without an attempt
  counter, a permanently failing event either loops forever or is dropped with no
  record.
* **HOW VELNOX** — `payment_events` already exists and is claimed with
  `ON CONFLICT (event_id) DO NOTHING` (good). Target additions:
  `received_at`, `attempt_count`, `next_retry_at`, `payload_reference`,
  `provider_object_id`, and a `processing` lease so a crashed worker's event is
  retried rather than stuck. Generic domain events (`OrderCreated`,
  `PaymentConfirmed`, `InventoryReserved`, …) go to a **transactional
  `outbox_events`** written in the same transaction as the state change.

### Event-driven commerce (general OMS literature)
* **WHAT** — Transactional outbox: write the event row in the same DB
  transaction as the state change; a separate publisher drains it with retries;
  consumers are idempotent on `event_id`.
* **WHY** — Two-write (DB commit + publish) cannot be atomic, so one of them is
  always lost sometimes.
* **WHAT PROBLEM** — "DB committed but the event vanished" leaves downstream
  state permanently wrong with no record that anything was owed.
* **HOW VELNOX** — `outbox_events` with `status`, `attempt_count`,
  `next_retry_at`, `last_error`; the existing WebSocket broadcast becomes a
  *consumer* of the outbox rather than a fire-and-forget call inside business
  transactions. The DB (Neon) remains the only source of truth; realtime stays a
  delivery channel.

---

## 7. RELIABILITY — idempotency, retry, reconciliation, locking

### Stripe (public docs) — idempotency
* **WHAT** — `Idempotency-Key` on unsafe requests; a replay returns the original
  response; keys are scoped and expire.
* **WHY** — Every client retry is a potential duplicate charge.
* **WHAT PROBLEM** — `if (!alreadyExists) create()` is a read-then-write race:
  two concurrent retries both read "not exists" and both create.
* **HOW VELNOX** — Durable keys in the database: `checkout_requests
  UNIQUE (user_id, scope, request_key)` (already exists), plus new
  `idempotency_keys`-style UNIQUE constraints on the new tables
  (`payment_attempts.idempotency_key`, `ledger_entries.idempotency_key`,
  `inventory_movements.idempotency_key`). Every operation the brief lists as
  retryable (create checkout, create payment, capture, refund, cancel, reserve,
  release, webhook processing, shipment creation) resolves through a
  `INSERT … ON CONFLICT … RETURNING` claim or a guarded `UPDATE … WHERE <state>`
  claim — never `SELECT` then `INSERT`.

### Payment industry (public reconciliation guidance, Stripe/Shopify payout docs)
* **WHAT** — Settlement reports are compared against internal records on a
  schedule; discrepancies become *findings* with an owner and a resolution, never
  silent edits.
* **WHY** — Distributed systems drift. Drift is only safe if it is *detected*.
* **WHAT PROBLEM** — Undetected drift is found by a customer or an accountant,
  after the audit trail is gone.
* **HOW VELNOX** — Four reconcilers (payment, inventory, fulfillment, refund) as
  scheduled jobs writing `reconciliation_runs` + `reconciliation_findings`; admin
  surfaces under Velcenter. Provider-side comparison uses the Stripe API when
  credentials exist, and *internal invariant* comparison otherwise — labelled as
  such, never faked.

### Reliability engineering (public literature)
* **WHAT** — Retry with bounded attempts + backoff + a terminal dead-letter
  state; pessimistic row locks (`SELECT … FOR UPDATE`) taken in a **single global
  order**; optimistic concurrency via a version/state guard; correlation ids
  threaded through every log line.
* **WHY** — Unbounded retry is a self-inflicted outage; inconsistent lock order is
  a deadlock; without correlation ids an incident cannot be reconstructed.
* **WHAT PROBLEM** — (a) infinite retry loops; (b) AB-BA deadlocks resolved by
  luck; (c) "the customer says they paid" with no way to trace the request.
* **HOW VELNOX** — `max attempts` + `next_retry_at` + `last_error` on every
  retried table; `backend/lib/order-lock.ts` already mandates "lock the ORDER row
  first" — extend it to a documented global lock order
  (`purchase → order (id ASC) → payment → refund → inventory (id ASC)`);
  a `request_id` middleware + `correlation_id` column on ledger/movement/outbox
  rows.

---

## 8. MONEY — exact decimals, never floating point

* **WHAT** — Payment providers transact in **minor units** (integer cents/satang);
  database money columns are `NUMERIC(p,s)`; arithmetic uses decimal or integer
  minor units end-to-end.
* **WHY** — Binary floating point cannot represent 0.10 exactly, so sums drift and
  a total can be off by a satang — which is a reconciliation failure, not a
  rounding nicety.
* **WHAT PROBLEM** — `0.1 + 0.2 !== 0.3`; repeated accumulation of a rounded
  per-line fee produces a payout that does not match the sum of charges.
* **HOW VELNOX** — `NUMERIC(12,2)` for stored money (already), and a **single
  money module** (`backend/lib/money.ts`, already present) for all arithmetic;
  the ledger stores `amount_minor BIGINT` so no float ever touches a financial
  figure. Audit confirms `NUMERIC(12,2)` today — the gap is the *unrecorded*
  commission/settlement path, not the storage type.

---

## 9. What this research forbids Velnox from doing

1. Treating a browser redirect, a `success_url`, or a client field as payment
   proof. 2. Faking a provider event, an inventory movement, an order or a
   settlement to make a flow "pass". 3. A second source of truth for order /
   payment / money / inventory (Convex or realtime as authority). 4. Copying
   proprietary code — principles only. 5. Introducing a state that mixes axes.
6. `if (!alreadyExists) create()` as an idempotency strategy. 7. Unbounded
   retries. 8. Mutating a financial record destructively with no audit trail.
