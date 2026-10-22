# MVP staging — deployment runbook

> **SUPERSEDED PARTIALLY (2026-10-22).** Three things this runbook assumes no
> longer exist: the `MVP_API_ENABLED` flag (the MVP API is now mounted
> unconditionally — `backend/mvp/` is the only route tree), `db/mvp/*` (the
> canonical schema is `db/schema.sql` + `db/run-sqleditor.sql`, and
> `db/mvp/cutover.md` moved to [`PRODUCTION_CUTOVER.md`](./PRODUCTION_CUTOVER.md))
> and `db/mvp/reset.sh` (`bun run db:reset` → `scripts/db-reset.sh`). Everything
> provider-side below (create the Neon database, deploy staging, keep production
> untouched) still applies. Read this as "how to stand up staging", with the
> paths above corrected.

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
                                          Render: velnox-api-staging  (MVP_API_ENABLED=true)
                                                                     │
                                                                     ▼
                                          Neon: velnox_mvp_staging  (db/mvp/schema.sql, 20 tables)
```

One Render service and one database. The three Vercel projects clone the existing
production project settings and change **only** the environment variables in §3.
The production Render service keeps `MVP_API_ENABLED` unset, so it mounts no
`/api/mvp` route and starts no MVP worker.

> A staging backend with `MVP_API_ENABLED=true` is an **MVP-only** backend: its
> pre-MVP routes still query the legacy tables, which the MVP database does not
> have. Do not point staging frontend traffic at a service that must also serve
> the legacy apps.

---

## 2. Database (owner action 1)

1. Create a **new** Neon database/branch named `velnox_mvp_staging`. Never the
   production database and never a branch of it that carries production data.
2. Bootstrap it once:

   ```bash
   psql "$MVP_STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/mvp/schema.sql
   ```

3. Record the identity (no secrets) and keep it with the staging ticket:

   ```sql
   SELECT current_database(), inet_server_addr(), current_setting('server_version');
   SELECT to_regclass('public.shops') IS NULL AS no_legacy_tables;   -- must be true
   SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'; -- 19
   ```

4. Optional categories seed: `psql "$MVP_STAGING_DATABASE_URL" -f db/mvp/seed.sql`.
5. Create the staging owner/admin account through the API
   (`POST /api/mvp/auth/bootstrap-owner` with `BOOTSTRAP_OWNER_SECRET`) or sign up
   and promote the row once. Use a staging-only password.

The database name **must not** be the production database. `db/mvp/reset.sh`
refuses any target that does not end in `_dev`/`_test`, refuses `DATABASE_URL`,
and refuses a production-marked process — but the provider-side creation is still
the owner's responsibility.

---

## 3. Environment matrix

### Render — `velnox-api-staging`

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | the staging Neon URL | must be the database from §2 |
| `MVP_API_ENABLED` | **`true`** | mounts `/api/mvp/*` and starts the expiry worker |
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
| `VITE_API_MODE` | `mvp` |
| `VITE_DEPLOY_ENV` | `staging` |
| `VITE_API_URL` | `https://<velnox-api-staging host>` (origin only, no `/api`) |

Everything else (`VITE_VELSHOP_URL`, …) follows the existing production pattern
with staging hosts.

**Production projects must not receive these three variables.** A production
build that sets `VITE_API_MODE=mvp` without `VITE_DEPLOY_ENV=staging` resolves to
the legacy API and logs `MVP_FORBIDDEN_IN_PRODUCTION`; that fail-closed path is
covered by `packages/shared/tests/mvp-config.test.ts`.

---

## 4. Verification after deploy (in order)

1. `GET https://<api>/api/health` → 200.
2. `GET https://<api>/api/mvp/payments/status` → `usable:false` unless Stripe test
   keys were set (never `mode:"live"`).
3. Open `https://<shop-staging>/` → the header shows the **MVP** chip and the
   footer prints `[api] MVP mode (staging) → …`. If it shows the legacy storefront,
   `VITE_API_MODE` did not reach the build.
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

`backend/jobs/mvp-order-expiry-scheduler.ts` starts only when
`MVP_API_ENABLED=true`, polls every 60 s (floor 30 s) and calls the same
`expireStaleOrders` the admin endpoint uses. `MVP_ORDER_EXPIRY_SCHEDULER=off`
keeps it manual (admin → Overview → “Run expiry sweep”). No second scheduler
system is introduced.

## 6. Known blockers (do not paper over)

| Blocker | Evidence | Consequence |
|---|---|---|
| ~~**Retail sets/packs are missing from the MVP**~~ **RESOLVED in Phase 3d** | `db/mvp/schema.sql` now has `product_selling_units` (`label`, `base_quantity`, own `price`, `is_active`) plus the `cart_items.selling_unit_id` and `order_items` snapshot columns | The MVP can sell a “Pack 6 / Pack 12” at its own price against base-unit stock (`base_units = quantity × base_quantity`). Proven by `backend/mvp/tests/selling-units.test.ts`, `db/mvp/verify.sh` §F3 and the browser E2E. Legacy sets/packs are untouched |
| **Image upload is not implemented for the MVP** | legacy `backend/routes/upload.ts` writes `INSERT INTO media (url, key, …)`; the MVP table is `media.object_key` (no `key`) | Sellers paste image URLs; the editor says so. A real upload needs an MVP-aware presign route writing `media.object_key` |
| **Google OAuth is parked** | `GET /api/mvp/auth/oauth` → 501; the MVP schema has no identity tables | email/password only; OAuth users from the legacy database cannot sign in |
| Vercel/Render access | no provider credential in this workspace | §2–§3 are owner actions, unverified by the agent |

## 7. Rollback

- **Frontends:** remove `VITE_API_MODE` (or set `legacy`) and redeploy → the
  legacy storefront returns; no code change needed.
- **Backend:** set `MVP_API_ENABLED=false` (or delete the staging service).
  `/api/mvp/*` unmounts and the expiry worker does not start.
- **Database:** the staging database is disposable; drop it with the Neon console.
- **Production:** nothing to roll back — no production resource is referenced by
  this runbook's changes.

## 8. Explicitly out of bounds

- Never point production `DATABASE_URL` at the staging database, or staging at
  production.
- Never run `db/mvp/reset.sql` / `reset.sh` against an unidentified database.
- Never enable `MVP_API_ENABLED` on the production Render service while it points
  at the legacy database.
- Never put a secret in a `VITE_*` variable (they are public and inlined).
- No production cutover in this phase.
