# MVP staging — deployment runbook

> **RECONCILED WITH THE MVP-ONLY TREE (2026-10-22).** Commands and variables
> below were corrected after the `db/` collapse: the canonical schema is
> `db/schema.sql`, the reset is `scripts/db-reset.sh`, the cutover is
> [`PRODUCTION_CUTOVER.md`](./PRODUCTION_CUTOVER.md), and there is no
> `MVP_API_ENABLED` flag — `backend/mvp/` is the only route tree and `/api/mvp`
> is always mounted. Everything provider-side (create the Neon database, deploy
> staging, keep production untouched) still applies; staging is still **NOT
> deployed**.

**Status:** ready to deploy, **not deployed**. No staging database, backend or Vercel
project is reachable from this workspace, and no production resource was touched.
Everything in it has been verified locally except the provider-side steps, which
need dashboard access.

---

## 1. What staging is

```
Vercel: velShop-staging  ─┐
Vercel: velSeller-staging ├─ HTTPS + cookies (SameSite=None; Secure) ─┐
Vercel: velCenter-staging ┘                                          │
                                                                     ▼
                                          Render: velnox-api-staging  (/api/mvp, no flag)
                                                                     │
                                                                     ▼
                                          Neon: velnox_mvp_staging  (db/schema.sql, 20 tables)
```

One Render service and one database. The three Vercel projects clone the existing
production project settings and change **only** the environment variables in §3.
The production Render service still points at the pre-MVP database until the
cutover ([`PRODUCTION_CUTOVER.md`](./PRODUCTION_CUTOVER.md)) moves its
`DATABASE_URL`.

> The backend serves **only** the 20 MVP tables. Pointing it at the pre-MVP
> database (77 tables, `shops`, `orders.order_state`) is reported once at boot as
> `MVP SCHEMA INCOMPLETE`, and every request then fails against missing columns.
> Do not deploy staging against anything but the database from §2.

---

## 2. Database (owner action 1)

1. Create a **new** Neon database/branch named `velnox_mvp_staging`. Never the
   production database and never a branch of it that carries production data.
2. Bootstrap it once:

   ```bash
   psql "$MVP_STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
   ```

3. Record the identity (no secrets) and keep it with the staging ticket:

   ```sql
   SELECT current_database(), inet_server_addr(), current_setting('server_version');
   SELECT to_regclass('public.shops') IS NULL AS no_legacy_tables;   -- must be true
   SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'; -- 20
   ```

4. Categories are created through the admin API (`POST /api/mvp/admin/categories`).
   `scripts/db-seed.sql` is development/test only — it refuses any database whose
   name does not end in `_dev`/`_test`, so it cannot seed `velnox_mvp_staging`.
5. Create the staging owner/admin account through the API
   (`POST /api/mvp/auth/bootstrap-owner` with `BOOTSTRAP_OWNER_SECRET`) or sign up
   and promote the row once. Use a staging-only password.

The database name **must not** be the production database. `scripts/db-reset.sh`
refuses any target that does not end in `_dev`/`_test`, refuses `DATABASE_URL`,
and refuses a production-marked process, so it cannot be used to rebuild staging —
create that database once and leave it alone. Provider-side creation is the
owner's responsibility.

---

## 3. Environment matrix

### Render — `velnox-api-staging`

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | the staging Neon URL | must be the database from §2 |
| `JWT_SECRET` | a **new** 64+ char random secret | never the production value |
| `NODE_ENV` | `production` | providers usually set this; see the cookie note |
| `MVP_COOKIE_SECURE` | `true` | only ever *adds* `Secure`; harmless if `NODE_ENV=production` |
| `CORS_ORIGINS` | the three staging frontend origins | comma-separated |
| `VITE_VELSHOP_URL` / `VITE_VELSELLER_URL` / `VITE_VELCENTER_URL` | staging frontend origins | the server merges these into CORS |
| `MVP_ORDER_EXPIRY_INTERVAL_MS` | `60000` (optional) | floor 30 s |
| `STRIPE_SECRET_KEY` | `sk_test_…` (optional) | live keys are **refused** by `lib/payment-config.ts` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_…` (optional) | |
| `STRIPE_WEBHOOK_SECRET` | the test-mode webhook secret (optional) | |
| `GOOGLE_*`, `R2_*` | **do not set for the MVP** | OAuth answers 501; media upload is a documented gap |

Suggested Render settings (same shape as the existing service):

- Build: `bun install --frozen-lockfile`
- Start: `bun --filter @velnox/backend start`
- Health check: `/api/health`
- Auto-deploy: on, from `main` (staging may auto-deploy; production must not be
  changed by this task)

> **Cookie note.** The session cookie is `SameSite=None`; Chromium only stores it
> with `Secure`. Render terminates TLS, so set `MVP_COOKIE_SECURE=true` (or ensure
> `NODE_ENV=production`) on staging. Without it, sign-in appears to succeed and
> the next request is anonymous — that failure mode is exactly what the browser
> E2E reproduces locally.

### Vercel — `velShop-staging`, `velSeller-staging`, `velCenter-staging`

Clone each production project (Root Directory, Build Command, Output Directory
unchanged) and set only:

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://<velnox-api-staging host>` (origin only, no `/api`) |
| `VITE_API_MODE` | `mvp` (optional; still read by `mvp/config.ts`) |
| `VITE_DEPLOY_ENV` | `staging` (optional; declares the build to `mvp/config.ts`) |

