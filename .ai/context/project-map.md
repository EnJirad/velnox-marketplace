# PROJECT_MAP — Where Things Live

## Monorepo Layout

```
apps/velshop/       Customer marketplace (Vercel)  — port 5173
apps/velseller/     Seller dashboard (Vercel)      — port 5174
apps/velcenter/     Admin/operations (Vercel)      — port 5175
apps/velnox/        Corporate site (Vercel)        — port 5176
backend/            Express API + WebSocket (Render) — port 3001
packages/shared/    Single shared package (ui, hooks, lib, pages)
db/                 Neon schema + migrations
docs/               Human docs (API, SECURITY, DEPLOYMENT, …)
.ai/                AI workspace: context/, tasks/, history/
```

## Frontend Apps (apps/*)

Each app: `src/main.tsx` (router), `src/pages/`, `src/components/` (app-local), `vite.config.ts` (alias `@velnox/shared → packages/shared/src`).

| App | Key routes / pages | Notes |
|-----|-------------------|-------|
| velshop | `/`, `/products`, `/products/:id`, `/cart`, `/checkout`, `/orders`, `/wishlist`, `/velrepeat` | Customer browsing, cart, checkout |
| velseller | `/`, `/seller/goals`, `/seller/shop`, `/seller/orders`, `/seller/income`, `/seller/reorder`, `/seller/profile` | Seller management, `RequireRole` onboarding |
| velcenter | `/` (tabs: Users, Employees, Sellers, Products, Orders, Audit, Settings, Categories), `/auth` | Admin; `Center.tsx` is the main page, `CategoriesManagement.tsx` for categories |
| velnox | `/`, `/about`, `/vision`, `/business`, `/ecosystem`, `/technology`, `/careers`, `/news`, `/privacy`, `/terms`, `/contact` | Pure marketing, no marketplace logic |

All frontends share `@velnox/shared` via Vite alias.

## Shared Package (packages/shared/src)

Wildcard exports: `"./*": "./src/*"`.

| Area | Location | Purpose |
|------|----------|---------|
| UI components | `components/ui/` | 70+ shadcn/ui components |
| Shared components | `components/` | `Logo`, `AppHeader`, `MobileTabBar`, `RequireAuth`, `RequireRole`, `UserMenu`, `VBadge`, `seller/*`, `goals/*`, `reorder/*` |
| Hooks | `hooks/use-auth.ts`, `hooks/use-mobile.ts` | Auth state, responsive |
| Lib | `lib/` | `commerce.ts` (types/constants), `sites.ts` (URLs), `api-routes.ts` (route table), `api-client.ts`, `i18n/`, `image-optimize.ts` |
| Pages | `pages/` | `Auth.tsx`, `NotFound.tsx` |
| Theme | `index.css` | Tailwind v4 + Velnox tokens |
| Types/assets | `types/`, `assets/logo.svg` | Shared types |

Import examples: `@velnox/shared/components/ui/button`, `@velnox/shared/lib/commerce`, `@velnox/shared/hooks/use-auth`.

## Backend (backend/)

| Area | File(s) | Responsibility |
|------|---------|---------------|
| Server | `server.ts` | Express + Helmet + CORS + cookie-parser + WebSocket mount; listens on `PORT` |
| DB pool | `db/index.ts` | Single `pg.Pool` (max 20, SSL verify-full); `query()` helper |
| Auth | `routes/auth.ts`, `middleware/auth.ts` | Google OAuth, JWT session, `requireAuth`/`optionalAuth`, revocation |
| Products | `routes/products.ts`, `lib/categories.ts`, `lib/product-lifecycle.ts` | Catalog, product CRUD, category API, lifecycle |
| Seller | `routes/seller.ts`, `routes/seller-orders.ts`, `routes/verification.ts` | Apply, profile, shop, orders, verification/evidence |
| Cart/Checkout | `routes/cart.ts`, `routes/stripe.ts`, `routes/velrepeat*.ts` | Cart, Stripe, VelRepeat |
| Admin/Center | `routes/admin.ts`, `routes/center.ts` | Bootstrap/owner, admin operations |
| Upload | `routes/upload.ts` | R2 presign + confirm |
| Variants/Options | `routes/product-options.ts`, `lib/variant-options.ts`, `lib/inventory.ts` | Option groups/values, variant mapping, stock |
| Realtime | `realtime/index.ts` | WebSocket server, channel subscriptions |
| Middleware | `middleware/error.ts`, `middleware/origin-guard.ts`, `middleware/rate-limit.ts` | Error handling, origin, rate limiting |
| Jobs | `jobs/velrepeat-scheduler.ts` | Scheduled VelRepeat |

Route table is centralized in `packages/shared/src/lib/api-routes.ts` and `backend/routes/index.ts`.

## Database (db/)

- `db/schema.sql` / `db/run-sqleditor.sql` — canonical, byte-identical bootstrap
- `db/migrations/001_*.sql` … `042_*.sql` — historical migrations (do not rewrite)

See `.ai/context/database.md`.

## Docs & Config

- Root: `AGENTS.md`, `INSTALLATION.md`, `VELNOX_DESIGN_THEME.md`, `README.md`, `package.json` (bun workspaces), `vercel.json`
- `docs/`: `API.md`, `ARCHITECTURE.md`, `AUTHENTICATION.md`, `DATABASE.md`, `DEPLOYMENT.md`, `ENVIRONMENT.md`, `I18N.md`, `MEDIA.md`, `REALTIME.md`, `SECURITY.md`, `STORAGE.md`
- AI workspace: `.ai/` — `AI_RULES.md`, `AI_HANDOFF.md` (current state + remaining gaps), `context/*.md`, `tasks/`, `history/` (`AI_Handoff_Archive.md` dated index + `archive/` full records). See `.ai/README.md`

## Feature → Location Map

| Need | Look at |
|------|---------|
| Find a route/component/table | Search symbol → `.ai/context/project-map.md` → subsystem doc → source |
| Product creation/editing | `.ai/context/products.md` → `backend/routes/products.ts`, `packages/shared/src/components/seller/ProductFormDialog.tsx` |
| Category tree/selector | `.ai/context/categories.md` → `backend/lib/categories.ts`, `apps/velcenter/src/components/CategoriesManagement.tsx` |
| Seller onboarding/shop | `.ai/context/seller.md` → `backend/routes/seller.ts`, `packages/shared/src/components/RequireRole.tsx` |
| Auth/session | `.ai/context/security.md` → `backend/routes/auth.ts`, `backend/middleware/auth.ts` |
| Uploads/images | `.ai/context/media.md` → `backend/routes/upload.ts` |
| Orders/checkout | `.ai/context/checkout.md` → `backend/routes/cart.ts`, `backend/routes/stripe.ts` |
| Payments / Stripe / COD flags | `.ai/context/payment.md` → `backend/lib/payment-config.ts`, `backend/routes/stripe.ts` |
| Seller verification / V badge | `.ai/context/verification.md` → `backend/routes/verification.ts`, `backend/lib/verification-guard.ts` |
| Styling/theme | `.ai/context/frontend.md` → `VELNOX_DESIGN_THEME.md`, `packages/shared/src/index.css` |
