# ECOMMERCE_BENCHMARK.md — public production patterns

**Audit artifact. No code is changed by this document (§41).**

**Repository audited:** `EnJirad/velnox-marketplace`, branch `main`
**GitHub SHA:** `04f9707c8fe3a8c06d6e1183ff2598d4c36a10db` (local == `origin/main`, tree clean)

## How to read the evidence in this file

Every benchmark entry names a **public source**. Nothing here claims to know how
any company's internal systems are built. Where the public material does not
describe an internal mechanism, this file says so rather than guessing (§4).

Three phrasings are used deliberately and must not be upgraded when quoted:

| Phrasing | Meaning |
|---|---|
| **Documented** | the pattern is named and described in the provider's own public developer documentation |
| **Observable** | the workflow is visible in a public UI/API surface but its internal implementation is not described |
| **Cannot verify internal implementation** | no public source describes it; no claim is made |

**`Velnox equivalent`** is either a real `file:line` reference or the literal word
`ABSENT`, which means "verified absent by search, not assumed absent".

---

## 1. LAZADA

### 1.1 Order and seller-order separation — **Documented / Observable**

- **Source:** Lazada Open Platform public API documentation (`/order/get`,
  `/order/items/get`, order-status and order-notification topics); Lazada Seller
  Center order workflow as publicly observable.
- **Pattern:** a marketplace order carries a per-seller sub-unit. Sellers act on
  their own sub-unit (`ready_to_ship` → shipped), and the seller-visible lifecycle
  is narrower than the platform's purchase-level lifecycle. A multi-seller cart
  produces several seller orders under one customer payment.
- **Why it matters:** without a seller-scoped unit, "who may ship this" has no
  answer that is safe for a multi-vendor cart, and every seller query has to
  re-derive its own boundary — the classic source of cross-seller leakage.
- **Velnox equivalent:** **PRESENT.** `orders` is already one row per shop
  (`routes/cart.ts` splits the cart per shop); seller routes scope by
  `shops.seller_id`; `backend/routes/seller-orders.ts` is the seller's own view.
  The purchase-level parent is `checkout_groups` (migration 055/056).

### 1.2 Fulfilment as a workflow, not a status field — **Observable**

- **Source:** Lazada Seller Center public order workflow; Open Platform fulfilment
  and shipping calls.
- **Pattern:** the seller moves an order through an explicit fulfilment workflow
  (pack → ready to ship → shipped → delivered) with logistics attached to the
  shipment, not to the order status string.
- **Why it matters:** fulfilment progress and payment settlement are independent
  facts. Folding them into one field makes "paid but not yet picked" and "shipped
  but not paid" unrepresentable.
- **Velnox equivalent:** **PARTIAL, and currently NOT SEPARATED AT RUNTIME.**
  `backend/lib/order-fulfillment.ts` has a real 7-state fulfilment machine
  (`FULFILLMENT_TRANSITIONS`) and `orders.fulfillment_status` now exists
  (migration 056) — but a verified search shows **no non-test code reads or writes
  `fulfillment_status`**. The runtime authority is still the single
  `orders.status` column (see `CURRENT_SYSTEM_MAP.md` §6).

### 1.3 Marketplace settlement separated from customer payment — **Documented**

- **Source:** Lazada Open Platform finance/payout APIs (`/finance/payout/status/get`
  and the payout/statement family).
- **Pattern:** the money the customer pays and the money the seller is paid are
  different objects on different timelines. The platform holds a payable per
  seller and settles it on a period, net of fees.
- **Why it matters:** this is what makes a marketplace a marketplace rather than a
  shop with many vendors. Without it, the platform cannot answer "how much do we
  owe this seller?" — and a refund after settlement has nowhere to be accounted.
- **Velnox equivalent:** **ABSENT at runtime.** `commissions` and `settlements`
  exist as tables with **zero writers** (verified); migration 056 adds
  `ledger_entries` and a `platform_fee` / `seller_payable` vocabulary, and a
  verified search shows **no non-test code reads or writes `ledger_entries`**.

### 1.4 Returns/reverse logistics as its own entity — **Observable**

- **Source:** Lazada Open Platform reverse-order (`/order/return/*`) surface;
  Seller Center return/refund workflow as publicly observable.
- **Pattern:** a return is a physical, customer-or-seller-initiated process with
  its own lifecycle (requested → approved → in transit → received → refunded),
  distinct from a cancellation and distinct from a refund.
- **Why it matters:** `cancel` and `return` have different inventory and money
  consequences. Conflating them loses the evidence needed to decide who pays.
- **Velnox equivalent:** **ABSENT.** No return/RMA table or route exists. (056 adds
  `order_returns`, again with no writer.)

---

## 2. SHOPIFY

