# AI_Handoff.md — Velnox Marketplace

**LAST UPDATED: 2026-08-23**

---

## Project Purpose

Velnox is a modern multi-vendor marketplace platform supporting Thai, English, and Burmese languages. It connects customers with independent sellers through a curated shopping experience. The UI/UX is derived from the Velnox V2 reference project.

## Architecture

```
4 Frontend Apps (Vercel)
    ↓
1 Backend API (Render)
    ↓
1 Neon PostgreSQL (source of truth)
+ 1 Cloudflare R2 (file storage)
+ 1 WebSocket (realtime delivery)
```

## Frontend Applications

All 4 apps share a single `@velnox/shared` package containing:
- All shadcn/ui components (70+ components)
- Shared components: Logo, AppHeader, MobileTabBar, RequireAuth, RequireRole, UserMenu
- Shared hooks: use-auth, use-mobile
- Shared libs: commerce types, sites config, app-shell, auth-flow, monitoring, i18n, track, shop, goals, reorder, customer-memory-core, image-optimize, api-client, api-routes
- Shared pages: Auth, NotFound
- Theme CSS (index.css with Velnox Design Theme v1.0)
- Shared assets (logo.svg)

### apps/velshop
- Customer marketplace storefront
- Product browsing, search, categories
- Cart drawer, checkout, orders
- Customer account, profile, addresses, wishlist
- VelRepeat (smart reorder)
- Mobile tab bar navigation
- Routes: /, /products, /products/:id, /auth, /cart, /checkout, /orders, /profile, /addresses, /wishlist, /velrepeat

### apps/velseller
- Seller management dashboard
- Goals, My Shop, Products, Orders, Income, Reorder
- Mobile tab bar navigation
- Routes: /, /seller/goals, /seller/shop, /seller/orders, /seller/income, /seller/reorder, /auth

### apps/velcenter
- Company/admin management
- Center dashboard with tabs: Users, Employees, Sellers, Products, Orders, Audit Logs, Settings
- Routes: /, /auth

### apps/velnox
- Corporate/public website
- Landing page, About, Vision, Business, Ecosystem, Technology, Careers, News, Privacy, Terms, Contact
- NO marketplace logic — pure marketing site
- Routes: /, /about, /vision, /business, /ecosystem, /technology, /careers, /news, /privacy, /terms, /contact

## Shared Package Structure

The `packages/shared` package is the ONLY shared package. It uses wildcard exports:
```json
"exports": {
  ".": "./src/index.ts",
  "./*": "./src/*"
}
```

Import patterns:
- `@velnox/shared/components/ui/button` — UI components
- `@velnox/shared/components/Logo` — shared components
- `@velnox/shared/hooks/use-auth` — shared hooks
- `@velnox/shared/lib/commerce` — commerce types
- `@velnox/shared/lib/sites` — site URLs
- `@velnox/shared/pages/Auth` — shared pages

Each app imports from `@velnox/shared` via a Vite resolve alias that points to `packages/shared/src`.

## Backend Architecture

### backend/server.ts
- Express server with Helmet, CORS, cookie-parser
- Google OAuth routes (backend/routes/auth.ts)
- API routes (backend/routes/index.ts)
- WebSocket server (backend/realtime/index.ts)
- Listens on process.env.PORT

### backend/routes/auth.ts
- `GET /auth/google` — Initiate Google OAuth flow
- `GET /auth/google/callback` — Handle Google callback, exchange code, resolve user, set session
- `GET /api/auth/me` — Get current authenticated user
- `POST /api/auth/logout` — Clear session cookie

### backend/middleware/auth.ts
- JWT session verification from `velnox_session` cookie
- requireAuth, optionalAuth middleware

### backend/db/index.ts
- PostgreSQL pool via pg
- query helper with slow query logging

### backend/routes/index.ts
- Products, categories, cart, orders, addresses, shops routes

### backend/realtime/index.ts
- WebSocket server, channel subscriptions, broadcast helper

## Database Architecture

Neon PostgreSQL is the ONLY source of truth.

### Tables by Domain

**Customer:** users, provider_identities, customer_profiles, addresses, carts, cart_items
**Seller:** sellers, shops, categories, products, product_images, inventory
**Commerce:** orders, order_items, payments, refunds, commissions, settlements, subscriptions
**Company:** departments, employees, company_settings, audit_logs
**Media:** media
**Analytics:** behavioral_events
**Notifications:** notifications

### Key Files
- db/schema.sql — Complete schema
- db/run-sqleditor.sql — Idempotent bootstrap for Neon SQL Editor
- db/migrations/ — Sequential migration files

## Authentication

- Google OAuth handled by backend
- HttpOnly, Secure, SameSite=lax session cookies (`velnox_session`)
- JWT tokens stored in cookies (NOT localStorage)
- Backend creates session on successful Google auth
- Frontend calls `GET /api/auth/me` with `credentials: "include"`

