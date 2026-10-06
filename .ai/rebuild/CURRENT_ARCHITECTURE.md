# CURRENT_ARCHITECTURE.md — Velnox commerce as it actually is (audit, 2026-10-06)

> **Method.** Every statement below was read from the repository at
> `c44785b35c641a9f496e3057c33053bd9cf3620f` (branch `main`, working tree clean,
> `local SHA == origin/main`) — schema from `db/schema.sql`, behaviour from
> `backend/**` and `apps/**`. Nothing here is recalled from memory or assumed.
> File:line references are evidence, not decoration.
>
> Companion: `docs/PAYMENT_CURRENT_STATE.md` (the 25-question payment audit,
> §70) and `STATE_MACHINES.md` (the machine-by-machine reading).

---

## 1. The pipeline that exists today

```
guest/customer
  │  Google OAuth → httpOnly JWT cookie (revoked_tokens-backed)
  ▼
CART            carts (UNIQUE user_id) + cart_items (UNIQUE cart,product,variant)
  │             price stored on cart_items — DISPLAY ONLY; recalcCart() is a display helper
  ▼
CHECKOUT        POST /api/customer/checkout            backend/routes/cart.ts:684
  │             · re-reads products.price + product_variants.price server-side
  │             · ownership-checks the address row, snapshots it (never trusts body)
  │             · rejects unpublished products, bad quantities (MAX 999), bad methods
  │             · groups lines by shop_id  →  ONE ORDER PER SHOP
  │             · creates checkout_groups (the PURCHASE) when >1 shop or always?
  │             · reserves stock per line (inventory.reserved / product_variants.stock)
  │             · writes orders.payment_expires_at = now + 30 min (payment-reservation.ts)
  │             · idempotent via checkout_requests UNIQUE(user_id,'checkout',request_key)
  ▼
PURCHASE        checkout_groups (id, user_id, total_amount, currency, item_count, shop_count)
  │             orders.checkout_group_id → checkout_groups.id (FK, ON DELETE SET NULL)
  ▼
ORDER           orders (one per shop)  + order_items (snapshot + variant)
  │             orders.status = ONE column carrying THREE axes (see §3)
  ▼
PAYMENT         POST /api/stripe/checkout              backend/routes/stripe.ts:2012
  │             accepts { orderId } OR { checkoutGroupId } (server derives scope)
  │             payments: order_id | checkout_group_id | plan_id (at-least-one-parent)
  │             Stripe Checkout Session (test mode only) → hosted redirect
  │             idempotent via checkout_requests UNIQUE(user_id,'payment',request_key)
  │                       + idx_payments_one_active_stripe[_group|_plan]
  ▼
WEBHOOK         POST /api/payments/stripe/webhook      backend/routes/stripe.ts:2503
  │             raw body (middleware/stripe-raw-body.ts before express.json)
  │             constructEventAsync signature verify
  │             claim: INSERT INTO payment_events … ON CONFLICT (event_id) DO NOTHING
  │             dispatch handleStripeEvent (stripe.ts:1672) → 10 event types
  │             failure → status='failed' + HTTP 500 (Stripe redelivers)
  ▼
INVENTORY       commitOrderInventory()  (settlement)   backend/lib/inventory.ts:98
                releaseOrderInventory() (cancel/expire/fail) backend/lib/inventory.ts:246
                guarded UPDATE claims: orders.inventory_released (one flag per order)
  ▼
SELLER ORDER    PATCH /api/seller/orders/:id/status    backend/routes/seller-orders.ts:521
                fulfillment machine in backend/lib/order-fulfillment.ts (7 statuses,
                mapped onto the 12-value orders.status via normalizeOrderStatusToFulfillment)
                gates: payment-gate on confirm, no-cancel-after-paid, shipment-required-to-ship
  ▼
SHIPMENT        shipments(order_id, carrier, tracking_number, status free TEXT)
                tracking_events(shipment_id, status, description, location, occurred_at)
  ▼
VELCENTER       order/payment/refund/incident read + status write (routes/center.ts:378, 532)
```

