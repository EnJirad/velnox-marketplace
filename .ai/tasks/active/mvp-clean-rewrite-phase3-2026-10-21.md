# Velnox Phase 3 — Core backend rewrite against the clean MVP schema

**Date:** 2026-10-21 · **Branch:** `main` · **Status:** COMPLETE for the Phase 3 scope
(9 of 9 domains implemented and tested). **Production not touched. Cutover not executed.**

---

## 1. Verified GitHub SHAs

| Item | Value |
|---|---|
| Starting `HEAD` | `1275a1180bccefc3843fe4bb332ab9091ddd7505` |
| Starting `origin/main` | `1275a1180bccefc3843fe4bb332ab9091ddd7505` |
| `git ls-remote origin refs/heads/main` | `1275a1180bccefc3843fe4bb332ab9091ddd7505` |
| Working tree at start | clean (`## main...origin/main`) |
| Phase 2 baseline from the brief | `1275a1180bccefc3843fe4bb332ab9091ddd7505` — **exact match** |

GitHub had not advanced past the Phase 2 baseline, so no remote work was superseded.

**Final commit:** the `feat(mvp): …` commit on `main` containing this report (SHA recorded in
`.ai/AI_HANDOFF.md` §86 and in the delivery message — a later commit cannot contain its own hash).
Verified with `git rev-parse HEAD`, `git rev-parse origin/main` and
`git ls-remote origin refs/heads/main` all equal after push.

---

## 2. Backend architecture and route-consumer inventory

### 2.1 Two trees, one database each

| Tree | Mount | Database | Status |
|---|---|---|---|
| Pre-MVP (`backend/routes`, `backend/lib`, `backend/jobs`) | `/api/*`, `/auth/*`, `/ws` | the frozen 77-table pre-MVP database | **unchanged**, still the deployed API |
| MVP (`backend/mvp/*`) | `/api/mvp/*` | `db/mvp/schema.sql` (19 tables) | **new**, opt-in via `MVP_API_ENABLED=true` |

Why the MVP API is a namespace instead of in-place edits (the routing strategy the brief asks
for):

- the deployed Render service points `DATABASE_URL` at a database that has `shops`,
  `product_selling_units`, `checkout_groups`, `auth_identities`, … and **none** of the MVP
  shapes. Rewriting the existing paths in place would break all four frontends and the 76-file
  legacy suite at once;
- `db/mvp/cutover.md` §3 requires the code to exist **before** the schema cutover, precisely so
  the schema never leads the code;
- a namespace makes the compatibility surface explicit: nothing that exists today changed
  behaviour, and nothing new is reachable until the owner flips one flag on a database built from
  the MVP schema.

`MVP_API_ENABLED` defaults to **off**. `server.ts` therefore behaves exactly as before on the
deployed database; the flag is flipped in the same maintenance window as `DATABASE_URL`
(cutover §3 step 6).

### 2.2 Reused infrastructure (no second implementation)

| Concern | Module | Note |
|---|---|---|
| Pool, `query`, `withTransaction` | `backend/db/index.ts` | the same single pool; test-database guard unchanged |
| JWT verification + `revoked_tokens` cache | `backend/middleware/auth.ts` | the MVP cookie is the same contract, so this verifies MVP tokens unchanged |
| scrypt password hashing | `backend/lib/password.ts` | same cost parameters, no new scheme |
| Exact money arithmetic | `backend/lib/money.ts` | `NUMERIC(12,2)` strings, integers only |
| 18-digit order numbers | `backend/lib/order-number.ts` | `^[0-9]{18}$` matches the schema CHECK |
| Stripe test-mode policy | `backend/lib/payment-config.ts` | **live keys are refused**, not warned about |
| Admin pagination | `backend/lib/pagination.ts` | bounded pages, exact totals |
| Raw webhook body | `backend/middleware/stripe-raw-body.ts` | generalised to a path list; the pre-MVP export is unchanged |
| Rate limits | `backend/middleware/rate-limit.ts` | four new `/api/mvp` rules added to the existing registry |

### 2.3 Route inventory

