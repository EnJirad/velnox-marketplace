# FULFILLMENT_ARCHITECTURE.md — work units, shipments, transit, returns

> Today fulfillment is a status string on `orders` (`packing|shipped|delivered`)
> plus a flat `shipments` row per order. The rebuild introduces the missing
> entity (§6): a **FulfillmentOrder** — the unit of work — with **ShipmentItems**
> so partial and split fulfilment are expressible.

---

## 1. The chain

```
Purchase
  └── SellerOrder (orders)                     one per shop
        └── FulfillmentOrder (NEW)             the WORK: one per order per location
              ├── Shipment 1 (shipments)       carrier handoff #1 — partial
              │     └── ShipmentItem × n       exactly which order_items and how many
              └── Shipment 2 …                 a second parcel, a reshipment, a split
```

**Why a work unit at all.** Without it, "the parcel is lost" and "we cannot find
the item in the warehouse" are the same record, so the correct remediation cannot
be chosen; "2 of 3 units shipped" cannot be represented; and a reshipment after a
loss has nowhere to live. The fulfillment order is the smallest change that makes
those three first-class.

**Cardinality today:** exactly one fulfillment order per order (`location='default'`),
created inside the settlement transaction. The `(order_id, location)` uniqueness is
what leaves room for multi-warehouse later without a schema change.

---

## 2. Creation rules

| Trigger | Result |
|---|---|
| payment settled (webhook) | `fulfillment_orders` row created **in the settlement transaction**, `status='unfulfilled'`; `outbox_events` `FulfillmentCreated` |
| COD order created (rail disabled today) | created at order creation, `unfulfilled` — no payment settles online |
| payment refunded before fulfilment | fulfillment order → `cancelled`; no shipment is allowed afterwards |
| order cancelled | fulfillment order → `cancelled` |
| backfill | one row per existing order whose state is paid or further; `status` derived from `orders.fulfillment_status` |

`I-FO1` a fulfillment order never exists for an order with no captured money and
no COD rail.
`I-FO2` exactly one active (`unfulfilled…ready_to_ship`) fulfillment order per
order per location.

---

## 3. Shipment creation — partial by construction

```
Seller picks "ship" (optionally a subset of items/quantities)
  │
  ├─ 1. lock orders row; resolve fulfillment order (must be active)
  ├─ 2. for EACH (order_item, quantity):
  │        UPDATE order_items
  │           SET fulfilled_quantity = fulfilled_quantity + $q
  │         WHERE id = $item AND fulfilled_quantity + $q <= quantity
  │        RETURNING id            ← the claim: 0 rows = the request over-ships, refused
  ├─ 3. INSERT shipments (fulfillment_order_id, carrier, tracking_number, status='created')
  ├─ 4. INSERT shipment_items (shipment_id, order_item_id, quantity) for the claimed rows
  ├─ 5. if every order_item is fully fulfilled → order.fulfillment_status='shipped'
  │      else                        → fulfillment order stays active (partial), status 'ready_to_ship'
  ├─ 6. inventory movement 'fulfil' per item (committed −q, fulfilled +q, on_hand −q)
  ├─ 7. ledger: no money moves here
  └─ 8. outbox: ShipmentCreated (+ ShipmentShipped when fully shipped)
```

Single transaction. The guarded `UPDATE order_items` in step 2 **is** the
idempotency mechanism (§A14: today's `SELECT … LIMIT 1` then `INSERT` can create
two shipments for one order). A repeated request over-ships nothing and is
refused with `409 FULFILLMENT_ERROR` — never a silent duplicate.

**Carrier and tracking** remain mandatory before an order may be marked shipped
(the existing rule, kept). A carrier **API** integration is out of scope: booking
with a carrier is an operator/seller action, and no fake booking call is created.

---

## 4. Transit (Shipment status)

