# Phase 3b — MVP client integration & staging E2E (2026-10-21)

**Status:** DONE for what can be verified locally · **staging deployment: NOT PERFORMED**
(no staging backend, no MVP staging database host, no Stripe TEST credentials in this
workspace) · **production: untouched**.

- **Starting SHA (verified):** `11aa59cc38700959f0d1eb2b6ad484b5f273c052`
  (`git rev-parse HEAD` = `git rev-parse origin/main` = `git ls-remote origin
  refs/heads/main` before any edit).
- **Final SHA:** see "Git log" at the bottom of this file (filled from the commit
  series pushed for this pass).
- Previous report: [`mvp-clean-rewrite-phase3-2026-10-21.md`](./mvp-clean-rewrite-phase3-2026-10-21.md)
  (backend). This pass adds the client and the first end-to-end proof through it.

---

## 1. What was built

### 1.1 Phase A — MVP API client (`packages/shared/src/mvp/`)

| File | Role |
|---|---|
| `config.ts` | the ONE switch: `resolveApiMode(env)` → `{mode, apiOrigin, mvpBaseUrl, deployEnv, disabledReason}` |
| `routes.ts` | `/api/mvp/*` path table, **separate** from `lib/api-routes.ts` |
| `client.ts` | `createMvpHttp()` — `{success,data}` envelope, `credentials:"include"`, 15 s timeout, typed `MvpApiError` (`status`, `code`, `isUnauthenticated`/`isForbidden`/`isNotFound`/`isConflict`), injectable `fetch` |
| `api.ts` | one typed function per backend route (`auth`, `catalog`, `cart`, `checkout`, `orders`, `payments`, `seller`, `admin`) |
| `types.ts` | payload types mirroring `backend/mvp/*` exactly (money is always a **string**) |
| `ui.tsx` | `useMvpQuery`, `MvpLoading`/`MvpErrorState`/`MvpEmpty`, `formatMoney`/`formatDate`, `MvpAuthPanel`, `MvpSessionProvider`/`MvpRequireSession`, `mvpSignOut` |
| `index.ts` | the barrel (`@velnox/shared/mvp`) |

**No legacy constant was changed.** `lib/api-routes.ts` is untouched. The only edit to an
existing shared module is `lib/api-client.ts`: the session paths (`me`, `logout`) follow
the resolved mode, so in MVP mode `RequireAuth`/headers read `/api/mvp/auth/me`. Legacy
remains the default, so nothing changes when the mode is off.

### 1.2 Phase B — feature flags (fail-closed)

```
VITE_API_MODE=legacy|mvp        default: legacy (absent, "", "true", "1", typos → legacy)
VITE_DEPLOY_ENV=staging         REQUIRED for MVP mode in any real build
VITE_API_URL=<origin>           backend origin only (no /api, no userinfo/query/fragment)
MVP_API_ENABLED=true            backend: mounts /api/mvp/* AND starts the expiry worker
```

Decision matrix (`packages/shared/tests/mvp-config.test.ts`, 13 tests):

| Env | Result |
|---|---|
| nothing | legacy, `http://localhost:3001` |
| `VITE_API_MODE=mvp`, `PROD=true`, no `VITE_DEPLOY_ENV` | **legacy**, `MVP_FORBIDDEN_IN_PRODUCTION` |
| `VITE_API_MODE=mvp`, `VITE_DEPLOY_ENV=production` | **legacy**, `MVP_FORBIDDEN_IN_PRODUCTION` |
| `VITE_API_MODE=mvp`, `VITE_DEPLOY_ENV=preview|qa|prod` | **legacy**, `MVP_ENV_NOT_ALLOWED` |
| `VITE_API_MODE=mvp`, `VITE_DEPLOY_ENV=staging` (or dev/local/test) | **mvp** |
| `VITE_API_MODE=mvp` + malformed `VITE_API_URL` | **legacy**, `INVALID_API_URL` (never silently falls back to localhost *for MVP*) |

Why `VITE_DEPLOY_ENV` is needed: a `vite build` always reports `PROD=true`, so a staging
build is indistinguishable from production by `PROD` alone. Staging must declare itself;
production that forgets to declare anything stays on legacy, which is the safe direction.

**No secret can travel through these variables** — they are `VITE_*`, i.e. public and
inlined into the bundle. The session is the same httpOnly cookie the legacy API sets.

