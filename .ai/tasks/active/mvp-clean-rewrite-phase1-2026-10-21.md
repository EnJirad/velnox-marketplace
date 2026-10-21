# PHASE 1 — CLEAN MVP FOUNDATION

**Date:** 2026-10-21
**Repository:** `EnJirad/velnox-marketplace`, branch `main`
**Baseline SHA (verified against GitHub this turn):** `84b376793eb81e5a374f9993701da72c8ea2331d`
**Phase 0 input:** `.ai/tasks/active/mvp-clean-rewrite-phase0-audit-2026-10-21.md`
**Scope of this phase:** repository baseline, dependency map, core domain map, cleanup plan, and **only** the cleanup items that are provably free of runtime dependency. No schema change, no endpoint removal, no payment/auth change, no app deletion.

> **No destructive work was performed.** No table, migration, route module, worker or app was deleted. The only deletions are two unused UI primitives and three unused package declarations — each with zero importers, listed with evidence in §2.

---

## 0. A. GIT BASELINE (STEP 1)

| Check | Result |
|---|---|
| Branch | `main` |
| Remote | `origin` → `https://github.com/EnJirad/velnox-marketplace.git` |
| `git rev-parse HEAD` (local) | `84b376793eb81e5a374f9993701da72c8ea2331d` |
| `git rev-parse origin/main` (after `git fetch`) | `84b376793eb81e5a374f9993701da72c8ea2331d` |
| `git ls-remote origin refs/heads/main` (GitHub truth, not local state) | `84b376793eb81e5a374f9993701da72c8ea2331d` |
| Comparison | **in sync** (local == remote == requested baseline) |
| Working tree at start | clean |
| Package manager | **bun** (`bun.lock`; root `workspaces: apps/*, packages/*, backend`) |
| Root scripts | `typecheck` (4 apps), `test` (`bun test backend/tests`), `i18n:check`, `build:apps`, `db:verify` |
| Placeholder scripts (still placeholders) | `db:migrate` = `echo 'Run migrations via db/migrations/'`, `db:smoke`, `db:consistency`, `lint`, `format` |
| Deploy config in repo | `apps/*/vercel.json` (SPA rewrite), `.github/workflows/*` (6). **No `render.yaml`** — the Render service is configured in the dashboard |
| CI | `.github/workflows/test.yml`: `bun install --frozen-lockfile` → 4-app typecheck **+ backend typecheck** → bootstrap a disposable PostgreSQL from `db/run-sqleditor.sql` → assert the test-DB guard refuses production → `bun test backend/tests` → `git diff --check` |
| Production DB workflow | `.github/workflows/production-db-migrate.yml` applies `db/migrations/*.sql` on **push to main that changes that path**, using `NEON_PRODUCTION_DATABASE_URL` only (no fallback) |
| Production verify workflow | `.github/workflows/production-db-verify.yml` asserts the `schema_migrations` ledger and object shape |

The baseline is exactly the commit the brief names; no newer remote commit exists.

---

## 1. WHAT THIS PHASE CHANGED (safe cleanup only)

Every item below was verified to have **zero importers / zero references** before removal (`grep` over `backend`, `apps`, `packages`). Nothing here touches a runtime path, a table, an endpoint or a policy.

| Removed | Evidence | Effect |
|---|---|---|
| `zod` (backend dependency) | repo-wide grep for `zod` returns **only** `backend/package.json` | nothing imported it; install surface shrinks |
| `framer-motion` (velshop dependency) | 0 imports in `apps/**` | was declared, never used |
| `framer-motion` (shared dependency) | 0 imports in `packages/**` | same |
| `packages/shared/src/components/ui/chart.tsx` (357 lines) | imported `recharts`, which is **not declared in any package.json and not in `bun.lock`** — the file could not compile or bundle if a consumer existed; no consumer imported `ChartContainer`/`ChartTooltip`/`ChartLegend`/`ChartStyle` | dead + broken primitive removed |
| `packages/shared/src/components/ui/form.tsx` (167 lines) | imported `react-hook-form`, likewise **undeclared**; no consumer imported `Form`/`FormField` | dead + broken primitive removed |
| barrel exports + 2 doc examples in `packages/shared/src/components/ui/index.ts` | the only remaining references were the re-exports themselves | keeps the barrel honest |
| root `leaflet` dependency | only consumer is `apps/velshop/src/components/shop/MapPicker.tsx` | **moved** to `apps/velshop` (dependency now declared by the workspace that uses it) |
| `leaflet` + `@types/leaflet` from `packages/shared` | no `leaflet` import anywhere in `packages/shared/src` (only CSS selectors in `index.css`) | **moved** to `apps/velshop` (`leaflet` dep, `@types/leaflet` devDep) |

`bun install` regenerated `bun.lock` so the frozen-lockfile CI step stays valid.

**Why nothing bigger was removed:** every larger candidate fails the brief's own STOP conditions (§14). Each one is mapped in §3 with the decision that unblocks it, and each is listed as PARK (code retained, not reachable) rather than deleted.