**Data ownership (correct, keep):** Neon PostgreSQL is the single source of truth
for commerce/financial/critical data; R2 is binary storage; WebSocket is delivery
only; Convex is not part of the architecture. There is **no** second source of
truth for order/payment/money/inventory today.

---

## 2. Schema inventory (commerce-relevant), with what each really is

| Table | Real role today | Verdict |
|---|---|---|
| `carts`, `cart_items` | cart; `cart_items.price` is a display snapshot | keep (Cart ≠ Order — already separated) |
| `checkout_groups` | **the Purchase aggregate** (multi-shop checkout) | keep — correct model |
| `checkout_requests` | durable idempotency store, `UNIQUE(user_id, scope, request_key)`, stores the replayed `response` | keep — the only correct idempotency mechanism in the repo |
| `orders` | **SellerOrder** (one per shop per purchase) + a 12-value status mixing 3 axes + `inventory_released` + `payment_expires_at` + `reservation_policy` | keep, split the axes |
| `order_items` | line snapshots (product/variant name, image, price, subtotal) | keep |
| `inventory` | product-level stock: `quantity` (on-hand), `reserved`; `product_id UNIQUE`; **no CHECK** | keep, extend |
| `product_variants.stock` | variant-level stock: **a second, independent stock authority**, no CHECK | merge into `inventory` |
| `payments` | attempt + session + result in ONE row; 7-value status CHECK | keep, split attempts out |
| `payment_events` | webhook event store: `event_id UNIQUE`, `status`, `error`, `payload`, `processed_at` | keep, extend |
| `payment_incidents` | operator incident register (`dedupe_key UNIQUE`), exactly-one-parent CHECK | keep |
| `refunds` | refund rows, `provider_refund_id UNIQUE`, parent check (order OR group) | keep, extend |
| `shipments` | one row per order; `status` free TEXT, never advanced past `created` | keep, extend |
| `tracking_events` | transit breadcrumbs | keep |
| `commissions` | **DEAD — zero writers** (verified: no `INSERT`/`UPDATE` in `backend/**`) | replace with the ledger |
| `settlements` | **DEAD — zero writers** | replace with ledger-derived settlement |
| `audit_logs` | generic audit sink | reuse for admin actions |
| `product_verifications`, `products.verification_status` | deprecated, unwritten | leave (known-accepted) |

---

## 3. Finding A1 — one column carries three lifecycles

`orders.status` (`db/schema.sql:366` + the V0050 re-declaration at
`db/schema.sql:1089`) allows **12** values, and they belong to three different
domains:

| Axis | Values inside `orders.status` |
|---|---|
| payment | `pending_payment`, `paid`, `payment_failed`, `refunded`, `expired` |
| order | `pending`, `confirmed` |
| fulfillment | `packing`, `shipped`, `delivered`, `completed`, `cancelled` |

Writers (verified, non-test): `cart.ts:1501`, `center.ts:532`,
`seller-orders.ts:627`, `stripe.ts:1011/1067/1266/1442/1489/1637/1643/2449`,
`checkout-group-lifecycle.ts:168` — each writes the whole column for its own
purpose. Consequence: no reader can interpret the column without knowing which
of three systems wrote it. `backend/lib/order-fulfillment.ts` already documents
the ambiguity and normalises 12 values down to 7 purely in code — the database
cannot enforce any of it.

## 4. Finding A2 — `orders.status` mixes warehouse and transit

The fulfillment machine ends at `delivered`; the shipment's own progress
(`picked_up`, `in_transit`, `out_for_delivery`, `lost`, `returned`) has no
representation. `shipments.status` is free `TEXT NOT NULL DEFAULT 'pending'`
with **no CHECK**, and the only values any writer produces are `'pending'`
(default) and `'created'` (`order-fulfillment.ts:438`, and the
`CASE WHEN status = 'pending' THEN 'created'` at `:418`). Transit is therefore
not tracked at all — `orders.status='shipped'` is the only signal.

## 5. Finding A3 — TWO stock authorities, neither protected by the database

