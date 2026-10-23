# PAYMENT — TARGET ARCHITECTURE (Phase 2 design)

This is the architecture the system is built to. It is **not** an aspiration: every
box and every rule below is implemented, and the Implementation doc
(`docs/PAYMENT_IMPLEMENTATION.md`) maps rules to code and to the tests that pin them.

The design rule that drives everything: **the customer's money is never the frontend's
opinion, and never one column's opinion.**

---

## 1. The canonical pipeline

```
CUSTOMER
  ↓  adds to cart (server-derived price; no price accepted from the client)
CART                       carts / cart_items  (PostgreSQL)
  ↓  POST /api/customer/checkout   (authenticated, idempotency-keyed)
SERVER-SIDE VALIDATION
     product exists + published
     variant exists + active + belongs to the product
     quantity is a whole positive number within the platform cap
     seller/shop is approved
     stock is available (availability = quantity − reserved)
     price, discount, shipping, commission recomputed from the DATABASE
     grand total recomputed
  ↓  ONE transaction
ORDER(S)                    one order per shop + one checkout_groups row
PAYMENT PENDING             ONE payments row for the purchase (order_id IS NULL,
                            checkout_group_id = <group>), status requires_action
INVENTORY RESERVED          reserveInventoryStock() — atomic conditional UPDATE
  ↓
PAYMENT SESSION             Stripe Checkout Session (server-created, server-priced)
STRIPE CHECKOUT             Stripe owns the payment method and all sensitive data
  ↓  (the browser redirect is NOT evidence of payment)
STRIPE WEBHOOK              POST /api/payments/stripe/webhook
VERIFY SIGNATURE            constructEventAsync on the RAW body
IDEMPOTENCY CLAIM           INSERT INTO payment_events ... ON CONFLICT DO NOTHING
PAYMENT STATE UPDATE        payments.status
ORDER STATE UPDATE          orders.status  (group-aware: every member order)
INVENTORY FINALIZATION      commit the sale once / release the hold once
  ↓
FULFILLMENT                 seller/admin transitions, driven by their own state machine
```

## 2. Hard prohibitions (all enforced in code)

| Forbidden | Enforced by |
|---|---|
| The frontend sending an amount/currency/price that is charged | the checkout body is not read for money fields; every price is re-read from the DB |
| Trusting `subtotal`, `discount`, `shipping`, `tax`, `total`, seller amount or commission from the client | server recomputes all of them; none of these names appear in the accepted request shape for money |
| A success/redirect page marking an order paid | `paid` is written only by the webhook handler; the success page only reads and polls |
| Building a card form / storing PAN or CVC | no card fields exist in this repo; Stripe Checkout hosts the form |
| A mock or fake payment rail | none exists; the Stripe SDK is the only online provider |
| One status column standing in for order + payment + fulfillment | three separate axes (below) |
| Currency or payment method hardcoded from the client | method is validated against server-side configuration; currency comes from the stored order rows |

## 3. Money model

**Representation.** All monetary columns are PostgreSQL `NUMERIC`. TypeScript converts at
the boundary (`parseFloat` on read for display/JSON) and Stripe minor units are produced
through a bigint-rational conversion — never `float` multiplication into an integer.

**Stored per charge:** `payments.amount`, `payments.currency`,
`payments.refunded_amount`. **Stored per order:** `orders.subtotal`,
`orders.shipping_fee`, `orders.discount`, `orders.total_amount`, `orders.currency`.
**Derivable and reconcilable:**

```
checkout_groups.total_amount  ==  SUM(orders.total_amount) for the group
SUM(order_items.price * order_items.quantity)  ==  orders.subtotal
orders.subtotal − discount + shipping_fee  ==  orders.total_amount
payments.amount  ==  checkout_groups.total_amount        (one charge, N orders)
```

The last identity is the one that makes a multi-shop purchase coherent, and it is the
invariant the audit's root-cause fix protects: a charge is addressed by the **covering
set** of orders, so `payments.amount` is never compared against one shop's order total.

**Seller amounts / commission.** `backend/lib/seller-stats.ts` derives
`{commission, commissionRate, payout}` from order rows for reporting. No commission row
is persisted and no money is moved — see the current-state audit §18/§19 and the
remaining production requirements.

## 4. State machines

### 4.1 Order (`orders.status`, one CHECK constraint)

```
pending / pending_payment
   │ payment succeeded (webhook only)
   ▼
  paid ──────► confirmed ──────► packing ──────► shipped ──────► delivered ──────► completed
   │              │                 │               │                │
   │              │                 │               │                └─► refunded / partially_refunded
   │              │                 │               └─► return/refund flow (customer cannot cancel)
   │              │                 └─► customer cannot cancel directly
   │              └─► seller/admin decision, policy-dependent cancel
   └─► cancelled
```

