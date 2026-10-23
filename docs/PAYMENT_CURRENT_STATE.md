# PAYMENT — CURRENT STATE (Phase 1 audit)

Audited from **source code, the DB schema, the API surface and the frontend flows in
this repository** — not from filenames or from older documentation. Every answer below
cites the artifact that proves it. Line numbers are from the commit this document was
written in; the identifiers (function, route, constraint names) are the stable reference.

Scope: `apps/velshop`, `apps/velseller`, `apps/velcenter`, `backend`, `packages/shared`,
`db/{schema.sql,run-sqleditor.sql,migrations}`, `.ai/`, environment/config.

---

## 1. How does a customer add a product?

Cart-only. `POST /api/customer/cart/add` (`backend/routes/cart.ts` — the cart section)
validates the product (`status = 'published'`), validates the variant when one is
supplied (`product_variants.status = 'active'`, belongs to the product), reads
**authoritative price and stock from the database** (`variant.price` / `variant.stock`,
else `inventory.quantity - inventory.reserved`), and writes `cart_items` with that
server-derived price. The client sends `productId`, `quantity`, `variantId` — never a
price. Existing lines merge, capped at available stock.

A "Buy now" path exists in the storefront (`ShopCheckout*` pages) and is served by the
same cart endpoints; there is no second add-to-cart implementation.

## 2. Where is the cart stored?

PostgreSQL: `carts` (one per user, `user_id UNIQUE`) + `cart_items`
(`cart_id`, `product_id`, `variant_id`, `quantity`, `price`, `added_at`).
`carts.total_items` / `carts.total_amount` are a **cache** recomputed by `recalcCart()`
from `cart_items` — they are never trusted as the amount to charge. There is no
client-side/localStorage cart as a source of truth.

## 3. Which endpoint starts checkout?

`POST /api/customer/checkout` (`backend/routes/cart.ts:684`, `requireAuth`). It requires
an `Idempotency-Key`-style `request_key` and refuses an empty cart. It is the **only**
place an order is created from a cart.

Payment for an order that already exists is a separate endpoint:
`POST /api/stripe/checkout` (`backend/routes/stripe.ts:2012`) — "resume/create a Stripe
Checkout Session".

## 4. When is an order created?

Inside the checkout request, one transaction, after server-side validation. The cart is
split **one order per shop** (`checkout_groups` row + N `orders` rows, each order's
`checkout_group_id` pointing at the group). Items are copied into `order_items` with
snapshots (`product_name_snapshot`, `variant_name_snapshot`, `image_url_snapshot`) so a
later product edit cannot rewrite history. An order row is only created after validate →
recompute → reserve, never before.

## 5. When is a payment created?

In the same checkout transaction, after the orders exist:
`INSERT INTO payments (checkout_group_id, provider, method, status, amount, currency,
provider_checkout_session_id, metadata)` with `status = 'requires_action'`
(`backend/routes/stripe.ts` — `openCheckoutGroupSession`, called from the checkout
route). For a purchase the row carries **`order_id IS NULL` and
`checkout_group_id = <group>`**: ONE charge for the whole multi-shop purchase.
A single-shop purchase uses the same group machinery.

## 6. Where is the amount computed?

Server-side only, from `cart_items`, which itself holds server-derived prices:

1. `recalcCart()` sums `price * quantity` per line;
2. the checkout handler re-reads each product/variant from the database and recomputes
   the line and order totals (a price that changed since the item was added is caught
   here, not charged at the stale value);
3. the **charge amount is the sum of the member orders' `total_amount`**
   (`checkout_groups.total_amount`), written by the server.

Stripe is called with an amount derived from those rows, converted to minor units
through a bigint-rational money module — never through `float` arithmetic.

## 7. Does the frontend send the amount?

**No.** The checkout request body carries no `amount`, `total`, `price`, `currency`, or
`seller amount`, and the backend does not read any of them if they are sent. The only
money-shaped fields accepted anywhere on this path are `quantity` / `variantId`
(product identity), which are validated and re-priced server-side.

## 8. Does the backend re-validate the price?

Yes. Every price on the charge is re-read from `products` / `product_variants` inside
the checkout transaction, and the charged amount is re-derived from the resulting order
rows. The cart's cached totals are only a display value.

## 9. When is stock reserved?