1. Non-variant: `inventory.quantity` (on-hand) + `inventory.reserved`.
   Checkout guard: `UPDATE inventory SET reserved = reserved + $1 WHERE
   product_id = $2 AND quantity - reserved >= $1` (`inventory.ts:61`) — atomic,
   correct. Settlement: `quantity - q, reserved - q` (`inventory.ts:129`).
   Release: `reserved - q` (`inventory.ts:292`).
2. Variant: `product_variants.stock`, guarded `UPDATE … WHERE stock >= $1`, and
   **deliberately never restored or consumed at settlement** (`inventory.ts:113`
   — "Leaving it decremented IS the consumption").

So for a variant the stock number is decremented at *reserve* time and no later
stage can tell "held" from "sold" from "gone". Neither column has a
`CHECK (… >= 0)` (`db/schema.sql:257`, `:322`) — the only protection is the
`WHERE` clause of the guarded UPDATEs, which is correct but not durable: any
other writer (admin edit, VelRepeat scheduler, migration) can go negative.

## 6. Finding A4 — inventory cannot express its own lifecycle

`on_hand` / `reserved` exist. `committed` (paid, not yet shipped), `fulfilled`,
`returned` **do not exist anywhere**. Consequences, all real today:
a return cannot be recorded; a paid-but-unshipped unit is indistinguishable from
a physically gone unit; `available` is recomputed ad hoc as `quantity - reserved`
in at least three places; there is no per-movement audit (no
`inventory_movements` table), so "why did this number change?" has no answer.

## 7. Finding A5/A6 — payment attempt lifecycle is flattened

`payments` holds `provider_checkout_session_id`, `provider_payment_id`,
`status`, `paid_at`, `refunded_amount`, `refund_status`, `failure_code`,
`metadata` in one row. There is **no** `payment_attempts` table: no
`attempt_number`, no `idempotency_key`, no session→intent mapping, no
`authorized` state (the CHECK is `pending | requires_action | processing | paid |
failed | cancelled` — `db/schema.sql:484`), no `expired`. A retry creates a
**new** `payments` row, so "attempts" exist only as an implicit side effect of
row multiplicity, ordered by `created_at`, with no explicit link between them.
Settlement (`markPaymentSucceeded`, stripe.ts:1054) writes `orders.status='paid'`
and `payments.status='paid'` — the payment **is** the attempt, the session and
the result.

## 8. Finding A7/A8 — commission and settlement are declared but dead

`commissions(order_id, seller_id, amount, rate NUMERIC(5,4) DEFAULT 0.05,
created_at)` and `settlements(seller_id, amount, status DEFAULT 'pending',
created_at)` exist in `db/schema.sql:568-581`. **A repository-wide grep for
`INSERT INTO commissions` / `UPDATE commissions` / `INSERT INTO settlements` /
`UPDATE settlements` in `backend/**` (excluding tests) returns zero rows.** The
only seller money is read-only derivation at request time with **three
different rates**: `SELLER_COMMISSION_RATE = 0.03` (`lib/seller-stats.ts:7`, used
by `routes/admin.ts:190`), `commissionRate: 0.03` (`routes/products.ts:2608`),
`commissionRate: 0` (`routes/seller-orders.ts:249`), and a 0.05 column default.
There is no ledger, no seller payable, no settlement run and no payout
(`docs/PAYMENT_*` §19 records Stripe Connect as absent). **Customer payment
today implies nothing about seller money.**

## 9. Finding A9 — error taxonomy is ad hoc

Of the 13 categories the brief names, only two appear in the backend at all:
`VALIDATION_ERROR` (141 occurrences) and `PAYMENT_FAILED` (3). Everything else is
a bespoke string invented per call site — `INSUFFICIENT_STOCK` (thrown as a bare
`Error`, `inventory.ts:66`), `EMPTY_CART`, `PRODUCT_UNAVAILABLE`,
`INVALID_PAYMENT_METHOD`, `PAYMENT_METHOD_DISABLED`, `INVALID_STATUS`,
`ORDER_ALREADY_PAID`, `PAYMENT_IN_PROGRESS`, `PAYMENT_NOT_CONFIRMED`,
`DUPLICATE_PAYMENT_IN_PROGRESS`, `SHIPMENT_REQUIRED`, `STRIPE_ERROR`,
`ADDRESS_NOT_FOUND`, `PAYMENT_RESERVATION_EXPIRED`. There is no
`AUTHORIZATION_ERROR`, no `INVENTORY_UNAVAILABLE`, no `PAYMENT_PENDING`, no
`PAYMENT_EXPIRED`, no `ORDER_NOT_CANCELLABLE`, no `REFUND_FAILED`, no
`FULFILLMENT_ERROR`, no `PROVIDER_ERROR`, no `CONCURRENCY_ERROR`, no
`SYSTEM_ERROR`.

