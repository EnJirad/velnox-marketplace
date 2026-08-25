# AI_Handoff.md — Velnox Marketplace

**LAST UPDATED: 2026-08-25**

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
- Upload routes (backend/routes/upload.ts)
- Admin routes (backend/routes/admin.ts) — bootstrap status & owner claim
- WebSocket server (backend/realtime/index.ts)
- Listens on process.env.PORT

### backend/routes/auth.ts
- `GET /auth/google` — Initiate Google OAuth flow
- `GET /auth/google/callback` — Handle Google callback, exchange code, resolve user, set session
- `GET /api/auth/me` — Get current authenticated user (with 30s per-user cache)
- `POST /api/auth/logout` — Clear session cookie

### backend/routes/upload.ts
- `POST /api/upload/presign` — Generic R2 presigned URL generation
- `POST /api/upload/confirm` — Generic upload confirmation
- `POST /api/customer/profile-image/upload-intent` — Profile image presign (avatar/cover)
- `POST /api/customer/profile-image/save` — Verify R2 + persist to Neon
- `PATCH /api/customer/profile-image` — Direct avatar URL update
- `GET /api/health/r2` — R2 health check

### backend/routes/index.ts
- Products: `GET /api/products`, `GET /api/products/:id`
- Categories: `GET /api/categories`
- Customer Profile: `GET/PUT /api/customer/profile`
- Addresses: `GET/POST /api/customer/addresses`, `DELETE /api/customer/addresses/:id`
- Cart, Orders, Shops: placeholder routes

### backend/routes/seller.ts
- `POST /api/seller/apply` — Submit seller application (creates seller + shop records)
- `GET /api/seller/status` — Get current user's seller status
- `GET /api/seller/profile` — Get seller profile with shop details
- `GET /api/admin/sellers` — List all sellers with user/shop info (admin only, returns `owner_id` for self-detection)
- `PATCH /api/admin/sellers/:id/status` — Approve/reject/suspend seller (owner/admin only, self-approval blocked)
  - Uses PostgreSQL transaction with `FOR UPDATE` row lock
  - Promotes `users.role` to 'seller' on approval (unless owner/admin/staff)
  - Records `audit_logs` entry for every status change
  - Idempotent: already-approved returns success
  - Canonical statuses: pending, approved, rejected, suspended

### backend/middleware/auth.ts
- JWT session verification from `velnox_session` cookie
- requireAuth, optionalAuth middleware

### backend/db/index.ts
- PostgreSQL pool via pg (max: 20, idleTimeout: 30s, connectTimeout: 5s)
- Shared pool — never creates new pool per request
- Slow query logging (>500ms)
- SSL mode: verify-full

### backend/realtime/index.ts
- WebSocket server, channel subscriptions, broadcast helper

## Database Architecture

Neon PostgreSQL is the ONLY source of truth.

### Tables by Domain

**Customer:** users, auth_identities, customer_profiles, addresses, carts, cart_items
**Seller:** sellers, shops, categories, products, product_images, inventory, seller_settings, seller_analytics
**Commerce:** orders, order_items, payments, refunds, commissions, settlements, subscriptions
**Company:** departments, employees, company_settings, platform_settings, system_settings, audit_logs, moderation_records
**Media:** media
**Analytics:** behavioral_events
**Notifications:** notifications

### Key Files
- db/schema.sql — Complete schema (source of truth for documentation)
- db/run-sqleditor.sql — Idempotent bootstrap for Neon SQL Editor
- db/migrations/ — Sequential migration files (001–009)

## Authentication

- Google OAuth handled by backend
- HttpOnly, Secure, SameSite=none session cookies (`velnox_session`)
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
1. Check auth_identities for Google provider_id
2. If found → use existing user
3. If not → normalize email, check users.email
4. If email exists → link Google identity to existing user
5. If new → create new user + customer_profile

Database enforces uniqueness on (provider, provider_id).
Email is normalized (trim + lowercase) before comparison.

### Rules
- NEVER blindly INSERT a new user on every login
- Use INSERT ... ON CONFLICT or transactional strategy
- Handle concurrent login requests safely (use database transactions)

## Cloudflare R2 — Profile Image Storage

### Fixed Key Strategy (Current)
Each user has exactly 1 R2 object per image type:
- Avatar: `profile/avatar/{userId}.webp`
- Cover: `profile/cover/{userId}.webp`