At checkout, inside the transaction: `reserveInventoryStock()`
(`backend/lib/inventory.ts`) atomically decrements availability
(`WHERE product_id = $2 AND quantity - reserved >= $1`) so two concurrent checkouts
cannot oversell. Reservation is released by the ONE release path
`releaseOrderInventory()` (guarded `UPDATE ... WHERE inventory_released = FALSE AND
status = ANY($2)` + `NOT EXISTS(settled payment)`), and expires on the policy window via
`backend/jobs/payment-reservation-scheduler.ts`. A sale commits by decrementing
`quantity`/`reserved` once and incrementing `products.sold_count` once.

## 10. Where is Stripe used?

Exactly one module: `backend/routes/stripe.ts`. It owns ONE lazily-created client
(`getStripe()`, line 108), Checkout Session creation (single order and checkout group),
session expiry, refunds, the webhook handler, and the payment-status/order-detail reads.
Other names that mention payments (`backend/routes/velrepeat-v2-payments.ts`) are
**consumers** of the same authority — they import from `./stripe.js`, use the same
`payments` table, the same `payment_events` claim store and the same
`backend/lib/payment-config.ts` gate. There is no second Stripe client.

## 11. Is there a webhook?

Yes. `POST /api/payments/stripe/webhook` (`backend/routes/stripe.ts:2503`). Raw body is
wired in `backend/server.ts` **before** `express.json`, because signature verification
needs the exact bytes.

## 12. Where is the webhook endpoint?

`POST /api/payments/stripe/webhook` — see 11. Handled event types (`handleStripeEvent`,
line 1672): `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`,
`payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`,
`charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`.

## 13. How is the signature verified?

`stripe.webhooks.constructEventAsync(rawBody, signatureHeader, STRIPE_WEBHOOK_SECRET)`
against the **raw** body. A missing/blank/mismatched secret or an invalid signature
answers 400 and performs no state change. A deployment that cannot verify at all is
detected explicitly (`selfTestWebhookSignature()`, line 191) rather than silently
accepting everything.

## 14. Which table holds payment status?

`payments.status`, with the vocabulary the code writes:
`pending`, `requires_action`, `processing`, `paid`, `failed`, `cancelled`
(plus the derived refund states reported to readers: `partially_refunded`, `refunded`,
which live on `payments.refund_status` and are folded into the answer). Migration 055
adds `payments_status_check` so an out-of-vocabulary value is rejected by the database.
`payments` has three possible parents — `order_id`, `checkout_group_id`, `plan_id` —
with `payments_at_least_one_parent_check` and `payments_single_domain_check` ensuring
exactly one.

## 15. Which table holds order status?

`orders.status`, constrained by `orders_status_check` (`db/schema.sql:1091`):
`pending`, `confirmed`, `packing`, `shipped`, `delivered`, `completed`, `cancelled`,
`pending_payment`, `paid`, `payment_failed`, `refunded`, `expired`.
`orders.inventory_released` is a separate boolean claim flag, not a status.

## 16. How does a refund work?

Admin-initiated: `POST /api/admin/orders/:orderId/refund` (`stripe.ts:2670`,
`requireAuth` + admin check) creates a Stripe refund and records it in `refunds`
(`payment_id`, `amount`, `status`, `reason`, `provider_refund_id`). Stripe then reports
the authoritative result through the webhook, which is what
`syncRefundFromStripe()` (`stripe.ts:1507`) consumes: it finds the payment — through the
**covering set**, so a grouped charge's refund is found from either member order — locks
the right rows, upserts `refunds` on `provider_refund_id`, and updates the payment's
`refunded_amount`/`refund_status` and the orders' status. A grouped refund has
`order_id IS NULL` + `checkout_group_id`, which migration 055 makes representable
(`refunds_parent_check` requires one of the two; `refunds.order_id` is no longer
`NOT NULL`).

## 17. How does cancellation work?

`PATCH /api/customer/orders/:orderId/cancel` (`backend/routes/cart.ts`). Ownership is
enforced in the `WHERE` clause (another user gets 404). The order status list comes from
one shared constant (`CUSTOMER_CANCELABLE_ORDER_STATUSES` →
`CANCELABLE_STATUSES`); a `paid`/`processing` payment is refused with 409
`ORDER_ALREADY_PAID` / `PAYMENT_IN_PROGRESS`; the Stripe session is expired; and the
status move, the payment void and the stock release happen in ONE transaction behind a
guarded `UPDATE ... WHERE status = ANY($2) RETURNING id` race gate. A grouped purchase
is cancelled **as one unit** through `terminateCheckoutGroup()`
(`backend/lib/checkout-group-lifecycle.ts`), which refuses outright when any member
order's charge is settled.

## 18. How does a seller receive money?