### 2.1 `FulfillmentOrder` — work unit separate from the order — **Documented**

- **Source:** `shopify.dev/docs/api/admin-rest/latest/resources/fulfillmentorder`:
  *"The FulfillmentOrder resource represents either an item or a group of items in
  an order that are to be fulfilled from the same location."* Also
  `FulfillmentOrderStatus`.
- **Pattern:** the order is the commercial record; the **fulfillment order** is the
  unit of work, keyed by location. A `Fulfillment` is then *"a shipment of one or
  more items from an Order"* that *"tracks which LineItem objects ship, their
  quantities, and the shipment's tracking information"*
  (`admin-graphql/latest/objects/Fulfillment`).
- **Why it matters:** it is what makes *partial* and *split* fulfilment
  expressible. One order → many fulfilments → many shipments, with per-line
  quantities, without inventing new statuses.
- **Velnox equivalent:** **ABSENT at runtime.** `fulfillment_orders` and
  `shipment_items` now exist as tables (056) and `shipments` hangs off
  `fulfillment_orders` — but both have **no non-test code reference**. At runtime
  one order can produce exactly one shipment, and no code records *which units* a
  shipment carried.

### 2.2 Multi-location inventory as levels over items — **Documented**

- **Source:** Shopify Admin API `InventoryLevel` / `InventoryItem` / `Location`.
- **Pattern:** stock is not a number on a product; it is a **level** — a quantity
  of an item at a location — so the same item can be stocked and sold from several
  places.
- **Why it matters:** only relevant once a seller has more than one stocking
  location. For a single-location seller it adds a join and nothing else.
- **Velnox equivalent:** **NOT APPLICABLE TODAY** (see §7). One `inventory` row per
  product (or `product_variants.stock`) is sufficient for Velnox's current model.

### 2.3 Idempotency by caller-supplied key — **Documented**

- **Source:** Shopify Admin API idempotency guidance and webhook delivery
  semantics (`X-Shopify-Webhook-Id` / `X-Shopify-Event-Id` style dedup headers on
  public webhook docs).
- **Pattern:** a mutating request carries a client-generated key; a replay returns
  the **original** response rather than performing the work twice. Webhooks carry a
  stable event id so a redelivery is a no-op.
- **Why it matters:** every retry, every double-click and every provider redelivery
  becomes a duplicate charge/refund unless the write is keyed.
- **Velnox equivalent:** **PRESENT and strong.**
  `checkout_requests UNIQUE (user_id, scope, request_key)` with the stored response
  (`routes/cart.ts`); `payment_events` claim; `orders.inventory_released` claim
  (`lib/inventory.ts`); `refunds.provider_refund_id` unique with
  `ON CONFLICT … DO UPDATE` (`routes/stripe.ts:1594`, `:2796`). See
  `DOMAIN_COMPARISON.md` §Idempotency for the full matrix.

### 2.4 Webhook authenticity + durable event store — **Documented**

- **Source:** Shopify webhook documentation (HMAC header, delivery retries).
- **Pattern:** verify the HMAC over the **raw** body before parsing; persist the
  event id; treat delivery as at-least-once.
- **Why it matters:** parsing first loses the bytes the signature covers, and
  without a persisted event id a redelivery repeats the side effects.
- **Velnox equivalent:** **PRESENT and strong.** Raw `Buffer` body
  (`routes/stripe.ts:2541`), signature verification
  (`routes/stripe.ts:2528`, `:218`), `payment_events` claim table, and a **500 on
  processing failure** so the provider retries rather than the event being lost.

---

## 3. AMAZON

### 3.1 Order vs OrderItem vs Fulfillment vs Shipment — **Documented**

- **Source:** Selling Partner API public reference — `getOrders` / `getOrderItems`,
  and the Fulfillment Outbound family.
- **Pattern:** the order header, its line items, the fulfilment instruction and the
  shipment are four separate objects with four separate lifecycles.
- **Why it matters:** partial shipment and partial refund both require knowing
  **which lines** moved, not only how many orders were touched.
- **Velnox equivalent:** **PARTIAL.** `orders` and `order_items` are properly
  separated and line-level fields exist (`quantity`, `price`, `subtotal`).
  Shipment-to-line linkage is ABSENT at runtime (`shipment_items`, no writer), and
  `order_items.fulfilled_quantity` is never written.

### 3.2 Asynchronous, paginated, rate-limited APIs — **Documented**