---

## 2. B. DEPENDENCY MAP — the parked / non-MVP systems (STEP 2)

### 2.1 VelRepeat (V1 + V2)

| Aspect | Detail |
|---|---|
| Feature flags | `backend/lib/features.ts:VELREPEAT_ENABLED`, `packages/shared/src/lib/features.ts` (fail-closed: only the exact string `"true"`) |
| Mount points | `backend/server.ts` — 6 imports and 6 `setup*Routes` calls inside one `if (VELREPEAT_ENABLED)` block; 2 scheduler starts inside a second `if` |
| Route modules | `velrepeat.ts` (7), `velrepeat-plans.ts` (12), `velrepeat-packages.ts` (2), `velrepeat-v2-plans.ts` (1), `velrepeat-v2-payments.ts` (1), `velrepeat-v2-status.ts` (3) — **26 endpoints** |
| Backend code | **6,720 lines** (`routes/velrepeat*.ts` + `jobs/velrepeat*.ts` + `lib/velrepeat*.ts`) |
| Jobs | `velrepeat-scheduler.ts`, `velrepeat-v2-cycle-scheduler.ts` (both flag-gated) |
| Boot DDL | `ensureVelRepeatV2Tables()` reads `db/migrations/034_velrepeat_v2.sql` at startup, inside `if (VELREPEAT_ENABLED)` |
| Database | 12 tables + columns: `products.vrepeat_*` (9), `orders.velrepeat_run_id`, `orders.velrepeat_cycle_id`, `payments.plan_id`, cart repeat fields |
| Tests | 25 test files reference VelRepeat |
| Frontend | 17 velshop files; pages `VelRepeatPage.tsx`, `VelRepeatV2Page.tsx`; routes `/velrepeat`, `/velrepeat/v2`; velseller `/seller/reorder` + `/seller/goals` share the vocabulary |
| **Hidden coupling (blocks a naive delete)** | `backend/routes/seller-orders.ts` imports `processPlan` from `jobs/velrepeat-scheduler.js`; `routes/stripe.ts` settles VelRepeat plans in the same webhook. Deleting the job module or the webhook branch would break ordinary order settlement. |
| Safe exit | unmounted today (404 for every endpoint). Full removal must first move/replace `processPlan` and split the webhook branch — that is REWRITE work, not a delete. |

### 2.2 Customer Memory / behavior tracking

| Aspect | Detail |
|---|---|
| Flag | `CUSTOMER_MEMORY_ENABLED` (backend + shared) |
| Endpoints | `POST /api/events/track`, `POST /api/events/merge`, `GET /api/memory/insights` (all in `routes/center.ts`) |
| Backend | `packages/shared/src/lib/track.ts` client + center handlers; `routes/center.ts` is 1,612 lines and also hosts the real admin tabs |
| Database | `behavioral_events`, `customer_events` (2 tables) |
| Frontend | 8 storefront files call `useTracking`: `ProductDetailModal`, `ProductSelectionSheet`, `lib/cart.tsx`, `ShopCheckout`, `ShopDetail`, `ShopHome`, `ShopProductDetail`, `ShopProducts` |
| Test coupling | `backend/tests/helpers/purge.ts` truncates `behavioral_events`; `velrepeat-v2-phase3-pricing-snapshot.test.ts` references it |
| Safe exit | remove the 8 call sites + 3 handlers + 2 tables together; deleting only the backend leaves 8 pages calling a 404 (silently swallowed, but dead code). |

### 2.3 Wholesale / B2B store accounts

| Aspect | Detail |
|---|---|
| Flag | `WHOLESALE_ENABLED` (backend, shared, permissions catalog) |
| Mount | `server.ts` — `if (WHOLESALE_ENABLED) setupStoreAccountRoutes(app)` |
| Endpoints | 4 (customer application + 3 admin queue) — **not mounted** |
| Backend | `routes/store-accounts.ts` + `lib/store-accounts.ts` = **545 lines**; `lib/selling-units.ts` filters `is_wholesale`; `permissions.ts` withholds `stores.manage` from the catalog while off |
| Database | `store_accounts` + `product_selling_units.is_wholesale` |
| Frontend | `ShopStoreAccount.tsx` page + route `/profile/store`, `StoreAccountQueue.tsx`, `center-events` channel |
| Tests | `store-accounts.test.ts` (14 cases, all skipped while the flag is off), `center-rbac.test.ts` |
| Safe exit | self-contained; a real delete is safe once wholesale is confirmed out of scope for good. |

### 2.4 Chat

| Aspect | Detail |
|---|---|
| Endpoints | 13 (`routes/chat.ts`) |
| Backend | `routes/chat.ts` 698 lines |
| Database | `conversations`, `chat_messages` (+ boot DDL `ensureChatTables`) |
| Frontend | `ShopChat.tsx`, `SellerChat.tsx`, notification bells, WS channels |
| Safe exit | delete route module + mount + pages + 2 tables + `ensureChatTables` in one change. |

