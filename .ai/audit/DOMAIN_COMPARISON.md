# DOMAIN_COMPARISON.md — Velnox vs. three public benchmarks

**Audit artifact. No code is changed by this document (§41).**

**SHA:** `04f9707c8fe3a8c06d6e1183ff2598d4c36a10db` (local == `origin/main`, tree clean)
**Benchmark sources:** `ECOMMERCE_BENCHMARK.md`. Benchmark cells say what the
**public documentation describes**, never what a company does internally (§4).
**Velnox cells** are traced from code/DB at this SHA, not from file names.

Legend for **Velnox**: ✅ present and correct · ⚠️ partial / structural only ·
❌ absent at runtime · ⛔ real defect

---

## 1. The domain matrix

| Domain | Velnox | Lazada (public) | Shopify (public) | Amazon (public) | Gap |
|---|---|---|---|---|---|
| **Cart** | ✅ **price revalidated and reassigned per item at checkout** (`cart.ts:843`, `:861`); five body fields only — price/quantity/seller/product/variant/discount are all DB-resolved; upsert per (cart, product, variant); ownership scoped by subquery | cart → per-seller sub-orders | Cart/Checkout objects; line items priced server-side | order created platform-side | ⚠️ no cart expiry (low impact — checkout revalidates); ⚠️ no row lock on `cart_items` (last-write-wins, not money-affecting) |
| **Checkout** | ✅ one `withTransaction()`; server resolves price/seller/total; idempotent via stored-response replay; **partial failure rolls back the whole purchase**; `priceChanged` surfaced to the client | multi-seller order grouping | Checkout→Order atomic server-side | order submission is server-authoritative | ⚠️ the **cart** has no expiry (the checkout quote does — the payment reservation expires and releases stock) |
| **Payment** | ⚠️ provider-authoritative, verified webhook, but **attempt layer unused**; `authorized`/`expired` unreachable | payment status per order; payout separate | Payment + PaymentAttempt-like separation | Finances API as money-event ledger | ⛔ no attempt layer at runtime; no reconciliation vs. provider |
| **Order** | ⛔ `orders.status` is the ONLY runtime authority (12 values mixing 3 axes) | per-seller order + platform order | Order + FulfillmentOrder split | Order vs OrderItem vs Fulfillment split | ⛔ axes exist in schema, **no writer** |
| **Inventory** | ✅ guarded atomic reserve/decrement; ⚠️ no movement journal; ⛔ absolute-set path can now raise `23514` | seller-managed stock per SKU | InventoryLevel per location | inventory per SKU per fulfilment centre | ⚠️ no `committed`/`fulfilled`/`returned` writes; no movement audit |
| **Seller Order** | ✅ real seller-scoped unit, paginated, ownership-checked | seller sub-order is the seller's unit | order is merchant-scoped | seller = the merchant | ✅ no gap found |
| **Fulfillment** | ⚠️ real 7-state machine **in code only**, stored in `orders.status` | pack → ready → shipped workflow | **FulfillmentOrder** ✅ | Fulfillment Outbound ✅ | ⚠️ `fulfillment_orders` unused; no partial fulfilment |
| **Shipment** | ⛔ free-TEXT status; only `pending`/`created` ever written; ⛔ non-idempotent create | shipment + logistics attached | Fulfillment tracks tracking | Shipment objects | ⛔ no transit states; no shipment↔line quantities |
| **Cancellation** | ⚠️ inline, race-safe, but **unrecorded**; no partial cancel | cancel with reason/status | order cancel + fulfillment order cancel | order cancel API | ⚠️ no cancellation record, no reason, no partial cancellation |
| **Return** | ❌ `order_returns` exists, **no writer/route** | reverse-order lifecycle | Returns API | Returns in SP-API | ❌ whole capability missing at runtime |
| **Refund** | ✅ full + partial; DB-enforced `refunded <= captured`; recomputed totals | refund/return flow | Refund object | Finances refund events | ⚠️ no refund reconciler; correctness delegated to the provider |
| **Settlement** | ❌ `commissions`/`settlements` zero writers; `ledger_entries` unused; 3 disagreeing fee rates | payout/statement APIs | payouts | Finances + settlement reports | ❌ no payable, no ledger, no period close |
| **Webhook** | ✅ raw-body HMAC verify, event-id claim, 500-on-failure | order/status notification topics | HMAC + delivery retries | notifications + polling | ⚠️ retry delegated entirely to the provider; no dead-letter |
| **Events** | ⚠️ realtime broadcast after COMMIT outside the transaction | — | webhook topics | — | ⚠️ `outbox_events` unused; a lost notification is undetectable |
| **Reconciliation** | ❌ `reconciliation_*` unused; all `reconcil` code is amount comments | payout reconciliation (observable) | payout reconciliation | **report-based** settlement reconciliation | ❌ no runner of any kind |
| **Notifications** | ⚠️ WebSocket only; no email/push | — | — | — | ⚠️ no durable delivery |
| **Security** | ✅ httpOnly JWT, per-route ownership, route-class rate limiting, Origin-guard CSRF defense, fail-closed test DB guard | — | — | — | ⚠️ no correlation id for incident tracing (see the correction note below) |
| **Observability** | ⚠️ SQLSTATE logging exists; **no correlation id anywhere** | — | — | — | ⚠️ cross-domain trace impossible |
| **Idempotency** | ✅ 8 of 11 operations DB-protected (see §3) | caller keys | caller keys + event ids | idempotency on submission | ⛔ **shipment creation** is SELECT-then-INSERT |
| **Retry** | ❌ no retry budget/dead-letter anywhere; columns exist, unused | — | webhook retries | documented retry/backoff policy | ❌ unbounded reliance on provider redelivery |
| **Concurrency** | ✅ guarded atomic stock; one-lock-order; ✅ route-class rate limiting | — | — | — | ✅ stock race is genuinely closed (see §5) |