### Google OAuth Flow
1. Frontend redirects to `/auth/google?returnTo=...`
2. Backend redirects to Google OAuth consent screen
3. Google redirects to `/auth/google/callback` with code
4. Backend exchanges code for tokens, verifies Google identity
5. Backend resolves/creates Neon user (identity resolution)
6. Backend creates JWT session, sets httpOnly cookie
7. Backend redirects to frontend with returnTo path

## User Identity — CRITICAL RULES

The same person MUST NEVER receive a new user record every time they log in.

### Identity Resolution Flow (in backend/routes/auth.ts)
1. Check provider_identities for Google provider_subject
2. If found → use existing user
3. If not → normalize email, check users.email
4. If email exists → link Google identity to existing user
5. If new → create new user + customer_profile

Database enforces uniqueness on (provider, provider_subject).
Email is normalized (trim + lowercase) before comparison.

### Rules
- NEVER blindly INSERT a new user on every login
- Use INSERT ... ON CONFLICT or transactional strategy
- Handle concurrent login requests safely (use database transactions)

## Cloudflare R2

Binary file storage for avatars, covers, product images, documents.
- Backend generates presigned upload URLs
- Neon stores media metadata in `media` table
- Never expose R2 secrets to frontend

## Realtime

WebSocket delivery via backend/realtime/
- Neon is source of truth, WebSocket is delivery mechanism
- Channels: cart:updated, order:created, order:updated, product:updated, inventory:updated

## Behavioral Tracking

Stored in Neon `behavioral_events` table.
Events: product_view, category_view, search, add_to_cart, remove_from_cart, wishlist, purchase, shop_view, session_start, session_end

## i18n

- Managed via `packages/shared/src/lib/i18n/`
- Languages: th (default), en, my
- Locale persisted in localStorage (velnox_locale)
- All apps import i18n from their local `@/lib/i18n` which re-exports from shared
- Translation keys cover: navigation, products, cart, orders, auth, seller, center, corporate, footer

## Environment Variables

### Frontend (Vercel) — ONLY
```
VITE_CORPORATE_URL=
VITE_VELSHOP_URL=
VITE_VELSELLER_URL=
VITE_VELCENTER_URL=
VITE_SITE_BASENAME=
```

### Backend (Render) — ALL secrets
```
DATABASE_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
JWT_SECRET=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_DOMAIN=
CORS_ORIGINS=
PORT=3001
```

### What is NEVER in the frontend
- DATABASE_URL
- JWT_SECRET
- GOOGLE_CLIENT_SECRET
- R2_SECRET_ACCESS_KEY
- Any server-side credentials

## Deployment

### Frontend (Vercel) — 4 independent projects
- velshop: `bun run build:velshop` → apps/velshop/dist
- velseller: `bun run build:velseller` → apps/velseller/dist
- velcenter: `bun run build:velcenter` → apps/velcenter/dist
- velnox: `bun run build:velnox` → apps/velnox/dist

### Backend (Render)
- Service: velnox-api
- Start: `bun run api:start` → runs `tsx server.ts`
- Must listen on process.env.PORT

## Migration Rules

1. Every schema change → create migration file in db/migrations/
2. Update db/schema.sql
3. Update db/run-sqleditor.sql
4. NEVER use DROP TABLE/TRUNCATE in migrations
5. All migrations must be idempotent (IF NOT EXISTS)

## Coding Rules

- Bun for package management
- TypeScript strict mode
- React 19, Vite 7, Tailwind v4
- shadcn/ui components (from packages/shared/src/components/ui/)
- Framer Motion for animations
- Each app is fully isolated in apps/
- Shared code goes in packages/shared/
- Apps import from @velnox/shared via Vite alias

## Security Rules

- Never commit .env files
- Never put server secrets in frontend code
- Use HttpOnly cookies for auth tokens
- CORS configured via CORS_ORIGINS environment variable
- Input validation with Zod
- Rate limiting on auth endpoints

## Important Invariants

1. Neon PostgreSQL is the ONLY source of truth
2. Frontend NEVER connects directly to Neon
3. Frontend NEVER contains DATABASE_URL
4. User identity resolution prevents duplicate accounts
5. WebSocket state is NOT permanent database state
6. R2 stores binaries, Neon stores metadata
7. All four frontend apps must build independently
8. Backend is the ONLY server-side gateway

## Things Future AI Agents MUST NOT Change

1. Remove Convex from the system (it's already gone)
2. Add direct database access from frontend apps
3. Store auth tokens in localStorage
4. Create duplicate user records on login
5. Use DROP TABLE or TRUNCATE in migrations
6. Expose server secrets via VITE_ variables
7. Mix application-specific code between apps
8. Change the package naming convention (@velnox/shared, @velnox/velshop, etc.)
9. Replace the @velnox/shared wildcard export pattern

## Things That MUST Be Updated When Architecture Changes

1. This file (AI_Handoff.md)
2. docs/ARCHITECTURE.md
3. docs/DATABASE.md
4. db/schema.sql
5. db/run-sqleditor.sql
6. README.md
