# Database

## Two canonical files — that is all `db/` contains

| File | Purpose |
|---|---|
| `db/schema.sql` | The canonical MVP DDL. The only description of the data model there is. |
| `db/run-sqleditor.sql` | The same DDL in dependency order for the Neon SQL Editor, ending in a read-only install check. |

Both files are **declaration-identical**, carry **no SQL comments** and contain
**no destructive or data-writing statement**. There is no `db/mvp/`, no
`db/migrations/`, no seed, no reset SQL and no third schema file, and
`db/run-update.sql` must never be recreated. How they are proved: `bun run
db:check` (installs both twice on a disposable PostgreSQL and diffs the dumps)
and `bun run db:verify` (static contract).

The production switch to this schema is planned, **not executed**:
`docs/PRODUCTION_CUTOVER.md`. Until it runs, production still holds the previous
database — changing the repository and changing production data are separate
acts.

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
| Development | `bun run db:reset` (`scripts/db-reset.sh`) — rebuilds the named database from `db/schema.sql` | database name must end `_dev`/`_test`; explicit `velnox.allow_reset=yes`; never reads `DATABASE_URL` |
| Test / CI | `bun run test:mvp` builds its own `velnox_mvp_app_test`; `bun run db:check` builds two more and drops them | `backend/db/test-database.ts` refuses Neon/production markers before any fixture loads |
| Production | **never reset**. It is created once by the cutover and changed only through `docs/PRODUCTION_CUTOVER.md` | no script in this repository targets it |

## Changing the schema

A schema change is an edit to **both** canonical files **in the same commit** —
the model in `db/schema.sql` and the same DDL in dependency order in
`db/run-sqleditor.sql` — followed by `bun run db:check`, `bun run db:verify` and
`bun run test:mvp`. There is no migration chain and there are no migration files
to add: an existing database is brought forward by re-running the guarded file,
which changes nothing that is already there.

After the cutover, the first post-cutover change must pick a migration strategy
before it lands. Until then, do not reintroduce `db/migrations/`.

## The MVP API (`backend/mvp/`) and its tables

`backend/mvp/` is the only backend tree; it is mounted unconditionally at
`/api/mvp` from `server.ts` and reads **only** the tables above. There is no
second route tree and no feature flag choosing between them — a switch whose
default hid the API would 404 every frontend call, and the tree it used to
protect is gone. Authorisation is re-checked on every request server-side.

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
bun run typecheck                         # 4 apps
(cd backend && bun tsc --noEmit)          # backend
bun test backend/tests packages/shared/tests   # static contract + client wrappers
bun run db:verify                         # the schema contract (no database needed)
bun run db:check                          # real PostgreSQL: both files, twice, diffed
bun run test:mvp                          # MVP API against a database built from db/schema.sql
bun run build:apps
```

`bun run test:mvp` creates `velnox_mvp_app_test` on the cluster named by
`TEST_DATABASE_URL`, applies `db/schema.sql`, runs `bun test backend/mvp/tests`
against it, and drops it. It never reads `DATABASE_URL`.
and drops the database. It never reads `DATABASE_URL`.
