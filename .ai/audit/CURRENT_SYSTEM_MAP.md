# CURRENT_SYSTEM_MAP.md — Velnox as it actually is

**Audit artifact. No code is changed by this document (§41).**

**Repository:** `EnJirad/velnox-marketplace`, branch `main`
**GitHub SHA:** `04f9707c8fe3a8c06d6e1183ff2598d4c36a10db` (local == `origin/main`, tree clean)
**Method:** every claim below was produced by reading or searching the repository at
this SHA. Nothing is inferred from a file name (§6). Where a claim is a *search
result* rather than a read, it says so.

## 0. A note on the SHA — what changed since the last audit

An earlier audit of this repository was recorded at `c44785b` in
`.ai/rebuild/CURRENT_ARCHITECTURE.md` (findings A1–A19). **That document is still
accurate about the runtime, but it is no longer accurate about the schema.**
Between `c44785b` and this SHA, `70c1596` recorded the design and `6fabbe3`
applied **migration 056**.

The distinction matters more than any other sentence in this file:

> **Migration 056 added the STRUCTURE for the domain model. It added no behaviour.**
> A verified search of every non-test `.ts` file under `backend/` for
> `outbox_events`, `ledger_entries`, `inventory_movements`, `payment_attempts`,
> `fulfillment_orders`, `shipment_items`, `order_returns`, `reconciliation_runs`
> and `reconciliation_findings` returns **zero matches**, and the same search for
> `order_state`, `fulfillment_status`, `fulfilled_quantity`, `correlation_id` and
> `inventory.committed` also returns **zero matches**.

So the schema is at "production foundation" for several domains while the runtime
is still at the level the previous audit described. `FINAL_GAP_REPORT.md` §39
answers this question in full.

---

## 1. FRONTEND

| | |
|---|---|
| **Actual files** | `apps/velshop` (customer storefront), `apps/velseller`, `apps/velcenter` (staff/admin), `apps/velnox` (platform) |
| **Actual API** | every app calls the one backend over HTTP + WebSocket; nothing touches the database |
| **Actual DB tables** | none (enforced by architecture, not by a DB role) |
| **Actual state** | React + Vite + Tailwind + shadcn/ui |
| **Actual owner** | platform |
| **Actual source of truth** | the backend API — the frontend holds only display state |
| **Actual transaction boundary** | none |
| **Actual tests** | `bun run typecheck` per app; `bun run build:apps` (4/4 built, exit 0); no component/E2E test suite |

**Verified this session:** `bun run typecheck` exit 0 for all four apps;
`bun run build:apps` exit 0, 4/4 `✓ built`.

**Honest limitation:** no browser executed any of these apps in this workspace. The
frontend is verified to *compile and build*, not to *run correctly*.

---

## 2. BACKEND

| | |
|---|---|
| **Actual files** | `backend/routes/*.ts` (Express routers), `backend/lib/*.ts` (domain logic), `backend/jobs/*.ts`, `backend/db/index.ts` |
| **Actual API** | REST under `/api/...` + a WebSocket channel; routers mounted in the backend entrypoint |
| **Actual DB tables** | all of them, through `query()` / `withTransaction()` in `backend/db/index.ts` |
| **Actual owner** | platform |
| **Actual source of truth** | **Neon Postgres.** No other store holds business truth |
| **Actual transaction boundary** | `withTransaction()`; the one-lock-order contract in `lib/order-lock.ts` serialises per-order mutations |
| **Actual tests** | 70 files / 2037 tests under `backend/tests` (2035 pass, 2 skip, 0 fail) |

**Verified:** `backend/db/index.ts` exports `query`, `getClient`, `withTransaction`,
`describeDatabaseIdentity`, `SLOW_QUERY_MS`, `PAYMENT_CRITICAL_SCHEMA_OBJECTS`.

**Membership of the guard:** `backend/db/test-database.ts` **refuses to run a test
process against a production-looking database** (Neon host, production env marker,
or the exact production host+database) and has no fallback path. This is a genuine
strength, and `backend/tests/test-database-isolation.test.ts` proves it fails closed.