Where to set them (documented in the task doc because `.env.example` is a protected file
in this workspace):

- **Local dev:** each app's `.env.local` (`VITE_API_MODE=mvp`, `VITE_API_URL=http://localhost:3101`);
  no `VITE_DEPLOY_ENV` needed because a dev server is not `PROD`.
- **Staging Vercel project (velshop / velseller / velcenter):** `VITE_API_MODE=mvp`,
  `VITE_DEPLOY_ENV=staging`, `VITE_API_URL=<staging API origin>`. **Not** set on any
  production project.
- **Staging Render service:** `MVP_API_ENABLED=true` + `DATABASE_URL` = the MVP staging
  database. **Never** on the current production service (it points at the pre-MVP Neon DB).

### 1.3 Phase C — VelShop (`apps/velshop/src/mvp/`)

`main.tsx` branches ONCE: `{MVP_API ? <MvpShopApp/> : <legacy providers + routes>}`.
When the mode is off, the legacy tree is exactly what it was. In MVP mode the legacy
`CartProvider` is not mounted (it talks to the pre-MVP cart API); `MvpCartProvider`
reads `/api/mvp/cart` instead.

| Route | Page | Notes |
|---|---|---|
| `/` | `Home.tsx` | published products + categories, hero |
| `/products` | `Catalog.tsx` | server-side search/category/pagination via URL |
| `/products/:slug` | `Product.tsx` | images, variants with own price + available, 404 for unpublished |
| `/cart` | `CartPage.tsx` | one cart per seller, per-cart checkout, server totals |
| `/checkout?cart=` | `CheckoutPage.tsx` | inline address snapshot, **one** `requestKey` per mount |
| `/orders` | `OrdersPage.tsx` | own orders only |
| `/orders/:id` | `OrderDetailPage.tsx` | confirmation + payment status + cancel + pay |
| `/auth` | `MvpAuthPanel` | email/password (the only auth the MVP API implements) |

Every price/stock/payment/status value is rendered from the API. The checkout page shows
the cart subtotal only and says the final total is confirmed server-side; the order page
shows the order's own `totalAmount`/`shippingFee`.

### 1.4 Phase D — VelSeller / VelCenter

- `apps/velseller/src/mvp/` — `App.tsx` (shell/routes), `Workspace.tsx` (apply, statuses
  `pending|rejected|suspended`, product list, create draft), `ProductEditor.tsx` (edit,
  images as URLs, variants, **absolute** inventory, submit, publish), `OrdersPanel.tsx`
  (`processing → shipped → delivered` only).
- `apps/velcenter/src/mvp/` — `App.tsx` + `Admin.tsx`: metrics, seller
  approve/reject/suspend, product approve/reject, category create/rename/activate, and the
  admin-only expiry sweep.
- **No client-side authorisation decision exists.** A customer who opens VelCenter gets
  403s rendered as "Not allowed"; a pending seller gets 403 on every write.

### 1.5 Phase F — media and expiry

- **R2 is NOT reused.** The legacy presign routes (`backend/routes/upload.ts`) write
  `INSERT INTO media (url, key, …)`, but the MVP `media` table has `object_key` and no
  `key` column (`db/mvp/schema.sql` §4) — the legacy writer cannot be pointed at the MVP
  schema, and no MVP route references `media` at all. MVP image support is therefore
  **URL-only** (`product_images.url`), and the seller editor says so. No fake upload was
  added.
- **Expiry is now scheduled** with the repository's existing pattern:
  `backend/jobs/mvp-order-expiry-scheduler.ts` (one export per tick + one `setInterval`,
  started from `server.ts` like the other jobs). It refuses to start unless
  `MVP_API_ENABLED=true`, is disabled by `MVP_ORDER_EXPIRY_SCHEDULER=off`, and inherits
  idempotency from `expireStaleOrders` (`FOR UPDATE SKIP LOCKED` + the one cancellation
  authority). No second scheduler system was introduced.

---

## 2. Verification (exact commands and results)