---

## 2. State machine audit (§12) — traced from code and constraints

### 2.1 `orders.status` — one column, three vocabularies ⛔

**Source of truth:** the DB constraint, quoted verbatim from `db/schema.sql`
(`orders_status_check`, around line 1091):

```
CHECK (status IN ('pending', 'confirmed', 'packing', 'shipped', 'delivered',
                  'completed', 'cancelled', 'pending_payment', 'paid',
                  'payment_failed', 'refunded', 'expired'))
```

Those twelve values are **three different machines in one column**:

| Vocabulary | Values | Real owner |
|---|---|---|
| payment | `pending_payment`, `paid`, `payment_failed`, `expired`, `refunded` | Stripe webhook |
| order/purchase | `pending`, `cancelled`, `completed` | checkout / lifecycle |
| fulfilment | `confirmed`, `packing`, `shipped`, `delivered` | seller |

- **Writers:** 12 sites (`cart.ts:1501`, `center.ts:532`, `seller-orders.ts:627`,
  `stripe.ts:1011/1067/1266/1442/1489/1637/1643/2449`,
  `checkout-group-lifecycle.ts:168`).
- **DB-enforced transitions:** **none.** The CHECK validates the *set* of values,
  never the *legality* of a move. `paid → pending_payment` is accepted by the
  database.
- **Code-enforced transitions:** only inside `lib/order-fulfillment.ts`, and only
  after `normalizeOrderStatusToFulfillment()` has *translated away* the payment
  values.
- **Consequence:** "paid but not yet confirmed" and "packing but unpaid" are the
  same shape to the database, and the only thing preventing an illegal move is that
  the 12 writers happen not to contradict each other today.

### 2.2 Fulfilment machine — real, in code, unenforced by the DB ⚠️

From `backend/lib/order-fulfillment.ts` (`FULFILLMENT_TRANSITIONS`), verbatim:

| From | Allowed to |
|---|---|
| `pending` | `confirmed`, `cancelled` |
| `confirmed` | `packing`, `cancelled` |
| `packing` | `shipped` |
| `shipped` | `delivered` |
| `delivered` | `completed` |
| `completed` | — (terminal) |
| `cancelled` | — (terminal) |

- **Who may transition:** the seller, through the seller order transition route.
- **Guards:** `assertPaymentConfirmedForConfirmation` (payment must be settled) and
  `assertNoSettledPaymentForCancellation` (a settled payment blocks cancellation).
- **Side effects on transition:** `ensureShipmentForShipping` before `shipped`.
- **Transaction boundary:** the route's transaction.
- **Gap:** none of this is enforced by the database, and the transition result is
  written into the shared `orders.status` column.

### 2.3 Shipment machine — declared, unreachable ⛔

- **Declared vocabulary (056):** `pending, created, picked_up, in_transit,
  out_for_delivery, delivered, returned, lost, cancelled`.
- **Actually written:** only `created`, plus a one-way `pending → created` migration
  (`order-fulfillment.ts:418`). **Verified:** no other writer exists.
- `shipments.shipped_at` / `shipments.delivered_at` (056) have **no writer**.
- **Gap:** transit, delivery, loss and return are unrepresentable at runtime. The
  vocabulary is a promise the code does not keep.

### 2.4 Payment machine — widened vocabulary, unexercised ⚠️

- **DB vocabulary (056):** `pending, requires_action, processing, authorized, paid,
  failed, cancelled, expired, partially_refunded, refunded`.
- **Actually written:** `pending`, `requires_action`, `processing`, `paid`, `failed`,
  `cancelled`. `authorized`, `expired`, `partially_refunded`, `refunded` have **no
  writer** — but `payments.refund_status` (a different column) does carry
  `refunded` / `partially_refunded`.
- **Gap:** an authorization has nowhere to live, so the attempt layer cannot begin.

### 2.5 Refund machine — provider-driven, locally projected ✅

`refunds.status` ∈ `pending` → `succeeded`; set from Stripe's own refund object by
`syncRefundFromStripe`. Locally: `payments.refunded_amount` recomputed as
`SUM(refunds.amount) WHERE status='succeeded'`, and `refund_status` =
`refunded` if `total >= paid`, else `partially_refunded` if `> 0`. A full refund
moves every member order of the purchase to `refunded`.

### 2.6 Return machine — declared, unreachable ❌

`order_returns.status` ∈ `requested, approved, rejected, in_transit, received,
restocked, completed, cancelled`. **No writer, no reader, no route.**

### 2.7 Inventory machine — two counter axes, one unexercised ⚠️

- Product axis: `quantity` (on-hand), `reserved` written by
  `reserveInventoryStock` / released / committed.
- Variant axis: `stock` written by guarded decrement; `reserved`, `committed`,
  `fulfilled`, `returned` (056) **never written**.
- DB invariants now enforced: counters ≥ 0 and `reserved + committed <= on_hand`
  on **both** axes. On the variant axis this currently reduces to `stock >= 0`,
  because the other counters are always zero.

---

## 3. Idempotency matrix (§23) — mechanism, not keyword search

Every row was verified by reading the statement, not by grepping for the word.

| Operation | Idempotent? | Mechanism | DB-protected? | Gap |
|---|---|---|---|---|
| **Checkout** | ✅ | `checkout_requests UNIQUE (user_id, scope, request_key)` + **stored response** replayed | ✅ | — |
| **Payment (webhook)** | ✅ | `payment_events` claim on the provider event id | ✅ | — |
| **Payment (settlement)** | ✅ | covering-set resolver + group lifecycle terminates once | ✅ | — |
| **Refund** | ✅ | `refunds.provider_refund_id` UNIQUE + `ON CONFLICT … DO UPDATE`; totals **recomputed** | ✅ | — |
| **Cancel** | ✅ | lifecycle helper is a no-op on repeat (tested: CASE 10) | ✅ | — |
| **Inventory reserve** | ✅ | `orders.inventory_released` claim + guarded atomic UPDATE | ✅ | — |
| **Inventory release** | ✅ | `inventory_released` exactly-once claim | ✅ | — |
| **Inventory commit** | ⚠️ | `GREATEST(0, …)` clamps; no claim key of its own | ⚠️ | idempotent by arithmetic, not by claim |
| **Webhook (whole handler)** | ✅ | event claim + 500 so the provider retries | ✅ | — |
| **Shipment create** | ⛔ | **`SELECT … LIMIT 1` then `INSERT`** (`order-fulfillment.ts:396`) | ❌ **no unique constraint** | **two concurrent "mark shipped" → two shipment rows** |
| **Commission / settlement** | ❌ | no writer exists | ❌ | n/a until implemented |