---

## 3. DATABASE

| | |
|---|---|
| **Actual files** | `db/schema.sql` (snapshot, 1,829 lines), `db/run-sqleditor.sql` (rerunnable reconciler, 5,166 lines), `db/migrations/056_commerce_core_invariants.sql`, `db/verify-reconciler.sh` |
| **Actual tables** | 75 in `public` |
| **Actual constraints** | 339 |
| **Actual indexes** | 296 |
| **Actual columns** | 807 |
| **Actual triggers** | 2 (`trg_prevent_circular_category_parent`, `trg_prevent_ledger_mutation`) |
| **Actual source of truth** | `db/run-sqleditor.sql` is the bootstrap/updater; `db/schema.sql` is the declared snapshot; a contract test pins the two against each other |
| **Actual transaction boundary** | per-request `withTransaction()`; no cross-request transaction |
| **Actual tests** | `db/verify-reconciler.sh` (51 PASS / 0 FAIL), `commerce-core-invariants.test.ts` (23), `db-run-sqleditor-reconciler.test.ts` (21), plus the canonical-parity tests |

**Verified this session (not inferred):** a fresh bootstrap and the
pre-056 → migration-056 path are **definitionally identical** — an empty diff
across all 807 columns (`is_nullable`, `column_default`, `udt_name`), all 339
constraints (`pg_get_constraintdef`), all 296 indexes (`indexdef`) and both
triggers. A count can match while a default silently differs; this compares what
the shapes *are*.

---

## 4. PAYMENT

| | |
|---|---|
| **Actual files** | `backend/routes/stripe.ts` (3,034 lines), `backend/lib/payment-attempt.ts`, `backend/lib/payment-reservation.ts`, `backend/lib/checkout-group-lifecycle.ts` |
| **Actual API** | `POST /api/payments/stripe/...`, `POST /api/payments/stripe/webhook` (raw-body verified) |
| **Actual DB tables** | `payments` (attempt + session + result in ONE row), `payment_events`, `payment_incidents`, `refunds`, and — **structure only** — `payment_attempts` |
| **Actual state** | `payments.status` vocabulary is now `pending, requires_action, processing, authorized, paid, failed, cancelled, expired, partially_refunded, refunded`. **Only the pre-056 subset is ever written** |
| **Actual owner** | platform |
| **Actual source of truth** | **the provider.** Settlement happens only from a verified webhook; a frontend redirect never settles anything |
| **Actual transaction boundary** | the webhook handler's transaction; `orders.inventory_released` is the exactly-once claim |
| **Actual tests** | `checkout-group-payment-visibility.test.ts` (12 cases), `payment-*.test.ts` (attempt identity, cancellation race, reservation expiry, webhook schema lag), `late-payment-incidents.test.ts`, `dead-order-status-failed.test.ts` |

**Verified strengths:** signature verification over the raw body
(`routes/stripe.ts:2528`, `:2541`, and `constructEventAsync` at `:218`);
`payment_events` claims each provider event id; a processing failure returns 500 so
the provider retries rather than the event being dropped; refund totals are
**recomputed** from `SUM(refunds.amount)` per sync, so a replayed webhook cannot
double-count; the operator refund path validates `requestedMinor > 0`
(`routes/stripe.ts:2721`) and `<= refundableMinor` (`:2725`) and derives a stable
provider idempotency key (`:2777`).

**Verified gaps:** no `payment_attempts` writer, so `authorized` and `expired` are
unreachable at runtime; no retry budget; no reconciliation against Stripe.

---

## 4A. CART

| | |
|---|---|
| **Actual files** | `backend/routes/cart.ts` — add/update at `:308`, `:395-417`, remove at `:448`/`:536`; checkout from `:684` |
| **Actual API** | cart CRUD + `POST /api/customer/checkout` |
| **Actual DB tables** | `carts`, `cart_items` (carries an add-to-cart `price` snapshot), `products`, `product_variants`, `inventory` |
| **Actual state** | one cart per user; items snapshot a price at add time |
| **Actual owner** | the customer |
| **Actual source of truth** | **the server** — `products.price` / `product_variants.price` are the real prices; `cart_items.price` is only a snapshot that checkout revalidates |
| **Actual transaction boundary** | add/update are single statements; checkout is one transaction |
| **Actual tests** | cart suites + `multi-shop-checkout.test.ts` |

