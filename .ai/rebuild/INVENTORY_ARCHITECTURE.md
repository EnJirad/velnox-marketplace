# INVENTORY_ARCHITECTURE.md — one authority, six axes, audited movements

> Replaces two independent stock models (`inventory.quantity/reserved` per product
> and `product_variants.stock` per variant) with **one** table and **one** writer.
> Nothing here is a new duplicate: `inventory` is extended in place, and
> `product_variants.stock` is kept as a **derived projection** so the existing
> storefront reads keep working.

---

## 1. The six quantities (§11)

| Quantity | Meaning | Stored? |
|---|---|---|
| `on_hand` | physical units under the seller's control, **including** units sold but not yet shipped | **stored** (was `quantity`) |
| `reserved` | held by an open order that has not settled | **stored** |
| `committed` | **NEW** — paid, not yet handed to a carrier | **stored** |
| `fulfilled` | **NEW** — handed over / delivered | **stored** |
| `returned` | **NEW** — units returned (counter) | **stored** |
| `available` | what a NEW order may take | **DERIVED, never stored** |

```
available = on_hand − reserved − committed
```

**Why `available` is derived, not stored.** A stored `available` is a second copy
of the other three, and the three change in different transactions; any code path
that forgets to update it produces a silent oversell. A derived value cannot
drift.

**Why `committed` is subtracted.** Once money settled, those units are no longer
sellable even though they are physically present. Today the commit decrements
`on_hand` immediately, which produces the same availability number but loses the
distinction between "sold, not shipped" and "gone". The rebuild keeps availability
identical on day one (backfill sets `committed=0, fulfilled=0, returned=0` on rows
whose `on_hand` is already net of sold units) and gains the distinction.

**DB invariants** (`§21` — the database must prevent the bug, not just the code):

```sql
CHECK (on_hand   >= 0)
CHECK (reserved  >= 0)
CHECK (committed >= 0)
CHECK (fulfilled >= 0)
CHECK (returned  >= 0)
CHECK (reserved + committed <= on_hand)
```

Uniqueness: `UNIQUE (product_id) WHERE variant_id IS NULL` and
`UNIQUE (variant_id) WHERE variant_id IS NOT NULL` — the single documented
`DROP CONSTRAINT` of this rebuild replaces `inventory_product_id_key`, because it
structurally forbids two variants of one product from each having a row.

---

## 2. The movements, and what each one does

| Movement | `on_hand` | `reserved` | `committed` | `fulfilled` | `returned` | Trigger |
|---|---|---|---|---|---|---|
| `reserve` | — | **+q** | — | — | — | order creation (checkout) |
| `release` | — | **−q** | — | — | — | cancel, expiry, payment failure |
| `commit` | — | **−q** | **+q** | — | — | payment settled |
| `fulfil` | **−q** | — | **−q** | **+q** | — | shipment handed over (or delivered) |
| `return` | **+q** *(if restocked)* | — | — | **−q** | **+q** | a return is received and restocked |
| `adjust` | **±q** | — | — | — | — | seller/admin correction (audited, reason required) |

Invariant `available = on_hand − reserved − committed ≥ 0` therefore holds after
every movement, because each guarded statement re-checks it.

**Return, stated precisely.** Returning without restocking (damaged goods) records
`returned +q` and `fulfilled −q` but does **not** add to `on_hand` — the units are
counted but not sellable. Restocking is a separate, explicit `adjust +q` with
reason `restock`. That is why `returned` and `on_hand` are separate axes.

---

## 3. The reservation lifecycle (§12)

```
                    reserve                    commit
   AVAILABLE ──────────────> RESERVED ────────────────────> COMMITTED ──────> FULFILLED
       ▲                         │                                              │
       │        release          │                                              │ return
       └─────────────────────────┘                                              ▼
       │                                                                   RETURNED
       │        return received + restock (adjust)
       └────────────────────────────────────────────────────────────────────────
```

Every exit from `RESERVED` (payment failure, checkout expiry, customer cancel,
payment timeout, webhook failure, order expiration) is a `release`, and every
release goes through **`releaseOrderInventory()`** — the existing exactly-once
claim on `orders.inventory_released`. That claim is what keeps a repeat, a
concurrent sweep, a retried webhook or a raced cancel from restoring the same
units twice. **This mechanism already exists and is kept unchanged**; the rebuild
only adds the movement row and the axis names.

