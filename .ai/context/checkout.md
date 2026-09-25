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
→ orders + order_items (stock reserved)
→ POST /api/stripe/checkout (Checkout Session; idempotent via checkout_requests[scope=payment]
   + idx_payments_one_active_stripe) → payments
→ Stripe webhook (authoritative) → payments.status + orders.status
→ shipments + tracking_events → VelRepeat plans/runs
```

## Endpoints (payment)

| Endpoint | Notes |
|---|---|
| `GET /api/payments/methods` | Backend-driven method discovery. The storefront renders THIS list, so a disabled method cannot be offered |
| `POST /api/stripe/checkout` | `CARD` \| `PROMPTPAY`. Amount is reconciled to `orders.total_amount` **exactly** |
| `POST /api/payments/stripe/webhook` | Raw body, signature-verified, event-claimed, idempotent |
| `POST /api/admin/orders/:orderId/refund` | Requires `orders.manage`; webhook-confirmed |
| `GET /api/stripe/payment-status/:sessionId` | Ownership-checked |
| `GET /api/orders/:orderId` | Order + payment + refunds (what the success page polls) |

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
needs real test keys — see `.ai/AI_HANDOFF.md` §15 for what remains unverified.

Related: `customer.md`, `database.md`, `security.md`.
