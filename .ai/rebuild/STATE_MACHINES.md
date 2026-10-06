# STATE_MACHINES.md — the four independent lifecycles

> **One axis per machine. No combined state.** A value that answers two
> questions at once (the current `orders.status`) is the defect this rebuild
> removes, not a shortcut it re-uses.
>
> Enforcement: the **DB CHECK** constrains the vocabulary (the column cannot hold
> an invented value); the **transition table in code** constrains the graph (which
> move is legal from where); the **transaction + row lock** makes the move atomic;
> `outbox_events` records that it happened.

---

## 1. PAYMENT — `payments.status` (EXTENDED vocabulary)

```
                    ┌─────────────┐
                    │   UNPAID    │  (a payment row exists, nothing requested)
                    └──────┬──────┘
                           │ create attempt / open session
                           ▼
                    ┌─────────────┐
              ┌─────│   PENDING   │─────┐           requires_action from the provider
              │     └──────┬──────┘     │           (3DS / PromptPay QR) is recorded on the
              │            │            │           payment row as REQUIRES_ACTION — it is a
              │            │            │           *sub-state of pending* for the customer and a
              │            │            │           real attempt status in payment_attempts.
              │            │            │
     expire/  │            │ provider   │  provider
     cancel   │            │ authorised │  failed
              │            ▼            ▼
              │     ┌─────────────┐  ┌─────────────┐
              │     │ AUTHORIZED  │  │   FAILED    │
              │     └──────┬──────┘  └─────────────┘  (terminal for THIS attempt;
              │            │ capture                   the payment may take a new attempt)
              │            ▼
              │     ┌─────────────┐
              │     │ PROCESSING  │  (delayed notification: PromptPay / async)
              │     └──────┬──────┘
              │            │ provider confirms
              │            ▼
              │     ┌─────────────┐
              └────>│    PAID     │  ← the ONLY value the webhook may write
                    └──────┬──────┘
                           │ refund
                 ┌─────────┴──────────┐
                 ▼                    ▼
          ┌──────────────────┐  ┌─────────────┐
          │ PARTIALLY_REFUNDED│ │  REFUNDED   │
          └────────┬─────────┘  └─────────────┘
                   │ further refunds → REFUNDED (when the sum reaches the captured amount)

          ┌─────────────┐
          │  EXPIRED    │  the session/window lapsed with no captured money (terminal)
          └─────────────┘
```

**Rules**
* `P1` Only a signature-verified provider event may write `PAID`. Never a
  redirect, never a client field, never a job.
* `P2` `PAID` is **sticky** in the forwards direction only: no event may move a
  paid payment back to `pending`/`failed`/`expired` (out-of-order guard).