## 10. Finding A10 — no correlation ids

A repository-wide grep for `requestId|correlationId|x-request-id` in
`backend/**` (non-test) returns exactly one meaning: a **client-supplied**
idempotency key in the checkout body (`cart.ts:694`) and a
`provider_request_id` field read off a provider error object
(`stripe.ts:482`). There is no request-id middleware, no `correlation_id` column
on any table and no correlation id in any log line. Given an incident reported by
a customer, the chain checkout → purchase → payment → provider → webhook → order
→ inventory → fulfillment **cannot be reconstructed** from the logs.

## 11. Finding A11 — no retry metadata anywhere

`grep -rniE "attempt_count|next_retry|maxAttempts|backoff|dead.?letter"` over
`backend/**` and `db/schema.sql` returns **zero** matches. `payment_events`
records `status` and `error` but not how many times an event was attempted, when
it should be retried, or whether it exhausted its budget. The only retry
mechanism in the system is Stripe's own redelivery, driven by the 500 response.

## 12. Finding A12 — no data reconciliation

Every `reconcil` match in `backend/**` (non-test) is a comment about
**amount reconciliation** inside checkout/settlement (`stripe.ts:20`, `:492`,
`:771`, `:2190`, `:3033`, `checkout-groups.ts:23`). `db/verify-reconciler.sh` is
a **schema-shape** verifier (it runs `run-sqleditor.sql` against disposable
databases and asserts the resulting catalog), not a data reconciler. There is no
job that compares our payment rows against Stripe, our inventory against our
orders, our orders against their fulfillments, or our refunds against the
provider's.

## 13. Finding A13 — events are fire-and-forget after commit

WebSocket broadcasts happen *after* `COMMIT`, wrapped in `try { … } catch {}`
(e.g. `seller-orders.ts:657-666`). There is no outbox, so "DB committed but the
event vanished" is possible by design. The channels `cart:updated`,
`order:created` and `inventory:updated` sit in the subscribe allowlist with **no
publisher at all** (measured, §19 of the handoff) — the realtime surface is not a
reliable event system, and it is not claimed to be.

## 14. Finding A14 — idempotency coverage is uneven

| Operation the brief requires idempotent | Today |
|---|---|
| create checkout | **yes** — `checkout_requests` claim, replay returns the stored response |
| create payment session | **yes** — `checkout_requests` + `idx_payments_one_active_stripe*` |
| capture | n/a (no manual capture; automatic capture only) |
| refund | partial — deterministic `velnox-refund-${payment.id}-${alreadyRefundedMinor}-${requestedMinor}` (`stripe.ts:2777`) + a duplicate-request replay; no `refunds.idempotency_key` column |
| cancel | yes in effect — guarded `UPDATE … WHERE status = ANY(...)` claim, terminal statuses are a 200 no-op |
| reserve inventory | yes — guarded UPDATE |
| release inventory | yes — `orders.inventory_released` claim inside the transaction |
| webhook processing | yes — `payment_events.event_id UNIQUE` claim |
| **shipment creation** | **NO** — `ensureShipmentForShipping` (`order-fulfillment.ts:396`) does `SELECT … LIMIT 1` then `INSERT`; two concurrent ship requests can create two shipment rows for one order |

## 15. Finding A15-A19 — the remaining gaps, stated plainly

* **A15** The fulfillment machine lives **only in code**; the FK from
  `shipments` to a fulfillment unit and any DB-level fulfillment status do not
  exist.
* **A16** A refund's **size** is guarded in code (`refundableMinorFor`) but not by
  the database: `refunds.amount` has **no** `CHECK (amount > 0)` and nothing
  prevents `SUM(refunds.amount) > payments.amount` at the DB level.