### 2.5 Reviews / wishlist

| Aspect | Detail |
|---|---|
| Endpoints | 6 (`/api/products/:id/reviews` GET/POST, `/api/reviews/:id` PATCH/DELETE, wishlist GET + toggle) |
| Database | `product_reviews`, `customer_wishlist` |
| Frontend | `ShopWishlist.tsx`, product-detail review blocks |
| Safe exit | self-contained inside `products.ts`/`cart.ts`; the two route modules also carry core code, so removal is an edit, not a file delete. |

### 2.6 Seller intelligence (goals / income / reorder)

| Aspect | Detail |
|---|---|
| Endpoints | 7 (`routes/seller-intelligence.ts`) |
| Backend | 380 lines + `lib/seller-stats.ts` |
| Database | `seller_goals`, `seller_analytics` |
| Frontend | velseller `/seller/goals` (the app's **default route**), `/seller/income`, `/seller/reorder` |
| Note | velseller's landing route redirects to `/seller/goals` — removing this without a new landing route leaves the app with a redirect to 404. |

### 2.7 Realtime / WebSocket

| Aspect | Detail |
|---|---|
| Backend | `backend/realtime/index.ts` + `ws` dependency; `/ws` setup in `server.ts`; 402 lines including the client socket |
| Consumers | 7 velcenter components, velshop `NotificationBell`, both chat pages |
| Nature | Signals only — consumers refetch. **No business state travels over the socket.** |
| Safe exit | every consumer has a REST read path; removing the socket is a UI-refresh change, not a data change. |

### 2.8 Workers / schedulers

| Worker | Status | Verdict |
|---|---|---|
| `payment-reservation-scheduler.ts` | **live**, flag-free | **KEEP** — it performs the stock release for expired unpaid orders (money/stock invariant) |
| `velrepeat-scheduler.ts` | flag-gated | remove with VelRepeat (but its `processPlan` export is imported by `seller-orders.ts` — see 2.1) |
| `velrepeat-v2-cycle-scheduler.ts` | flag-gated | remove with VelRepeat |

No queue, no Redis, no external cron. `payment-reservation-scheduler` is an in-process timer whose correctness comes from the database.

### 2.9 Convex

**Not used.** `grep -rn "convex"` over `*.ts|*.tsx|*.json` → **0 matches**. There is no Convex dependency, import, config or deployment.

### 2.10 Corporate app `apps/velnox`

| Aspect | Detail |
|---|---|
| Size | 1,002 lines, 7 files, marketing only |
| Wiring | root `dev:velnox`, `build:velnox`, `build:apps` (4th step), `typecheck` (4th step), `apps/velnox/vercel.json`, `VITE_CORPORATE_URL` in the CORS origin list, `INSTALLATION.md`, `README.md` |
| Coupling to commerce | none — no API client, no cart, no auth beyond shared shell |
| Safe exit | remove the app + the 3 script entries + the CORS variable + docs. **Not done in Phase 1** because a Vercel project and Google OAuth redirect URL live outside this repo (D9). |

### 2.11 Boot-time DDL (a dependency, not a feature)

`server.ts` runs four `ensure*` functions at startup, three unconditionally:

| Function | Reads | Creates |
|---|---|---|
| `ensureVariantTables()` | `db/migrations/028_create_variant_tables_if_missing.sql` | variant/option tables + 5 columns + 3 indexes |
| `ensureCheckoutIdempotencyTable()` | `db/migrations/035_checkout_idempotency.sql` | `checkout_requests` |
| `ensureChatTables()` | `db/migrations/036_comments_chat.sql` | `conversations`, `chat_messages` |
| `ensureVelRepeatV2Tables()` | `db/migrations/034_velrepeat_v2.sql` | VelRepeat V2 tables (flag-gated) |

**This is why the migration chain cannot be deleted in Phase 1** (§4.3): three boot paths read those files from disk on every start.

---

## 3. C. CORE DOMAIN MAP (STEP 3)

Every domain below is real, database-backed, and reachable from a frontend. "Source of truth" is the table(s) the API reads; no frontend value is authoritative.

### 3.1 User / identity

| | |
|---|---|
| Source of truth | `users` (role, status), `auth_identities` (Google `sub`), `revoked_tokens` (session revocation) |
| API | `GET /auth/google`, `GET /auth/google/callback`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/member-login`, `POST /api/auth/change-password` |
| Enforcement | `middleware/auth.ts` (`requireAuth`/`optionalAuth`), JWT httpOnly cookie, DB revocation, Origin guard, rate limits |
| Frontend | an `AuthPage` per app + shared `auth-flow.ts`; profile at `/profile` (velshop) |
| Tests | `auth-revocation.test.ts`, `security-hardening.test.ts`, `test-database-isolation.test.ts`, `staff-must-change-password.test.ts` |
| Known gap | OAuth `state` is `base64url({returnTo})` — **not a CSRF nonce** (no signature, no cookie comparison). Fix belongs to the auth rewrite, not to a shortcut patch. |

### 3.2 Seller

| | |
|---|---|
| Source of truth | `sellers` (`status`: pending/approved/rejected/suspended), `shops` (storefront), `seller_verifications` (evidence + decision history) |
| API | `POST /api/seller/apply`, `GET /api/seller/status`, `GET /api/seller/profile`, `PATCH /api/seller/shop`, `GET /api/admin/sellers`, `PATCH /api/admin/sellers/:id/status`, `GET /api/admin/sellers/:id/application`, `POST /api/admin/sellers/:id/revoke`, plus 10 verification endpoints |
| Enforcement | `getSellerForUser` filters `status='approved'` — every product write goes through it (regression `seller-access-authorization.test.ts`) |
| Frontend | velseller `/seller/shop` (`MyShop.tsx`, 1,133 lines — products are embedded here, there is no product editor page) |
| Tests | `seller-apply-identity-evidence`, `seller-approval-access`, `seller-access-authorization`, `seller-center-apis`, `seller-resubmission-queue`, `verification-self-approval`, `admin-sellers-pagination` |
| MVP gap | evidence upload + reason codes + review history exceed "apply → admin approve/reject" (D12). |

### 3.3 Product

| | |
|---|---|
| Source of truth | `products`, `product_images`, `product_variants`, `product_option_groups` / `_values` / `product_variant_values`, `categories` (slug is the product FK) |
| API | seller: 21 paths in `products.ts` + 16 in `product-options.ts`; public: `GET /api/products`, `/api/products/catalog`, `/api/products/:id`, `/api/shops[/:id]`, `/api/categories[/tree|/stats]`; admin: 3 moderation + 4 category paths |
| Enforcement | ownership via `shops.seller_id`; a seller cannot publish (creation downgrades `published` → `pending_review`); admin moderation writes `published` |
| Frontend | velshop `/products`, `/products/:id`, `/shops/:id`, `/categories`; velseller inside `MyShop`; velcenter moderation queue |
| Tests | `product-lifecycle`, `product-variant-options`, `product-visibility`, `product-moderation-pagination`, `category-validation`, `selling-units` |
| Note | `product_verifications` and the V badge are seller-only; the table itself is dead. |

### 3.4 Inventory

| | |
|---|---|
| Source of truth | `inventory` (`quantity`, `reserved`) for base products; `product_variants.stock` for variants — **two authorities** |
| API | `PATCH /api/seller/products/:id/stock`, `/reorder-level`; reservation happens inside checkout/webhook, never from a client call |
| Invariant | one guarded atomic statement: `UPDATE … SET reserved = reserved + $n WHERE quantity - reserved >= $n`; commit via the settlement transaction; release via `lib/inventory.ts` |
| Frontend | velseller stock editor; no customer-facing write |
| Tests | `inventory-race`, `inventory-settlement`, `reservation-urgency-contracts`, `payment-reservation-expiry` |

### 3.5 Cart

| | |
|---|---|
| Source of truth | `carts` (one per user), `cart_items` (line + price snapshot) |
| API | `GET /api/customer/cart`, `POST /api/customer/cart/add`, `PUT /api/customer/cart/item/:id`, `DELETE /api/customer/cart/item/:id` |
| Rule | the stored price snapshot is **display only**; checkout re-reads the product/variant price and refuses or reports a change |
| Frontend | `lib/cart.tsx` + `/cart` |
| Tests | `cart-selection.test.ts` |

### 3.6 Checkout

| | |
|---|---|
| Source of truth | `checkout_requests` (idempotency), `checkout_groups` (one charge, N shops), `orders` + `order_items` (snapshots), `inventory.reserved` |
| API | `POST /api/customer/checkout` (`routes/cart.ts`) |
| Invariant | server-side price/stock/seller resolution; one transaction writes group + N orders + item snapshots + guarded reservations + pending payment; `UNIQUE(user_id, scope, request_key)` makes a duplicate submit return the original purchase |
| Frontend | `/checkout` guarded by `RequireAuth`; `/checkout/success` and `/checkout/cancel` read state from the API, never from the redirect |
| Tests | `checkout-payment-flow`, `checkout-group-session-open`, `checkout-group-payment-visibility`, `checkout-group-sql-scope`, `multi-shop-checkout`, `commerce-core-invariants` |

### 3.7 Order

| | |
|---|---|
| Source of truth | `orders` + `order_items` (immutable snapshots). **Four vocabularies today**: `orders.status` (12), `orders.order_state` (5), `orders.fulfillment_status` (9), payment fold (11) |
| API | `GET /api/customer/orders[/:id]`, `PATCH /api/customer/orders/:id/cancel`, `GET /api/orders/:id`, seller `GET /api/seller/orders[/:id]` + `PATCH …/status` + `PATCH …/shipment`, admin `GET /api/admin/orders` + 2 transitions |
| Projection | `lib/order-state.ts` (443 lines) exists only to keep the axes in agreement |
| Frontend | velshop `/orders`, `/orders/:id`, `/orders/:id/tracking`; velseller `/seller/orders[/:id]`; velcenter Orders tab |
| Tests | `order-state-projection`, `order-status-contract`, `order-status-check-constraint`, `order-fulfillment-state-machine`, `order-ux-polish`, `order-detail-reviews`, `order-number`, `dead-order-status-failed`, `customer-order-cancel`, `shipment-lifecycle`, `shipment-idempotency`, `seller-orders`, `seller-order-ux` |

### 3.8 Payment

| | |
|---|---|
| Source of truth | `payments` (attempt/session/result), `payment_events` (one row per provider event = the claim), `checkout_requests` (request idempotency) |
| API | `GET /api/stripe/configured`, `GET /api/payments/methods`, `POST /api/stripe/checkout`, `POST /api/payments/stripe/webhook`, `GET /api/stripe/payment-status/:sessionId`, `POST /api/admin/orders/:orderId/refund` |
| Invariants (verified in source during Phase 0, unchanged here) | raw-body signature; `payment_events` `ON CONFLICT DO NOTHING` claim; amount re-read from DB; one settlement transaction; stock commits once; failure returns 500 so Stripe retries; refund totals recomputed from `SUM(refunds)`; late money becomes `payment_incidents` |
| Frontend | checkout redirect + polling; success page never asserts payment |
| Tests | `payment-foundation`, `payment-attempt-identity`, `payment-cancellation-race`, `payment-reservation-policy`, `payment-webhook-schema-lag`, `stripe-webhook-raw-body`, `webhook-resilience`, `late-payment-incidents`, `checkout-payment-flow` |

### 3.9 Address

| | |
|---|---|
| Source of truth | `addresses` (owner-scoped; ownership re-checked at checkout before use) |
| API | `GET /api/customer/addresses`, `POST /api/customer/addresses`, `DELETE /api/customer/addresses/:id` — **no PATCH** (an edit is create + delete today) |
| Frontend | velshop `/addresses`, checkout address picker |
| Tests | **none dedicated** — covered only indirectly by checkout tests. This is a real gap for the MVP. |

### 3.10 Cross-domain facts worth keeping

- Deals in `NUMERIC(12,2)` and `TIMESTAMPTZ` throughout — keep.
- One `audit_logs` writer for admin actions — keep.
- `media` registry + R2 presign/confirm for images — keep.
- No mock/fake production data anywhere (`grep` → 0), no TODO/FIXME in production code.

---

## 4. D. CLEANUP PLAN (STEP 4)

Legend: **REMOVE** = delete outright and update every reference; **PARK** = keep code, keep it unreachable, do not invest; **KEEP** = MVP core, protect with tests; **REWRITE** = keep the invariant, replace the implementation.

### 4.1 REMOVE (delivered this phase)

| Item | Status |
|---|---|
| `zod` dependency (backend) | **REMOVED** |
| `framer-motion` (velshop, shared) | **REMOVED** |
| dead `chart.tsx` / `form.tsx` + barrel exports | **REMOVED** |
| misplaced `leaflet` / `@types/leaflet` declarations | **MOVED** to `apps/velshop` |

### 4.2 REMOVE (planned, blocked by a decision or by coupling)

| # | Item | Blocked by | Why it is not a Phase 1 delete |
|---|---|---|---|
| P1 | VelRepeat V1+V2: 6 route modules, 2 jobs, 2 libs, 12 tables, 26 endpoints, 17 storefront files, 2 pages, 2 routes, 25 test files | — (no owner decision needed, but the coupling below must be resolved first) | `seller-orders.ts` imports `processPlan`; `stripe.ts` settles plans in the same webhook. Removal is a three-step refactor |
| P2 | Customer Memory: 3 endpoints, 2 tables, 8 `useTracking` call sites | — | must be removed backend + frontend together; `purge.ts` also truncates its table |
| P3 | Wholesale: 4 endpoints (unmounted), 545 lines, 1 table, 2 pages, 14 skipped tests, flags | — | self-contained but touches the permission catalog and shared features |
| P4 | Chat: 13 endpoints, 2 tables, 2 pages, WS channel | D8 | product decision |
| P5 | Reviews + wishlist: 6 endpoints, 2 tables, 1 page | D8 | product decision |
| P6 | Seller goals/income/reorder: 7 endpoints, 2 tables, 3 pages | D8 | velseller's **default route** is `/seller/goals`; needs a replacement landing page |
| P7 | Staff RBAC: `employees`, `departments`, 8 endpoints, permission catalog | D7 | admin model decision |
| P8 | `apps/velnox` (1,002 lines) | D9 | external Vercel project + OAuth redirect URLs must be removed by the owner |
| P9 | WebSocket layer (`ws`, `/ws`, 402 lines) | — | every consumer needs a polling fallback first |
| P10 | 16 dead tables (12 LEGACY + 4 UNUSED) | D1 + D10 | no DDL against a live database without a clean reset target |
| P11 | `_diag/schema` endpoint (~200 lines, owner/admin) | — | operational diagnostics; removing it is a tooling decision, not a cleanup |
| P12 | Boot-time DDL (4 `ensure*` functions) | D10 | three of them create tables a fresh database still needs until the migration chain is replaced |

### 4.3 PARK (keep, unreachable, do not extend)

| Item | Current state |
|---|---|
| VelRepeat routes + schedulers | flag off → 404, no background writes |
| Wholesale routes | flag off → 404, `stores.manage` withheld from the catalog |
| Customer Memory handlers | flag off (`CUSTOMER_MEMORY_ENABLED`); **the storefront `useTracking` calls still fire** and receive an error — a real (harmless) dead path to remove with P2 |
| Sets/packs (`product_selling_units`, 6 snapshot columns, 705 lines) | **active core today**; D3 decides whether they stay (audit recommends drop) |
| Multi-shop checkout (`checkout_groups`, group settlement) | **active core today**; D4 decides |
| 62 migrations + 5,442-line reconciler + placeholder `db:*` scripts | load-bearing (see 4.4) |
| `apps/velnox` | builds and typechecks; not a commerce surface |

### 4.4 KEEP (protect; do not "simplify" during cleanup)

Everything in §3 that carries a money or authorization invariant:

1. server-authoritative checkout pricing/stock/seller;
2. the single guarded stock-reservation statement and its release path;
3. `checkout_requests` idempotency (`UNIQUE(user_id, scope, request_key)`);
4. Stripe raw-body signature verification + `payment_events` claim + one settlement transaction + 500-on-failure;
5. refund total recomputation from `SUM(refunds)`;
6. seller `status='approved'` gate at `getSellerForUser`;
7. JWT httpOnly cookie + `revoked_tokens` + Origin guard + route-class rate limits;
8. test-database fail-closed guard (`backend/db/test-database.ts`);
9. `payment-reservation-scheduler` (stock release);
10. `audit_logs` choke point, order-number generator, R2 presign/confirm, `money.ts`, `pagination.ts`;
11. th/en/my i18n parity (1,535 keys × 3).

### 4.5 REWRITE (later phases; the invariant is kept, the code is not)

| Target | What changes | Why |
|---|---|---|
| Order state | 4 vocabularies → **one** status axis (`pending_payment → paid → processing → shipped → delivered`, `cancelled`); delete the 443-line projection | today a delivered order must agree across 4 columns |
| Payment fold | `lib/payment-attempt.ts` fold → `payments.status` only | removes two settlement paths and the schema-lag tolerance |
| Inventory | `inventory` + `product_variants.stock` → one table keyed `(product_id, variant_id)` | one stock authority |
| Auth | OAuth `state` → signed single-use nonce + same-origin `returnTo` validation; one shared seller lookup | `state` is currently a return-path carrier, not CSRF protection |
| Seller onboarding | evidence queue → apply/approve/reject/suspend (D12) | acceptance criteria stop at approval |
| Admin | 40 endpoints → overview, sellers, products, orders, audit (D7) | no staff RBAC in MVP |
| Catalog modules | `products.ts` (3,959 lines) + `product-options.ts` (22 paths) → seller products + public catalog split | one module currently owns 40 paths across 3 audiences |
| Frontend | velseller: extract `ProductEditor` out of `MyShop.tsx`; velcenter: split `Center.tsx` (2,509 lines) into tabs | currently single files own whole apps |

---

## 5. E. DATABASE DIRECTION (STEP 5 inputs; no DDL performed)

### 5.1 Current shape (unchanged)

`db/schema.sql` 1,963 lines / **77 tables**; `db/run-sqleditor.sql` 5,442 lines (additive reconciler); **62 migration files** (numbers 001–059 with four duplicated numbers and no 026).

### 5.2 Tables the MVP keeps (target ~20)

`users`, `auth_identities`, `revoked_tokens`, `addresses`, `sellers`, `shops`,
`seller_verifications` (or collapsed into `sellers`), `categories`, `products`,
`product_images`, `product_variants`, `product_option_groups`,
`product_option_values`, `product_variant_values`, `inventory`, `carts`,
`cart_items`, `orders`, `order_items`, `payments`, `payment_events`,
`checkout_requests`, `checkout_groups` (if D4 = keep), `shipments`, `audit_logs`,
`media`.

### 5.3 Tables prepared for deletion — **not dropped**

16 dead tables (12 LEGACY with no runtime writer + 4 with zero references:
`company_settings`, `system_settings`, `departments`, `seller_analytics`), plus
the 12 VelRepeat tables, 2 memory tables, 1 wholesale table, 2 chat tables,
2 review/wishlist tables, 2 seller-intelligence tables, `employees`,
`schema_migrations` — each gated by the decision named in §4.2.

**Nothing was dropped. `db/schema.sql` and `db/run-sqleditor.sql` are byte-identical to the baseline.**

### 5.4 Migration strategy — evidence, then plan

The brief asks for the safe path, not a fast delete. Evidence gathered:

| Consumer | Evidence | Consequence |
|---|---|---|
| Production migration workflow | `production-db-migrate.yml` applies `db/migrations/*.sql` on push to `main` that changes that path, using `NEON_PRODUCTION_DATABASE_URL` only | deleting the folder does **not** roll anything back, but the workflow becomes a no-op and the ledger stops matching reality |
| Production verification workflow | `production-db-verify.yml` asserts `schema_migrations` exists/usable and records 054 | the ledger is part of the production contract |
| Backend boot | `server.ts` reads migrations **028, 034, 035, 036** from disk at startup | deleting those four files breaks boot-time table creation (non-fatal by try/catch, but the tables would never be created on a fresh DB) |
| CI | `test.yml` bootstraps the disposable DB from `db/run-sqleditor.sql`; `backend/tests/migration-numbering.test.ts` pins filename/ledger numbering; `db-run-sqleditor-reconciler.test.ts` pins declaration parity | deleting migrations breaks a test contract, not just history |
| Docs | `INSTALLATION.md`, `docs/DATABASE.md`, `README.md` describe the chain as the way schema changes ship | docs would lie |
| Local scripts | `db:migrate` is an `echo` placeholder | no local runner depends on the chain |

**Plan (Phase 2, requires D1 + D10):**

1. Build a **new empty** database (Neon branch/database), never the live one.
2. Land one canonical `db/schema.sql` for the MVP core + `db/reset-dev.sql` that drops and rebuilds **only** a database whose name carries the `_dev`/`_test` marker (a guard, like `backend/db/test-database.ts`, that refuses anything else).
3. Point CI at the new bootstrap (already `run-sqleditor.sql`; switch it to the single schema file) and re-run the parity test.
4. Cut Render's `DATABASE_URL` over only after a fresh build boots and a real checkout+webhook round-trip succeeds on the new database.
5. **Only then** archive the 62 migrations (move under `db/migrations-legacy/` or delete in one atomic commit), delete `ensure*` boot DDL, and retire `production-db-migrate.yml`.
6. Amend `AGENTS.md` rule 4 / `.ai/context/database.md` in the same commit — they currently require both canonical files and forbid deleting the chain.

Until step 6, the chain is **frozen**: no new migrations in Phase 1/2 work.

---

## 6. F. API SURFACE (before / after this phase)

| Measure | Before | After Phase 1 |
|---|---|---|
| Route modules | 22 | 22 |
| Route declarations | 204 | 204 |
| Unique `/api` paths | **199** | **199** |
| Unmounted-but-present groups | VelRepeat (26), wholesale (4), memory (3) | same |
| MVP target | — | ~40–45 (audit §10.2) |

Per-module declaration counts: `products 40`, `product-options 22`, `center 20`, `cart 15`, `chat 13`, `velrepeat-plans 12`, `verification 10`, `seller 8`, `index 7`, `seller-intelligence 7`, `stripe 7`, `velrepeat 7`, `auth 6`, `seller-orders 6`, `upload 5`, `admin 4`, `product-selling-units 4`, `store-accounts 4`, `velrepeat-v2-status 3`, `velrepeat-packages 2`, `velrepeat-v2-plans 1`, `velrepeat-v2-payments 1`.

---

## 7. G. APPS (before / after)

| App | Lines | Phase 1 |
|---|---|---|
| `apps/velshop` | 17,193 | unchanged (dependency declarations corrected) |
| `apps/velseller` | 4,309 | unchanged |
| `apps/velcenter` | 7,656 | unchanged |
| `apps/velnox` | 1,002 | **PARK** — still builds; removal waits for D9 |
| `backend` | ~34,462 (non-test) | unchanged |
| `packages/shared` | ~24,020 | −2 dead primitives (−524 lines) |

Apps: **4 → 4** in Phase 1. Target: 3 (D9).

---

## 8. H. VERIFICATION (STEP 6)

Every command was run in this workspace after the edits, at the commit reported in §10.

| Check | Command | Result |
|---|---|---|
| Install / lockfile | `bun install` | exit 0 — `Saved lockfile`, diff 2 insertions / 16 deletions (only the removed declarations) |
| Frontend typecheck | `bun run typecheck` | **4/4 exit 0** (velshop, velseller, velcenter, velnox) |
| Backend typecheck | `bun --filter @velnox/backend typecheck` | **exit 0** |
| i18n parity | `bun run i18n:check` | **OK** — th=1535 en=1535 my=1535, all locales at parity |
| Production build | `bun run build:apps` | **4/4 exit 0** (velshop, velseller, velcenter, velnox) |
| Test suite | `bun test backend/tests` | **1741 pass / 414 skip / 1 fail** across 75 files (2,156 tests) — see below |
| Whitespace | `git diff --check` | clean |

**The single failure is pre-existing and environmental, not caused by this phase.**
`backend/tests/checkout-group-payment-visibility.test.ts` has a `beforeAll` hook that
is **not** gated by `hasTestDatabase()` (its individual cases are), so on a machine
with no PostgreSQL it throws `ECONNREFUSED 127.0.0.1:5432`. The same file passes
alone once its DB-gated block is skipped, and the diff in this phase contains no
backend or test file. CI provisions a PostgreSQL service container, where the hook
succeeds. Per the brief ("fix only what Phase 1 caused"), it was **not** patched
here; the one-line gate is listed as a Phase 2 test-harness item.

Not run / not verifiable in this workspace: browser E2E, a real Stripe TEST round
trip, R2 credentials, and any production database read (no `DATABASE_URL` /
`TEST_DATABASE_URL` is set here — verified by presence check only).

---

## 9. I. RISKS AND STOP CONDITIONS HIT

| # | Risk / stop condition | State |
|---|---|---|
| 1 | Cannot tell which tables are production-critical | **STOP respected** — 0 DDL executed; deletion plan requires D1 |
| 2 | Cannot tell which migration is required | **STOP respected** — 4 migrations are read at boot, CI and prod workflows consume the chain; none deleted |
| 3 | Changing payment behavior | **Not touched** — no file under `routes/stripe.ts`, `lib/payment*`, `lib/order-*` was edited |
| 4 | Changing auth behavior | **Not touched** — `routes/auth.ts`, middleware untouched |
| 5 | Destructive DB migration | **Not attempted** |
| 6 | Removing an app that is deployed elsewhere | **PARKED** — `apps/velnox` still builds (D9) |
| 7 | Removing a module whose endpoint might be in use | **PARKED** — the three parked groups already answer 404 behind fail-closed flags |
| 8 | Deleting code with a hidden cross-module import | **Checked** — orphan scan over `backend/**/*.ts` found exactly one unreferenced module (`server.ts`, the entry point); no dead backend lib exists |
| 9 | D1–D12 unanswered | This phase was scoped to what needs **no** business decision; every decision-dependent action is deferred with its blocking decision named |
| 10 | Pre-existing suite failure without a database | Reported, not masked; no test was skipped or weakened to make the run green |

---

## 10. J. GIT DELIVERY

| | |
|---|---|
| Previous SHA | `84b376793eb81e5a374f9993701da72c8ea2331d` |
| New SHA | `54c10ae56b5060049faa87a845786cfe4659d35e` |
| Remote verification | `git rev-parse HEAD` == `git rev-parse origin/main` == `git ls-remote origin refs/heads/main` |
| Commit | `refactor(mvp): remove unused dependencies and dead UI primitives` |
| Push | `git push origin main`, then `git fetch` + SHA comparison (local == remote) |

---

## 11. K. PHASE 2 PROPOSAL (do not start without approval)

**Phase 2 — one database, one authority (needs D1, D10, D3, D4).**

1. New empty Neon database/branch; never the live one.
2. Write the MVP canonical `db/schema.sql` (~20 tables, one order status, one stock table) and `db/reset-dev.sql` with a fail-closed name guard.
3. Fresh bootstrap twice → identical; FK orphan check = 0; every NOT NULL/default/CHECK verified.
4. Point CI at the new bootstrap; keep the parity test green.
5. Cut over only after a fresh boot + a real checkout→webhook round-trip succeeds; then archive the 62 migrations, delete `ensure*` boot DDL, retire the migration workflow, and amend `AGENTS.md` rule 4.
6. Exit check: fresh reset reproducible; no dead table; typecheck + full suite green on the new database; no production database touched.

**Not in Phase 2:** route deletion, frontend rewrites, VelRepeat/Memory/wholesale removal (those are Phase 3+ and follow the P1–P12 order in §4.2).

---

## Appendix — evidence commands

```bash
git rev-parse HEAD && git rev-parse origin/main && git ls-remote origin refs/heads/main
grep -rn "zod" --include='*.ts' --include='*.tsx' --include='*.json' . | grep -v node_modules
grep -rn "framer-motion" backend apps packages --include='*.ts' --include='*.tsx'
grep -rn "recharts\|react-hook-form" apps packages backend --include='*.ts' --include='*.tsx'
for f in $(find backend -name '*.ts' -not -path '*/tests/*'); do … orphan scan …; done
grep -ohE 'app\.(get|post|put|patch|delete)\(\s*"[^"]+"' backend/routes/*.ts backend/server.ts | sort -u | wc -l
ls db/migrations/*.sql | wc -l; grep -cE '^CREATE TABLE (IF NOT EXISTS )?' db/schema.sql
grep -rn "db/migrations" backend --include='*.ts' | grep -v tests
bun install && bun run typecheck && bun --filter @velnox/backend typecheck
bun run i18n:check && bun run build:apps && bun test backend/tests && git diff --check
```