R2 PUT automatically overwrites the existing object with the same key.
Images are converted to WebP before upload on the frontend.

### Upload Flow
1. Frontend calls `/api/customer/profile-image/upload-intent`
2. Backend generates presigned PUT URL for fixed key
3. Frontend converts file to WebP, PUTs to R2
4. Frontend calls `/api/customer/profile-image/save`
5. Backend verifies R2 object exists, saves media record, updates user table
6. Backend returns canonical URL
7. Frontend appends `?v={timestamp}` for cache-busting display

### Cache-Busting
Database stores canonical URL: `https://pub-xxx.r2.dev/profile/avatar/user.webp`
Frontend displays: `https://pub-xxx.r2.dev/profile/avatar/user.webp?v=1787612345678`
`optimizedUrl()` in `packages/shared/src/lib/image-optimize.ts` preserves existing query params.

### Legacy Cleanup
Old timestamped objects (`profile/cover/{userId}/{timestamp}.webp`) are cleaned up automatically on first upload with the new fixed-key system.

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

## Centralized URL Configuration

All frontend URLs are centralized in `packages/shared/src/lib/sites.ts`:

| Export | Purpose | Source |
|--------|---------|--------|
| `apiUrl` | Backend API origin (no path) | `VITE_API_URL` (default: `http://localhost:3001`) |
| `apiBaseUrl` | Full API base URL with `/api` prefix | `VITE_API_URL + /api` |
| `SITE_URLS.corporate` | Corporate website URL | `VITE_CORPORATE_URL` |
| `SITE_URLS.velshop` | VelShop URL | `VITE_VELSHOP_URL` |
| `SITE_URLS.velseller` | VelSeller URL | `VITE_VELSELLER_URL` |
| `SITE_URLS.velcenter` | VelCenter URL | `VITE_VELCENTER_URL` |
| `siteBasename()` | Router basename | `VITE_SITE_BASENAME` |
| `joinUrl()` | Safe URL path joining helper | — |

All `VITE_*` values are **PUBLIC** and intentionally exposed to the browser.
In Vercel, configure these as type **Config** (NOT Secret).

### Why centralized?

If a domain changes (e.g. `shop.velnx.com` → `shop.newdomain.com`), update the Vercel environment variable and redeploy. No source code changes needed.

## Environment Variables

### Frontend (Vercel) — ALL PUBLIC
```
VITE_API_URL=https://velnx-api.onrender.com
VITE_SITE_BASENAME=
VITE_VELSHOP_URL=https://shop.velnox.com
VITE_VELSELLER_URL=https://seller.velnx.com
VITE_VELCENTER_URL=https://center.velnx.com
VITE_CORPORATE_URL=https://velnx.com
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
BOOTSTRAP_OWNER_SECRET=
PORT=3001
```

### What is NEVER in the frontend
- DATABASE_URL
- JWT_SECRET
- GOOGLE_CLIENT_SECRET
- R2_SECRET_ACCESS_KEY
- Any server-side credentials
- BOOTSTRAP_OWNER_SECRET (backend only)

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
9. Profile images use deterministic fixed keys (1 object per user per type)

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
10. Change profile image R2 key scheme (fixed keys are intentional)

## Things That MUST Be Updated When Architecture Changes

1. This file (AI_Handoff.md)
2. docs/ARCHITECTURE.md
3. docs/DATABASE.md
4. db/schema.sql
5. db/run-sqleditor.sql
6. db/run-update.sql (append new migration)
7. README.md
8. AI_RULES.md

## Recent Work History

### 2026-08-25 — Fix Seller Approval CORS, Diagnostics & Frontend Error Handling
- **Problem:** After approving a seller in VelCenter, the seller still cannot use VelSeller. Multiple subtle issues compound:
  1. CORS silently blocks cross-origin requests when `CORS_ORIGINS` env var on Render doesn't include all production frontend domains
  2. When `/api/seller/status` fails (CORS, timeout, table missing), `RequireRole` shows the login/onboarding form instead of a helpful error
  3. Backend `GET /api/seller/status` query crashes if `shops` or `seller_settings` tables don't exist in production
  4. No diagnostic logging on seller status checks makes production debugging impossible