| Domain | Endpoints | Writes | Reads |
|---|---|---|---|
| Auth | `POST /api/mvp/auth/{signup,login,logout,bootstrap-owner}` · `GET /api/mvp/auth/me` · `GET /api/mvp/auth/oauth` (501) | `users`, `revoked_tokens` | `users`, `seller_profiles` |
| Seller | `POST /api/mvp/seller/apply` · `GET /api/mvp/seller/status` | `seller_profiles` | `seller_profiles`, `products` (counts) |
| Seller products | `POST /api/mvp/seller/products` · `GET …/products[/:id]` · `PATCH …/:id` · `POST …/:id/{submit,publish,variants}` · `PATCH …/:id/variants/:variantId` · `PUT …/:id/inventory` | `products`, `product_variants`, `product_images`, `inventory`, `audit_logs` | own product rows |
| Catalogue (public) | `GET /api/mvp/categories` · `GET /api/mvp/products[/:slug]` | — | `categories`, `products`, `product_images`, `product_variants`, `inventory`, `seller_profiles` |
| Cart | `GET /api/mvp/cart` · `POST /api/mvp/cart/items` · `PATCH|DELETE /api/mvp/cart/items/:id` | `carts`, `cart_items` | `products`, `product_variants`, `inventory`, `seller_profiles` |
| Checkout | `POST /api/mvp/checkout` | `checkout_requests`, `orders`, `order_items`, `inventory`, `cart_items`, `carts`, `audit_logs` | `addresses`, `products`, `product_variants`, `seller_profiles` |
| Payments | `POST /api/mvp/orders/:id/payment-session` · `GET /api/mvp/orders/:id/payment-status` · `POST /api/mvp/payments/webhook` · `GET /api/mvp/payments/status` | `payments`, `payment_events`, `orders`, `inventory`, `audit_logs` | `payments`, `order_items` |
| Orders | `GET /api/mvp/orders[/:id]` · `POST /api/mvp/orders/:id/cancel` | `orders`, `inventory`, `audit_logs` | `orders`, `order_items`, `payments`, `shipments` |
| Seller fulfilment | `GET /api/mvp/seller/orders` · `PATCH /api/mvp/seller/orders/:id/status` | `orders`, `shipments`, `audit_logs` | `orders`, `order_items`, `payments` |
| Admin | `GET /api/mvp/admin/{sellers,products,categories,metrics}` · `POST /api/mvp/admin/sellers/:id/{approve,reject,suspend}` · `POST /api/mvp/admin/products/:id/{approve,reject}` · `POST /api/mvp/admin/categories` · `PATCH|DELETE /api/mvp/admin/categories/:id` · `POST /api/mvp/admin/maintenance/expire-pending-orders` | `seller_profiles`, `products`, `categories`, `users.role`, `audit_logs` | counts + queues |

### 2.4 Consumers traced before each domain

| Consumer | What it does today | Phase 3 impact |
|---|---|---|
| `apps/velshop` (storefront, cart, checkout) | calls `/api/products`, `/api/customer/cart`, `/api/customer/checkout`, `/api/stripe/*` | **none** — those routes are untouched. It does not call `/api/mvp`. |
| `apps/velseller` (seller workspace) | `/api/seller/*`, `/api/seller/orders/*` | none — untouched |
| `apps/velcenter` (staff console) | `/api/admin/*`, `/api/center/*`, `/api/seller/:id/verification` | none — untouched. MVP admin has **no** staff/RBAC surface by design. |
| `apps/velnox` (corporate site) | static marketing | none |
| `packages/shared` (`api-routes.ts`, api client) | the pre-MVP route constants | **not modified**; an MVP client is new work (see §10) |
| `backend/jobs/*` (VelRepeat, reservation sweeps) | pre-MVP tables | untouched; MVP expiry is an admin endpoint, not a job |
| WebSocket `/ws` | pre-MVP event channels | untouched; the MVP API publishes no realtime events (no consumer) |

---

## 3. Domains completed / pending

