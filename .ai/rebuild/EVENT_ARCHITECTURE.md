# EVENT_ARCHITECTURE.md — transactional outbox, event catalogue, webhook durability

---

## 1. The problem being solved (§25, §26)

Today every domain change either publishes nothing or publishes a WebSocket
message **after** commit inside a `try { … } catch {}` (e.g.
`seller-orders.ts:657-666`). Two guarantees are therefore impossible:

* *"DB committed but the event vanished"* — a crash between COMMIT and the
  broadcast loses the notification forever, with no record that it was owed.
* *"the event says X but the DB says Y"* — a publish that succeeds while the
  transaction rolls back tells every connected client a lie.

No message broker is introduced. The **outbox table is the broker**: the row is
written in the same transaction as the state change (so it can never be lost or
phantom), and a drain worker publishes it afterwards with retries.

---

## 2. Shape

```
   ONE transaction
   ┌────────────────────────────────────────────────────────────┐
   │ UPDATE orders / payments / inventory / …                    │
   │ INSERT inventory_movements …                                │
   │ INSERT ledger_entries …                                     │
   │ INSERT outbox_events (event_id, aggregate, type, payload,   │  ← same commit
   │                       correlation_id, status='pending')     │
   └──────────────────────────┬─────────────────────────────────┘
                              │ COMMIT
                              ▼
                 drain worker (bounded batch, FOR UPDATE SKIP LOCKED)
                              │
              ┌───────────────┼────────────────┬───────────────────┐
              ▼               ▼                ▼                   ▼
        WebSocket         notifications     derived reads      (future: email,
        channels          (existing)        / intelligence      carrier APIs)
                              │
                     on failure: attempt_count + 1, next_retry_at = backoff(attempt_count),
                                 last_error = …; at max attempts → status='dead' + incident
```

**Rules**
* `E1` an outbox row is written **only** inside the transaction of the change it
  describes. A service function that publishes without an outbox row is a defect.
* `E2` the drain worker never mutates domain state — it publishes. A consumer that
  needs to change state must call the owning domain function.
* `E3` consumers are idempotent on `event_id` (a re-publish after a crash is a
  normal event, not an exception).
* `E4` `status='dead'` is a loud terminal state: it raises a `payment_incidents`
  row with `kind='reconciliation_failure'`. A dead event is never silently
  dropped.
* `E5` the outbox is **not** an authority. Losing it must never lose money, an
  order or a unit of stock — everything it carries is derivable from the state
  rows; it exists so downstream surfaces converge.
* `E6` payloads carry **ids and scalars only**, never a secret, a token, a card
  field or a full customer address.

---

## 3. Event catalogue (minimum)

| Event | Aggregate | Emitted when | Primary consumers |
|---|---|---|---|
| `PurchaseCreated` | purchase | checkout transaction commits | notification, analytics |
| `OrderCreated` | order | one per shop, same transaction | seller realtime, notification |
| `PaymentPending` | payment | attempt opened / session created | customer UI refetch |
| `PaymentConfirmed` | payment | webhook settled the money | seller realtime, fulfillment work creation |
| `PaymentFailed` | payment | provider failure | customer UI, stock release already done transactionally |
| `PaymentExpired` | payment | reservation window lapsed | customer UI |
| `InventoryReserved` | inventory | reserve movement | seller stock views |
| `InventoryReleased` | inventory | release movement | seller stock views |
| `InventoryCommitted` | inventory | commit movement | seller stock views |
| `OrderConfirmed` | order | seller accepted (payment settled) | customer UI, seller queue |
| `OrderCancelled` | order | cancel orchestration completed | customer UI, stock views |
| `FulfillmentCreated` | fulfillment | settlement created the work unit | seller queue |
| `FulfillmentStarted` | fulfillment | picking began | customer UI |
| `ShipmentCreated` | shipment | carrier + tracking recorded | customer UI, notification |
| `ShipmentShipped` | shipment | handed to the carrier | customer UI |
| `ShipmentDelivered` | shipment | delivery confirmed | customer UI, order completion |
| `ReturnRequested` | return | customer asked | seller/center queue |
| `ReturnReceived` | return | seller received the goods | refund queue |
| `RefundCreated` | refund | refund submitted to the provider | customer UI, ledger |
| `RefundCompleted` | refund | provider confirmed | customer UI, ledger |
| `LedgerEntryRecorded` | ledger | every ledger write | seller income surfaces |
| `SettlementPaid` | settlement | a payout is recorded | seller income surfaces |