### The §8 checklist, verified item by item

| Check | Result | Evidence |
|---|---|---|
| Cart ownership | ✅ | every item mutation scopes by subquery: `DELETE FROM cart_items WHERE id = $1 AND cart_id = (SELECT id FROM carts WHERE user_id = $2)` (`:448`, `:536`) |
| Cart persistence | ✅ | `carts` / `cart_items` in Postgres; totals recalculated from `cart_items` (`:172-178`) |
| Product validation | ✅ | checkout rejects `product_status !== 'published'` → `PRODUCT_UNAVAILABLE` (`:799`) |
| Variant validation | ✅ | re-reads `product_variants`; rejects `status !== 'active'` or insufficient stock → `INSUFFICIENT_STOCK` / `VARIANT_NOT_FOUND` (`:805-841`) |
| Quantity validation | ✅ | `validateCheckoutQuantity()` server-side, `MAX_ORDER_QUANTITY = 999` (`lib/inventory.ts:11`) → `VALIDATION_ERROR` (`:789`) |
| **Price refresh** | ✅✅ | checkout re-reads the price per item and **reassigns it**: `item.price = productPrice` (`:861-865`) and `item.price = variantPrice` (`:843-847`), with a 0.005 tolerance, setting `priceChanged` so the client is told. The code comment claiming this is accurate — this is stronger than the common "trust the cart snapshot" implementation |
| Unavailable product | ✅ | `PRODUCT_UNAVAILABLE` |
| Seller ownership | ✅ | the shop comes from `p.shop_id` in the join, never from the request |
| Stock changes | ✅ | availability is re-read at checkout (`stock_qty - reserved`, or variant `stock`) |
| Duplicate items | ✅ | upsert per (cart, product, variant): `SELECT … FROM cart_items WHERE cart_id = $1 AND product_id = $2${variantClause}` then UPDATE, else INSERT (`:395-417`) |
| Concurrent modification | ⚠️ | no row lock or version on `cart_items`; a concurrent add and a concurrent checkout can interleave. Harmless for money — checkout revalidates stock and price inside its own transaction — but cart contents are last-write-wins |
| Cart expiration | ❌ absent | verified: no `expires_at` column, no sweep job. Low impact precisely *because* checkout revalidates price and stock; the cost is stale rows and a stale-looking total in the UI |

### Can the frontend tamper with the money? — **No, verified**

`POST /api/customer/checkout` reads exactly five body fields (`cart.ts:690-700`):
`shippingAddressId`/`addressId`, `notes`, `cartItemIds`, `requestId`, `paymentMethod`.
A search for `body.price`, `body.total`, `body.amount`, `body.seller`, `body.discount`,
`body.subtotal` and `body.shop` returns **zero matches** in `routes/cart.ts`.

So **price, quantity, seller, product, variant and discount cannot be supplied by the
client.** All are resolved from the database. `paymentMethod` is documented in the code
itself as *"a routing hint; it never affects price"* and is validated against server-side
payment configuration, so a disabled method cannot be ordered by hiding or showing UI.

---

## 5. CHECKOUT

| | |
|---|---|
| **Actual files** | `backend/routes/cart.ts` (1,853 lines; checkout at ~684), `backend/lib/inventory.ts`, `backend/lib/order-lock.ts` |
| **Actual API** | `POST /api/customer/checkout` (cart scope + `requestId` idempotency key) |
| **Actual DB tables** | `carts`/`cart_items`, `checkout_requests`, `checkout_groups`, `orders`, `order_items`, `inventory` / `product_variants` |
| **Actual state** | cart → one order per shop under one `checkout_groups` parent → one provider session per purchase |
| **Actual owner** | platform |
| **Actual source of truth** | **the server.** Prices, seller identity and totals are resolved from the DB inside the transaction; the client supplies quantities and ids only |
| **Actual transaction boundary** | one transaction spanning order creation, line items and stock reservation |
| **Actual tests** | `multi-shop-checkout.test.ts`, `checkout-payment-flow.test.ts`, `checkout-group-session-open.test.ts`, `customer-order-cancel.test.ts`, `payment-reservation-expiry.test.ts` |

