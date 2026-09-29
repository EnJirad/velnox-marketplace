# CHECKOUT

## Purpose

Cart → order → payment → shipment lifecycle.

**A Stripe payment system ALREADY EXISTS — extend it, never build beside it.**
(TASK 005 is built on it; before that pass the implementation was easy to miss
and a stale note claimed none existed. `backend/routes/stripe.ts` is real.)

## Source Locations

- `backend/routes/cart.ts` — cart CRUD + `POST /api/customer/checkout` (order creation)
- `backend/routes/stripe.ts` — **all payment endpoints**: checkout session, webhook, refund, method discovery, order detail
- `backend/lib/payment-config.ts` — the ONE payment-config decision point (test-mode enforcement, COD flags, method guard)
- `backend/routes/velrepeat*.ts`, `backend/jobs/velrepeat-scheduler.ts` — subscriptions, VelRepeat
- `backend/routes/index.ts`, `backend/routes/seller-orders.ts`, `backend/routes/center.ts` — order read/update
- DB: `orders`, `order_items`, `payments`, `payment_events`, `refunds`, `commissions`, `settlements`, `shipments`, `tracking_events`, `checkout_requests`

## Data Flow

```
cart_items → POST /api/customer/checkout (idempotent via checkout_requests[scope=checkout])
→ orders + order_items (stock reserved + a payment reservation deadline, see below)
→ POST /api/stripe/checkout (Checkout Session; idempotent via checkout_requests[scope=payment]
   + idx_payments_one_active_stripe) → payments
→ Stripe webhook (authoritative) → payments.status + orders.status
→ shipments + tracking_events → VelRepeat plans/runs
```

## Customer cancellation (order lifecycle)

`PATCH /api/customer/orders/:orderId/cancel` (`backend/routes/cart.ts`) is the ONE
cancellation path and the only place a customer may end an unpaid order. It cancels
`pending` **and `pending_payment`** (the status an order carries while a Stripe Checkout
Session exists — i.e. after an abandoned/failed payment) and `confirmed`, by:

1. 404 for a non-owner (ownership is in the `WHERE` — never a 403 that confirms existence);
2. refusing `paid`/`shipped`/`delivered`/`completed`/`refunded` (`400 INVALID_STATUS`),
   a `paid` payment on a lagging order row (`409 ORDER_ALREADY_PAID`) and a payment being
   authorised (`409 PAYMENT_IN_PROGRESS`);
3. expiring the abandoned Stripe session FIRST (`expireStripeCheckoutSession()` in
   `stripe.ts`) so the old Stripe tab cannot charge a cancelled order;
4. one transaction: guarded `UPDATE … status = ANY($2)` claim (the race gate) → abandon the
   `pending`/`requires_action` payment row → `releaseOrderInventory()`. Terminal states
   (`cancelled`, `payment_failed`, `expired`) answer **200 as an idempotent no-op**.

The rule the storefront reads is `orderCustomerCancelability()` /
`CUSTOMER_CANCELABLE_ORDER_STATUSES` (`packages/shared/src/lib/commerce.ts`) — one list for
button and server, pinned by `backend/tests/customer-order-cancel.test.ts`. Copy lives in the
`orderCancel` i18n namespace.

## Payment reservation window (Dynamic Payment Reservation V1)

An unpaid order holds stock for a **risk-based window** instead of forever. The deadline is decided
once, inside the order-creation transaction, by `backend/lib/payment-reservation.ts` and stored on
the order (`orders.payment_expires_at` + `orders.reservation_policy`, the audited policy JSON).

| Risk | Window | Fires when |
|---|---|---|
| CRITICAL | 15 min | ≤2 available · ≤5 available with ≥1 unit/day · <1.5 days of cover · promoted AND ≤5 available |
| HIGH | 20 min | ≤10 available · ≤20 available with ≥1 unit/day · <3 days of cover |
| NORMAL | 30 min | the default (also "stock unknown") |
| LOW | 45 min | ≥20 available, <1 unit/day, ≥10 days of cover, not promoted |
| VERY_LOW | 60 min | ≥50 available, ≤0.2 units/day, ≥30 days of cover, not promoted |

Hard limits **MIN 10 / MAX 60**, default **30** minutes. Signals come only from real columns:
`inventory.quantity − reserved`, `product_variants.stock`, `products.featured` (the platform's
promotion flag — there is **no** flash-sale column, so none is invented) and 7-day sales velocity
from `order_items ⋈ orders`. The scarcest line decides the window. COD gets **no** window (no
online payment is waited on).

When the deadline passes, `backend/jobs/payment-reservation-scheduler.ts` (started in `server.ts`,
30 s tick) ends the order:

1. the claim is one guarded `UPDATE orders … status = 'expired' WHERE status IN
   ('pending','pending_payment') AND inventory_released = FALSE AND payment_expires_at <= NOW()` —
   the race gate against the webhook and the customer's own cancel;
2. a `paid`/`processing` payment blocks it outright (a live charge is never expired);
3. the waiting payment row becomes `cancelled` with `failure_code =
   'PAYMENT_RESERVATION_EXPIRED'`;