| Transition | Written by | Note |
|---|---|---|
| `created` → `picked_up` | seller/center or a carrier webhook (future) | appends `tracking_events` |
| `picked_up` → `in_transit` → `out_for_delivery` | same | each appends an event |
| → `delivered` | same | fulfillment order → `delivered`; order → `COMPLETED`; `fulfil` movement if not already applied |
| → `returned` | operator/carrier | pairs with `order_returns`; refund is an explicit refund-domain action |
| → `lost` | operator/carrier | writes an incident; the remediation (reship or refund) is explicit |

`tracking_events` stays the breadcrumb table; the shipment's status is the
**fold** of its own events through the transition table, so a duplicated or late
event cannot move it backwards (monotonic guard, same principle as the payment
axis).

---

## 5. Returns (new, §15 "refund after return")

```
customer requests  → order_returns(status='requested')            + outbox ReturnRequested
seller/center decides → 'approved' | 'rejected'
customer ships      → 'in_transit'
seller receives     → 'received'   (+ restocked_quantity)
restock             → 'restocked'  → inventory movement 'return'
close               → 'completed'  → refund-domain action if money is owed
```

* A return **never refunds automatically**: it records the physical fact. The
  refund is a separate, authorized operation whose amount is computed from the
  refundable amount (§PAYMENT §6).
* A return **never releases stock**: the units were already `fulfilled`; a
  restock is an explicit `return` + `adjust` movement.
* Return window, reason codes and auto-approval thresholds are **policy**, not
  architecture; the rebuild ships the entity, the transitions and the audit trail,
  and leaves the policy to the owner.

---

## 6. Failure handling (§36)

| Failure | Behaviour |
|---|---|
| warehouse cannot fulfil (`FAILED`) | `fulfillment_orders.status='failed'` + `failure_code`; order state unchanged; incident raised; operator chooses reship or refund |
| parcel lost | shipment `lost` + incident; fulfillment order stays active for a **reship** (a new shipment against the same work) |
| shipment never picked up | status stays `created`; the fulfillment reconciler flags it after N hours |
| two concurrent ship requests | the `order_items.fulfilled_quantity` claim serialises them; one wins, the other is refused (no duplicate shipment) |
| partial fulfilment | legal and expected: the work stays open until every item is fulfilled |
| customer cancels after shipping | refused (`ORDER_NOT_CANCELLABLE`) — the return flow is the path |

---

## 7. Fulfillment reconciliation (§23)

| Check | Expected | Observed |
|---|---|---|
| order ↔ work unit | every paid order has exactly one active-or-completed fulfillment order | `fulfillment_orders` |
| work unit ↔ shipments | `shipped` implies ≥1 shipment with carrier + tracking | `shipments` |
| quantity accounting | `Σ shipment_items.quantity` per item = `order_items.fulfilled_quantity` | both |
| no over-ship | `fulfilled_quantity ≤ quantity` on every item | `order_items` |
| stuck work | active work older than the SLA | `fulfillment_orders.updated_at` |
| lost/returned without resolution | shipments in `lost`/`returned` with no return record or refund | `shipments` + `order_returns` + `refunds` |

Findings only. A reconciler never ships, refunds or cancels anything.

---

## 8. What the seller and the customer see (derived, never invented)

* **Seller** (VelSeller): New Order → Paid → Ready to Process → Picking → Packing
  → Ready to Ship → Shipped → Delivered → Cancelled / Return Requested / Refunded.
  Every item on that list is a **pair** of (order axis, fulfillment axis) values
  read from the backend; the seller route returns them and the UI renders them.
  A button is offered only for a legal transition, and the server refuses anyway.
* **Customer** (VelShop): "รอชำระเงิน / ชำระเงินแล้ว / กำลังเตรียมสินค้า / กำลังแพ็ก
  / จัดส่งแล้ว / กำลังนำจ่าย / จัดส่งสำเร็จ / ยกเลิก / คืนเงิน" — the same
  derivation. §31's rule holds: the frontend **derives** and never decides; no
  client may compute an expiry, a payment outcome or an order state.
* **Admin** (VelCenter): order, payment, webhook, inventory, fulfillment, refund,
  reconciliation and incident inspection — each screen reading the tables named in
  `DOMAIN_MODEL.md`, each with the audit trail (who, when, why).