| Command | Result |
|---|---|
| `TEST_DATABASE_URL=postgresql://velnox_test:***@127.0.0.1:5432/velnox_test bun run test:mvp` | **86 pass / 0 fail**, 11 files (incl. the new client E2E + scheduler guard) — exit **0** |
| `TEST_DATABASE_URL=… bun test backend/tests` (legacy suite) | **2166 pass / 16 skip / 0 fail**, 76 files — exit **0** |
| `bun test packages/shared/tests` | **29 pass / 0 fail**, 117 assertions — exit **0** |
| `bun run typecheck` (velshop, velseller, velcenter, velnox) | 4/4 exit **0** |
| `bun --filter @velnox/backend typecheck` | exit **0** |
| `bun run i18n:check` | `th=1535 en=1535 my=1535`, parity OK — exit **0** |
| `bun --filter @velnox/velshop build` | exit **0** |
| `bun --filter @velnox/velseller build` | exit **0** |
| `bun --filter @velnox/velcenter build` | exit **0** |
| `bun --filter @velnox/velnox build` | exit **0** |
| `VITE_API_MODE=mvp VITE_DEPLOY_ENV=staging VITE_API_URL=https://… bun --filter @velnox/velshop build` | exit **0**; the staging origin is present in `dist/assets/index-*.js` (the mode actually reaches the bundle) |
| `git diff --check` | clean (exit **0**) |

### 2.1 Client E2E (browser-equivalent, through the SHARED client)

`backend/mvp/tests/client-e2e.test.ts` drives `@velnox/shared/mvp` — the module the three
apps use — against a real express app and a real PostgreSQL database, with a cookie jar.
Path proven in one test:

signup → seller `apply` (pending) → **pending seller write = 403** → admin `approveSeller`
→ seller `status` = approved → `createProduct` (draft) → `addVariant` → `setInventory` →
`submit` → product **404 in the public catalogue while unreviewed** → admin
`approveProduct` → `publish` → catalogue `products`/`product` → `cart.addItem` (subtotal
`600.00` from the server) → `checkout.create` (`totalAmount 600.00`, `shippingFee 0.00`,
`pending_payment`) → **duplicate `requestKey` returns the same order (`replayed: true`)** →
`orders.list`/`paymentStatus` (`settled:false`) → **another buyer gets 404** →
**customer `admin.metrics` = 403** → seller order list contains it →
**seller `pending_payment → processing` = 409** and the order is unchanged →
admin metrics include the order → **anonymous `cart.get` = 401 `MvpApiError`**.

A second test proves a checkout with no cart id cannot invent an order (4xx).

Negative cases not repeated here are covered by the existing route-level suites, which
still pass in the same run: unpublished product catalogue exclusion, client-tampered
prices/quantities, out-of-stock and concurrent checkout, forged/duplicate webhook
signatures, amount/currency mismatch, foreign cart/order access, suspended account login,
product lifecycle transition rules.

### 2.2 Staging database identity (no secrets printed)

Created by `bun run test:mvp` from `db/mvp/schema.sql` (`velnox_mvp_app_test`, kept with
`VELNOX_KEEP_TEST_DB=1` for the identity query, then dropped):

```
current_database = velnox_mvp_app_test
inet_server_addr  = 127.0.0.1/32          (local disposable cluster, not Neon)
server_version    = 14.24
public tables     = 19
has_legacy_shops  = false
has_legacy_product_selling_units = false
tables: addresses audit_logs cart_items carts categories checkout_requests inventory
        media order_items orders payment_events payments product_images product_variants
        products revoked_tokens seller_profiles shipments users
```

The runner refuses to target anything that is not `*_test` (`assertMvpDatabase()`), the
reset script additionally requires `*_dev`/`*_test`, refuses `DATABASE_URL`, refuses a Neon
host without an explicit branch flag, and refuses to run with `NODE_ENV/APP_ENV/
ENVIRONMENT/VERCEL_ENV=production` (`db/mvp/reset.sh` + `backend/db/test-database.ts`).
**No destructive script was run against any identified non-test database.**

---

## 3. Verified vs NOT verified

**Verified locally**

- Client wiring, feature-flag defaults and the production refusal matrix.
- The complete seller → admin → buyer flow and the negative cases in §2.1, on a real
  database and real HTTP.
- All typechecks, all four app builds, i18n parity, legacy suite, MVP suite.

**NOT verified (environmental — no code path claims otherwise)**

- **A deployed staging backend + staging database on Render/Neon.** Nothing in this
  workspace can create them. Owner action list below.