**Verified defect:** shipment creation is the **one** non-idempotent write in the
codebase. `shipment_items_shipment_item_unique` (056) constrains the *items* table,
not the shipment itself, so it does not close this.

---

## 4. Retry / failure matrix (§24)

| Dependency | Timeout | Retry | Backoff | Max attempts | Dead letter | Reconciliation |
|---|---|---|---|---|---|---|
| **Stripe (API calls)** | SDK default | SDK-internal only | SDK | SDK | ❌ | ❌ |
| **Stripe (webhooks, inbound)** | n/a | delegated to Stripe redelivery | — | ❌ unbounded | ❌ | ❌ |
| **R2 (file storage)** | — | ❌ none observed | — | — | — | ❌ |
| **Shipping provider** | — | **not integrated** | — | — | — | — |
| **Email** | — | **no sender exists** | — | — | — | — |
| **WebSocket broadcast** | — | ❌ none; failure is swallowed | — | — | — | — |
| **Database** | statement timeout via `SLOW_QUERY_MS` logging | n/a | — | — | — | ❌ |

**Finding:** there is **no infinite retry loop** — which is good — but there is also
**no retry budget and no dead letter** anywhere. A webhook that fails every time
returns 500 forever; the only trace is a log line. The 056 columns
(`attempt_count`, `next_retry_at`, `last_error`) exist and are unwritten.

---

## 5. Concurrency audit — the §13 race, answered from real code

**The simulated race (stock = 1, customer A and customer B check out):**

| Layer | What actually happens |
|---|---|
| Non-variant product | `reserveInventoryStock` issues **one** statement: `UPDATE inventory SET reserved = reserved + $1 … WHERE product_id = $2 AND quantity - reserved >= $1`. Validation and mutation are the same atomic operation, so PostgreSQL's row lock serialises A and B. **Exactly one succeeds**; the other affects 0 rows and the caller raises `INSUFFICIENT_STOCK` |
| Variant product | `cart.ts:1003` issues `UPDATE product_variants SET stock = stock - $1 … WHERE id = $2 AND stock >= $1`. **Exactly one succeeds**; 0 rows → `INSUFFICIENT_STOCK` |
| Purchase-level | `lib/order-lock.ts` locks one order at a time, and `PAYMENT_SETTLED_STATUSES = ["paid", "processing"]` |

**This is a genuine guarantee, not a test claim.** It is enforced by the SQL
predicate, so it holds under any interleaving the database allows — not merely
under the interleavings the tests happen to exercise. `db:verify` and the suite
both pass, but the guarantee does not depend on them.

**Verified counterpoint:** the guarantee is per-statement. Nothing prevents a
seller's absolute-set write (`products.ts:1487`) from lowering `quantity` below
`reserved` — see `FINAL_GAP_REPORT.md` P1-1.

---

## 6. Consistency classification (§30)