| # | Domain (brief §3 order) | Status | Test file |
|---|---|---|---|
| 1 | Auth + session/token revocation | **DONE** | `auth.test.ts` |
| 2 | Seller application, approval, suspension | **DONE** | `seller-lifecycle.test.ts`, `admin.test.ts` |
| 3 | Categories + product management | **DONE** | `product-lifecycle.test.ts`, `admin.test.ts` |
| 4 | Public catalogue + product detail | **DONE** | `catalog.test.ts` |
| 5 | Cart + inventory validation | **DONE** | `cart-checkout.test.ts`, `product-lifecycle.test.ts` |
| 6 | Checkout + order creation | **DONE** | `cart-checkout.test.ts` |
| 7 | Stripe Test Mode payment | **DONE (code) / NOT ROUND-TRIPPED** | `payments.test.ts`, `money.test.ts` |
| 8 | Order history + permitted transitions | **DONE** | `cart-checkout.test.ts`, `payments.test.ts` |
| 9 | Minimal admin operations + metrics | **DONE** | `admin.test.ts` |

Nothing in the brief's §3 list is pending. What is **not** implemented is either explicitly out of
scope (§6 of the brief: VelRepeat, memory, wholesale, sets/packs, multi-seller checkout, reviews,
wishlist, chat, seller goals, staff permissions, COD, refunds, new mobile apps, frontend/dashboard
redesign, WebSocket/worker rewrite) or recorded as a limitation in §9 below (OAuth, R2 upload,
payment round trip, scheduler).

---

## 4. New / rewritten / parked modules

### New (`backend/mvp/`, 17 modules)

| File | Responsibility |
|---|---|
| `index.ts` | entry point, route inventory, `MVP_API_ENABLED` gate |
| `http.ts` | envelope, `ApiError` → HTTP mapping (incl. `23514`/`P0001` → 409), validation, the ONE identity decision (`requireActiveUser`/`requireAdmin`/`requireApprovedSeller`) |
| `session.ts` | mint / set / revoke the `velnox_session` cookie and the `revoked_tokens` claim |
| `audit.ts` | the ONE MVP audit writer (`actor_id` / `metadata` shape), sanitised, transaction-aware |
| `inventory.ts` | the ONLY writer of `inventory`: guarded reserve, commit, release, set-level |
| `checkout.ts` | one-transaction cart → order (snapshots, idempotency, rollback), cancellation, expiry sweep |
| `settlement.ts` | the ONLY code that marks an order paid: event claim, payment/order/amount checks, single stock commit |
| `product-rules.ts` | MVP status vocabulary, slug generation, **material-change definition** |
| `auth.ts`, `seller.ts`, `seller-products.ts`, `catalog.ts`, `cart.ts`, `orders.ts`, `payments.ts`, `admin.ts` | route modules (one per domain) |
| `webhook-body.ts` | raw-body middleware for `/api/mvp/payments/webhook` (reuses the shared matcher) |

### New (support)

- `db/mvp/test-run.sh` — creates `velnox_mvp_app_test` from `db/mvp/schema.sql`, runs
  `bun test backend/mvp/tests`, drops it. Never reads `DATABASE_URL`; refuses a non-`_test` name
  through the existing guard.
- `backend/mvp/tests/` — 9 test files + `helpers/mvp-app.ts` (real HTTP app, DB-shape refusal,
  fixtures, signed webhook delivery). 81 tests, 439 assertions.

### Rewritten

Nothing pre-MVP was rewritten. Deliberately: the brief's §4 says to keep the existing path
operational while isolating the new implementation, and the cutover plan makes deletion a
separate, later step.

### Edited (minimal, justified)

| File | Change |
|---|---|
| `backend/server.ts` | import + `app.use(mvpWebhookRawBody)` before `express.json()`; `if (isMvpApiEnabled()) setupMvpRoutes(app)` |
| `backend/middleware/stripe-raw-body.ts` | added `isPaymentWebhookRequest` + `stripeWebhookRawBodyFor(paths)`; existing exports and behaviour unchanged |
| `backend/middleware/rate-limit.ts` | four `/api/mvp` rules (auth, checkout, payment session, seller/admin mutations) before the catch-all |
| `backend/tsconfig.json` | `mvp/tests` added to `exclude` (same convention as `tests`) |
| `backend/tests/shipment-idempotency.test.ts` | the "one shipment writer" static assertion is now **per tree**: pre-MVP expectation unchanged, MVP tree pinned to `backend/mvp/seller.ts` |
| `package.json` | `test:mvp` script |
| `.github/workflows/test.yml` | one step: `bun run test:mvp` (own disposable database) |
| `AGENTS.md`, `.ai/context/database.md`, `docs/DATABASE.md`, `db/README.md`, `INSTALLATION.md` | document the two trees, `MVP_API_ENABLED`, `BOOTSTRAP_OWNER_SECRET`, `bun run test:mvp` |