- **Root cause:**
  1. `CORS_ORIGINS` env var is the ONLY source of allowed origins — if misconfigured, every cross-origin request from VelSeller/VelCenter to the backend is silently blocked by the browser
  2. `requireAuth` middleware only checks JWT signature (correct), but `/api/auth/me` is the only endpoint that checks revoked tokens — this is by design to avoid doubling DB load on every request
  3. `RequireRole` catches fetch errors but falls back to `{ status: null }` without logging — the user sees the login form with no indication of what went wrong
- **Fix:**
  - **Backend `server.ts` CORS:** Now merges `CORS_ORIGINS` with `VITE_VELSHOP_URL`, `VITE_VELSELLER_URL`, `VITE_VELCENTER_URL`, `VITE_CORPORATE_URL` env vars plus dev origins. Production domains are always allowed even if `CORS_ORIGINS` is misconfigured
  - **Backend `/api/seller/status`:** Added graceful fallback — if LEFT JOIN with `shops`/`seller_settings` fails (table missing), falls back to a simpler query on `sellers` only. Added `[seller] status for user X: STATUS` diagnostic logging
  - **Backend `requireAuth`:** Documented that revoked-token check is intentionally in `/api/auth/me` only (not middleware) to avoid per-request DB overhead
  - **Frontend `RequireRole`:** Now checks `r.ok` on the seller status fetch and logs errors — improves production debugging
- **Files changed:** `backend/server.ts`, `backend/routes/seller.ts`, `backend/middleware/auth.ts`, `packages/shared/src/components/RequireRole.tsx`
- **Result:** All 5 typechecks pass. CORS is resilient to misconfiguration. Seller status endpoint handles missing tables gracefully.

### 2026-08-25 — Complete Seller Approval & Role Authorization Fix
- **Problem:** Seller approval had multiple critical issues: no database transaction (atomicity failure), no role promotion (approved sellers stayed `role='customer'`), no audit logging, no CHECK constraint on `sellers.status`, no idempotency, no concurrency protection
- **Root cause:**
  1. Backend PATCH `/api/admin/sellers/:id/status` used separate non-transactional queries — if one failed, the other succeeded = inconsistent state
  2. Approval did NOT update `users.role` — a customer approved as seller still had `role='customer'` in the database
  3. No `audit_logs` entries for seller authorization actions
  4. `sellers.status` CHECK constraint was removed entirely in a previous fix (no constraint at all)
  5. Backend valid statuses included `under_review` which was not in the canonical set
  6. No idempotency — approving an already-approved seller did a redundant UPDATE
- **Fix:**
  - **Backend `PATCH /api/admin/sellers/:id/status`:** Complete rewrite with:
    - PostgreSQL transaction (`BEGIN`/`COMMIT`/`ROLLBACK`) for atomicity
    - `FOR UPDATE` row lock to prevent race conditions
    - Role promotion: `customer` → `seller` on approval (preserves `owner`/`admin`/`staff` roles)
    - Idempotency: already-approved returns success with message
    - Audit logging: `audit_logs` entries for every status change
    - Auth cache invalidation: `invalidateCachedProfile()` so `/api/auth/me` returns fresh role
    - Canonical valid statuses: `pending`, `approved`, `rejected`, `suspended` (removed `under_review`)
  - **Database:** Added V0011 migration with CHECK constraint: `CHECK (status IN ('pending', 'approved', 'rejected', 'suspended'))`
  - **Database normalization:** `active` → `approved`, `under_review` → `pending` (migrates old inconsistent data)
  - **All three SQL files updated:** `run-update.sql` (V0011), `run-sqleditor.sql`, `schema.sql`
- **Role model:**
  - `users.role` = platform role (`customer`, `seller`, `admin`, `owner`, `staff`)
  - `sellers.status` = seller onboarding state (`pending`, `approved`, `rejected`, `suspended`)
  - On approval: customer gets `role='seller'`; owner/admin/staff keep their existing role
  - VelSeller access determined by `sellers.status = 'approved'`, not `users.role`