**They do not, automatically — there is no payout/money-movement implementation.** The
schema has no seller balance, ledger or payout table, and there is no Stripe Connect
integration. What exists is a **read-only computation** of what a seller is owed:
`backend/lib/seller-stats.ts` (`commissionRate`, `payout`) and
`backend/routes/seller-intelligence.ts` (`GET /api/seller/income` —
"income + commission report"). `backend/routes/admin.ts` reports the same commission
policy read-only, with a comment stating it does not compute payouts. Seller payout is a
**remaining production requirement** (Implementation doc §19).

## 19. How is commission calculated?

As a rate applied to an order's seller amount, for reporting only:
`commissionRate: 0.03` (3%) appears in `backend/routes/products.ts` and
`backend/routes/seller-orders.ts:249`; `backend/lib/seller-stats.ts` defines
`SELLER_RETURN_COVERAGE = 0.1` ("commission covers ≤10% returns") and returns
`{commission, commissionRate, payout}`. No commission row is persisted per order, and no
commission is deducted from a charge — the customer is charged the order total, full
stop. Persisting commission and driving a payout ledger from it is a remaining
production requirement.

## 20. Is there idempotency?

Yes, at three independent layers:

- **Webhook events** — `payment_events` with `event_id TEXT NOT NULL UNIQUE`, claimed
  by `INSERT ... ON CONFLICT (event_id) DO NOTHING` (`stripe.ts:2596`); a duplicate
  event is detected and does not re-run its side effects.
- **Checkout requests** — an idempotency store keyed `(user, scope, request_key)` with
  `scope = 'checkout'` for checkout and `scope = 'payment'` for payment, so a
  double-click or a retried request reuses the existing order/session instead of
  creating a second one.
- **Stock release / terminal transitions** — guarded `UPDATE`s that *claim* the
  transition (`inventory_released = FALSE`, `status = ANY(...)`), so a repeated or
  concurrent caller is an idempotent no-op.

## 21. Where are the race conditions?

The classes found and handled in this audit:

| Race | Where | Handling |
|---|---|---|
| Concurrent cancel vs. webhook writing `orders`+`payments` | cancel route, webhook | one shared lock order (`backend/lib/order-lock.ts`): every writer takes the order-row lock first, which removes the AB-BA deadlock |
| Concurrent checkout on the same product | `reserveInventoryStock` | single atomic conditional `UPDATE` on `quantity - reserved >= $1` |
| Double cancel / double release | `releaseOrderInventory` | atomic claim of `inventory_released`; the loser is a no-op |
| Duplicate/redelivered webhook | `payment_events` | unique `event_id` claim before any side effect |
| Late charge on an expired purchase | `settleCheckoutGroup` | refuses to move `expired` orders and records a durable operator incident instead of silently keeping the money |
| Second "pay" request while a session is open | `POST /api/stripe/checkout` | session reuse is gated on the same method and an open (`pending`/`requires_action`) state |
| Group expiry sweeping ONE member order | reservation sweep | expires the **whole** purchase through `terminateCheckoutGroup` |

## 22. Where can duplicate orders/payments occur?

Structurally prevented where the money is written: `idx_payments_one_active_stripe`
(UNIQUE on `order_id` WHERE `provider='stripe' AND status IN
('pending','requires_action')`) and its group twin prevent two *live* Stripe payments
for the same purchase; the checkout idempotency key prevents two orders from one
request; `orders.order_number` has a unique index and the insert retries only that
collision under a `SAVEPOINT`. Two Stripe Checkout Sessions for the same purchase are
prevented by the route reusing an existing open session rather than creating a new one.

## 23. Is there any fake/mock payment?

**No mock or fake payment rail exists in the payment path.** Grepping the checkout,
webhook, refund and config modules for fake/mock markers returns nothing. Stripe is the
only online provider and it is reached only through the real SDK. The two non-Stripe
modes are real, flag-gated, and default **off**: **COD** (`PAYMENT_METHOD.COD`, no
Stripe rail, `provider = 'CARRIER'`) and COD-for-VelRepeat. Both are enabled only when
their environment flag is the literal `true`/`1`; an absent or ambiguous value disables
them ("COD fails closed", `backend/lib/payment-config.ts:14`). Tests never stand in for
a payment: they use prototype-spied Stripe sessions against a real PostgreSQL, which is
labelled as a simulation wherever it appears.

## 24. How many legacy payment implementations are there?

**One** payment authority, with three payment *parents* — not three systems:

```
payments
├── order_id            → a single-order charge
├── checkout_group_id   → ONE charge for a multi-shop purchase
└── plan_id             → a VelRepeat prepaid plan charge
```