`inventory_released` remains a **per-order** flag (not per item): an order is a
single reservation unit, and a partially-released order is not a state the
business has.

---

## 4. Oversell prevention (§11, §18 required-in-test)

```
Customer A ─┐                    Customer B ─┐
   checkout │                       checkout │
            ▼                                 ▼
   UPDATE inventory                                   (one statement, both connections)
      SET reserved = reserved + q
    WHERE id = $inv
      AND on_hand - reserved - committed >= q
   RETURNING id
```

Under `READ COMMITTED`, the second transaction blocks on the row lock and then
**re-evaluates the WHERE clause against the committed row**; if the first
transaction won the last unit, the second matches **zero rows** and its whole
transaction rolls back with `409 INVENTORY_UNAVAILABLE`.

The same statement shape is used for the variant row (variant rows live in the
same table now — the old variant path decremented `product_variants.stock`
directly, which is precisely the code that had no `available` concept).

`the result can never be: A=success, B=success, stock = −1` — the DB CHECK
(`on_hand >= 0`, `reserved >= 0`) and the guarded UPDATE make that state
unreachable, and a concurrency test drives two real connections to prove it.

---

## 5. One writer, one projection

| Row | Writer |
|---|---|
| `inventory.*` (all five counters) | `backend/lib/inventory.ts` **only** |
| `inventory_movements` | written by the same function, same transaction |
| `product_variants.stock` | projected from the variant's `available` by `lib/inventory.ts` in the same transaction (compatibility read path) |
| `products.sold_count` | `commitOrderInventory` (kept as a counter) |

`grep` for a second `UPDATE inventory` / `UPDATE product_variants SET stock` in a
route is a defect. Today `routes/products.ts` writes `inventory` on product
create/update (`:695`, `:873`, `:1487`, `:1527`) — those become **adjust
movements** through the one writer, so an admin stock edit is as audited as a
checkout.

---

## 6. Movement record (the audit trail)

`inventory_movements` — `id`, `inventory_id`, `product_id`, `variant_id`,
`movement`, `quantity (> 0)`, `order_id`, `order_item_id`, `reason`, `actor_user_id`,
`idempotency_key` (UNIQUE, nullable), `correlation_id`, `created_at`.
**Append-only.** This is what makes "why is this number 3?" answerable, and it is
what the inventory reconciler reads.

---

## 7. Inventory reconciliation (§23)

`reconciliation_runs(kind='inventory')` + findings, comparing four things:

| Check | Expected | Observed |
|---|---|---|
| reservation ↔ open orders | `SUM(reserved)` per level = Σ quantities of order_items whose order is open and not released | `inventory.reserved` |
| commitment ↔ settled orders | `SUM(committed)` = Σ quantities of order_items of settled, unfulfilled orders | `inventory.committed` |
| fulfilment ↔ shipments | `SUM(fulfilled)` = Σ `shipment_items.quantity` shipped | `inventory.fulfilled` |
| movement replay | fold(`inventory_movements`) = the five counters | the columns |
| projection parity | variant `available` = `product_variants.stock` | the column |
| non-negative | every counter ≥ 0 and `reserved + committed ≤ on_hand` | the row |

A mismatch is written as a **finding** with severity, never repaired silently.
The movement-replay check is the strongest one: if the counters and the movements
disagree, one of them was written without the other, which is exactly the defect
class the movement table exists to catch.

---

## 8. What changes for existing behaviour (and what does not)

**Does not change:** the reservation window (fixed 30 minutes, server clock), the
exactly-once release claim, the "a settled payment outranks a cancellation"
refusal, the late-payment rule (money recorded, incident raised, order never
resurrected), the `MAX_ORDER_QUANTITY` backstop, or any customer-visible number.

**Changes:** a variant's stock now lives in `inventory` (with
`product_variants.stock` projected from it); commit no longer decrements `on_hand`
(it moves `reserved → committed`); `fulfil` decrements `on_hand` when the parcel
leaves; the CHECK constraints make a negative counter impossible; every change
writes a movement row; admin edits are audited.

**Migration safety:** the backfill is additive and value-preserving — one row per
variant from `product_variants.stock` with `reserved=0, committed=0,
fulfilled=0, returned=0`, and the product rows keep their existing `quantity`
renamed in meaning only (`quantity` → `on_hand` is a rename through a
`DO $$ … IF EXISTS` guard, or kept as `quantity` with a documented alias — see
`MIGRATION_PLAN.md` §4 for the decision and why a rename is optional).
