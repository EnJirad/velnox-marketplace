# CHECKOUT

## Purpose

Cart → order → payment → shipment lifecycle.

## Source Locations

- `backend/routes/cart.ts` — cart CRUD
- `backend/routes/stripe.ts`, `backend/routes/velrepeat*.ts`, `backend/jobs/velrepeat-scheduler.ts` — payments, subscriptions, VelRepeat
- `backend/routes/index.ts`, `backend/routes/seller-orders.ts`, `backend/routes/center.ts` — order read/update
- DB: `orders`, `order_items`, `payments`, `payment_events`, `refunds`, `commissions`, `settlements`, `shipments`, `tracking_events`, `checkout_requests`

## Data Flow

```
cart_items → POST /api/orders (idempotent via checkout_requests) → orders + order_items
→ Stripe / payments → shipments + tracking_events → VelRepeat plans/runs
```

## Important Files

`backend/routes/cart.ts`, `backend/routes/stripe.ts`, `backend/routes/index.ts`.

## Important Rules

- All financial state in Neon; idempotency for checkout; inventory checks before order creation.
- Status transitions via `backend/lib/product-lifecycle.ts` where applicable.

## Common Failure Modes

- Duplicate orders without idempotency key; payment webhook not verified; stock not reserved.

## Verification

Typecheck `backend`; test cart → order creation (idempotent), payment, and order retrieval. Check Neon for order/payment consistency.

Related: `customer.md`, `database.md`.