All three go through the same `payments` table, the same `payment_events` claim store,
the same `payment_incidents` mechanism, the same `payment-config.ts` method gate, and
the same `stripe.ts` client and webhook. Audit result for this phase: no parallel
ledger, no duplicate webhook processor, no unused payment endpoint, no second status
enum. What *did* exist was duplicate **logic** — a payment read that named only
`payments.order_id`, re-implemented at 24 call sites — and that is now the ONE
covering-set resolver (see the Implementation doc).

## 25. What is the source of truth for money?

**PostgreSQL, via the backend.** The chain is
`Stripe (authority on the provider's own payment) → signature-verified webhook →
backend → Neon → API → frontend`.
Concretely:

- amounts are computed by the backend from database rows and stored in `orders` /
  `payments` / `refunds` (NUMERIC, never float);
- the **webhook is the only writer of `paid`** — a browser redirect, a success page or
  a client claim can never set it;
- the storefront reads status back from `GET /api/orders/:orderId` and polls while the
  payment is unsettled, showing a "verifying" state rather than assuming success;
- a grouped purchase's money is resolvable from **every** member order through the
  covering set, which is what makes "one charge, N orders" consistent rather than
  contradictory.

---

## Multiple systems doing the same job — inventory of duplicates found

| Responsibility | Implementations found | Verdict |
|---|---|---|
| Per-order payment *read* | 24 hand-written `payments.order_id` subqueries across `cart.ts`, `stripe.ts`, `seller-orders.ts`, `center.ts`, `order-lock.ts`, `order-fulfillment.ts`, `inventory.ts`, `payment-reservation-scheduler.ts` | **Consolidated** into `backend/lib/payment-attempt.ts` (one resolver, one fold) |
| Group termination (cancel / expire / payment_failed) | cancel route had a group branch; the webhook failure paths and the expiry sweep did **not** | **Consolidated** into `backend/lib/checkout-group-lifecycle.ts` — one definition of "this purchase is over" |
| Payment status vocabulary | code constants + (before 055) no DB constraint | **Constrained** by `payments_status_check` |
| Refund parent | `refunds.order_id NOT NULL` — could not represent a grouped refund | **Generalised** by migration 055 |
| Stripe client | one (`getStripe()`) | no duplicate |
| Webhook processor | one (`POST /api/payments/stripe/webhook`) | no duplicate |
| Cart | one (`carts`/`cart_items` + `backend/routes/cart.ts`) | no duplicate |

## Defects proven in this audit (all reproduced against a real database)

1. **A paid purchase read as unpaid.** Every per-order payment read resolved the ledger
   by `payments.order_id` alone. A grouped purchase stores ONE payment row with
   `order_id IS NULL`, so the subquery returned NULL, `COALESCE(..., 'unpaid')` turned it
   into the string `'unpaid'`, and the UI showed `orders.status = 'paid'` beside
   "ยังไม่ชำระ".
2. **The confirm gate could never confirm.** Same blind read → no payment found → 409,
   so a seller could never ship a paid order.
3. **The stock-release guard would hand sold stock back.** No settled payment found →
   release allowed for a sold order.
4. **A paid purchase could be cancelled.** The cancellation gate found no settled
   payment → cancellation proceeded.
5. **The expiry sweep could expire a purchase the customer was still paying**, leaving
   the Stripe session OPEN, so a late charge could still land.
6. **A grouped refund raised 23502** (`refunds.order_id` NOT NULL) → webhook 500 →
   Stripe redelivered the same event forever.
7. **The failure/expiry webhook paths were never made group-aware** (found in this
   audit, the most severe). A group session carries
   `metadata.orderId = <representative order>`, so
   `checkout.session.async_payment_failed` / `checkout.session.expired` /
   `payment_intent.payment_failed` / `payment_intent.canceled` resolved to that ONE
   order, whose `payments.order_id` row does not exist → `moved: false` → **nothing
   happened at all**: the payment row stayed `requires_action` forever, the orders
   stayed `pending_payment` holding reserved stock, and the session was never closed.
   The sweep then expired ONE order (equally blind), leaving the session payable; the
   late charge reached `settleCheckoutGroup()`, which moved NO order (they were
   `expired`) and left `payments.status = 'paid'` with zero orders sold and **no
   incident recorded** — money taken, nothing sold, silently.

Defects 1–6 and 7 are all manifestations of the same architectural fault: **the payment
ledger was addressed by one column when a purchase's ledger is addressed by a set.**