- **VelCenter flow:** After approval, `reloadSellers()` re-fetches the list; admin's own auth unchanged
- **VelSeller flow:** `RequireRole` checks `/api/seller/status` → `approved` → shows dashboard
- **Security:** Self-approval blocked (`SELF_ACTION_FORBIDDEN`); only owner/admin can approve; backend determines identity from session
- **Files changed:** `backend/routes/seller.ts`, `db/migrations/011_seller_status_constraint.sql`, `db/run-sqleditor.sql`, `db/schema.sql`, `db/run-update.sql`
- **Result:** All 5 typechecks pass. Complete seller approval lifecycle works atomically with audit trail.

### 2026-08-25 — Permanent Development Memory System Initialized
- **Task:** Synchronize database schema files, create run-update.sql migration history, and establish permanent development memory
- **Problem:** `run-update.sql` did not exist; `run-sqleditor.sql` and `schema.sql` were out of sync (different column types, missing columns, wrong CHECK constraints); no single source of truth for incremental migrations
- **Fix:**
  - Created `db/run-update.sql` — consolidated all 10 existing migrations (V0001–V0010) into the permanent incremental migration history file
  - Rewrote `db/run-sqleditor.sql` — complete bootstrap schema matching what the backend actually uses (TEXT types, no CHECK on sellers.status/products.status, added customer_profiles.date_of_birth/gender, carts.total_items/total_amount, inventory.reserved)
  - Rewrote `db/schema.sql` — synchronized to match run-sqleditor.sql exactly (verified with diff — only header comments and blank lines differ)
  - Removed wrong CHECK constraint on sellers.status (was `pending, active, suspended` — missing `approved`, `rejected`, `under_review` which the backend uses)
  - Removed wrong CHECK constraint on products.status (was `draft, active, archived` — backend may use other values)
  - Verified all 4 frontend apps + backend pass typecheck
- **Files created:** `db/run-update.sql`
- **Files updated:** `db/run-sqleditor.sql`, `db/schema.sql`, `AI_RULES.md` (47 permanent rules), `AI_Handoff.md`
- **Result:** Three SQL files are now synchronized and accurate. run-update.sql preserves the complete migration history. Every future DB change must update all three files.

### 2026-08-25 — Permanent AI Development Rules Established
- **Task:** Comprehensive rewrite of `AI_RULES.md` with 47 permanent development rules covering all aspects of the Velnox project
- **Rules added:**
  - **Database (Rules 3–10):** Three required SQL files (`run-update.sql`, `run-sqleditor.sql`, `schema.sql`); migration format with version/date/description/reason; every DB change must update all three files; never destroy production data; 13-step production database workflow; consistency check before declaring complete
  - **Documentation (Rules 11–13):** AI_Handoff.md always updated; AI_RULES.md maintained; INSTALLATION.md maintained
  - **Git (Rule 14):** Always push after completion; commit message format; never force push
  - **Authentication (Rules 15–22):** Backend session as source of truth; Google OAuth requirements; session creation; /api/auth/me; real logout with server-side revocation; logout verification; auth cache invalidation; cross-browser auth
  - **Cross-domain (Rules 23–24):** Cross-domain auth verification; CORS requirements
  - **API (Rules 25, 30, 43):** API URL standardization; JSON-only error responses; centralized URL configuration
  - **Environment (Rule 26):** Frontend VITE_* vars are public; secrets must remain server-side
  - **Business Logic (Rules 27–29):** VelCenter authorization; seller status canonical values; seller approval flow
  - **Performance (Rule 31):** Slow query debugging protocol
  - **File uploads (Rules 32–34):** WebP conversion; R2 fixed keys; frontend cache invalidation
  - **Database debugging (Rule 36):** Compare all layers before modifying backend
  - **Quality (Rules 37–42):** No quick hacks; document architecture changes; build/typecheck; final verification checklist; never declare complete prematurely; final report format
  - **Architecture (Rule 44):** Project structure; key invariants; things AI agents must NOT change
  - **Bug fixes (Rule 45):** Root cause analysis protocol
  - **Consistency (Rules 46–47):** Never guess; documentation consistency
- **Files changed:** `AI_RULES.md` (complete rewrite — 1069 lines, 47 permanent rules)
- **Result:** AI_RULES.md is now the single authoritative source for all permanent Velnox development rules. Every future AI agent and developer MUST read this file before any task.