* **A17** There is **no return/RMA entity at all**. "refund after return" is
  expressible only as an operator-created refund with a free-text reason.
* **A18** Cancellation is an inline sequence in a route, not a named
  orchestration with an audit record. It is correct (payment gate, stock release,
  session expiry, group-aware) but it leaves no `cancellation` record, and it
  deliberately never creates a refund — a paid order is refused instead
  (`ORDER_ALREADY_PAID`).
* **A19** `payment_incidents` is real and used for late/duplicate charges, but
  there is no incident class for inventory or fulfillment drift.

## 16. What is already correct and must not be rebuilt

1. Money is `NUMERIC(12,2)` everywhere (no float in the storage layer).
2. `checkout_requests` — durable, DB-backed idempotency with a stored response.
3. The raw-body + `constructEventAsync` + `payment_events` claim + 500-on-failure
   webhook pipeline (its **shape** is the target shape).
4. `orders.inventory_released` guarded-claim release (exactly-once), plus the
   `releaseOrderInventory` refusal to release a settled order.
5. The one-lock-order contract (`lib/order-lock.ts`): the ORDER row is locked
   first by every multi-table writer, enforced by a test that reads `payments`
   with `FOR UPDATE NOWAIT`.
6. Checkout never trusts a client amount/seller/price: the address is resolved
   from the DB, prices are re-read, quantities are validated server-side.
7. The covering-set resolver (`lib/payment-attempt.ts`) — the ONE money read.
8. Test-mode-only key classification with a fail-closed webhook secret.
9. `checkout_groups` as a payment parent with per-member guarded settlement.
10. 71 test files / ~2 000 assertions, a 4-app typecheck, a 4-app build, an
    i18n parity check and a schema-shape reconciler that all currently pass.

---

## 17. Audit scorecard against the brief

| Brief requirement | State |
|---|---|
| §4 Cart ≠ Order, server-resolved checkout | **partly** — separation and server resolution exist; no persisted quote |
| §5 Purchase / Checkout Group | **yes** — `checkout_groups` |
| §6 Purchase→SellerOrder→FulfillmentOrder→Shipment | **missing FulfillmentOrder**, shipment is flat |
| §7 Payment separate from Order, attempt lifecycle | **partly** — separate table, no attempt layer, no `authorized`/`expired` |
| §8 Provider event is the authority | **yes** |
| §9 9-step webhook sequence | **yes** (steps 1-9 present; no attempt/retry metadata) |
| §10 durable idempotency for 9 operations | **6 of 9**; shipment creation is the hole |
| §11 inventory axes | **2 of 6** |
| §12 reservation lifecycle + release + reconciliation job | **release yes, reconciliation no** |
| §13 four separate state machines | **payment + fulfillment(partial) yes in code; order/shipment no; DB enforces one mixed column** |
| §14 explicit cancel orchestration | **inline, correct, unrecorded** |
| §15 refund as a domain operation | **partly** — provider-confirmed, no DB bound, no return flow |
| §16-18 marketplace split, settlement, ledger | **split yes; settlement and ledger absent** |
| §19 NUMERIC money | **yes** |
| §20-21 source of truth + DB invariants | **single source yes; almost no invariants** |
| §22 durable webhook store | **yes** |
| §23 reconciliation | **absent** |
| §24 retry system | **absent** |
| §25-26 events / outbox | **absent** |
| §27-28 API + security | **good** (validated, ownership-scoped, no client money); no CSRF token layer, no rate limiting on order/payment endpoints |
| §29 observability | **absent** (no correlation ids) |
| §30 error model | **absent** (2 of 13) |
| §31-33 UX / admin inspection | **partly** — seller and center surfaces exist; no reconciliation/incident inspection for inventory/fulfillment |
| §34-36 test pyramid | **strong unit+integration (~2 000)**, no E2E/contract/concurrency-in-production; Stripe TEST E2E BLOCKED |
| §38 legacy cleanup | **not yet** (dead `commissions`/`settlements`, duplicate stock model) |