### Parked (not deleted, not mounted, not re-enabled)

- Google OAuth (`/api/mvp/auth/oauth` answers **501 OAUTH_PARKED**; the pre-MVP Google flow is
  untouched and still mounted).
- R2 upload / `media` (MVP products store image URLs; no presign route, no `media` write).
- Reviews, wishlist, chat, notifications, VelRepeat, wholesale/store accounts, staff RBAC,
  `apps/velnox`, the four boot-time `ensure*` functions, all 62 migrations, the pre-MVP canonical
  SQL pair.

---

## 5. API compatibility and frontend impact

| Question | Answer |
|---|---|
| Did any existing endpoint change path, shape, status code or auth? | **No.** No pre-MVP route file was modified. |
| Does any frontend call `/api/mvp`? | **No.** All four apps keep using the pre-MVP routes. |
| Is the session cookie compatible? | **Yes, identical contract** (`velnox_session`, httpOnly, SameSite=None, Secure in prod, 7-day, `{userId,email,jti}`). A token issued by the MVP login verifies with the existing middleware — proven by `auth.test.ts`. |
| What happens on the deployed (pre-MVP) database if the flag is set by mistake? | The MVP routes would fail on missing tables, but nothing calls them and the flag defaults to OFF. The cutover checklist requires the flag and `DATABASE_URL` to change together. |
| Frontend work still required | A new MVP client in `packages/shared` + the three dashboards' MVP screens (see §10). `packages/shared/src/lib/api-routes.ts` was intentionally left untouched so the existing clients cannot half-migrate. |

---

## 6. Tables and columns used per domain

| Domain | Tables (columns that matter) |
|---|---|
| Auth | `users` (`id,email,name,role,status,password_hash`), `revoked_tokens` (`token_id,user_id,expires_at`) |
| Seller | `seller_profiles` (`id,user_id,store_name,slug,description,status,rejection_reason,approved_at,approved_by,suspended_at,suspension_reason`), `users.role` (cached only) |
| Products | `products` (`seller_id,category_slug,name,slug,description,price,status,rejection_reason,submitted_at,approved_at,approved_by,published_at`; `approval_status` is GENERATED and never written), `product_variants` (`product_id,name,sku,price,status,sort_order`), `product_images` (`product_id,url,alt,sort_order`), `inventory` (`product_id,variant_id,quantity,reserved`) |
| Catalogue | same as products, **read-only**, plus `categories` (`slug,name,names,parent_id,sort_order,is_active`) and `seller_profiles.status` |
| Cart | `carts` (`user_id,seller_id`), `cart_items` (`cart_id,seller_id,product_id,variant_id,quantity,price` — price is a display snapshot) |
| Checkout | `checkout_requests` (`user_id,request_key,order_id,response`), `orders` (`order_number,user_id,seller_id,status,subtotal,shipping_fee,total_amount,currency,shipping_address,notes,payment_expires_at,paid_at,payment_reference,cancelled_at,cancel_reason`), `order_items` (`order_id,seller_id,product_id,variant_id,product_name,variant_name,image_url,unit_price,quantity,subtotal`) |
| Payments | `payments` (`order_id,provider,status,amount,currency,method,provider_checkout_session_id,provider_payment_intent_id,paid_at`), `payment_events` (`event_id,event_type,status,error,payload`) |
| Orders | `orders`, `order_items`, `payments` (status/amount/method/timestamps only), `shipments` (`carrier,tracking_number,shipped_at,delivered_at`) |
| Admin | `seller_profiles`, `products`, `categories`, `users.role`, `audit_logs` (`actor_id,action,entity_type,entity_id,metadata`) |