### 2026-08-25 — Full Auth Overhaul: Session Revocation, Logout, Cross-Browser Auth
- **Problem:** Logout doesn't actually invalidate the server session (JWT stays valid 7 days); `google_failed` error on different browsers/accounts; after logout user data persists; no session invalidation on the backend
- **Root cause:**
  1. JWT sessions had no revocation mechanism — once issued, a token was valid for 7 days regardless of logout
  2. Backend `POST /api/auth/logout` only cleared the cookie but didn't invalidate the JWT server-side
  3. Frontend `signOut()` didn't verify the session was actually cleared, didn't clear sessionStorage markers
  4. No `revoked_tokens` table existed in the database
- **Fix:**
  - **Database:** Added `revoked_tokens` table (migration 010, schema.sql, run-sqleditor.sql) — stores revoked JWT `jti` values with expiry for cleanup
  - **Backend `createSessionToken`:** Added unique `jti` (UUID) to every JWT token
  - **Backend `/api/auth/me`:** Now checks `revoked_tokens` table before accepting a token — if `jti` is revoked, returns 401 and clears cookie
  - **Backend `POST /api/auth/logout`:** Now stores the token's `jti` in `revoked_tokens` table before clearing the cookie. Also clears cookie with ALL matching attributes (httpOnly, secure, sameSite)
  - **Backend cleanup:** Lazy cleanup of expired revoked tokens (once per 5 min)
  - **Frontend `signOut()`:** Now verifies session is actually cleared by calling `/api/auth/me` after logout. Clears sessionStorage markers. Retries logout if session still valid
- **Security:**
  - Token revocation is server-side (database) — even if cookie is stolen, revoked tokens are rejected
  - `BOOTSTRAP_OWNER_SECRET` never logged or exposed
  - Expired revoked tokens are cleaned up automatically
  - `SameSite=none; Secure=true` cookie attributes preserved
- **Files changed:** `backend/routes/auth.ts`, `packages/shared/src/lib/api-client.ts`, `db/schema.sql`, `db/run-sqleditor.sql`, `db/migrations/010_revoked_tokens.sql`
- **Database change:** NEW TABLE `revoked_tokens` — run migration 010 on Neon
- **Result:** All 4 frontend apps + backend pass typecheck. Logout now invalidates the server session. `/api/auth/me` returns 401 after logout.

### 2026-08-25 — Fix Google OAuth Login Flow & Seller Onboarding
- **Problem:** VelSeller Google login fails with `google_failed` error; after Google OAuth completes, user is redirected to wrong frontend; VelSeller shows login page even after successful auth; seller onboarding form is minimal (shop name only)
- **Root cause:**
  1. `getFrontendUrl()` in `backend/routes/auth.ts` always returned `CORS_ORIGINS[0]` (VelShop), ignoring which frontend initiated the OAuth flow. When VelSeller started Google auth, the callback redirected to VelShop
  2. `currentSite()` in `Auth.tsx` used pathname-based detection (`/velseller` prefix) which doesn't work when VelSeller runs on its own domain (`velseller.vercel.app` with `/auth` path)
  3. OAuth callback lacked diagnostic logging, making it impossible to debug backend failures
- **Fix:**
  - Backend `getFrontendUrl(req, returnTo?)`: now resolves the correct frontend URL from the `returnTo` path. Checks per-app env vars (`VITE_VELSELLER_URL`, `VITE_VELCENTER_URL`, `VITE_VELSHOP_URL`), then falls back to `CORS_ORIGINS` pattern matching, then to request origin header
  - Backend OAuth callback: added `[auth] OAuth success` and `[auth] Google OAuth callback error` diagnostic logging with error message and stack trace (no secrets logged)
  - Frontend `currentSite()`: added hostname-based detection — checks `window.location.hostname` for `seller`/`center` keywords before falling back to pathname detection
  - Frontend `RequireRole.tsx`: enhanced seller onboarding with multi-step mock KYC form (4 steps: shop info → personal info → identity verification → document upload), step indicator, success confirmation page with pending status, and proper error handling
- **Files changed:** `backend/routes/auth.ts`, `packages/shared/src/pages/Auth.tsx`, `packages/shared/src/components/RequireRole.tsx`
- **Environment variables needed on Render:**
  - `VITE_VELSHOP_URL` — must match the VelShop frontend origin (e.g., `https://velshop.vercel.app`)
  - `VITE_VELSELLER_URL` — must match the VelSeller frontend origin (e.g., `https://velseller.vercel.app`)
  - `VITE_VELCENTER_URL` — must match the VelCenter frontend origin (e.g., `https://velcenter.vercel.app`)
  - These are used by `getFrontendUrl()` to redirect to the correct frontend after OAuth