**Verified:** the cart split is real; `checkout_requests UNIQUE (user_id, scope,
request_key)` stores the response and replays it, so a duplicate checkout cannot
create a second purchase; stock reservation is a guarded atomic UPDATE.

### The §9 checklist, verified item by item

| Check | Result | Evidence |
|---|---|---|
| Server-side price | ✅ | see §4A — the price is re-read and reassigned per item inside checkout |
| Total calculation | ✅ | the order's lines are written from the **reassigned** `item.price` (`:963` `parseFloat(item.price) * item.quantity`) |
| Multi-seller | ✅ | items are grouped by `shop_id` in-memory and one order per shop is created (`:875+`) |
| Atomicity | ✅ | order, order items and stock reservation are written in **one** `withTransaction()`; a failure rolls the whole purchase back |
| Idempotency | ✅ | `checkout_requests UNIQUE (user_id, scope, request_key)` with the **response stored** and replayed |
| Retry | ✅ | a retry with the same `requestId` returns the original purchase rather than creating a second |
| Inventory reservation | ✅ | guarded atomic UPDATE; validation and mutation are the same statement |
| Expiration | ⚠️ | the *payment reservation* expires (`payment-reservation-expiry.test.ts`) and releases stock; the **cart** does not expire (§4A) |
| Concurrent checkout | ✅ | two concurrent requests for one purchase: the lock order + guarded stock predicate serialise them; tested with two real connections |
| Duplicate checkout | ✅ | blocked by the idempotency key above |
| Partial failure | ✅ | one transaction: a stock failure on the second shop rolls back the first shop's order too — no half-purchase. Verified by the `INSUFFICIENT_STOCK` / `EMPTY_CART` / `PRODUCT_UNAVAILABLE` early returns happening **before** any write, and the stock guards happening **inside** the transaction |

---

## 6. ORDER

| | |
|---|---|
| **Actual files** | `backend/lib/order-fulfillment.ts`, `backend/lib/order-read.ts`, `backend/lib/checkout-groups.ts`, `backend/routes/cart.ts`, `backend/routes/seller-orders.ts`, `backend/routes/center.ts`, `backend/routes/stripe.ts` |
| **Actual API** | customer order routes, `GET/PATCH /api/seller/orders/...`, admin order routes |
| **Actual DB tables** | `orders`, `order_items`, `checkout_groups`, and — **structure only** — `fulfillment_orders` |
| **Actual state** | **`orders.status` is the single runtime authority** and carries payment ∧ order ∧ fulfilment in one 12-value column. `orders.order_state` and `orders.fulfillment_status` exist but **no non-test code reads or writes them** (verified by search) |
| **Actual owner** | platform for the purchase; seller for its own order |
| **Actual source of truth** | `orders.status`, written from **12 sites**: `cart.ts:1501`, `center.ts:532`, `seller-orders.ts:627`, `stripe.ts:1011/1067/1266/1442/1489/1637/1643/2449`, `checkout-group-lifecycle.ts:168` |
| **Actual transaction boundary** | per-route `withTransaction()`; `lib/order-lock.ts` locks one order at a time |
| **Actual tests** | `order-status-check-constraint.test.ts`, `dead-order-status-failed.test.ts`, `customer-order-cancel.test.ts`, `order-number.test.ts` |

**This is finding A1 and it is a REAL DEFECT, unchanged by 056.** The axes exist in
the database; the projection function that would write them does not exist.

---

## 7. INVENTORY