- **A browser E2E in a real browser.** No browser runtime here; §2.1 is the same client,
  the same cookie semantics and the same routes, but it is not a DOM. No screenshot will
  be claimed.
- **Stripe TEST round trip.** No `STRIPE_SECRET_KEY` exists in this workspace (env file
  list is empty), so no session was ever created against Stripe. What IS verified is the
  contract: test-only key enforcement (live keys are refused, `payment-config.ts`),
  `payment-session` → **503 when Stripe is not configured**, signed-webhook rejection,
  duplicate-event claim, amount/currency mismatch refusal, foreign-order 404, and
  `payment-status` reporting only server state. **No order is marked paid by a redirect.**
- **R2 upload against the MVP schema** — proven incompatible, so not attempted (§1.5).

---

## 4. Blockers and owner actions

1. **Provision a staging MVP database** (Neon branch or a new project) and apply
   `db/mvp/schema.sql` with `psql "$STAGING_URL" -f db/mvp/schema.sql`. Name it something
   ending in `_test` or `_dev` so the reset guard accepts it if a rebuild is ever needed.
2. **Deploy a staging backend** from `main` with `DATABASE_URL=<that database>`,
   `MVP_API_ENABLED=true`, a **staging-only** `JWT_SECRET`, and `STRIPE_SECRET_KEY=sk_test_…`
   + `STRIPE_WEBHOOK_SECRET` if the Stripe round trip is wanted. Do **not** copy these onto
   the production Render service.
3. **Deploy staging frontends** (Vercel preview/staging projects) with `VITE_API_MODE=mvp`,
   `VITE_DEPLOY_ENV=staging`, `VITE_API_URL=<staging API origin>`. Leave every production
   project's environment unchanged.
4. **Run one browser pass** on the staging storefront: catalogue → cart → checkout →
   order → admin approve → seller publish, then confirm the Stripe return leaves the order
   `pending_payment` until the webhook lands.
5. **Decide the two parked product questions** before any cutover: Google OAuth (MVP API
   answers 501 — users created by OAuth in the legacy DB have no MVP password) and media
   upload (needs an MVP-aware presign route writing `media.object_key`).

## 5. Rollback (staging only)

- **Frontends:** remove/blank `VITE_API_MODE` and redeploy → the legacy API returns with
  no code change (the branch is build-time).
- **Backend:** set `MVP_API_ENABLED=false` (or `MVP_ORDER_EXPIRY_SCHEDULER=off` to stop
  only the worker). `/api/mvp/*` unmounts; the legacy routes were never touched.
- **Database:** the staging database is disposable — drop it and stop the staging service.
- **Production:** nothing to roll back; nothing was changed there.

## 6. Production confirmation

- No production `DATABASE_URL`, Render/Vercel environment variable, Stripe mode, DNS,
  domain or deployment was read, modified or deployed.
- `MVP_API_ENABLED` is absent by default (`backend/mvp/index.ts` requires the literal
  `"true"`), so the deployed service still mounts no `/api/mvp` route and starts no MVP
  worker.
- The frontends default to the legacy API; a production build that sets `VITE_API_MODE=mvp`
  still resolves to legacy (`MVP_FORBIDDEN_IN_PRODUCTION`).
- No legacy module, route, table, migration or `apps/velnox` file was deleted.
- No secret, cookie, token, connection string or payment credential is in the diff.

## 7. Next task

**Phase 3c — staging deployment + first real browser & Stripe TEST round trip** (owner
provides the staging database/backend/frontends and test credentials; the agent then runs
the checklist in §4 and reports each step as verified or failed).

---

## 8. Git log for this pass (branch `main`, no force-push)

| Commit | Scope |
|---|---|
| `0a39dae` | `feat(shared)`: MVP client, mode switch, client + config tests, session-path mode awareness |
| `285d6f1` | `feat(velshop)`: MVP storefront behind `isMvpMode()` |
| `08e27db` | `feat(velseller,velcenter)`: MVP seller workspace + admin console |
| `099d66a` | `feat(backend)`: MVP expiry scheduler, its guard test, and the shared-client E2E |

The docs commit that carries this file is the last commit of the pass; `HEAD` == `origin/main` ==
`git ls-remote origin refs/heads/main` was re-checked after the push (see the final report).