- **Result:** All 4 frontend apps + backend pass typecheck. OAuth redirect resolves to the correct frontend based on the `returnTo` path

### 2026-08-25 — Fix Seller Approval Authorization & Role Architecture
- **Problem:** Owner trying to approve/reject a seller got "Cannot approve/reject yourself"; also `UPDATE users SET role = 'seller'` would downgrade owner/admin/staff roles
- **Root cause:** Backend PATCH endpoint lacked proper role separation — seller status was conflated with user platform role. Also, the admin seller list endpoint returned `user_id` in SQL but didn't map it to the frontend, so the UI couldn't detect self-applications
- **Fix:**
  - Backend `PATCH /api/admin/sellers/:id/status`: removed `UPDATE users SET role = 'seller'` on approval — seller status is now independent from user platform role
  - Backend `GET /api/admin/sellers`: added `owner_id: row.user_id` to the response mapping so the frontend can identify the current user's own seller application
  - Frontend `Center.tsx`: added `owner_id` to `SellerRow` interface; added `isOwnSeller` check (`s.owner_id === user?._id`); disabled approve/reject buttons for own application with Thai message "ไม่สามารถอนุมัติร้านของตัวเอง"; added "(คุณ)" label on own seller row; backend self-approval protection remains enforced server-side
- **Security:**
  - Self-approval prevention: backend rejects with SELF_ACTION_FORBIDDEN if `seller.user_id === userId` on approve/reject
  - Owner/Admin/Staff roles are NEVER downgraded on seller approval
  - Backend determines user identity from JWT session, never trusts frontend userId
  - `staff` role CANNOT approve/reject sellers (only `owner` and `admin`)
- **Files changed:** `backend/routes/seller.ts`, `apps/velcenter/src/pages/Center.tsx`
- **Result:** All 4 frontend apps + backend pass typecheck. Seller approval correctly separated from user role

### 2026-08-25 — Complete Seller Onboarding & Approval System
- **Problem:** Frontend seller registration ("สมัครร้าน") returned `Unexpected token '<'` HTML error because backend had no seller API routes
- **Root cause:** Backend was missing `/api/seller/apply`, `/api/seller/status`, `/api/seller/profile`, `/api/admin/sellers`, and `/api/admin/sellers/:id/status` routes. Frontend called these endpoints, received 404 HTML → parse error
- **Fix:**
  - Created `backend/routes/seller.ts` with complete seller workflow endpoints
  - `POST /api/seller/apply` — Creates seller record with status=pending, creates shop record with unique slug
  - `GET /api/seller/status` — Returns current user's seller status with shop info and rejectionReason
  - `GET /api/seller/profile` — Returns full seller profile with shop details
  - `GET /api/admin/sellers` — Lists all sellers with user/shop info (admin only)
  - `PATCH /api/admin/sellers/:id/status` — Approve/reject/suspend seller with optional rejection reason (admin only)
  - Wired seller routes into `backend/server.ts`
- **Security:**
  - All seller endpoints require authentication
  - Admin endpoints verify owner/admin/staff role
  - Self-approval prevention (cannot approve/reject yourself)
  - Backend determines user identity from session, never trusts frontend userId
- **Files changed:** `backend/routes/seller.ts` (new), `backend/server.ts`, `AI_Handoff.md`
- **Result:** All 4 frontend apps + backend pass typecheck. Seller registration workflow complete end-to-end

### 2026-08-25 — Fix Owner Bootstrap Configuration
- **Problem:** VelCenter showed "ยังไม่ได้ตั้งค่ารหัสเปิดใช้งาน" even though `BOOTSTRAP_OWNER_SECRET` was set in Render
- **Root cause:** Backend was missing `/api/admin/bootstrap-status` and `/api/admin/claim-owner` routes. Frontend called these endpoints, received 404 → catch → `configured: false` → warning shown
- **Fix:**
  - Created `backend/routes/admin.ts` with `GET /api/admin/bootstrap-status` (unauthenticated) and `POST /api/admin/claim-owner` (authenticated)
  - Wired admin routes into `backend/server.ts`
  - Fixed `RequireRole.tsx` to use centralized `apiUrl` from sites.ts and correctly extract `s.data` from API response
  - Added `[bootstrap]` startup diagnostic logging (boolean only, never reveals secret)