No MVP module names a table that is absent from `db/mvp/schema.sql`
(`backend/mvp/tests/isolation.test.ts`).

---

## 7. Invariants verified

Each line names the proof, not an intention.

### Authentication / authorization

- Passwords are scrypt hashes (`$scrypt$…`); no response contains a hash or a secret
  (`auth.test.ts`).
- Login answers **identically** for an unknown e-mail and a wrong password, and runs a dummy
  verification for the unknown case (`auth.test.ts`).
- Logout persists the `jti` in `revoked_tokens`; the SAME cookie is then refused
  (`auth.test.ts`).
- A suspended account cannot log in (`403 ACCOUNT_NOT_ACTIVE`), and a suspended user's existing
  session is re-checked against `users.status` on every request (`requireActiveUser`).
- A token naming a user absent from this database is treated as unauthenticated.
- `role` is never accepted from a request body; signup is always `customer`. The first owner can
  only be created by `POST /api/mvp/auth/bootstrap-owner` with `BOOTSTRAP_OWNER_SECRET` and only
  while no admin exists (`auth.test.ts`).
- Admin routes answer 403 to customers and sellers, 401 to anonymous (`admin.test.ts`).

### Seller lifecycle

- `pending`, `rejected` and `suspended` sellers are refused **by the server** on every product,
  inventory and order operation (`403 SELLER_NOT_APPROVED`), not by a hidden button
  (`seller-lifecycle.test.ts`).
- Approval is admin-only; a seller approving their own application is refused by the DB
  constraint `seller_profiles_no_self_approval` (`409`), not merely by an app check.
- Rejection requires a written reason; a rejected application may be corrected and resubmitted.
- Suspension immediately removes the seller's listings from the public catalogue, and a cart
  filled before the suspension fails at checkout with `SELLER_NOT_APPROVED`.

### Product lifecycle / moderation

- The only transitions that succeed are `draft→submitted→approved→published`, plus
  `→rejected`, `rejected→draft|submitted`, `published→draft`. Illegal moves are refused
  (`409 CONSTRAINT_VIOLATION`) by the schema triggers, e.g. publishing a draft, approving a
  draft, delivering from `paid`.
- A client-supplied `status` is ignored: a new product is always `draft`.
- Only `published` products appear in any public response; `draft`, `submitted`, `approved` and
  `rejected` are 404 on detail and absent from lists (`catalog.test.ts`).
- **Published-edit rule (explicit):** a MATERIAL change to a published listing returns it to
  `draft` and it must be re-submitted and re-approved before it is purchasable. Material fields:
  name, description, price, category, images, and the variant set (add / remove / re-price /
  re-name / deactivate). **Stock is not material.** Verified for price, images, variant price and
  added variant; a no-op edit and a restock leave the listing published
  (`product-lifecycle.test.ts`).
- `submitted` and `approved` listings are read-only for the seller: the schema's transition set
  has no withdrawal edge, so `withdraw` is not offered rather than being silently allowed
  (`409 PRODUCT_LOCKED`).
- Another seller's product id is a 404, never a 403.

### Cart / inventory

- One cart per `(user, seller)`; adding a second seller's product creates a second cart and never
  merges them (`cart-checkout.test.ts`).
- A cart line naming a different seller is refused **by the database** (composite FKs), proven by
  a direct insert attempt.
- Reservation is a guarded atomic `UPDATE … WHERE quantity - reserved >= $n`; two concurrent
  checkouts for the last unit produce exactly one `201` and one `409 OUT_OF_STOCK`, and exactly
  one order row.
- A multi-line checkout where one line is short reserves **nothing**: the earlier line's
  reservation is rolled back with the transaction, no order exists, and the cart is intact.
- A seller cannot set stock below the reserved quantity (`409 STOCK_BELOW_RESERVED`) — proven
  after a real order reserved a unit.

### Checkout / orders

- Order totals come from `products`/`product_variants` read inside the checkout transaction. A
  corrupted `cart_items.price` (set to `0.01`) and client-supplied `total`/`subtotal`/`items`
  amounts do not change the order: `246.90` was charged for 2 × `123.45`
  (`cart-checkout.test.ts`).