| Operation | Required | Velnox uses | Correct? |
|---|---|---|---|
| Payment amount / settlement | **Strong** | one DB transaction + provider webhook authority | ✅ |
| Inventory reservation | **Strong** | single guarded atomic UPDATE inside the checkout transaction | ✅ |
| Inventory commit on settlement | **Strong** | same transaction as settlement | ✅ |
| Refunded total | **Strong** | recomputed `SUM` inside the sync transaction | ✅ |
| Order creation | **Strong** | one transaction across group + orders + lines + stock | ✅ |
| Offline stock edit | **Strong** | direct UPDATE | ⚠️ correct model, but now DB-rejected when it would break `reserved + committed <= quantity` with no handled error |
| Seller-order list / UI badge | **Eventual** | eventual | ✅ |
| Realtime notification | **Eventual** | eventual (broadcast after commit) | ✅ correct model |
| Webhook processing | **Strong** | claimed + transactional | ✅ |

**No mis-placed consistency model was found.** The only concern is the offline
stock edit, which is a *handling* gap, not a model error.

---

## 7. Scale / performance notes (§29)

| Item | Observation |
|---|---|
| Pagination | ✅ seller order list bounded (`pageSize` ≤ 100). |
| Correlated subqueries | ⚠️ `seller-orders.ts:197` and `:353` select a per-row image and latest shipment status. These are subqueries inside one statement, not N+1 round trips — but they are per-row work on an unpaginated inner set. |
| Unbounded admin lists | ⚠️ not verified in this pass; `center.ts` was not profiled. Recorded as unverified, not as a finding. |
| Webhook throughput | ⚠️ a processing failure returns 500 by design; under a Stripe retry storm this re-processes the same event id, which the claim table makes a no-op. Acceptable. |
| Transaction duration | ⚠️ the checkout transaction holds row locks on `inventory` while creating orders. Correct for correctness; the duration is bounded by a single request. |
| Rate limiting | **CORRECTION — present and documented.** `backend/middleware/rate-limit.ts`, wired at `server.ts:96`: per-route-class limits, IP-keyed for auth and public reads, user-keyed for money/order/upload/chat, `429 RATE_LIMITED` + `Retry-After`, bucket sweep and a `MAX_BUCKETS` guard. An earlier draft of this audit recorded this as absent; that draft was wrong and is corrected here rather than turned into a recommendation. CSRF is likewise defended via `middleware/origin-guard.ts`. |

**This audit did not run a load test and did not measure query timings.** No
performance number is claimed. The observations above are structural.

---

## 8. Cross-cutting scores (§35)

Scale: `0` absent · `1` prototype · `2` functional · `3` production foundation ·
`4` production strong · `5` mature marketplace.

| Domain | Score | Why not higher |
|---|---|---|
| Checkout | **3** | server-authoritative, idempotent, atomic; no quote expiry |
| Payment | **3** | provider-authoritative + verified webhook, but no attempt layer, no reconciliation |
| Order | **2** | correct commerce data; one column carries three lifecycles |
| Inventory | **3** | race genuinely closed + DB invariants; no movement journal, no `committed` |
| Fulfillment | **2** | real machine in code only; stored in the shared status column |
| Shipping | **1** | shipment row exists; transit unreachable; create is non-idempotent |
| Returns | **1** | table + vocabulary exist; zero runtime |
| Refunds | **3** | full/partial correct, DB-enforced bounds; no reconciler |
| Marketplace | **2** | real per-seller orders and ownership; no payable, no fee booking |
| Settlement | **0** | zero writers on every money table |
| Webhook | **4** | raw-body HMAC, claim, 500-on-failure, replay-safe |
| Events | **1** | broadcast works; no durable record, no outbox |
| Reconciliation | **1** | tables exist; no runner |
| Security | **4** | httpOnly JWT + per-route ownership + documented route-class rate limiting + Origin-guard CSRF + a fail-closed test-DB guard; only the missing correlation id keeps it off 5 |
| Observability | **2** | SQLSTATE logging; no correlation id, so cross-domain incidents cannot be traced |
| Scalability | **3** | pagination on the hot seller list and rate limiting at the edge; listed queries are unprofiled |
| **Overall (mean)** | **2.2 / 5** (35/16) | **"functional, with a production-shaped schema and a partially production-hardened runtime"** |