4. stock returns through `releaseOrderInventory()` — the ONE release path — so a repeat, a
   concurrent sweep or a retried request can never restore the same units twice;
5. the Stripe Checkout Session is closed afterwards (best effort).

The order page counts down from the API's `paymentExpiresAt` (ms) via
`paymentReservationState()` / `formatPaymentCountdown()` — **presentation only**. A late payment for
an expired order cannot resurrect it or reclaim stock: `markPaymentSucceeded` requires a
pre-payment status AND `inventory_released = FALSE`, records the money on the payment row and logs
`manual review/refund required` (no refund is invented in code).

## Endpoints (payment)

| Endpoint | Notes |
|---|---|
| `GET /api/payments/methods` | Backend-driven method discovery. The storefront renders THIS list, so a disabled method cannot be offered |
| `POST /api/stripe/checkout` | `CARD` \| `PROMPTPAY`. Amount is reconciled to `orders.total_amount` **exactly** |
| `POST /api/payments/stripe/webhook` | Raw body, signature-verified, event-claimed, idempotent |
| `POST /api/admin/orders/:orderId/refund` | Requires `orders.manage`; webhook-confirmed |
| `GET /api/stripe/payment-status/:sessionId` | Ownership-checked |
| `GET /api/orders/:orderId` | Order + payment + refunds (what the success page polls) |

## Order numbers (`VNX-YYYYMMDD-XXXXXX`)

One definition: **`backend/lib/order-number.ts` → `generateOrderNumber()`** (imported by `routes/cart.ts`
and `routes/stripe.ts`; the two old private copies are gone).

- The reference is 6 symbols from `crypto.randomInt` over `23456789ABCDEFGHJKMNPQRSTVWXYZ` — no `0/O`,
  `1/I/L`, `U/V`, because the number gets dictated to support. **Never `Math.random()`** (predictable).
- It is deliberately **not sequential** and never a UUID: `orders.id` is internal only. The date half
  keeps it searchable; the random half keeps the daily order volume private.
- Uniqueness is the DATABASE's job: `idx_orders_number_unique` (partial, `WHERE order_number IS NOT NULL`)
  exists in **both** `db/schema.sql` and `db/run-sqleditor.sql`. Checkout therefore retries that ONE
  collision — `insertOrderWithUniqueNumber()` in `routes/cart.ts`, under a SAVEPOINT so a failed INSERT
  cannot poison the transaction — and `isOrderNumberCollision()` refuses any other unique violation
  (order idempotency key, payment slot). `backend/tests/order-number.test.ts` pins all of it.

## Important Rules

- All financial state in Neon; idempotency is **database-backed** (never an in-memory Map).
- **Stripe is TEST MODE ONLY.** `backend/lib/payment-config.ts` refuses a live or
  unrecognized key; a missing webhook secret means "payment unavailable", never a
  fallback. Only the **test publishable** key may reach a browser.
- **The webhook is the authoritative payment event source**, not the browser
  redirect. Use `constructEventAsync` — the sync `constructEvent` throws on every
  event outside Node and would silently disable all webhooks.
- **PromptPay is delayed-notification:** `checkout.session.completed` with
  `payment_status != "paid"` is NOT success. Only `async_payment_succeeded` /
  `payment_intent.succeeded` / a `paid` session mark an order paid.
- **COD is IMPLEMENTED but DISABLED** (`COD_ENABLED` / `COD_CUSTOMER_SELECTABLE`,
  both default off, fail closed). `method=COD` → **403 `PAYMENT_METHOD_DISABLED`**
  before any order/payment/shipment/settlement write, independent of Stripe state.
- **Stock is reserved at order creation and released exactly once.** Cancellation, payment
  failure, session expiry **and the payment-reservation deadline** all converge on
  `releaseOrderInventory()` inside their own transaction; its `inventory_released` claim is what
  makes a repeated, concurrent, retried or webhook-driven release impossible, and its status
  guard refuses to release for an order that has become `paid`.
- Order and Payment are separate lifecycles. Only paired transitions are written:
  `paid`→`paid`, `failed`→`payment_failed`, expired/canceled→`cancelled`, full
  refund→`refunded`.
- Status transitions via `backend/lib/product-lifecycle.ts` where applicable.

## Common Failure Modes

- Duplicate orders without an idempotency key; an unverified or silently-broken
  webhook signature check; stock not reserved; trusting a client-supplied total;
  marking an order paid from the browser redirect or from an unpaid PromptPay session.

## Verification

Typecheck `backend`; test cart → order creation (idempotent), payment, and order
retrieval. `backend/tests/payment-foundation.test.ts` covers config, COD
fail-closed, webhook signature reject **and accept**, and the COD API bypass.
Check Neon for order/payment consistency. Full live test-mode Stripe verification
needs real test keys — see `.ai/AI_HANDOFF.md` §15 for the design and §16 for the
exact per-area evidence tier (CODE / AUTO / BLOCKED) and what remains unverified.

Related: `customer.md`, `database.md`, `security.md`.
