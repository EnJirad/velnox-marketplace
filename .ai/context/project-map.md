# PROJECT_MAP — Where Things Live

> **Last verified against the source on 2026-10-22.** The pre-MVP route/page tree
> was removed in §92 of the handoff; every path below is the MVP tree. If a path
> here is missing from the repository, this map is stale — the source wins.

## Monorepo Layout

```
apps/velshop/       Customer storefront (Vercel)      — port 5173
apps/velseller/     Seller workspace (Vercel)         — port 5174
apps/velcenter/     Admin console (Vercel)            — port 5175
apps/velnox/        Corporate site (Vercel)           — port 5176
backend/            Express API, ONE tree (Render)    — port 3001
packages/shared/    Single shared package (ui, mvp client, i18n, lib)
db/                 two canonical SQL files (no migrations)
scripts/            disposable-database proofs and resets
docs/, .ai/         Human docs and the AI workspace
```

## Frontend Apps (apps/*)

Each marketplace app: `src/main.tsx` (providers + basename) and `src/mvp/`
(`App.tsx` routes plus that app's pages). There is no second page tree and no
runtime switch between APIs — `main.tsx` mounts the MVP app directly.

| App | `src/` contents | Routes |
|-----|-----------------|--------|
| velshop | `mvp/` — `App.tsx`, `Home`, `Catalog`, `Product`, `CartPage`, `CheckoutPage`, `OrdersPage`, `OrderDetailPage`, `cart.tsx` (cart provider), `session.tsx`, `components.tsx` | `/`, `/products`, `/products/:slug`, `/cart`, `/checkout`, `/orders`, `/orders/:orderId`, `/auth`, `*` |
| velseller | `mvp/` — `App.tsx`, `Workspace`, `ProductEditor`, `OrdersPanel` | `/seller`, `/seller/products`, `/seller/products/:productId`, `/seller/orders`, `/auth`, `*` |
| velcenter | `mvp/` — `App.tsx`, `Admin.tsx` | `/` (overview), `/sellers`, `/products`, `/categories`, `/auth`, `*` |
| velnox | `pages/corporate/` — `CorporateLayout`, `CorporateHome`, `StaticPage`, `Contact`, `content.ts` | `/`, `/about`, `/vision`, `/business`, `/ecosystem`, `/technology`, `/careers`, `/news`, `/privacy`, `/terms`, `/contact` |

All frontends share `@velnox/shared` via the Vite alias (`@velnox/shared/*` →
`packages/shared/src/*`).

## Shared Package (packages/shared/src)

| Area | Location | Purpose |
|------|----------|---------|
| UI primitives | `components/ui/` | shadcn/ui components |
| Branding | `components/Logo.tsx` | the one shared logo |
| App shell | `lib/app-shell.tsx` | `RootErrorBoundary`, `SiteSuspense`, `RouteSyncer`, `RouteLoading` |
| Auth/session helper | `lib/api-client.ts` | `initAuth`, `useAuth`, `refetchCurrentUser`, `signOut`; reads `/api/mvp/auth/me` |
| Sites / origins | `lib/sites.ts` | per-app URLs, `siteBasename`, `apiBaseUrl` |
| API mode | `mvp/config.ts` | resolves the backend origin (`VITE_API_URL`, `VITE_API_MODE`, `VITE_DEPLOY_ENV`) |
| HTTP client | `mvp/client.ts` | envelope handling, cookie credentials, timeout, `MvpApiError` |
| Typed API | `mvp/api.ts` + `mvp/routes.ts` | one function per route; `MVP_ROUTES` is the only route table |
| Types | `mvp/types.ts` | shared payload shapes |
| UI kit | `mvp/ui.tsx` | query hook, loading/error/empty states, money formatting, auth panel, `MvpSessionProvider` / `MvpRequireSession` |
| i18n | `lib/i18n/` | `th` / `en` / `my` locales, parity via `bun run i18n:check` |
| Theme | `index.css` | Tailwind v4 + Velnox tokens (imported by every `main.tsx`) |

## Backend (backend/)

ONE route tree, mounted unconditionally at `/api/mvp` from `server.ts`. No
feature flag selects an API and there is no WebSocket.

| Area | File(s) | Responsibility |
|------|---------|----------------|
| Server | `server.ts` | Helmet, cookies, webhook raw body before `express.json()`, CORS + origin guard, rate limit, `/api/health`, 404/500 JSON |
| Entry | `mvp/index.ts` | route inventory; mounts the domain modules under `/api/mvp` |
| Auth | `mvp/auth.ts`, `mvp/session.ts`, `middleware/auth.ts` | signup/login/logout/me, `bootstrap-owner`, scrypt passwords, JWT cookie + `revoked_tokens`; OAuth answers 501 |
| Seller | `mvp/seller.ts`, `mvp/seller-products.ts` | apply/status, product CRUD, variants, selling units, stock, submit/publish, seller orders |
| Catalog | `mvp/catalog.ts` | category tree, published-only product list and detail |
| Cart / checkout | `mvp/cart.ts`, `mvp/checkout.ts` | one cart per seller, server-side pricing, idempotent order creation, guarded reserve |
| Orders | `mvp/orders.ts` | order reads for buyer/seller/admin, cancel |
| Payments | `mvp/payments.ts`, `mvp/settlement.ts`, `mvp/webhook-body.ts`, `lib/payment-config.ts` | Stripe TEST-only sessions, signed webhook, settlement/idempotency |
| Inventory | `mvp/inventory.ts` | the only stock authority (`inventory` table) — reserve / commit / release |
| Admin | `mvp/admin.ts` | seller and product review, categories, metrics, expiry sweep |
| Rules / audit | `mvp/product-rules.ts`, `mvp/audit.ts` | lifecycle constants and the single audit writer |
| HTTP | `mvp/http.ts` | `ApiError`, async handler, error mapping (CHECK/trigger violations included) |
| Database | `db/index.ts`, `db/test-database.ts` | single `pg.Pool`; fail-closed test-database guard |
| Libs | `lib/money.ts`, `lib/order-number.ts`, `lib/pagination.ts`, `lib/password.ts` | money math (NUMERIC strings), order numbers, list paging, scrypt |
| Middleware | `middleware/auth.ts`, `middleware/origin-guard.ts`, `middleware/rate-limit.ts` | session read, Origin check, rate limits |
| Jobs | `jobs/mvp-order-expiry-scheduler.ts` | releases reserved stock for unpaid orders (`MVP_ORDER_EXPIRY_SCHEDULER=off` opts out) |
| Tests | `mvp/tests/` (run by `bun run test:mvp`) · `tests/` (static contracts) | behaviour suite on a disposable database; schema/static contracts |

## Database (db/)

- `db/schema.sql` — canonical MVP DDL (20 tables; one order axis, `inventory` as
  the only stock authority, `NUMERIC(12,2)` money).
- `db/run-sqleditor.sql` — the same DDL in install order for the Neon SQL Editor,
  ending in a read-only install check.
- No migrations, no `db/mvp/`, no `db/README.md`. Both files are comment-free and
  non-destructive; `bun run db:check` (`scripts/db-verify.sh`) proves they install
  identically, twice.

See `.ai/context/database.md` and `docs/DATABASE.md`.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/db-verify.sh` (`bun run db:check`) | applies both SQL files twice to disposable databases and diffs the dumps |
| `scripts/db-reset.sh` (`bun run db:reset`) | guarded rebuild of an explicitly named `_dev`/`_test` database |
| `scripts/db-test-run.sh` (`bun run test:mvp`) | creates a disposable database from `db/schema.sql`, runs `backend/mvp/tests`, drops it |
| `scripts/db-browser-e2e.sh` (`bun run test:mvp:browser`) | Playwright pass over the three MVP apps against a disposable database |
| `scripts/db-seed.sql` | platform categories only; refuses a non-`_dev`/`_test` database |

## Docs & Config

- Root: `AGENTS.md`, `INSTALLATION.md`, `VELNOX_DESIGN_THEME.md`, `README.md`,
  `package.json` (bun workspaces), `vercel.json`
- `docs/`: `DATABASE.md`, `PRODUCTION_CUTOVER.md`, `MVP_STAGING.md`,
  `PAYMENT_*`, `DEPLOYMENT.md`, `ENVIRONMENT.md`, `API.md`, `SECURITY.md`, …
- `.ai/`: `AI_RULES.md`, `AI_HANDOFF.md` (current state + remaining gaps),
  `context/*.md`, `tasks/`, `history/`. See `.ai/README.md`

## Feature → Location Map

| Need | Look at |
|------|---------|
| Find a route/component/table | search the symbol → this map → subsystem doc → source |
| API route inventory | `backend/mvp/index.ts`, `packages/shared/src/mvp/routes.ts` |
| Product creation/editing | `backend/mvp/seller-products.ts` + `product-rules.ts`, `apps/velseller/src/mvp/ProductEditor.tsx` |
| Product catalogue / detail | `backend/mvp/catalog.ts`, `apps/velshop/src/mvp/Catalog.tsx`, `Product.tsx` |
| Category tree | `backend/mvp/catalog.ts`, `backend/mvp/admin.ts`, `apps/velcenter/src/mvp/Admin.tsx` |
| Seller onboarding | `backend/mvp/seller.ts`, `backend/mvp/admin.ts`, `apps/velseller/src/mvp/Workspace.tsx` |
| Auth / session | `backend/mvp/auth.ts`, `backend/mvp/session.ts`, `backend/middleware/auth.ts`, `packages/shared/src/lib/api-client.ts` |
| Cart / checkout | `backend/mvp/cart.ts`, `backend/mvp/checkout.ts`, `apps/velshop/src/mvp/CartPage.tsx`, `CheckoutPage.tsx` |
| Orders / fulfilment | `backend/mvp/orders.ts`, `backend/mvp/settlement.ts`, `apps/velshop/src/mvp/OrdersPage.tsx`, `apps/velseller/src/mvp/OrdersPanel.tsx` |
| Payments / Stripe | `backend/mvp/payments.ts`, `backend/mvp/settlement.ts`, `backend/lib/payment-config.ts`, `.ai/context/payment.md` |
| Inventory / stock | `backend/mvp/inventory.ts`, `backend/mvp/tests/selling-units.test.ts`, `cart-checkout.test.ts` |
| Images / media | MVP stores image URLs only (no R2 upload) — see `.ai/context/media.md` |
| Styling / theme | `VELNOX_DESIGN_THEME.md`, `packages/shared/src/index.css`, `.ai/context/frontend.md` |
