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

## Payment reservation window (FIXED 30 minutes)

An unpaid order holds stock for a **fixed 30 minutes** instead of forever. The deadline is decided
once, inside the order-creation transaction, by `backend/lib/payment-reservation.ts` and stored on
the order (`orders.payment_expires_at` + `orders.reservation_policy`, the audited policy JSON
`{version, reservationMinutes, reason, expiresAt}`):

    payment_expires_at = server_now + 30 minutes

The value is a **constant** (`PAYMENT_RESERVATION_MINUTES = 30`, policy `version: "v2"`) taken from
the SERVER clock — the client never supplies, extends or shortens it. Deliberately NOT dynamic:
popularity, product views/clicks, sales velocity, demand score and customer behaviour feed nothing
here (those belong to VelRepeat), so the storefront countdown always starts at 30:00 and the
backend always enforces the same number. COD gets **no** window (no online payment is waited on).

> v1 of this module was risk-based (15/20/30/45/60 minutes from stock cover + 7-day velocity).
> That table no longer exists anywhere in the code. A stored `reservation_policy` row carrying
> `version: "v1"` (with `riskLevel` + `signals`) is historical data only and is never re-derived.

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

## Order numbers — DIGITS ONLY (`^[0-9]{18}$`)

One definition: **`backend/lib/order-number.ts` → `generateOrderNumber()`** (imported by `routes/cart.ts`,
`routes/stripe.ts` and `lib/velrepeat-cycles.ts`; no private copy survives anywhere).

- The public number is **18 decimal digits and nothing else** — e.g. `586322973946053945`. No prefix,
  no separator, no letters, because every surface (customer, seller, center, tracking, support forms)
  treats it as a lookup key.
- The first **14** digits are a millisecond timestamp (`padStart(14, "0")`); the last **4** are a
  `crypto.randomInt()` disambiguator, so two orders created in the same millisecond do not collide.
  **Never `Math.random()`** (predictable PRNG).
- It is a **STRING everywhere**. 18 digits exceeds `Number.MAX_SAFE_INTEGER` (16 digits), so a
  `number` in any JSON round trip would silently corrupt it. `orders.order_number` stays `TEXT` and
  every API, type and UI surface types it as `string`.
- Uniqueness is the DATABASE's job: `idx_orders_number_unique` (partial, `WHERE order_number IS NOT NULL`)
  exists in **both** `db/schema.sql` and `db/run-sqleditor.sql`. Every creator retries that ONE
  collision under a SAVEPOINT — `insertOrderWithUniqueNumber()` in `routes/cart.ts` and the inline
  retry in `lib/velrepeat-cycles.ts` (`cycle_order_number_attempt`) — and `isOrderNumberCollision()`
  refuses any other unique violation.
- **Legacy numbers still resolve.** Orders created before this change keep their `VNX-YYYYMMDD-XXXXXX`
  value verbatim; nothing is rewritten, the column is nullable and the unique index is partial.
  `isLegacyOrderNumber()` recognises them for lookup paths.
- `backend/tests/order-number.test.ts` pins the shape, the string type, legacy recognition, the crypto
  source, the server-side-only generation and both SAVEPOINT retry loops.

## One purchase, N fulfillment orders (`checkout_groups`)

`POST /api/customer/checkout` groups cart lines by `shop_id` and creates **one canonical ORDER per shop**
— never one per product. A three-shop cart is therefore three orders, each with its own fulfillment,
shipment and tracking (a customer's cancellation and Stripe settlement cannot touch another shop's rows).

- The purchase identity is **`checkout_groups`** (`user_id`, `total_amount`, `currency`, `item_count`,
  `shop_count`); `orders.checkout_group_id` points at it (`ON DELETE SET NULL`).
- **The group is the payment parent.** `POST /api/stripe/checkout` accepts `checkoutGroupId` OR
  `orderId`. The group path re-derives the amount from the member ORDER rows
  (`sumGroupOrderTotal`), reads the group through the OWNER scope (`readOwnedCheckoutGroup`), and
  requires EVERY member order to be still payable — one shop lapsing closes the whole purchase,
  because the customer pays once.
- `payments.checkout_group_id` is the third payment parent, with `idx_payments_one_active_stripe_group`
  enforcing at most one active session per purchase. `payments_at_least_one_parent_check` +
  `payments_single_domain_check` replaced the old `payments_exactly_one_parent_check`, which would
  have rejected a group payment outright.
- Settlement: `settleCheckoutGroup()` takes the order locks FIRST (`lockCheckoutGroupOrderRows`, one
  statement, `id ASC`), writes the group payment row, then claims each order with the same
  `status IN ('pending','pending_payment') AND inventory_released = FALSE` guard and the same
  `commitOrderInventory` a single-order payment uses. One Stripe charge, N orders, one transaction,
  no duplicate charge. The webhook routes to it through `checkoutGroupIdForAttempt()`.

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