- The same `requestKey` returns the SAME order (`200` + `replayed: true`), one order row, and one
  reservation; a second checkout of the same cart with a new key creates no second order.
- `order_items` store name/price/quantity snapshots and `orders.shipping_address` stores an
  immutable JSON snapshot, so later edits cannot rewrite history.
- Order numbers match `^[0-9]{18}$`.
- Cancelling an unpaid order releases the reservation exactly once, is idempotent on repeat, and
  is a 404 for anyone but the owner. A **paid** order cannot be cancelled (`409`): refunds are out
  of scope, so un-paying is refused rather than faked.
- A buyer can read only their own orders (list and detail); another user's id is a 404.
- Seller fulfilment accepts only `processing`/`shipped`/`delivered`; `paid → delivered` is refused
  by the trigger; `shipped` writes the shipment row, `delivered` stamps it.

### Payments

- Stripe **test mode only**: `lib/payment-config.ts` refuses a live key, an unrecognised key, a
  declared live mode, or a missing webhook secret; `POST …/payment-session` then answers
  `503 STRIPE_NOT_CONFIGURED` and writes no payment row (`payments.test.ts`).
- The signature is verified over the RAW body (`constructEventAsync`), with the raw-body
  middleware mounted before `express.json()` — pinned by `isolation.test.ts`.
- A forged signature is `400` and writes **no** `payment_events` row.
- The event id is claimed with `INSERT … ON CONFLICT (event_id) DO NOTHING` inside the settlement
  transaction: a redelivered event answers `duplicate: true` and changes nothing; a *different*
  event for the same session answers `ALREADY_SETTLED`; stock is committed once.
- Settlement requires the payment row, the order row, `payments.amount`, `orders.total_amount`,
  Stripe's `amount_total` and the currency to agree. A one-minor-unit difference or a currency
  mismatch records a `failed` event, writes `PAYMENT_MISMATCH` to the audit log and leaves the
  order `pending_payment`.
- A paid webhook for a cancelled order is recorded (`PAYMENT_AFTER_CANCELLATION`) and never
  re-opens the order or commits stock.
- The buyer-facing `payment-status` reports the server's state only; a redirect/session id is not
  accepted as evidence.
- `toStripeMinor` and `amountMatches` are pinned by `money.test.ts`. **Two real defects were
  caught by these tests before commit:** both multiplied a `roundHalfUp(x, 2)` result by 100
  again, i.e. a 100× charge and an always-failing amount check. Fixed, then pinned.

---

## 8. Exact verification commands and results

All run on 2026-10-21 in this workspace, PostgreSQL 14.24 at `127.0.0.1:5432`.

| Command | Result |
|---|---|
| `cd backend && bunx tsc --noEmit` | **exit 0** |
| `bun run typecheck` (velshop · velseller · velcenter · velnox) | **4/4 exit 0** |
| `bun run build:apps` | **4/4 exit 0** (built in ~5 s each) |
| `bun run i18n:check` | `th=1535 en=1535 my=1535` — parity |
| `bun test backend/tests/mvp-schema-contract.test.ts` | **19 pass / 0 fail**, 161 assertions |
| `TEST_DATABASE_URL=… bun run db:verify:mvp` (`db/mvp/verify.sh`) | **81/81 checks passed** |
| `bun run test:mvp` (`db/mvp/test-run.sh`) | **81 pass / 0 fail**, 439 assertions, 9 files |
| `TEST_DATABASE_URL=… bun test backend/tests` (legacy suite, pre-MVP DB) | **2162 pass / 20 skip / 0 fail**, 18,553 assertions, 76 files |
| `git diff --check` | clean |

Notes on the skips and on one assertion change:

- The 20 skips are the wholesale-gated suite plus JWT-gated cases that need `JWT_SECRET` in the
  shell; they are environmental, not failures. Phase 2 recorded 16 skips with a JWT secret set.
- `backend/tests/shipment-idempotency.test.ts` asserts "exactly ONE non-test file inserts a
  shipment". The MVP tree legitimately contains a second writer for a different schema. The
  assertion was **scoped, not weakened**: the pre-MVP expectation (`backend/lib/order-shipment.ts`
  and nothing else) is unchanged, and the MVP tree is now pinned to exactly
  `backend/mvp/seller.ts`. The first legacy run failed on this single test; after the scoping
  change the suite is green.