| | |
|---|---|
| **Actual files** | `backend/lib/inventory.ts`, `backend/routes/products.ts` (stock set at `:1487`, `:1527`), `backend/routes/cart.ts:1003`, `backend/lib/velrepeat-cycles.ts:602`, `backend/jobs/velrepeat-scheduler.ts:328` |
| **Actual API** | `PATCH /api/seller/products/:id/stock`, variant update, reorder level |
| **Actual DB tables** | `inventory` (`product_id UNIQUE`) for non-variant stock, `product_variants.stock` for variant stock; and — **structure only** — `inventory_movements` |
| **Actual state** | `inventory.quantity` = on-hand, `inventory.reserved` = held; the four new counters (`committed`, `fulfilled`, `returned`) exist and are **never written**. `product_variants` now has the same counters, also never written |
| **Actual owner** | seller (writes), platform (reserves/commits/releases) |
| **Actual source of truth** | `inventory.quantity - inventory.reserved` for non-variant; `product_variants.stock` for variant |
| **Actual transaction boundary** | the checkout/settlement transaction — reservation and order creation are atomic together |
| **Actual tests** | `inventory.test.ts` family, `payment-reservation-expiry.test.ts`, `commerce-core-invariants.test.ts` |

**Verified strengths — do not dismantle (§40):**
`reserveInventoryStock` is a single guarded statement
(`UPDATE inventory SET reserved = reserved + $1 … WHERE product_id = $2 AND quantity - reserved >= $1`),
so validation and mutation are one atomic operation. Every variant decrement is
likewise guarded (`WHERE id = $2 AND stock >= $1`: `cart.ts:1003`,
`velrepeat-cycles.ts:602`, `velrepeat-scheduler.ts:328`). A race cannot oversell
through these paths.

**Verified NEW risk introduced by 056 — see `FINAL_GAP_REPORT.md` P1-1.** The
absolute-set path `routes/products.ts:1487`
(`ON CONFLICT (product_id) DO UPDATE SET quantity = $2`, clamped only at 0) can now
violate `inventory_availability_check (reserved + committed <= quantity)` when a
seller lowers stock below units currently **reserved** by an in-flight checkout.
The statement raises `23514` and the route's generic `catch` returns
`500 STOCK_FAILED`. This behaviour is new: before 056 the same update silently
succeeded and put the marketplace into a state where the shelf was oversold.

**Consistency model:** reservation and commit are **strong** (a single DB
transaction). Daily stock editing is strong. Nothing here is eventual, and that is
correct for stock.

---

## 8. SELLER

| | |
|---|---|
| **Actual files** | `backend/routes/seller-orders.ts` (825 lines), `backend/routes/products.ts`, `backend/routes/seller-*.ts`, `backend/lib/seller-stats.ts` |
| **Actual API** | `/api/seller/...` — products, orders, stock, statistics |
| **Actual DB tables** | `sellers`, `shops`, `products`, `orders`, `order_items`, `commissions` (**zero writers**), `settlements` (**zero writers**) |
| **Actual state** | seller onboarding, verification, product management and order handling are functional |
| **Actual owner** | the seller, scoped by `shops.seller_id` |
| **Actual source of truth** | Postgres; ownership is checked per route (`getSellerForUser`, `verifyProductOwnership`) |
| **Actual transaction boundary** | per-route |
| **Actual tests** | `seller-orders*.test.ts`, `seller-onboarding*.test.ts`, product-management and image-upload suites |

**Verified:** the seller order list **is paginated and bounded**
(`seller-orders.ts:322-325`, `pageSize` capped at 100) — a genuine strength.

**Verified defect (unchanged, A7/A8):** three disagreeing commission rates —
`SELLER_COMMISSION_RATE = 0.03` (`lib/seller-stats.ts:7`, used at
`routes/admin.ts:190`), `commissionRate: 0.03` (`routes/products.ts:2608`),
`commissionRate: 0` (`routes/seller-orders.ts:249`), and a column default of `0.05`.
`commissions` and `settlements` have **zero writers**, so no seller has ever been
paid and no fee has ever been booked.

---

## 9. FULFILLMENT