Terminal non-sale states: `cancelled`, `payment_failed`, `expired`, `refunded`.
`partially_refunded` is the partial-refund state.

Rules, in the order the code applies them:

1. `pending` / `pending_payment` → **cancellable** by the customer (stock returns).
2. `paid` → **not** cancellable by the customer; cancellation is refused with 409
   `ORDER_ALREADY_PAID` and the customer is pointed at the refund flow.
3. `confirmed` → the seller/admin policy decides; a cancellation here is a
   seller/admin action, not a customer one.
4. `packing` → a customer may not cancel directly.
5. `shipped` / `delivered` → only the return/refund flow.
6. Any state → a **settled payment outranks the cancellation**, whatever the order row
   still says (`paymentBlocksCancellation`, `backend/lib/order-lock.ts`).
7. Payment success makes an order `paid`. It **never** silently advances the order into
   `packing`/`shipped`: fulfillment moves only on its own transitions, by the
   seller/admin action that owns them.

### 4.2 Payment (`payments.status`, one vocabulary, one CHECK after migration 055)

```
pending ──► requires_action ──► processing ──► paid
   │               │                │
   │               │                └─► failed / cancelled
   │               └─► failed (async failure) / cancelled (group terminated)
   └─► cancelled
paid ──► refunded / partially_refunded   (readers fold this from refund_status)
```

Exactly one **active** Stripe payment per purchase is enforced by the database:
`idx_payments_one_active_stripe` (UNIQUE on `order_id` WHERE `provider='stripe' AND
status IN ('pending','requires_action')`) and its checkout-group twin.

### 4.3 Fulfillment

Fulfillment is `orders.status` transitions gated by `backend/lib/order-fulfillment.ts`:
`assertPaymentConfirmedForConfirmation` refuses to confirm without a settled payment, and
`assertNoSettledPaymentForCancellation` refuses to cancel with one. There is no second
"fulfillment status" column duplicating the order axis.

### 4.4 Centralised transition rules

"There is one definition of X" is a structural property of this codebase, not a
convention:

| Concept | Single definition |
|---|---|
| Is this order's money settled? | `backend/lib/payment-attempt.ts` (the covering set + the fold) |
| May this payment block a cancellation? | `paymentBlocksCancellation()` in `backend/lib/order-lock.ts` |
| May this order be cancelled by the customer? | `CUSTOMER_CANCELABLE_ORDER_STATUSES` |
| May this order be released? | `RELEASABLE_STATUSES` + `releaseOrderInventory()` |
| Is this purchase over? | `terminateCheckoutGroup()` in `backend/lib/checkout-group-lifecycle.ts` |
| Who may confirm/ship? | `assertPaymentConfirmedForConfirmation()` |

## 5. Webhook — the single source of truth for payment

`POST /api/payments/stripe/webhook`, and the required sequence is exactly:

1. read the **raw** request body (wired before `express.json` in `backend/server.ts`);
2. verify the Stripe signature against `STRIPE_WEBHOOK_SECRET`;
3. parse the event;
4. claim the event id in `payment_events` (`event_id UNIQUE`,
   `INSERT ... ON CONFLICT DO NOTHING`);
5. if the claim lost, detect the duplicate and return **without any side effect**;
6. map the event to its purchase — for a grouped session, resolve the **group** from
   `metadata.checkoutGroupId`, and for a request that names only an order, derive the
   group from the order row itself (never trust a client-supplied scope);
7. update `payments`;
8. update **every** member `orders` row;
9. commit/release inventory exactly once;
10. run downstream effects (incidents, events, realtime broadcast);
11. return success, or a non-2xx so Stripe retries when processing failed.

**A payment state transition is never applied without the payment state being checked
first.** Funds arriving for an order that is not payable are recorded and escalated to
an operator (a durable incident) instead of being silently ignored or silently applied.

## 6. Idempotency model

Three layers, each with a different job:

| Layer | Mechanism | Duplicate that it stops |
|---|---|---|
| Provider event | `payment_events.event_id` UNIQUE + `ON CONFLICT DO NOTHING` | a redelivered/duplicated Stripe event |
| Customer request | idempotency store keyed `(user, scope, request_key)`, `scope='checkout'` vs `'payment'` | double click, refresh, retry, mobile retry |
| Terminal transition | guarded `UPDATE` that claims the transition | two concurrent cancels, two releases, a late webhook |

Consequences the system guarantees: paying once cannot reduce stock twice, cannot create
a second order, cannot send two confirmations, and cannot credit a seller twice.

## 7. Inventory model

```
available  = inventory.quantity − inventory.reserved     ← the only thing checkout guards on
reserved   += quantity      at checkout (atomic conditional UPDATE)
on payment success:  quantity −= quantity,  reserved −= quantity,  products.sold_count += quantity   (once)
on failure/expiry/cancel:  reserved −= quantity                                                       (once)
```