`VITE_API_URL` is the value that decides where requests go: every app mounts the
MVP UI unconditionally, and the shared client resolves `<origin>/api/mvp` from
it. The two `VITE_API_MODE` / `VITE_DEPLOY_ENV` values are still resolved by
`packages/shared/src/mvp/config.ts` (pinned by
`packages/shared/tests/mvp-config.test.ts`) but no longer choose which screen is
mounted.

Everything else (`VITE_VELSHOP_URL`, …) follows the existing production pattern
with staging hosts.

---

## 4. Verification after deploy (in order)

1. `GET https://<api>/api/health` → 200.
2. `GET https://<api>/api/mvp/payments/status` → `usable:false` unless Stripe test
   keys were set (never `mode:"live"`).
3. Open `https://<shop-staging>/` → the catalogue is served by
   `GET /api/mvp/products` (DevTools → Network) and the footer prints the
   `describeApiMode()` line. There is no legacy storefront to fall back to; an
   empty catalogue with 404s means `VITE_API_URL` is wrong.
4. Sign up, browse, add to cart, check out (no payment configured → order stays
   `pending_payment`), cancel → stock returns.
5. Seller apply → admin approve → product → submit → admin approve → publish →
   the product appears in the shop catalogue.
6. Stripe TEST round trip (only with test keys): checkout session → hosted page →
   return → the order is still `pending_payment` until the signed webhook lands,
   then `paid`.
7. Run the local browser E2E against the same commit before sign-off:

   ```bash
   TEST_DATABASE_URL=postgresql://…/velnox_test bun run test:mvp:browser
   ```

---

## 5. Scheduling (expiry worker)

`backend/jobs/mvp-order-expiry-scheduler.ts` starts with the server, polls every
60 s (floor 30 s) and calls the same `expireStaleOrders` the admin endpoint uses.
`MVP_ORDER_EXPIRY_SCHEDULER=off` keeps it manual (admin → Overview → “Run expiry
sweep”). No second scheduler system is introduced.

## 6. Known blockers (do not paper over)

| Blocker | Evidence | Consequence |
|---|---|---|
| ~~**Retail sets/packs are missing from the MVP**~~ **RESOLVED in Phase 3d** | `db/schema.sql` has `product_selling_units` (`label`, `base_quantity`, own `price`, `is_active`) plus the `cart_items.selling_unit_id` and `order_items` snapshot columns | The MVP can sell a “Pack 6 / Pack 12” at its own price against base-unit stock (`base_units = quantity × base_quantity`). Proven by `backend/mvp/tests/selling-units.test.ts` and the browser E2E |
| **Image upload is not implemented for the MVP** | there is no upload route in `backend/mvp/`; the schema stores `media.object_key`, and sellers supply image URLs | Sellers paste image URLs; the editor says so. A real upload needs an MVP presign route writing `media.object_key` |
| **Google OAuth is parked** | `GET /api/mvp/auth/oauth` → 501; the MVP schema has no identity tables | email/password only; OAuth users from the legacy database cannot sign in |
| Vercel/Render access | no provider credential in this workspace | §2–§3 are owner actions, unverified by the agent |

## 7. Rollback

- **Frontends:** redeploy the previous build (or remove `VITE_API_URL` so the
  client falls back to `http://localhost:3001` — which fails loudly). There is no
  legacy storefront to switch back to.
- **Backend:** delete the staging Render service (or point its `DATABASE_URL`
  back at the pre-MVP database and redeploy the older build); `/api/mvp/*` is
  always mounted, so there is no flag to turn it off.
- **Database:** the staging database is disposable; drop it with the Neon console.
- **Production:** nothing to roll back — no production resource is referenced by
  this runbook's changes.

## 8. Explicitly out of bounds

- Never point production `DATABASE_URL` at the staging database, or staging at
  production.
- Never run `scripts/db-reset.sh` against an unidentified database (it refuses
  anything that is not a `_dev`/`_test` name).
- Never repoint the production Render service at the MVP database outside the
  approved cutover, and never run anything from `db/` against production.
- Never put a secret in a `VITE_*` variable (they are public and inlined).
- No production cutover in this phase.
