# Database

## Two states during the MVP rewrite

| State | Files | Status |
|---|---|---|
| **MVP — canonical** | `db/mvp/schema.sql`, `db/mvp/reset.sql`, `db/mvp/seed.sql` | The MVP data model. Edited here; proved by `db/mvp/verify.sh`. |
| **Pre-MVP — frozen** | `db/schema.sql`, `db/run-sqleditor.sql`, `db/migrations/*.sql` | The database the deployed backend still reads. Byte-for-byte unchanged until the cutover. |

The cutover is designed but **not executed**: `db/mvp/cutover.md`. `db/README.md`
is the file map. There is no third schema file and `db/run-update.sql` must never
be recreated.

## Source of truth

Neon PostgreSQL is the runtime source of truth. The backend is the only process
that connects to it (`backend/db/index.ts`, one pool). The frontend never holds
`DATABASE_URL` or any other server secret.

## MVP tables (20)

| Domain | Tables | Purpose |
|---|---|---|
| Identity | `users`, `revoked_tokens` | email + password (scrypt hash), roles `customer/seller/admin/owner`, JWT `jti` revocation |
| Seller | `seller_profiles` | store identity + lifecycle `pending → approved/rejected/suspended`, approver evidence, no self-approval |
| Catalog | `categories`, `products`, `product_images`, `product_variants` | category tree (slug-keyed), product lifecycle, gallery, flat variants with their own price |
| Inventory | `inventory` | **the only stock authority**, one row per `(product_id, variant_id)` |
| Selling units | `product_selling_units` | seller-defined set/pack: `label`, `base_quantity` base units, its own `price`, `is_active`; **owns no stock** |
| Customer | `addresses` | owner-scoped shipping addresses, at most one default |
| Cart | `carts`, `cart_items` | one cart per `(buyer, seller)`; line seller is FK-locked to both cart and product |
| Checkout | `checkout_requests` | idempotency key `(user_id, request_key)` |
| Orders | `orders`, `order_items`, `shipments` | one seller per order, immutable snapshots, one canonical status |
| Payments | `payments`, `payment_events` | Stripe only; one live session per order; one claim row per webhook event |
| Media / audit | `media`, `audit_logs` | R2 object registry; admin control trail |

## One order model

```
pending_payment ──paid──▶ processing ──▶ shipped ──▶ delivered
       │                     │
       └──cancelled          └──cancelled
```

- `orders.status` is the **only** order state. There is no `order_state`,
  `fulfillment_status`, payment fold or `inventory_released` flag.
- Transitions are enforced by `trg_orders_status_transition`; a legal-looking
  status reached by an illegal jump is refused.
- Timestamps are required by CHECKs: `paid_at` for paid/processing/shipped/
  delivered, `shipped_at` for shipped/delivered, `delivered_at` for delivered,
  `cancelled_at` for cancelled.
- `shipping_address` is an immutable JSONB snapshot and `order_items` stores the
  sold name, unit price and subtotal. Historical orders are never recomputed from
  the current product price.

## One inventory model

`inventory(product_id, variant_id)` — `variant_id IS NULL` is the base product.
`quantity` is on-hand, `reserved` is held by a pending checkout.

```
0 <= reserved <= quantity          (CHECK inventory_reserved_within_stock)
```

Reserve atomically (one statement, row lock):

```sql
UPDATE inventory
   SET reserved = reserved + $n
 WHERE product_id = $1
   AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = $2
   AND quantity - reserved >= $n
RETURNING id;
```

Settle in the same transaction as the order/payment update:

```sql
UPDATE inventory SET quantity = quantity - $n, reserved = reserved - $n ...
```

Release once on cancellation/expiry: `reserved = reserved - $n`. An oversell
attempt updates **0 rows** and is not an error to hide; the caller must stop.
`product_variants` has no stock column, so the two authorities cannot disagree.

## One payment model

```
order (pending_payment)
  → payments row (pending, server-derived amount)
  → Stripe Checkout session
  → customer pays at Stripe
  → signed webhook (raw body) → payment_events claim (event_id UNIQUE)
  → ONE transaction: payments.paid + orders.paid + stock commit
  → frontend reads GET /api/orders/:id (never treats the redirect as success)
```

- Frontend success never marks an order paid; the database does not do it on its
  own either — only the verified webhook path writes both rows.
- `idx_payments_one_active_stripe` forbids a second live session per order.
- Refunds, COD and mock payments are outside the MVP.

## Reset strategy

| Environment | How it is rebuilt | Guard |
|---|---|---|
| Development | `db/mvp/reset.sh --database-url … --seed` | database name must end `_dev`/`_test`; explicit `velnox.allow_reset=yes`; never `DATABASE_URL` |
| Test / CI | same script, or `db/mvp/verify.sh` which creates its own disposable databases | same, plus `backend/db/test-database.ts` refuses Neon/production markers |
| Production | **never reset**. It is created by the cutover and changed only through the approved cutover plan | no script in this repository targets it |

## Changing the MVP schema

Until the MVP database exists in production, a schema change is an edit to
`db/mvp/schema.sql` plus a fresh `db/mvp/reset.sql` run — there is no deployed
MVP database to migrate and therefore no MVP migration chain yet.

After the cutover, the first MVP migration strategy must be chosen before the
first post-cutover change. Do not add files to `db/migrations/`: that directory
is pre-MVP history and is frozen.

## The MVP API (`backend/mvp/`) and its tables

Phase 3 adds the MVP backend as a self-contained tree that reads **only** the
tables above. It is mounted under `/api/mvp` and is enabled by
`MVP_API_ENABLED=true`; the pre-MVP routes mounted in `server.ts` are untouched.

| Domain | Tables it writes | Tables it reads |
|---|---|---|
| Auth | `users`, `revoked_tokens` | `users` |
| Seller | `seller_profiles`, `users.role` | `seller_profiles` |
| Catalogue | — | `categories`, `products`, `product_variants`, `product_images`, `inventory`, `seller_profiles` |
| Seller products | `products`, `product_variants`, `product_images`, `inventory`, `audit_logs` | own product rows |
| Cart | `carts`, `cart_items` | `products`, `product_variants`, `inventory`, `seller_profiles` |
| Checkout / orders | `orders`, `order_items`, `checkout_requests`, `carts`, `cart_items`, `inventory`, `audit_logs` | `addresses`, `products`, `product_variants`, `seller_profiles` |
| Payments | `payments`, `payment_events`, `orders`, `inventory`, `audit_logs` | `payments`, `order_items` |
| Admin | `seller_profiles`, `products`, `categories`, `users`, `audit_logs` | all of the above (counts only) |

Money is `NUMERIC(12,2)` everywhere; `backend/mvp/*` never converts a money
column to a JavaScript number. The lifecycle machines stay in the database
triggers — the API maps a refused transition to HTTP 409 instead of restating
the machine.

## Verification

```bash
bun run typecheck
bun test backend/tests/mvp-schema-contract.test.ts   # static contract (pre-MVP suite)
bun run db:verify:mvp                                # real PostgreSQL, 93 schema checks
bun run test:mvp                                     # MVP API, disposable MVP database
```

`bun run test:mvp` creates `velnox_mvp_app_test` on the cluster named by
`TEST_DATABASE_URL`, applies `db/mvp/schema.sql`, runs `bun test backend/mvp/tests`
and drops the database. It never reads `DATABASE_URL`.
