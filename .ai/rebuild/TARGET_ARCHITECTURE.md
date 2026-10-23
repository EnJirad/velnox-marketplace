# TARGET_ARCHITECTURE.md — the Velnox commerce core we are building toward

> **Decisions here are final.** Each is justified by production practice
> (`PRODUCTION_COMMERCE_RESEARCH.md`) and by what the repository already
> contains. Where the repository already implements a principle correctly, the
> target **keeps it and names it as the authority** rather than writing a second
> system (rule 11: no duplicate tables, APIs or components).
>
> No implementation may begin before the phase plan in `MIGRATION_PLAN.md` and
> the constraints in `FINISH`-gate `FINAL_VERIFICATION.md` are in place.

---

## 1. Layer model

```
                 ┌─────────────────────────── Neon PostgreSQL ───────────────────────────┐
                 │  THE ONLY SOURCE OF TRUTH for order / payment / money / inventory /   │
                 │  fulfillment / refund / settlement / events                           │
                 └───────────────────────────────────────────────────────────────────────┘
   FRONTENDS (Vercel, 4 apps)      BACKEND (Render, Express + WS)              PROVIDERS
   ────────────────────────        ───────────────────────────────            ──────────
   render only                     · validate → authenticate → authorize      · Stripe (test)
   derive every label from         · ownership from the DB, never the body      Checkout Session,
   backend domain state            · compute every figure server-side           PaymentIntent,
   never decide money/state        · one transaction per state change           Refund, Webhooks
   never hold a secret             · one writer per column                    · R2 (objects)
        │                          · outbox for every published event
        │  REST /api/*             · idempotent by DB constraint
        └──────────────────────────┤ · correlation id on every row and log
                                   └─────────────────┬──────────
                                                     │ consumers (not authorities)
                                     WebSocket channels · scheduler jobs · admin tools
```

**Hard line (§20).** Realtime carries *signals*; Neon carries *facts*. A
WebSocket message may cause a refetch and never a state write. No device, no
browser, no cache and no second database may ever be the authority for an order,
a payment, a financial record or a unit of stock.

---

## 2. Domain separation (the aggregate map)

```
Customer ──owns──> Cart ──checked out as──> Purchase ──┬──> SellerOrder A ──> FulfillmentOrder ──> Shipment
                                                       ├──> SellerOrder B ──> FulfillmentOrder ──> Shipment
                                                       └──> Payment (may cover the whole Purchase)
                                                                  │
                                                             LedgerEntries ──> SellerPayable ──> Settlement
```

| # | Aggregate | Table | Identity / cardinality | Owns |
|---|---|---|---|---|
| 1 | Customer | `users`, `customer_profiles`, `addresses` | 1 user | identity, addresses |
| 2 | Cart | `carts`, `cart_items` | 1 per user | uncommitted intent; prices are display snapshots |
| 3 | **Purchase** | `checkout_groups` | 1 per checkout | currency, server-computed totals, item/shop counts |
| 4 | **SellerOrder** | `orders` (+ `orders.order_state`) | N per purchase, **one per shop** | its own money snapshot, its own status axis, `shop_id` |
| 5 | OrderItem | `order_items` | N per order | the immutable commercial line (snapshot + variant + price) |
| 6 | **Payment** | `payments` | 1..N per purchase or per order | amount, method, provider refs, refunded amount |
| 7 | **PaymentAttempt** | `payment_attempts` (new) | N per payment | one provider interaction: session/intent, status, idempotency key |
| 8 | **FulfillmentOrder** | `fulfillment_orders` (new) | 1..N per order (per location) | the work to do; its own status |
| 9 | **Shipment** | `shipments` (+ `shipment_items`) | 1..N per fulfillment order | carrier, tracking, transit status, which units |
| 10 | Refund | `refunds` | N per payment | amount, provider ref, status |
| 11 | Return | `order_returns` (new) | N per order | requested/approved/received units |
| 12 | InventoryLevel | `inventory` (extended) | 1 per (product × optional variant) | on_hand/reserved/committed/fulfilled/returned |
| 13 | InventoryMovement | `inventory_movements` (new) | N per inventory level | the audited *why* |
| 14 | LedgerEntry | `ledger_entries` (new) | append-only | charge/refund/fee/payable/settlement |
| 15 | Settlement | `settlements` (extended) | N per seller per period | payout of what the ledger says is payable |
| 16 | DomainEvent | `outbox_events` (new) | N per state change | event_id, aggregate, type, payload, delivery state |
| 17 | ProviderEvent | `payment_events` (extended) | 1 per provider event id | durable webhook record + retry state |
| 18 | ReconciliationRun/Finding | `reconciliation_runs`, `reconciliation_findings` (new) | N | drift detection with an owner |

**Deliberately NOT introduced:** a `purchases` table (would duplicate
`checkout_groups`), a `seller_orders` table (would duplicate `orders`, which is
already one-per-shop), a second inventory table, a second payment table, a
message broker (the outbox is the broker until a real need exists).

---

## 3. Ownership: who may write what