| | |
|---|---|
| **Actual files** | `backend/lib/order-fulfillment.ts` (452 lines) |
| **Actual API** | seller order transition route → fulfilment helpers |
| **Actual DB tables** | `orders` (status), `shipments`; and — **structure only** — `fulfillment_orders` |
| **Actual state** | a real 7-state machine exists in code: `pending, confirmed, packing, shipped, delivered, completed, cancelled`, with `FULFILLMENT_TRANSITIONS`, `normalizeOrderStatusToFulfillment`, `FulfillmentError`, `paymentAllowsConfirmation`, `assertPaymentConfirmedForConfirmation`, `assertNoSettledPaymentForCancellation` |
| **Actual owner** | seller |
| **Actual source of truth** | **code only.** The state machine is not enforced by any DB constraint; `orders.status` stores the result |
| **Actual transaction boundary** | the transition route's transaction |
| **Actual tests** | fulfilment transition tests, `dead-order-status-failed.test.ts` |

**Verified gap:** payment success and fulfilment start are **logically** separated
by `paymentAllowsConfirmation`, but they are stored in one column, so
"paid and picking" has no representation. One order can produce exactly one
shipment; no code records *which units* it carried.

---

## 10. SHIPMENT

| | |
|---|---|
| **Actual files** | `backend/lib/order-fulfillment.ts:396-450` (`ensureShipmentForShipping`) |
| **Actual API** | none of its own; created from the transition route |
| **Actual DB tables** | `shipments`; and — **structure only** — `shipment_items` |
| **Actual state** | `shipments.status` is free `TEXT`; the only values ever written are **`pending` and `created`** (`order-fulfillment.ts:418` maps `pending`→`created`; `:438` inserts `'created'`). `shipped_at` / `delivered_at` (056) have no writer |
| **Actual owner** | seller (data entry), platform (storage) |
| **Actual source of truth** | the `shipments` row |
| **Actual transaction boundary** | the transition route's transaction |
| **Actual tests** | fulfilment tests |

**Verified defect — the only non-idempotent write in the codebase.**
`ensureShipmentForShipping` performs `SELECT … LIMIT 1` and then `INSERT`
(`order-fulfillment.ts:396`) with no unique constraint preventing a second
shipment row for the same order and no idempotency key. Two concurrent "mark
shipped" requests can create two shipments. The 056 addition of
`shipment_items` does not change this, because nothing writes it.

---

## 11. REFUND

| | |
|---|---|
| **Actual files** | `backend/routes/stripe.ts` — `syncRefundFromStripe` (~`:1590`), operator refund route (~`:2790`) |
| **Actual API** | operator refund route; provider refund webhook |
| **Actual DB tables** | `refunds`, `payments.refunded_amount`, `payments.refund_status` |
| **Actual state** | full and partial refunds both work; `refunds.status` ∈ `pending`/`succeeded` |
| **Actual owner** | platform (admin/operator) |
| **Actual source of truth** | **Stripe.** The local row is a projection of the provider's refund object |
| **Actual transaction boundary** | the webhook/route transaction |
| **Actual tests** | `late-payment-incidents.test.ts`, refund cases inside the payment suites |

**Verified strengths:** `refunds.provider_refund_id` is unique and written with
`ON CONFLICT … DO UPDATE`; the parentless-refund case is closed by migration 055
(`refunds_parent_check` + `checkout_group_id`); `refunded_amount` is **recomputed**
from `SUM(refunds.amount) WHERE status='succeeded'`, never incremented;
`payments_refund_within_amount_check` and `refunds_amount_positive_check` (056)
enforce `total_refunded <= total_captured` **in the database**.

**Verified gap:** the invariant `total_refunded <= total_captured` holds only
because Stripe refuses to over-refund. There is no Velnox-side reconciliation, so
if the local projection and the provider ever disagree, only the provider knows.

---

## 12. RETURN

| | |
|---|---|
| **Actual files** | **none** |
| **Actual API** | **none** |
| **Actual DB tables** | `order_returns` exists (056) with a full lifecycle vocabulary — **no writer, no reader, no route** |
| **Actual state** | `ABSENT at runtime` |
| **Actual owner** | none |
| **Actual source of truth** | none |
| **Actual transaction boundary** | none |
| **Actual tests** | `commerce-core-invariants.test.ts` proves the TABLE refuses bad rows; nothing proves a workflow |

