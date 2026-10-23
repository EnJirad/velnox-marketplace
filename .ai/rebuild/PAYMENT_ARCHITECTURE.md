# PAYMENT_ARCHITECTURE.md — attempts, authority, idempotency, refunds, retry

> Keeps what already works (`docs/PAYMENT_*`, §70: raw-body signature
> verification, the `payment_events` claim, 500-on-failure, test-mode-only,
> fail-closed COD, the one lock order, the covering-set resolver). Adds the
> layers the brief requires and the audit found missing (§A5, A6, A11, A14).
> **No fake success of any kind (§37).**

---

## 1. The lifecycle the brief asks for, mapped onto Velnox

```
PaymentAttempt ──> PaymentIntent / Checkout Session ──> Payment Processing ──> Payment Confirmed ──> Payment Settled
   (NEW table)        (provider object id)                (attempt status)       (webhook says so)      (order + stock + ledger committed)
```

| Stage | Velnox today | Target |
|---|---|---|
| **PaymentAttempt** | absent — `payments` is the attempt | `payment_attempts` row per provider interaction, `attempt_number`, `idempotency_key UNIQUE` |
| **Intent / Session** | `payments.provider_checkout_session_id`, `.provider_payment_id` | moved onto the attempt; `UNIQUE(provider, provider_session_id)` and `UNIQUE(provider, provider_intent_id)` |
| **Processing** | `payments.status='processing'` | attempt `processing` + payment `PROCESSING` |
| **Confirmed** | `markPaymentSucceeded` writes `paid` | attempt `succeeded` + `confirmed_at`; payment `PAID` + `paid_at`; **order claimed** |
| **Settled** | same function, same transaction | the settlement transaction: order state + `commitOrderInventory` + `ledger_entries` (`charge`, `platform_fee`, `seller_payable`) + `fulfillment_orders` row + `outbox_events` (`PaymentConfirmed`) |

**"Confirmed" and "Settled" are deliberately distinct.** Confirmed = the provider
says money moved. Settled = *we* have finished applying it. A crash between the
two is exactly the state that produced the silent money-taken-no-sale incident
(§70, defect 7), so it must be representable: a `succeeded` attempt with no
settled order is a **detectable** state, not an invisible one.

---

## 2. Providers and methods

* **Stripe** — Card and PromptPay, **test mode only**. `classifyStripeSecretKey()`
  keeps refusing live and unrecognized keys; a missing `STRIPE_WEBHOOK_SECRET`
  keeps meaning "payment unavailable", never a fallback.
* **The provider seam is the attempt row**, not a second payment table: `provider`
  is a column on `payment_attempts`, and the settlement/failure/refund handlers
  dispatch on it. Adding a second provider is a new adapter, not a new system.
* **COD** stays implemented and **disabled**, fail-closed on the literal `true`/`1`
  only, refused with `403 PAYMENT_METHOD_DISABLED` before any order, payment,
  shipment or settlement write.
* **Never stored**: card number, CVV, expiry, PAN, raw credential, provider
  secret, or a session client secret beyond the redirect URL. Only provider object
  ids and amounts.

---

## 3. Authority — who may say "paid"

```
customer clicks "pay"      → creates an ATTEMPT (pending). Says nothing about money.
Stripe hosted checkout     → provider-side. Says nothing durable.
success_url redirect       → MAY refresh the UI. Reason: display only. (§8)
GET payment-status poll    → reads OUR record. Never writes `paid`.
POST /api/payments/stripe/webhook → verifies the signature with the endpoint secret,
                                   claims payment_events, then — and only then — may write:
                                     · attempt  → succeeded
                                     · payment  → PAID
                                     · order    → settled (claim under the lock)
                                     · stock    → committed
                                     · ledger   → charge/fee/payable
                                     · outbox   → PaymentConfirmed
```

`markPaymentSucceeded` remains the **only** writer of `payments.status='paid'`.
No route, job, admin action, test helper or frontend may write it. A frontend
that "knows" payment succeeded renders the backend's answer and refetches.

**Schema-lag safety (keep).** `to_jsonb(p) ->> 'checkout_group_id'` style reads
stay: a database older than the backend must degrade to a NULL key, never abort a
settlement with `42703` mid-transaction (the production incident of 2026-10-04).