* `P3` `FAILED` / `EXPIRED` are terminal for an *attempt*; the payment may open a
  new attempt, which returns it to `PENDING` with a NEW attempt row (the attempt
  history is what makes this expressible — today a retry silently overwrites the
  row's meaning).
* `P4` `PARTIALLY_REFUNDED` / `REFUNDED` are derived from the sum of succeeded
  refunds against the captured amount, and written by the refund sync — never
  guessed.
* `P5` a refund never exceeds the captured amount.

---

## 2. ORDER — `orders.order_state` (NEW)

```
   PENDING ──confirm──> CONFIRMED ──start work──> PROCESSING ──finish──> COMPLETED
      │                     │                          │
      └──────cancel─────────┴──────cancel──────────────┘        (terminal: COMPLETED, CANCELLED)
                    │
                 CANCELLED
```

| Value | Meaning | Who moves it | Allowed entries |
|---|---|---|---|
| `PENDING` | created; nothing accepted; the seller has not acted | order creation | — |
| `CONFIRMED` | the seller accepted the order | seller/center, **only with a settled payment** | `PENDING` |
| `PROCESSING` | fulfilment has begun | seller (`fulfillment_status` entering `picking`) | `CONFIRMED` |
| `COMPLETED` | the order ended successfully | seller/center on delivery | `PROCESSING` |
| `CANCELLED` | terminal | customer (pre-payment), seller/center (**never after a settled payment**) | `PENDING`, `CONFIRMED` |

**Rules**
* `O1` payment is **not** an order state. "Paid" is read from the payment axis.
* `O2` `CONFIRMED` requires a settled payment, evaluated **under the order row
  lock** (the existing `assertPaymentConfirmedForConfirmation`, now against the
  attempt-aware covering set).
* `O3` a settled payment blocks every cancellation (`ORDER_ALREADY_PAID` /
  `PAYMENT_IN_PROGRESS`) — the money path is a refund, never a status change.
* `O4` `COMPLETED` and `CANCELLED` are terminal; a late or duplicated request is
  an idempotent no-op (200), never a resurrection.
* `O5` **`PROCESSING` is entered by the same guarded transition that moves
  `fulfillment_status` out of `ready`**, so the two axes cannot disagree.

---

## 3. FULFILLMENT — `orders.fulfillment_status` + `fulfillment_orders.status` (NEW)

```
  UNFULFILLED ──ready──> READY ──start picking──> PICKING ──pack──> PACKING
                                                                      │
                                                            label/ready to hand over
                                                                      ▼
                                                                READY_TO_SHIP
                                                                      │ carrier accepts
                                                                      ▼
                                                                  SHIPPED
                                                                      │ delivered scan
                                                                      ▼
                                                                 DELIVERED
                                                                      │
                                                                 (order -> COMPLETED)

  any active state ──warehouse failure──> FAILED      (operator remediation: retry or refund)
  any state before READY_TO_SHIP ──cancel──> CANCELLED
```

| Value | Meaning |
|---|---|
| `UNFULFILLED` | created (at settlement); nothing started |
| `READY` | the seller accepted the work and can start |
| `PICKING` | picking items |
| `PACKING` | packing |
| `READY_TO_SHIP` | packed, awaiting carrier |
| `SHIPPED` | handed to the carrier — **requires** `shipments` row with carrier + tracking |
| `DELIVERED` | carrier confirmed delivery |
| `FAILED` | the warehouse could not complete it |
| `CANCELLED` | terminal, only before `READY_TO_SHIP` |

**Rules**
* `F1` created **inside the settlement transaction** (a fulfillment order exists
  only for a payable order). Today there is no such row at all.
* `F2` `SHIPPED` requires a real shipment with carrier + tracking (existing rule,
  kept) **and** `shipment_items` that account for the quantities carried.
* `F3` every move writes `outbox_events` (`FulfillmentCreated`,
  `FulfillmentStarted`, `ShipmentShipped`, …) in the same transaction.
* `F4` partial fulfilment is expressed by shipping a **subset** of the items: the
  fulfillment order stays active until every item is fulfilled, then becomes
  `SHIPPED` → `DELIVERED`. Multiple shipments per fulfillment order are legal.

---

## 4. SHIPMENT — `shipments.status` (+ CHECK, currently free TEXT)

```
  CREATED ──carrier pickup──> PICKED_UP ──> IN_TRANSIT ──> OUT_FOR_DELIVERY ──> DELIVERED
      │                                                                              
      ├──> RETURNED   (returned to sender — pairs with the return/refund flow)
      └──> LOST       (carrier declares lost — pairs with a reship or a refund)
```

**Rules**
* `S1` `CREATED` is written only by shipment creation, which is **idempotent by
  claim** (guarded UPDATE on `order_items.fulfilled_quantity`), so two concurrent
  ship requests cannot create two shipments for the same units.
* `S2` a transit event appends a `tracking_events` row; the shipment's status is
  the fold of its own events (one writer).
* `S3` `LOST`/`RETURNED` never silently change the order axis: they append an
  incident and leave the remediation (reship or refund) to an explicit action.
* `S4` `DELIVERED` moves the fulfillment order to `DELIVERED` and the order to
  `COMPLETED` in the same transaction.

---

## 5. `orders.status` — the legacy projection (kept, derived, never an input)

Four deployed frontends and the seller/center dashboards read `orders.status`
today. Breaking them would violate §40 (do not break the existing product) for no
architectural gain, so the column stays and becomes a **pure function** of the
two real axes plus the payment axis:

```
projectOrderStatus(order_state, fulfillment_status, payment_state):
  payment_state = REFUNDED          → 'refunded'
  order_state   = CANCELLED         → 'cancelled'
  payment_state = EXPIRED           → 'expired'
  payment_state = FAILED            → 'payment_failed'
  fulfillment   = SHIPPED           → 'shipped'
  fulfillment   = DELIVERED         → 'delivered'
  order_state   = COMPLETED         → 'completed'
  fulfillment   = PICKING|PACKING   → 'packing'
  order_state   = CONFIRMED         → 'confirmed'
  payment_state = PENDING           → 'pending_payment'
  payment_state = PAID              → 'paid'
  otherwise                         → 'pending'
```

* `L1` **exactly one** function writes `orders.status`, called only from the
  order/fulfillment/payment transition functions, inside the same transaction.
  No route writes it.
* `L2` the mapper is total: every (order_state, fulfillment_status, payment_state)
  combination maps to a value already allowed by `orders_status_check`, so the
  existing CHECK is **not** loosened or tightened (no risk to existing rows).
* `L3` the legacy values remain readable for historical rows and are **backfilled**
  by the migration (state columns derived from the legacy value, never the other
  way round).
* `L4` new code reads the domain columns. `orders.status` is for display and for
  the not-yet-migrated frontends; a new read of it in backend logic is a review
  failure.

---

## 6. Cancellation — an explicit orchestration, not a status write

```
                     Cancel requested (customer | seller | center)
                                    │
                     ┌──────────────▼───────────────┐
                     │ 1. LOCK the order row(s)      │  (group: all members, id ASC)
                     └──────────────┬───────────────┘
                                    ▼
                     ┌──────────────────────────────┐
                     │ 2. EVALUATE PAYMENT          │  covering-set read under the lock
                     └──────────────┬───────────────┘
              paid/processing ─────┤
                     → 409 ORDER_ALREADY_PAID / PAYMENT_IN_PROGRESS  (a refund is the path)
                                    │ unpaid
                                    ▼
                     ┌──────────────────────────────┐
                     │ 3. EVALUATE FULFILLMENT      │
                     └──────────────┬───────────────┘
              picking or beyond ───┤
                     → 409 ORDER_NOT_CANCELLABLE  (the return/refund flow is the path)
                                    │ before picking
                                    ▼
                     ┌──────────────────────────────┐
                     │ 4. CLOSE the payment attempt │  provider session voided/cancelled
                     └──────────────┬───────────────┘
                                    ▼
                     ┌──────────────────────────────┐
                     │ 5. RELEASE INVENTORY         │  releaseOrderInventory() — exactly once
                     └──────────────┬───────────────┘
                                    ▼
                     ┌──────────────────────────────┐
                     │ 6. CREATE REFUND IF REQUIRED │  only if captured money exists
                     └──────────────┬───────────────┘   (routed through the refund domain op)
                                    ▼
                     ┌──────────────────────────────┐
                     │ 7. UPDATE ORDER              │  order_state=CANCELLED,
                     │    + outbox                  │  fulfillment_status=CANCELLED,
                     └──────────────────────────────┘  OrderCancelled event
```

`C1` steps 2–7 are **one transaction** where the provider allows it; the provider
call (step 4/6) is the only external leg and it is wrapped in an attempt row so a
timeout leaves a recoverable record rather than an unknown.
`C2` releasing stock is **never** implied by cancelling; it is step 5, and it is
the same function every other path uses.
`C3` a refund is **never** implied by cancelling; it is step 6 and it is skipped
when nothing was captured.
`C4` the whole orchestration writes one audit record (`outbox_events`
`OrderCancelled` + `ledger_entries` if money moved + `payment_incidents` if an
operator decision is needed).

---

## 7. Cross-machine legality table (what may happen at the same time)

| Payment | Order | Fulfillment | Legal? |
|---|---|---|---|
| `PENDING` | `PENDING` | `UNFULFILLED` | yes — the normal pre-payment state |
| `PENDING` | `CANCELLED` | `CANCELLED` | yes — cancelled before payment; stock released; session closed |
| `FAILED`/`EXPIRED` | `PENDING` | `UNFULFILLED` | yes — retry is allowed (new attempt) |
| `FAILED`/`EXPIRED` | `CANCELLED` | `UNFULFILLED` | yes — nothing left to fulfil |
| `PAID` | `PENDING` | `UNFULFILLED` | yes — paid, seller has not accepted yet |
| `PAID` | `CONFIRMED`/`PROCESSING` | `READY`…`READY_TO_SHIP` | yes — the fulfilment window |
| `PAID` | `PROCESSING` | `SHIPPED`/`DELIVERED` | yes |
| `PAID` | `COMPLETED` | `DELIVERED` | yes — the happy terminal |
| `PAID` | `CANCELLED` | `CANCELLED` | **NO** — a settled payment is a refund, never a cancel |
| `REFUNDED` | `CANCELLED`/`COMPLETED` | any | yes — refund is orthogonal to fulfilment |
| `PARTIALLY_REFUNDED` | `PROCESSING` | `PACKING` | yes |
| `PENDING` | `CONFIRMED` | `READY` | **NO** — `CONFIRMED` requires a settled payment |

---

## 8. Where each machine is enforced (target)

| Machine | Vocabulary | Graph | Atomicity | Evidence |
|---|---|---|---|---|
| Payment | `payments_status_check` (extended) | transition table + out-of-order guards | order-row lock + payment-row lock, attempt claim | `payment_attempts`, `ledger_entries`, `payment_events` |
| Order | `orders_order_state_check` | `lib/order-state.ts` | `SELECT … FOR UPDATE` on `orders` | `outbox_events`, audit |
| Fulfillment | `orders_fulfillment_status_check` + `fulfillment_orders_status_check` | `lib/order-fulfillment.ts` | order-row lock, `fulfilled_quantity` claim | `shipment_items`, `tracking_events` |
| Shipment | `shipments_status_check` | `lib/shipment.ts` | `fulfilled_quantity` claim | `tracking_events` |
| Legacy projection | `orders_status_check` (unchanged) | `projectOrderStatus()` | same transaction as the axes | — |