**This is finding A17.** A return cannot be requested, approved, tracked or
received. `cancel` and `refund` exist and are *not* the same thing as a return,
which is why this is recorded as a **missing capability**, not a defect in an
existing one.

---

## 13. SETTLEMENT

| | |
|---|---|
| **Actual files** | none (only `lib/seller-stats.ts:7` computes a rate for display) |
| **Actual API** | none |
| **Actual DB tables** | `commissions` (zero writers), `settlements` (zero writers); `ledger_entries` exists (056) with `platform_cash`/`platform_revenue`/`seller_payable`/`refund_clearing` and an append-only trigger — **no writer** |
| **Actual state** | `ABSENT at runtime` |
| **Actual owner** | none |
| **Actual source of truth** | none — there is no record of what the platform owes a seller |
| **Actual transaction boundary** | none |
| **Actual tests** | `commerce-core-invariants.test.ts` proves the ledger is append-only (`P0001` on UPDATE and DELETE) and that a zero-amount entry is refused (`23514`) |

**Customer payment is separated from seller settlement in the SCHEMA and nowhere
else.** By §20's rule, this is why Velnox cannot currently be called a complete
production marketplace.

---

## 14. WEBHOOK

| | |
|---|---|
| **Actual files** | `backend/routes/stripe.ts:2503-2680` |
| **Actual API** | `POST /api/payments/stripe/webhook` |
| **Actual DB tables** | `payment_events`, `payments`, `refunds`, `orders`, `checkout_groups`, `payment_incidents` |
| **Actual state** | signature verified over the raw body before parsing; each event id claimed; processing failure returns 500 |
| **Actual owner** | platform |
| **Actual source of truth** | **Stripe** for payment outcome |
| **Actual transaction boundary** | the handler's transaction, with `payment_events` as the claim |
| **Actual tests** | `payment-webhook-schema-lag.test.ts`, group visibility cases 5–9 |

**Verified gap:** there is **no retry metadata** (`attempt_count`,
`next_retry_at`, `last_error`) in use — the columns exist (056) and nothing writes
them. Retry is delegated entirely to Stripe's redelivery schedule. There is no
dead-letter state and no way to see a webhook that keeps failing other than the
500 in the logs.

---

## 15. EVENTS

| | |
|---|---|
| **Actual files** | the realtime broadcast call sites, e.g. `backend/routes/seller-orders.ts:657-666` |
| **Actual API** | a WebSocket channel |
| **Actual DB tables** | **none in use.** `outbox_events` exists (056) with `aggregate_type`, `event_type`, `status ∈ (pending, published, failed, dead)`, `attempt_count`, `next_retry_at`, `last_error` — **no writer, no drain worker** |
| **Actual state** | broadcast happens **after COMMIT, inside `try{}catch{}`** — a failed broadcast is swallowed |
| **Actual owner** | platform |
| **Actual source of truth** | the database; the event is a notification only |
| **Actual transaction boundary** | the broadcast is deliberately OUTSIDE the transaction |
| **Actual tests** | realtime tests assert the channel allowlist; none assert delivery |

**Verified race (finding A13):** a crash between COMMIT and broadcast loses the
notification permanently, with no record that it was ever owed. The WebSocket
channel allowlist includes `cart:updated`, `order:created` and `inventory:updated`
**with no publisher**. For notifications this is **eventual consistency, which is
correct** — the gap is not the consistency model, it is that a lost notification is
undetectable.

---

## 16. NOTIFICATIONS

| | |
|---|---|
| **Actual files** | realtime broadcast helpers |
| **Actual state** | in-process WebSocket broadcast only; no email, no push, no SMS sender |
| **Actual consistency model** | eventual — correct for a notification |
| **Actual tests** | channel allowlist tests |

---

## 17. RECONCILIATION