A reservation has a policy window (`applyPaymentReservationPolicy`,
`orders.payment_expires_at`, `orders.reservation_policy`). The expiry sweep
(`backend/jobs/payment-reservation-scheduler.ts`) runs the **same** group termination the
customer's cancel route uses, and refuses outright while any covering payment row is
settled or in flight — so a payable purchase is never expired out from under a live
charge.

## 8. Multi-vendor model

```
Customer sees ONE cart and ONE checkout and is charged ONCE.
              checkout_groups                      ← the purchase (the charge's parent)
   ├── orders  (shop A)   ← seller A's order + seller A's items + A's fulfillment
   ├── orders  (shop B)
   └── orders  (shop C)
```

This already existed and is **reused**, not replaced. What the fix added is that the
purchase is addressable as a set: a payment read, a refund, a cancellation, an expiry and
a confirmation all resolve the purchase through its group. Every member order answers the
same money state, and the seller's own screens read only their own order while still
showing correct payment/fulfillment state.

## 9. Refund architecture

```
CUSTOMER ORDER (or any member order of a purchase)
  ↓  admin refund request
PAYMENT                the covering set picks the captured row (group-aware)
  ↓  Stripe refund created
STRIPE REFUND
  ↓  charge.refunded / refund.created / refund.updated / refund.failed   (webhook)
DATABASE               refunds upserted on provider_refund_id
                       payments.refunded_amount / refund_status updated
ORDER/PAYMENT STATE    full → refunded; partial → partially_refunded
SELLER LEDGER/COMMISSION  adjustment is derived from the same order rows (reporting)
```

`refunds` can name either parent — `order_id` or `checkout_group_id` — with
`refunds_parent_check` enforcing that it names one and migration 055 dropping the old
`NOT NULL` on `order_id`. A refund is never marked `succeeded` in our database on our own
say-so: the Stripe-confirmed result is what writes it.

## 10. Failure model

| Situation | Behaviour |
|---|---|
| Card declined | `payment_intent.payment_failed` → purchase terminated as one unit, stock returned once, session closed |
| Checkout expired | `checkout.session.expired` → same group termination |
| Customer abandons | reservation window lapses → sweep terminates the whole purchase; an open session is expired |
| PromptPay pending | **not** paid. `requires_action` until an authoritative confirmation arrives |
| PromptPay succeeds later | `checkout.session.async_payment_succeeded` settles the purchase |
| PromptPay fails | `checkout.session.async_payment_failed` terminates the purchase |
| Webhook delayed | the storefront polls and shows "verifying"; nothing is assumed |
| Webhook duplicated | the event claim makes the second delivery a no-op |
| Webhook out of order | state transitions are guarded by the current state, not by arrival order; a late charge on a terminal purchase raises an operator incident |
| Network / Stripe API timeout | the request fails cleanly and is retried under the idempotency key; no partial write survives (one transaction per step) |

A single rule covers all of them: **an order is never moved to a state the evidence does
not support.**

## 11. Success page

The success page (`apps/velshop/src/pages/ShopCheckoutSuccess.tsx`) has exactly three
jobs: show the status, read that status from the backend, and show what the customer
should see. It polls the order endpoint while the status is unsettled, and — because a
browser redirect proves nothing — it renders "verifying" while confirmation is still
outstanding. It never marks anything `paid`, `confirmed` or `fulfilled`, and a missing
payment row is never hidden: the customer is told confirmation is still in progress.

## 12. Security

| Requirement | Position |
|---|---|
| Authentication | `requireAuth` on every customer/payment route; the webhook is authenticated by signature instead |
| Authorization / ownership | order reads and cancels put `user_id` in the `WHERE` clause; seller routes scope by the seller's own shops; admin routes check the admin claim |
| Payment ownership | the covering set is derived server-side from the order row; no client-supplied scope is trusted |
| Webhook signature | verified on the raw body, per request; a missing secret cannot silently pass |
| Secrets | `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` are backend-only. The frontend never receives them; only a publishable key is exposed to a browser |
| Logging | structured payment events with a closed field list; no secrets, no card data, no full credentials; DB error logs redact literals (`backend/tests/db-failure-log-redaction.test.ts`) |
| CSRF/CORS/cookies | unchanged: JWT in httpOnly cookies, CORS allow-list from config |
| Card data | never touches this application — Stripe Checkout owns the form |

## 13. What is deliberately **not** built

Named here so "not done" is never mistaken for "forgotten":

- **Seller payouts / Stripe Connect** — no money movement to sellers exists.
- **Persisted commission ledger per order** — commission is currently derived.
- **Partial-refund initiation from the seller UI** — the data model and the webhook
  reconciler support partial refunds (`partially_refunded`); the seller-facing
  initiation flow is not built.
- **A real Stripe TEST-mode end-to-end run** — blocked in this workspace; see
  `docs/PAYMENT_E2E_CHECKLIST.md`.