- The MVP suite creates and drops `velnox_mvp_app_test` on the cluster named by
  `TEST_DATABASE_URL`; it never reads `DATABASE_URL` and refuses any database whose name does not
  end in `_test` or that contains the pre-MVP `shops` table (`helpers/mvp-app.ts`).

---

## 9. Known blockers, assumptions, unverified behaviour

1. **No real Stripe TEST round trip.** This workspace holds no `STRIPE_SECRET_KEY` /
   `STRIPE_WEBHOOK_SECRET`, so `checkout.sessions.create` was **never executed against Stripe**.
   What *is* proven: the 503 guard, the exact minor-unit conversion, signature verification with a
   genuine HMAC produced by the Stripe SDK, event claiming, amount/currency checks, single stock
   commit, retry/duplicate behaviour, and the fulfilment path after settlement. What is **not**
   proven: that Stripe accepts the session payload, the hosted page renders, a real PaymentIntent
   is created, and a real delivery reaches the endpoint. Reported as **CODE VERIFIED, NOT
   ROUND-TRIPPED**.
2. **Google OAuth is parked.** `/api/mvp/auth/oauth` answers 501 with an explicit code; the
   pre-MVP flow still works against the pre-MVP database. At cutover, Google-only accounts have no
   MVP identity (`auth_identities` does not exist in the MVP schema) — a product decision is
   required before cutover.
3. **R2 upload is not part of the MVP API.** `product_images.url` accepts an external http(s) URL;
   no presign/confirm route and no `media` write. `/api/upload/*` is pre-MVP and untouched.
4. **The expiry sweep needs a scheduler.** `POST /api/mvp/admin/maintenance/expire-pending-orders`
   is idempotent and tested, but nothing calls it on a timer; the MVP has no worker rewrite in
   scope. Unpaid orders hold stock until it runs (or the buyer cancels).
5. **No frontend consumes the MVP API**, so no browser E2E was possible. The four apps and
   `packages/shared` were not modified.
6. **`MVP_API_ENABLED` must stay unset on the deployed pre-MVP service.** Enabling it there would
   expose endpoints whose tables do not exist. It is flipped only with the cutover.
7. **Schema-imposed limitations, recorded not worked around:** no seller withdrawal from
   `submitted`/`approved`; no refund edges (so `paid → cancelled` is never exposed); product
   ownership is immutable at the DB level.
8. **Shipping is a flat `0.00`.** `db/mvp/schema.sql` has `shipping_fee` but no shipping-price
   model; `total = subtotal` and `orders_total_matches_parts` holds.
9. **Cart line quantity is capped at 999** per line (`LEAST(…, 999)`); no test asserts the clamp
   itself.
10. **Rate limiting is per process** (pre-existing design, no shared store). The new `/api/mvp`
    rules inherit that limitation.
11. **PostgreSQL 14 locally, 16 in CI/Neon.** No behaviour difference was observed, but the MVP
    schema was not executed on 16 in this pass.
12. **Production database identity is still unproven** (Phase 2 §66). Nothing in Phase 3 connects
    to, writes to, or resets any production database; the cutover remains unexecuted.

---

## 10. Recommended next task

**Phase 3b — make the MVP API reachable by a real client on a disposable/staging database,
without touching production:**

1. Add an MVP API client + route constants to `packages/shared` (new namespace, do not edit the
   existing `api-routes.ts`), and a feature flag that keeps the current build pointed at the
   pre-MVP API.
2. Wire velShop's catalogue → cart → checkout → order-status screens to it on a staging database
   built from `db/mvp/schema.sql` with `MVP_API_ENABLED=true`, and run the first browser E2E.
3. Decide the two product questions this phase could not: **Google OAuth at cutover** and
   **R2 media upload** for MVP products.
4. Only then, run `db/mvp/cutover.md` steps 1–6 (new database → staging backend → provided
   round-trip → CI switch → Render switch), keeping the old database read-only for rollback.

Do not start Phase 4, delete pre-MVP modules, or execute the cutover as part of Phase 3.