| | |
|---|---|
| **Actual files** | **none** |
| **Actual DB tables** | `reconciliation_runs`, `reconciliation_findings` exist (056) with `kind`, `severity`, `fingerprint` (unique per kind), `expected`/`observed` JSONB — **no runner, no reader** |
| **Actual state** | `ABSENT at runtime`. All `reconcil` matches in the code are *amount-reconciliation comments*; `db/verify-reconciler.sh` is a **schema-shape** verifier, not a data reconciler |
| **Actual owner** | none |
| **Actual tests** | `commerce-core-invariants.test.ts` proves one OPEN finding per fingerprint |

---

## 18. SECURITY

| | |
|---|---|
| **Actual files** | `backend/lib/auth*.ts`, `requireAuth` middleware, `backend/lib/seller-*.ts` ownership helpers, `backend/middleware/rate-limit.ts`, `backend/middleware/origin-guard.ts` |
| **Actual API** | JWT in an httpOnly cookie; route-class rate limits (`429 RATE_LIMITED`); Origin-guard on state-changing methods |
| **Actual state** | authentication on every `/api` route; ownership checked per route (`getSellerForUser`, `verifyProductOwnership`); rate limiting and CSRF defense both present |
| **Actual owner** | platform |
| **Actual tests** | auth suites, ownership suites, `test-database-isolation.test.ts` |

**Verified strengths:** JWT is httpOnly; provider webhooks require a signature;
the test-database guard **fails closed** rather than falling back to production.

**CORRECTION — this audit first recorded rate limiting and CSRF as MISSING, and
that record was WRONG.** Direct inspection found a real, documented defense layer:

- `backend/middleware/rate-limit.ts` is a **route-class rate limiter** wired at
  `server.ts:96` (`app.use(rateLimitSecurity)`). Auth endpoints are IP-keyed and
  tight; money/order mutations are user-keyed at 10/min (with `checkout_requests`
  idempotency as the primary guard); chat 30/min; upload intents 20/min; public
  reads 300/min; plus a 600/min per-IP catch-all. It returns `429 RATE_LIMITED`
  with a `Retry-After` header, sweeps expired buckets on a timer, and guards
  `MAX_BUCKETS` against a flood of brand-new spoofed keys.
- `backend/middleware/origin-guard.ts` provides **CSRF defense by Origin
  allowlist**, wired at `server.ts:88`, with the reasoning for preferring it over a
  double-submit cookie written out in the file, and its non-breakage for Google
  OAuth redirects, the WebSocket upgrade, the Stripe webhook (no `Origin` header)
  and local dev each analysed explicitly.

**Neither of these should be replaced by a generic "add rate limiting / add CSRF"
change.** The gap this audit actually found in Security is the correlation id in
§19, and nothing else.

No leaked-secret finding is claimed: this audit did not run a secret scanner.

---

## 19. OBSERVABILITY

| | |
|---|---|
| **Actual files** | `backend/db/index.ts` (`SLOW_QUERY_MS`, `sqlForLog`, `[DB] operation failed:` logging) |
| **Actual state** | structured DB error logging with the statement and SQLSTATE; request logs |
| **Actual gap** | **no request/correlation id is generated or propagated.** `correlation_id` columns exist (056) and **nothing writes them**. A client-supplied checkout `requestId` (`cart.ts:694`) and `provider_request_id` (`stripe.ts:482`) are the only correlation-like values, and neither flows through to a log scope |

**§27 test — "the customer says they paid but the seller sees no order":** this can
be traced *today* only by manually correlating `payments` → `checkout_groups` →
`orders` → `payment_events` in SQL. There is no id that ties the request, the
purchase, the provider event and the fulfilment together. **GAP, P2.**

---

## 20. What is verified vs. what is assumed in this map

- **Read/verified at this SHA:** the counts in §3, the zero-writer searches in §0,
  the writer line numbers in §6 and §10, the payment validation lines in §4, the
  pagination lines in §8, the guarded reservation statements in §7, the raw-body
  and signature lines in §14.
- **Carried forward from the audit at `c44785b`** and re-confirmed by search where
  the SHA changed: the A-findings in `.ai/rebuild/CURRENT_ARCHITECTURE.md`.
- **Not verified here:** anything requiring a live provider, a browser, or the
  production database. Those are listed as BLOCKED in `FINAL_GAP_REPORT.md`.