**Channel mapping (realtime stays delivery-only).** `order:updated` and the two
currently-published channels keep their names; `order:created`, `cart:updated` and
`inventory:updated` — allowlisted but never published today (§A13) — get their
publisher through the outbox, which is what turns three dead entries into real
ones.

---

## 4. Webhook durability (§22) — `payment_events` extended

The existing pipeline is the model for the whole system and is kept:

```
                    ┌──────────────────────────────────────────────┐
POST /api/payments/stripe/webhook                                   
  raw body → constructEventAsync (STRIPE_WEBHOOK_SECRET)             
        │                            
        ├─ failure → 400 (forgery / wrong secret) — recorded nowhere, correct: it is unverified traffic
        ▼
  INSERT INTO payment_events (provider, event_id, event_type, payload,
                              received_at, provider_object_id, correlation_id, status='processing')
  ON CONFLICT (event_id) DO NOTHING RETURNING id
        │
        ├─ conflict + status='processed' → 200 {duplicate:true}   (nothing re-runs)
        ├─ conflict + status='failed'    → re-arm ('processing', attempt_count+1) → reprocess
        ├─ conflict + status='processing' and stale → reclaim (attempt_count+1) → reprocess
        ▼
  handleStripeEvent → ONE transaction per domain change
        │                        (attempt → payment → order claim → stock commit
        │                         → ledger → fulfillment work → outbox)
        ├─ success → status='processed', processed_at=NOW() → 200
        └─ failure → status='failed', error=<msg>, attempt_count+1,
                     next_retry_at=backoff(...) → 500  (the provider redelivers; our worker also retries)
```

**New columns (§22 requires provider/event_id/type/received_at/processed_at/status/
attempt_count/payload_reference/error — the table already has 5 of 8):**
`received_at` (backfilled from `created_at`), `attempt_count` (backfilled 1 for
processed rows, 0 for pending), `next_retry_at`, `payload_reference` (a stable
key into the stored payload rather than a promise of an external store),
`provider_object_id`, `correlation_id`, `last_error_at`.

**Stale-lease reclaim** is what makes a crashed process recoverable: a
`processing` row whose `updated_at` is older than the lease (15 min) is claimed by
the retry worker with `UPDATE … WHERE status='processing' AND updated_at <
NOW() - interval '15 minutes' RETURNING id`. Without it, a crash mid-event leaves
a row that no provider retry can advance (the conflict branch sees
`processing` and answers "already claimed"), which is precisely the silent-stall
class §70 found.

---

## 5. Ordering and out-of-order tolerance

Events are **not** ordered by delivery. Two mechanisms make order irrelevant:

1. **State guards** — every write is `UPDATE … WHERE <legal current state>`; an
   event whose precondition no longer holds matches zero rows and becomes a
   recorded no-op instead of a corruption.
2. **Monotonic vocabulary** — a value may only move forward within its machine
   (`PAID` never returns to `PENDING`; `delivered` never returns to `packed`), so
   a late "earlier" event cannot undo a later one.

A provider event that contradicts our record is never applied — it becomes a
`payment_incidents` row with the exact provider object ids so an operator can see
it. That is the same rule as the existing late-payment path (record the money,
raise the incident, never resurrect the order).

---

## 6. Testing this layer (§34 contract/concurrency tiers)

| Test | Asserts |
|---|---|
| commit-then-crash | an outbox row survives a transaction that commits; a rollback leaves none |
| drain retry | a failing publisher increments `attempt_count`, sets `next_retry_at`, then `dead` at max, and raises an incident |
| consumer idempotency | publishing the same `event_id` twice changes nothing downstream |
| webhook duplicate | two deliveries of one `event_id` → one settlement |
| webhook concurrent | two parallel deliveries → exactly one claim wins (DB constraint, not a race) |
| stale reclaim | a `processing` row older than the lease is reclaimed exactly once |
| out-of-order | `payment_failed` after `succeeded` is refused and incidented; `succeeded` after `expired` records money + incident, never resurrects |
| no-secret payload | no ledger/outbox/event payload contains a token, cookie, signature, key or card field |