---

## 4. The webhook — nine steps, duplicate/retry/out-of-order tolerant

```
1 verify signature         raw bytes + STRIPE_WEBHOOK_SECRET (constructEventAsync)
2 parse event              typed Stripe.Event
3 identify event           event.id (provider-unique), event.type, data.object
4 check idempotency        INSERT INTO payment_events (event_id …) ON CONFLICT DO NOTHING RETURNING id
5 persist event            payload + received_at + provider_object_id + correlation_id
6 process event            handleStripeEvent → domain state, ONE transaction per domain change
7 update state transactionally   (see §1: attempt → payment → order → stock → ledger → outbox in one commit)
8 acknowledge correctly    200 processed | 200 {duplicate:true} | 500 on internal failure (so the provider retries)
9 support retry            attempt_count + next_retry_at; a crashed 'processing' claim is reclaimable
```

**Extension over today:** steps 4/5 gain `received_at`, `attempt_count`,
`next_retry_at`, `provider_object_id`, `correlation_id`; step 9 becomes a real
retry policy instead of relying solely on provider redelivery (`§A11`).

**Handled event set** (unchanged, all already implemented): `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
`checkout.session.expired`, `payment_intent.succeeded`,
`payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`,
`refund.created`, `refund.updated`, `refund.failed`.
**Added:** `charge.dispute.created` / `charge.dispute.closed` → **recorded as an
incident** (`kind='duplicate_charge'|'provider_dispute'`), never as a state change.
Dispute handling is explicitly an operator flow in this rebuild.

**Out-of-order guards (new, §9 "มาถึงไม่เรียงลำดับได้"):**

| Late event | Guard |
|---|---|
| `payment_intent.canceled` after `succeeded` | `P2` sticky-`PAID`: the payment does not move; an incident is recorded |
| `payment_intent.payment_failed` after `succeeded` | same — never un-pay a paid order |
| `checkout.session.expired` after settlement | the group/order settle path already refuses; incident if money was captured |
| `payment_intent.succeeded` after the order `expired` and stock released | keeps the existing behaviour: record the money on the payment row (that is what makes it **refundable**), write a `late_payment` incident, **never** resurrect the order or reclaim stock |
| duplicate of any of the above | claim in step 4 makes it a 200 no-op |

---

## 5. Idempotency (durable, never `if (!alreadyExists) create()`)

| Operation | Mechanism |
|---|---|
| create checkout | `checkout_requests` `UNIQUE(user_id, scope, request_key)` claim; replay returns the stored `response` |
| create payment session | same claim with `scope='payment'` **plus** `idx_payments_one_active_stripe[_group\|_plan]`; a different-method race expires our own session and answers `409 DUPLICATE_PAYMENT_IN_PROGRESS` |
| create attempt | `payment_attempts.idempotency_key UNIQUE` — `INSERT … ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`, then read the existing row |
| capture / settle | guarded `UPDATE orders … WHERE status IN ('pending','pending_payment') AND inventory_released = FALSE RETURNING id` — the order-row lock is the gate |
| refund | `refunds.idempotency_key UNIQUE` **plus** the deterministic provider key `velnox-refund-{payment}-{alreadyRefundedMinor}-{requestedMinor}` |
| cancel | guarded `UPDATE orders … WHERE status = ANY(cancellable) RETURNING id`; terminal statuses are a 200 no-op |
| reserve inventory | guarded `UPDATE inventory … WHERE available >= qty RETURNING id` |
| release inventory | `orders.inventory_released` claim inside the transaction |
| webhook processing | `payment_events.event_id UNIQUE` claim |
| **shipment creation** | **NEW** guarded `UPDATE order_items SET fulfilled_quantity = fulfilled_quantity + q WHERE fulfilled_quantity + q <= quantity RETURNING id` — the same statement *is* the claim, so a double ship cannot double-record |

Every one of these is a **single atomic statement or a unique constraint**. None
is a read-then-write.

---

## 6. Refunds — a domain operation

Signature: `refund({ scope, amountMinor | 'full', reason, actor, requestId })`.

```
1 authorize        orders.manage (Velcenter permission) — a customer never refunds arbitrarily
2 resolve scope    payment (and its covering purchase/order) server-side from OUR rows
3 LOCK             the payment row (and, for a purchase, the member order rows id ASC)
4 compute          capturedAmount − succeededRefunds = refundableMinor   (never orders.total_amount)
5 refuse           requested > refundable  → 409 REFUND_EXCEEDS_CAPTURED   (and DB CHECK, §I-R1)
6 claim            INSERT refunds (…, idempotency_key) ON CONFLICT DO NOTHING → replay if exists
7 call provider    stripe.refunds.create(..., { idempotencyKey })   ← the ONLY external leg
8 record           refunds.status = 'pending' + last_error; attempt recorded
9 confirm          ONLY charge.refunded / refund.updated mark it succeeded; refund.failed marks failure
10 apply           ledger_entries: refund (platform_cash debit) + seller_payable reversal
                   payments.refunded_amount recomputed from succeeded rows (never incremented blind)
                   payments.status → PARTIALLY_REFUNDED | REFUNDED
                   inventory: nothing moves until a RETURN is received (§INVENTORY)