- **Source:** SP-API public reference — `NextToken` continuation on order/listing
  operations; per-operation **usage-plan rate limits**, including on the Finances
  API (`developer-docs.amazon.com/sp-api/reference/listsummary`: *"returns the
  usage plan rate limits that apply to the operation"*). Amazon also documents
  asynchronous/report-based access for large result sets.
- **Pattern:** every list operation is bounded and paginated by token; every
  operation has a documented rate; bulk reconciliation is a **report/job**, not a
  synchronous scan.
- **Why it matters:** an unbounded list is an outage waiting for volume, and a
  reconciliation that has to scan synchronously cannot be scheduled safely.
- **Velnox equivalent:** **PARTIAL.** Pagination exists on the seller order list
  (`routes/seller-orders.ts:322-325`, capped at 100). There is **no rate limiting
  anywhere in the API layer**, and no reconciliation job of any kind.

### 3.3 Financial events as a first-class ledger — **Documented**

- **Source:** SP-API Finances API (financial events / settlement periods).
- **Pattern:** money movements are queryable **events** per settlement period, not
  a derived sum over orders.
- **Why it matters:** the platform must be able to answer "what did we take, owe
  and pay out in this period" as a first-class question.
- **Velnox equivalent:** **ABSENT at runtime.** `ledger_entries` exists (056) with
  the account vocabulary (`platform_cash`, `platform_revenue`, `seller_payable`,
  `refund_clearing`) and an append-only trigger — and **no writer**.

### 3.4 Explicit retry/reliability semantics on integration calls — **Documented**

- **Source:** SP-API public reliability guidance (retry with backoff on throttling,
  distinguish retryable from terminal errors).
- **Pattern:** each outbound integration call distinguishes *retryable* from
  *terminal*, and a retry that keeps failing lands somewhere visible.
- **Why it matters:** an unbounded retry is an infinite loop that hides a permanent
  failure; a no-retry policy loses transient failures.
- **Velnox equivalent:** **PARTIAL.** Stripe SDK calls use the SDK's own retry
  behaviour; `payment_events` records failures and returns 500 so Stripe redelivers.
  There is **no `attempt_count` / `next_retry_at` / `max_attempts` / dead-letter
  worker** — those columns now exist (056) and have **no writer**.

---

## 4. COMMON PRODUCTION PATTERNS

Patterns that appear, in some form, in **more than one** of the three benchmarks.

| # | Pattern | Source(s) | Why it matters | Velnox |
|---|---|---|---|---|
| C1 | One authority per lifecycle axis | all three | a single status column cannot represent payment ∧ order ∧ fulfilment | **DEFECT** — `orders.status` is the only runtime authority |
| C2 | Durable event/message record written in the same transaction as the state change | Shopify webhooks, Amazon financial events | "DB committed but the event vanished" becomes impossible | **ABSENT at runtime** (`outbox_events`, no writer) |
| C3 | Caller-supplied idempotency key on every money mutation | Shopify, Amazon | retry/double-submit cannot duplicate money | **PRESENT** |
| C4 | Provider is the authority for payment outcome | Shopify Payments, Amazon, Stripe | a redirect is a UI event, not a payment event | **PRESENT** |
| C5 | Amounts stored as exact decimals/minor units | all three | float money drifts | **PRESENT** — `NUMERIC(12,2)` throughout |
| C6 | Reconciliation as a scheduled job that **reports** | Amazon settlement reports; Shopify payouts | drift is found before a customer finds it | **ABSENT at runtime** |
| C7 | Line-level linkage between shipment and order item | all three | partial shipment/refund requires it | **ABSENT at runtime** |
| C8 | Append-only financial record, corrections as new entries | Amazon financial events | history cannot be silently rewritten | **ABSENT at runtime** (`ledger_entries`, no writer) |

---

## 5. PATTERNS VELNOX ALREADY IMPLEMENTS

**This section is deliberately first among the conclusions (§40).** None of these
should be dismantled by a fix for anything below.

| Pattern | Velnox evidence |
|---|---|
| Provider-authoritative payment; frontend redirect is never treated as paid | `routes/stripe.ts` settlement only from the verified webhook |
| Raw-body signature verification before parsing | `routes/stripe.ts:2541` (`Buffer`), `:2528`, `:218` |
| Durable webhook event id + duplicate is a no-op | `payment_events` claim; 500 on failure so the provider retries |
| Checkout idempotency with the **stored response** replayed | `checkout_requests UNIQUE (user_id, scope, request_key)` |
| Exactly-once stock release with a DB claim | `orders.inventory_released` + `lib/inventory.ts` |
| Absolute-value recompute instead of increment for refund totals | `routes/stripe.ts` — `SUM(refunds.amount)` per sync, so a replayed webhook cannot double-count |
| Server-resolved checkout (client cannot set price/seller/total) | `routes/cart.ts` reads exactly five body fields (`:690-700`) and resolves everything else from the DB inside the transaction |
| **Per-item price revalidation at checkout** — the add-to-cart price is a display snapshot, never the price charged | `cart.ts:843-847` (variant) and `:861-865` (product) re-read the current price, compare with a 0.005 tolerance and **overwrite** `item.price`; `priceChanged` is surfaced so neither side is silently surprised |
| Guarded atomic stock reservation (`WHERE stock >= $1`) | `routes/cart.ts:1003`, `lib/inventory.ts:61`, `lib/velrepeat-cycles.ts:602` |
| Exact decimal money | `NUMERIC(12,2)`; `lib/money.ts` documents string handling |
| Purchase-level parent for a multi-shop charge | `checkout_groups` + the covering-set resolver `lib/payment-attempt.ts` |
| Rerunnable, self-asserting schema reconciler + a **test database that refuses production** | `db/run-sqleditor.sql`, `backend/db/test-database.ts`, `db/verify-reconciler.sh` |
| Contract tests that pin the two canonical SQL files against each other | `backend/tests/db-run-sqleditor-reconciler.test.ts`, `helpers/canonical-schema.ts` |
| Bounded, paginated seller order list | `routes/seller-orders.ts:322-325` (cap 100) |
| DB-enforced commerce invariants | migration 056 — 23 cases assert the SQLSTATEs |

---

## 6. PATTERNS VELNOX IS MISSING

Ordered by the severity assigned in `FINAL_GAP_REPORT.md`. Each entry states
whether it is a **REAL DEFECT**, a **MISSING CAPABILITY** or a **FUTURE SCALE
GAP** (§33), because those are not the same thing.

| Pattern | Type | Runtime state |
|---|---|---|
| Separate payment / order / fulfilment axes | **REAL DEFECT** | columns exist, **no writer**; `orders.status` still governs |
| Reconciliation of DB ↔ provider | **MISSING CAPABILITY** | `reconciliation_*` exist, **no runner** |
| Transactional outbox | **MISSING CAPABILITY** | `outbox_events` exists, **no writer/drain** |
| Seller payable + platform ledger | **MISSING CAPABILITY** | `ledger_entries` exists, **no writer**; `settlements` still has zero writers |
| Return / RMA lifecycle | **MISSING CAPABILITY** | `order_returns` exists, **no writer** |
| Shipment ↔ order-item quantities | **MISSING CAPABILITY** | `shipment_items` exists, **no writer** |
| Fulfilment work unit (multi-location, partial) | **MISSING CAPABILITY** | `fulfillment_orders` exists, **no writer** |
| Inventory movement journal | **MISSING CAPABILITY** | `inventory_movements` exists, **no writer** |
| Payment attempt layer | **MISSING CAPABILITY** | `payment_attempts` exists, **no writer** |
| Retry budget / dead-letter for webhooks | **MISSING CAPABILITY** | columns exist, **no worker** |
| Shipment transit states actually reached | **MISSING CAPABILITY** | only `pending`/`created` are ever written |
| Correlation id end-to-end | **MISSING CAPABILITY** | `correlation_id` columns exist, **no writer** |
| Rate limiting | **FUTURE SCALE GAP** | none anywhere in the API layer |
| Multi-location inventory | **FUTURE SCALE GAP** | one stock row per product/variant |

---

## 7. PATTERNS THAT DO NOT APPLY

Applying these would be over-engineering, not improvement (§34).

| Pattern | Why it does not apply to Velnox |
|---|---|
| Multi-location inventory levels | Velnox sellers have one stocking point per shop; `inventory` per product and `product_variants.stock` already cover it. Adding locations adds a join and a UI for no business case that exists today. |
| Amazon-scale distributed/async report infrastructure | Velnox's order volume does not justify asynchronous report generation; a scheduled SQL reconciler is sufficient and far simpler. |
| Carrier API booking integration | **Already declared out of scope**: booking a parcel with a carrier is an operator action in this rebuild. Not a defect. |
| Microservice split of payment/order/inventory | A single Postgres transaction is the strongest consistency tool Velnox has; splitting it would **remove** the guarantee that currently prevents oversell (`lib/order-lock.ts` one-lock-order contract). |
| Public marketplace API for third-party apps | No third-party developer ecosystem exists; building one is a product decision, not a gap. |
| `commissions` rewrite into a commission engine | The real gap is **no ledger and no payable**, not the absence of a configurable rule engine. |

---

## 8. What this benchmark does NOT prove

- It does not establish, and this audit does not claim, that any provider's
  internal architecture resembles the public surface described here (§4).
- A pattern's absence from Velnox is **not** by itself a defect. §33's three-way
  classification is applied in `FINAL_GAP_REPORT.md`, and §34's question — *is it
  actually required for Velnox's business model?* — was asked of every row above.
- Nothing in this file was verified by running Velnox against a live provider.
  See `FINAL_GAP_REPORT.md` §"Production Blockers".