| Column / table | The ONE writer |
|---|---|
| `orders.order_state` | order-domain transitions (`lib/order-state.ts`) |
| `orders.fulfillment_status` | fulfillment-domain transitions (`lib/order-fulfillment.ts`) |
| `orders.status` | **derived projection** — `projectOrderStatus()`, called only by the two above during the same transaction. No route may write it. |
| `orders.inventory_released` | `releaseOrderInventory()` (guarded claim) |
| `payments.status` | settlement/failure/refund paths in `routes/stripe.ts` + the refund sync |
| `payment_attempts.status` | `lib/payment-attempt-lifecycle.ts` |
| `refunds.*` | the refund service (`lib/refunds.ts`) — webhook-confirmed |
| `inventory.*` | `lib/inventory.ts` only (reserve/commit/release/adjust/return) |
| `inventory_movements` | written by `lib/inventory.ts` in the same transaction as its mutation |
| `fulfillment_orders.*` | `lib/order-fulfillment.ts` |
| `shipments.*` | `lib/shipment.ts` |
| `ledger_entries` | `lib/ledger.ts`, append-only, same transaction as the triggering state change |
| `outbox_events` | `lib/outbox.ts` `enqueue(client, …)`, same transaction |
| `payment_events` | the webhook route (claim) + the retry worker (state) |

A second writer for any row above is a defect, not a style choice.

---

## 4. Money model

* Storage: `NUMERIC(12,2)` for order/refund/payment amounts (unchanged);
  `amount_minor BIGINT` in the ledger so no decimal ever rounds twice.
* Currency: one currency per purchase (`checkout_groups.currency`), enforced by
  a DB CHECK that every member order matches.
* Arithmetic: one module (`lib/money.ts`); no float, no `+` on strings, no
  `toFixed()` on a computed total before it is stored.
* **The ledger is the financial record.** `SUM(ledger_entries)` per seller must
  equal what the platform owes; a settlement pays a subset of it and records
  which entries it paid.
* Commission: ONE rate resolved from ONE place (`shop_settings.commissionRate`
  → platform default), snapshotted on the ledger entry. The three disagreeing
  rates in code today (`0.03`, `0.05`, `0`) collapse into that one resolution.

---

## 5. The transaction contract

Every state change happens in **one** transaction that also writes:

1. the state row(s),
2. the `inventory_movements` row(s) if stock moved,
3. the `ledger_entries` row(s) if money moved,
4. the `outbox_events` row(s) for the lifecycle event,

and commits once. The publish step (WebSocket, notifications, derived reads)
consumes the outbox **after** commit and is allowed to fail — a failed publish
leaves an outbox row with `attempt_count + 1` and `next_retry_at`, never a
missing event.

Lock order (**global, documented, one order**):

```
checkout_groups (if the change spans a purchase)
  → orders          ORDER BY id ASC
  → payments        ORDER BY id ASC
  → refunds         ORDER BY id ASC
  → inventory       ORDER BY id ASC
  → fulfillment_orders
  → shipments
```

`lib/order-lock.ts` already mandates "the ORDER row is locked FIRST" for the
single-order case and `lockCheckoutGroupOrderRows` locks members `id ASC` for the
group case; the target extends the same discipline to the new tables and pins it
with `FOR UPDATE NOWAIT` probes.

---

## 6. Failure model

| Failure | Target behaviour |
|---|---|
| provider timeouts | attempt row → `failed`/`expired` with provider error code; bounded retries with `next_retry_at`; reconciliation finds the divergence |
| webhook duplicate | `payment_events` claim replays nothing; 200 `{duplicate:true}` |
| webhook retry after failure | re-armed claim, `attempt_count + 1`, reprocessed |
| webhook out of order | monotonic guards: a `processing` payment never becomes `pending`; a `paid` payment never becomes `failed`; an `expired` order never becomes paid; late money becomes an **incident**, never a silent state |
| concurrent checkout for the last unit | guarded `UPDATE … WHERE available >= qty`; the loser gets `INVENTORY_UNAVAILABLE` (409) and its whole transaction rolls back |
| DB failure mid-transaction | nothing was written; the client retries with the same idempotency key and gets one order, not two |
| process crash mid-webhook | `payment_events.status='processing'` + `next_retry_at` lets a worker pick it up; provider redelivery is also safe |
| refund > captured | refused before the provider call, and bounded by the DB invariant |
| fulfillment failure (lost parcel) | `fulfillment_status='failed'` + shipment `lost`; the remediation (reship or refund) is an explicit operator action |

---

## 7. Observability contract

* A `request_id` is assigned by middleware when the client does not supply
  `X-Request-Id`; it is echoed in the response header and attached to every log
  line of that request.
* Every domain write records `correlation_id` = that request id (or, for
  webhooks and jobs, the provider event id / job run id).
* A trace for one customer complaint is therefore one query:
  `SELECT * FROM ledger_entries WHERE correlation_id = $1` plus
  `inventory_movements`, `outbox_events`, `payment_events`.
* No secret, token, cookie, signature or payload body is ever logged.

---

## 8. What the target explicitly refuses

1. A second source of truth for order/payment/money/inventory.
2. A combined status column, or a new status value that merges axes.
3. `SELECT`-then-`INSERT` as an idempotency mechanism.
4. A client-supplied amount, seller, price, stock figure, payment status or
   order status — for any reason, including "performance" or "offline".
5. Inventing a refund, an order, an inventory movement or a provider event to
   make a flow appear to succeed.
6. Deleting or rewriting a financial row; corrections are new ledger entries.
7. Unbounded retry; a retry without `attempt_count`/`next_retry_at`/`last_error`.
8. Applying a migration that alters or drops existing business data without a
   documented, tested mapping and a rollback story (`MIGRATION_PLAN.md`).