```

Supported: full, partial, multiple, after cancellation, after a return. A timeout
in step 7 leaves a `pending` refund with an attempt record; the reconciler and the
webhook both converge it. `refund > captured` is refused in step 5 **and** by the
DB invariant.

---

## 7. Retry (§24)

Every external operation gets: `attempt_count`, `next_retry_at`, `last_error`,
`max_attempts`, terminal `dead`/`failed` state, and a reconciler that notices.

| Operation | Max attempts | Backoff | Terminal state |
|---|---|---|---|
| provider refund | 5 | 1m, 5m, 30m, 2h, 12h | `refunds.status='failed'` + incident |
| webhook reprocessing | 8 | 30s → 1h exponential | `payment_events.status='failed'` + incident |
| outbox publish | 10 | 5s → 30m exponential | `outbox_events.status='dead'` + incident (never silently dropped) |
| booking a shipment with a carrier | n/a in this rebuild (no carrier API integrated) | — | — |

**No infinite loop may exist.** A retry without a max attempt count, a
`next_retry_at` and a recorded last error is a review failure.

---

## 8. Payment tests (the brief's 20, §35) — target coverage map

| # | Case | Test tier |
|---|---|---|
| 1 | successful card | contract (spied provider) + **Stripe TEST E2E — BLOCKED** |
| 2 | failed card | contract + DB |
| 3 | payment pending | DB + unit (fold) |
| 4 | PromptPay (delayed notification) | unit (`sessionConfirmsPayment`) + DB |
| 5 | webhook duplicate | DB (claim) |
| 6 | webhook retry after failure | DB (re-arm + attempt_count) |
| 7 | webhook out-of-order | DB (sticky-PAID guards) |
| 8 | redirect without webhook | unit + DB (nothing settles) |
| 9 | webhook without redirect | DB (settles; the webhook is the authority) |
| 10 | payment expiration | DB (sweep + `EXPIRED`) |
| 11 | cancellation before payment | DB |
| 12 | cancellation after payment | DB (409, never a cancel) |
| 13 | refund | DB + contract |
| 14 | partial refund | DB |
| 15 | duplicate refund request | DB (idempotency key) |
| 16 | duplicate checkout request | DB (`checkout_requests`) |
| 17 | concurrent checkout | **concurrency** (two connections) |
| 18 | inventory race | **concurrency** (last unit) |
| 19 | multi-seller purchase | DB (group settlement) |
| 20 | payment with multiple seller orders | DB (one charge → N orders, one transaction) |

Tier 1–2 that need a real provider round trip are reported **BLOCKED** with the
exact missing configuration, never as PASS.

---

## 9. Missing configuration (reported, not worked around)

`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` are absent
from this workspace (`freebuff-env list` → `{"files":{}}`), and no browser/test
account exists to complete a hosted Checkout round trip. Consequences, reported
verbatim in `FINAL_VERIFICATION.md`:
**real Stripe TEST E2E = BLOCKED**; the settlement path is verified at DB level
with prototype-spied provider objects and labelled a simulation.

**Stripe Connect / marketplace payout remains absent** unless the owner asks for
it; this rebuild implements an **internal ledger + payable + settlement**, which is
what §17/§18 ask for and is achievable without Connect.