- **Files changed:** `backend/routes/admin.ts` (new), `backend/server.ts`, `packages/shared/src/components/RequireRole.tsx`
- **Security:** `BOOTSTRAP_OWNER_SECRET` is never exposed to the frontend, never logged, never returned via API
- **Result:** All 4 frontend apps + backend pass typecheck

### 2026-08-25 — Centralized Environment & URL Configuration
- **Problem:** `VITE_API_URL` was duplicated across 4 files; `packages/shared/src/vite-env.d.ts` only declared `VITE_API_URL`; `VITE_VELSHOP_URL`, `VITE_VELSELLER_URL`, etc. missing from shared types
- **Root cause:** URL configuration was partially centralized but incomplete
- **Fix:**
  - Updated `packages/shared/src/vite-env.d.ts` to declare all `VITE_*` environment variables
  - Added `apiUrl` constant to `packages/shared/src/lib/sites.ts` (single source of truth for API base URL)
  - Added `joinUrl(base, path)` helper for safe URL construction without double-slash issues
  - Updated `api-client.ts`, `api-routes.ts`, `track.ts` to import `apiUrl` from sites.ts
  - Updated `Auth.tsx` Google OAuth redirect to use `apiUrl` instead of inline `import.meta.env`
  - Updated documentation: AI_RULES.md, AI_Handoff.md, INSTALLATION.md
- **Files changed:** `packages/shared/src/vite-env.d.ts`, `packages/shared/src/lib/sites.ts`, `packages/shared/src/lib/api-client.ts`, `packages/shared/src/lib/api-routes.ts`, `packages/shared/src/lib/track.ts`, `packages/shared/src/pages/Auth.tsx`, `AI_RULES.md`, `AI_Handoff.md`, `INSTALLATION.md`
- **Result:** All 4 frontend apps pass typecheck. No hardcoded API URLs remain in frontend source code.

### 2026-08-24 — Address Management Fix
- **Problem:** /addresses save failed with generic error
- **Root cause:** Frontend called `/api/customer/addresses` but backend had no routes — only placeholder routes at `/api/addresses`
- **Fix:** Implemented full GET/POST/DELETE routes for `/api/customer/addresses` with field mapping, validation, transaction-safe default address logic, and graceful fallback for missing DB columns

### 2026-08-24 — Profile Image Cache-Busting
- **Problem:** After uploading new avatar/cover, UI showed old image until page refresh
- **Root cause:** Fixed R2 keys meant same URL → browser served cached old image. `optimizedUrl()` stripped existing query params.
- **Fix:** Added `?v={timestamp}` cache-busting to display URLs; fixed `optimizedUrl()` to preserve existing query params; added version state to ShopAccount and ShopProfile

### 2026-08-24 — AI Project Memory
- Created AI_RULES.md (mandatory development rules)
- Created INSTALLATION.md (complete setup guide)
- Created VELNOX_DESIGN_THEME.md (UI/UX design system)
- Updated schema.sql and run-sqleditor.sql to match actual DB

### 2026-08-23 — Profile Image Upload
- Implemented deterministic R2 keys: `profile/avatar/{userId}.webp`, `profile/cover/{userId}.webp`
- Upload flow: upload-intent → presigned URL → WebP conversion → R2 PUT → save → verify → DB update
- Old timestamped objects cleaned up automatically
- Media records upserted with ON CONFLICT

## Known Issues

- Neon cold start causes ~1.5s latency on first query after idle period (mitigated with 30s in-memory cache)
- SSL deprecation warning from pg-connection-string (cosmetic, handled by replacing sslmode=require with sslmode=verify-full)
- Production Neon may have columns (date_of_birth, gender, reserved, etc.) that were added outside of migrations — the schema files now reflect the actual backend usage but production state should be verified

## Next Tasks

- Cart implementation (currently placeholder routes)
- Order implementation (currently placeholder routes)
- Product image management
- Search/filter improvements
- Mobile responsive refinements
- Verify production Neon schema matches the synchronized run-sqleditor.sql
- Run migration 010 (revoked_tokens) on production Neon if not already applied
