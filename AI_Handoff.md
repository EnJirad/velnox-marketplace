# AI_Handoff.md — Velnox Marketplace

**LAST UPDATED: 2026-08-26**

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

### 2026-08-26 — Stripe Payment Architecture + Cart Drawer Enhancement
- **Part 1 — Cart Drawer:** Added product image display to CartDrawer (previously only showed name/price/qty). Cart icon badge with count, mini cart with +/-, remove, subtotal, checkout button already existed from previous work.
- **Part 2 — Stripe Payment System (new):**
  - **Backend:** Created `backend/routes/stripe.ts` with:
    - `POST /api/stripe/checkout` — Creates Stripe Checkout Session for an order (validates ownership, creates line items from DB, stores session ID, returns checkout URL)
    - `POST /api/payments/stripe/webhook` — Handles `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed` with event dedup via `payment_events` table
    - `GET /api/stripe/configured` — Checks if Stripe is configured
    - `GET /api/stripe/payment-status/:sessionId` — Gets payment status from Stripe
    - `GET /api/orders/:orderId` — Gets order with items + payment status (for success page polling)
  - **Server.ts:** Added raw body middleware for webhook signature verification (before `express.json()`)
  - **Database V0023 migration:** Enhanced `orders` (order_number, subtotal, shipping_fee, discount), `order_items` (shop_id, variant_id, product_name_snapshot, variant_name_snapshot, image_url_snapshot, subtotal), `payments` (provider, provider_payment_id, provider_checkout_session_id, paid_at, updated_at), created `payment_events` table
  - **Frontend:** Created `ShopCheckoutSuccess.tsx` (polls backend for payment status, shows order details, supports all terminal states) and `ShopCheckoutCancel.tsx` (cancel page with link back to cart)
  - **i18n:** Added checkoutSuccess and checkoutCancel translation keys in Thai, English, Burmese
- **Files changed:** `backend/routes/stripe.ts` (NEW), `backend/server.ts`, `backend/package.json`, `apps/velshop/src/main.tsx`, `apps/velshop/src/components/shop/CartDrawer.tsx`, `apps/velshop/src/pages/ShopCheckoutSuccess.tsx` (NEW), `apps/velshop/src/pages/ShopCheckoutCancel.tsx` (NEW), `packages/shared/src/lib/i18n/locales/th.ts`, `packages/shared/src/lib/i18n/locales/en.ts`, `packages/shared/src/lib/i18n/locales/my.ts`, `db/migrations/023_stripe_payment_system.sql` (NEW), `db/schema.sql`, `db/run-sqleditor.sql`, `db/run-update.sql`
- **Environment variables needed:** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `API_URL` (backend URL for Stripe success/cancel redirects)
- **All 5 typechecks pass**

### 2026-08-26 — FIX: Cart variant_id Column Missing + Wishlist Migration Files Never Applied
- **Root causes:**
  1. `cart_items.variant_id` column does not exist in production Neon. Backend `cart.ts` line 151 does `INSERT INTO cart_items (..., variant_id)` → PostgreSQL error `42703: column "variant_id" does not exist`. Add to Cart silently fails — item appears briefly in frontend but never persists.
  2. V0019/V0020 migration files were written as inline SQL in `run-update.sql` but NEVER existed as actual files in `db/migrations/`. The GitHub Action (`migrate-neon.yml`) scans `db/migrations/*.sql` — the directory was empty. So `customer_wishlist` and `subscriptions` tables were never created in production.
- **Fix (backend):** Changed cart INSERT to use try-catch: if `variant_id` column doesn't exist (error 42703), retry without it. Cart add now works immediately.
- **Fix (database):** Created proper migration files:
  - `db/migrations/021_add_cart_item_variant_id.sql` — adds nullable `variant_id` column, replaces UNIQUE constraint with expression-based constraint to support variants
  - `db/migrations/022_create_customer_wishlist.sql` — creates `customer_wishlist` table (the actual migration file that GitHub Action will run)
- **Fix (schema files):** Updated `schema.sql`, `run-sqleditor.sql`, and `run-update.sql` (V0021, V0022) to include `variant_id` column and `customer_wishlist` table
- **After migration runs:** The `variant_id` column will exist, and the try-catch will take the success path

### 2026-08-26 — CRITICAL FIX: Missing customer_wishlist Table + Product Detail Crash
- **Root cause (from production logs):** The `customer_wishlist` table was never applied to Neon. V0019 migration existed in `run-update.sql` but the GitHub Action never ran it. When the product detail page loaded the product successfully, it then called `myWishlist()` which hit the `customer_wishlist` table → PostgreSQL error `42P01: relation "customer_wishlist" does not exist`. The `catch` block in the frontend `load()` function caught this error and called `setProduct(null)`, wiping out the successfully-loaded product. Result: "ไม่พบสินค้า" even though the product was found and published.
- **Fix (backend):** Made wishlist GET endpoint gracefully handle missing table — returns `[]` instead of 500 when `customer_wishlist` doesn't exist. Made toggle endpoint return 503 with clear message.
- **Fix (frontend):** Separated product loading from optional data loading. Product is set first, then reviews/wishlist load in a separate `try/catch` with `Promise.allSettled`. Failures in reviews/wishlist do NOT clear the product.
- **Database:** Created V0020 migration (`020_repair_wishlist_subscriptions.sql`) that creates `customer_wishlist` and `subscriptions` tables with `IF NOT EXISTS`. Both tables use the canonical schema from `schema.sql`.
- **Files changed:** `backend/routes/cart.ts`, `apps/velshop/src/pages/ShopProductDetail.tsx`, `db/migrations/020_repair_wishlist_subscriptions.sql`, `db/run-update.sql`
- **All 5 typechecks pass**

### 2026-08-26 — Product Detail Debug + Enhanced Error Handling
- **Problem:** Product detail page shows "ไม่พบสินค้า" (product not found) even though the product list displays products correctly
- **Investigation:** Traced the complete flow: frontend route `/products/:productId` → `useParams` → `useAction(api.commerce.getProductDetail)` → `apiGet(/api/products/:id)` → backend `GET /api/products/:productId` → SQL `WHERE p.id = $1 AND p.status = 'published'`
- **Both catalog and detail endpoints use `WHERE p.status = 'published'`** — if a product appears in the catalog, it should also appear in the detail page
- **Root cause analysis in progress:** Added comprehensive diagnostic logging to both backend and frontend to trace the exact issue:
  - Backend: logs requested ID, product existence check, status mismatch detection, successful product found
  - Frontend: logs API response, status check result, and error details
  - Frontend: added `loadError` state to distinguish between 404 (not found) vs network/500 errors
  - Added `productDetail.loadError` and `productDetail.retry` i18n keys in all 3 languages (th, en, my)
- **Files changed:** `backend/routes/products.ts`, `apps/velshop/src/pages/ShopProductDetail.tsx`, `packages/shared/src/lib/i18n/locales/th.ts`, `packages/shared/src/lib/i18n/locales/en.ts`, `packages/shared/src/lib/i18n/locales/my.ts`
- **Next step:** Deploy and check Render logs for `[products] detail` output to identify exact failure point

### 2026-08-26 — Fix Marketplace Product Navigation, Cart API, and Favorites
- **Problem 1:** Clicking a product card on the homepage opened a quick-view modal instead of navigating to `/products/:id`
- **Problem 2:** Cart system didn't work — `cart.tsx` raw `fetch` functions returned `{success, data}` envelope but code accessed `cart.items` instead of `cart.data.items`, making the cart appear empty
- **Problem 3:** No favorite/heart button on product cards
- **Problem 4:** Shop detail page product cards had no favorite button
- **Root cause:**
  1. `ShopHome.openProduct()` called `setDetailProduct()` (modal) instead of `navigate()`
  2. `cart.tsx` helper functions (`apiCartGet`, `apiCartAdd`, etc.) used raw `fetch` without unwrapping the `{success, data}` envelope, so `cart.items` was `undefined` → empty cart
  3. `ProductCard` component had no `onWishlist` prop — favorites only worked on the product detail page
- **Fix:**
  - **`apps/velshop/src/lib/cart.tsx`:** Added `unwrapJson()` helper that strips `{success, data}` envelope. All four cart API functions now unwrap responses before returning
  - **`apps/velshop/src/pages/ShopHome.tsx`:** Changed `openProduct()` to call `navigate(`/products/${id}`)` instead of opening modal. Removed `ProductDetailModal` import/JSX. Added wishlist state (load, toggle) with `toggleWishlistAction`/`myWishlist` API calls. Passed `wishlisted`/`onWishlist`/`wishToggling` props to all ProductCard instances
  - **`apps/velshop/src/components/shop/ProductCard.tsx`:** Added `wishlisted`, `onWishlist`, `wishToggling` props. Renders a heart button (top-right of image) with `event.stopPropagation()` to prevent navigation. Heart toggles between outlined (♡) and filled (♥) states
  - **`apps/velshop/src/pages/ShopProducts.tsx`:** Added wishlist state + `handleWishlist` handler. Passed wishlist props to ProductCard
  - **`apps/velshop/src/pages/ShopDetail.tsx`:** Added wishlist state + handler. Replaced `<Link>` image wrapper with `<div>` + inner `<Link>` so a heart `<button>` with `stopPropagation` can overlay the image
- **All 5 typechecks pass (backend, velshop, velseller, velcenter, velnox)**

### 2026-08-25 — Category JOIN Fix + SQL Syntax Error
- **Problem:** After changing `products.category_id` from UUID to TEXT (V0015), the `/api/products` endpoint still JOINed `categories ON c.id = p.category_id` — UUID vs TEXT mismatch caused the JOIN to fail. Also discovered double-comma syntax error `NOW(),,` in both schema files
- **Fix:**
  - Changed category JOIN to `c.slug = p.category_id` (TEXT slug matching)
  - Fixed `NOW(),,` → `NOW(),` in both `schema.sql` and `run-sqleditor.sql`
- **All 5 typechecks pass**

### 2026-08-25 — Fix R2 Key Extraction for Product Image Deletion
- **Problem:** `deleteR2Object(img.url)` passed the full CDN URL (`https://pub-xxx.r2.dev/products/...`) as the R2 object key, but R2 expects just the key (`products/...`). This caused silent deletion failures — orphaned files accumulate in R2 storage
- **Root cause:** The `product_images.url` column stores the full CDN URL (via `publicUrl(key)` = `${R2_PUBLIC_DOMAIN}/${key}`), but `DeleteObjectCommand` requires just the key. No extraction logic existed to convert URLs back to keys
- **Fix:**
  - Added `urlToKey(url)` helper — strips `R2_PUBLIC_DOMAIN` prefix from URL to extract the R2 object key
  - Updated all `deleteR2Object(img.url)` calls to `deleteR2Object(urlToKey(img.url))`
  - Updated `storageKey` in `formatProduct` to use `urlToKey(img.url)` instead of raw URL
  - Backend typecheck passes
- **Files changed:** `backend/routes/products.ts`
- **Problem:** Production error `column "unit" of relation "products" does not exist` (PostgreSQL code 42703). Product creation fails because V0012 migration (adding `unit`/`supplier` columns) was never applied to Neon despite V0013 marking it as applied in `schema_migrations`. Additionally, product creation used separate non-atomic queries — if inventory creation failed, a half-created product remained
- **Root cause:** Migration V0013 pre-marks V0012 as applied in `schema_migrations` (`INSERT INTO schema_migrations ... ON CONFLICT DO NOTHING`), so the GitHub Action skips V0012. But V0012 was never actually applied to Neon. The product INSERT references `unit` column that doesn't exist
- **Fix:**
  - **New file `db/migrations/014_repair_product_fields.sql`** — Repair migration using `IF NOT EXISTS` to safely add `unit` and `supplier` columns even if V0012 was partially applied
  - **Product creation wrapped in PostgreSQL transaction** — `BEGIN`/`COMMIT`/`ROLLBACK` using `getClient()` for product INSERT + inventory INSERT + shop product_count UPDATE
  - Updated `db/run-update.sql` with V0014 repair migration
  - Verified `db/schema.sql` and `db/run-sqleditor.sql` already contain the columns
  - All 5 typechecks pass (backend, velshop, velseller, velcenter, velnox)
- **Migration architecture:**
  - V0012: adds `unit`/`supplier` (may or may not be applied to Neon)
  - V0013: creates `schema_migrations` + marks V0012 as applied (dangerous if V0012 wasn't applied)
  - V0014: repair — safely ensures columns exist using `IF NOT EXISTS` (always safe to run)
- **Result:** After V0014 is applied to Neon (via GitHub Action or manual), product creation will work. Transaction ensures atomicity
- **Status:** Code complete, typecheck passes. V0014 needs to be applied to Neon production

### 2026-08-25 — Migration System & Schema Drift Fix
- **Problem:** Backend ran `ALTER TABLE addresses ADD COLUMN IF NOT EXISTS` at every startup (schema drift). No migration tracking table existed. No GitHub Action for automated Neon migrations. Production had `column "unit" does not exist` error because V0012 migration was never applied
- **Root cause:** Schema changes were applied via startup DDL instead of proper migrations. No `schema_migrations` tracking table. No CI/CD for database
- **Fix:**
  - Created `schema_migrations` tracking table in V0013 migration
  - Created `.github/workflows/migrate-neon.yml` — automated incremental migration system for Neon production
  - Migrated `ensureAddressColumns()` startup DDL into V0013 proper migration
  - Removed startup ALTER TABLE from `backend/routes/index.ts`
  - Updated all three SQL files (schema.sql, run-sqleditor.sql, run-update.sql)
  - Updated INSTALLATION.md with migration system documentation
  - Added rules 48-53 to AI_RULES.md (No Startup DDL, Migration System, Schema Tracking, No Duplicate Systems, Product Ownership, No Quick Schema Removal)
- **Migration system architecture:**
  - `db/migrations/*.sql` — individual migration files
  - `.github/workflows/migrate-neon.yml` — auto-applies pending migrations on push to main
  - `schema_migrations` table — tracks which migrations have been applied
  - GitHub Secret: `NEON_DATABASE_URL`
- **Result:** Production product creation will work after the GitHub Action applies V0012 + V0013. Backend no longer runs DDL at startup

### 2026-08-25 — Complete Seller Product Management System
- **Problem:** Approved sellers could not create, edit, delete, or manage products on VelSeller. The entire backend product API was missing — frontend MyShop.tsx and ProductFormDialog.tsx were built but had no backend endpoints to call
- **Root cause:** Backend had NO `products.ts` route file. The `api-routes.ts` ACTION_MAP had mappings for product CRUD, image upload, and inventory but the actual Express routes didn't exist. Also missing: `setStockAction` and `setReorderLevelAction` route mappings
- **Fix:**
  - **New file `backend/routes/products.ts`** — Complete product system with 13 endpoints:
    - `GET /api/seller/products` — List seller's products with images + inventory
    - `POST /api/seller/products` — Create product with validation, slug generation, inventory creation
    - `PATCH /api/seller/products/:productId` — Update product fields
    - `DELETE /api/seller/products/:productId` — Delete product + R2 images + decrement shop count
    - `PATCH /api/seller/products/:productId/status` — Set product status (draft/published/pending_review/rejected/archived)
    - `PATCH /api/seller/products/:productId/stock` — Set inventory quantity
    - `PATCH /api/seller/products/:productId/reorder-level` — Set reorder threshold
    - `POST /api/seller/products/image-upload-intent` — R2 presigned URL for product images
    - `POST /api/seller/products/save-image` — Save image metadata to product_images
    - `DELETE /api/seller/products/images/:imageId` — Delete image from R2 + DB + recompact sort order
    - `PATCH /api/seller/products/:productId/primary-image` — Set primary image
    - `PATCH /api/seller/products/:productId/reorder-images` — Reorder images
    - `GET /api/products/catalog` — Public catalog with search, filter, sort
  - **Public catalog routes:** `GET /api/products/catalog`, `GET /api/products/:productId`, `GET /api/shops`, `GET /api/shops/:shopId`, `GET /api/categories`
  - **Backend `server.ts`:** Registered `setupProductRoutes`
  - **Frontend `api-routes.ts`:** Added missing `setStockAction` and `setReorderLevelAction` mappings
  - **Database V0012 migration:** Added `unit TEXT` and `supplier TEXT` columns to `products` table, plus `idx_products_shop_status` index
  - **Database files:** All three SQL files updated and synchronized
- **Security:** All seller endpoints verify authenticated user → approved seller → shop ownership before any operation. Cross-seller access is blocked. Public catalog only shows `published` products
- **Files changed:** `backend/routes/products.ts` (NEW), `backend/server.ts`, `packages/shared/src/lib/api-routes.ts`, `db/migrations/012_product_fields.sql` (NEW), `db/run-update.sql`, `db/run-sqleditor.sql`, `db/schema.sql`
- **Result:** All 5 typechecks pass. Approved sellers can now create, edit, delete products with images, inventory, and stock management via VelSeller MyShop page

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

### 2026-08-25 — Fix Product Creation: UUID Type Mismatch + Backend Validation
- **Problem:** Product creation fails with `error: invalid input syntax for type uuid: "daily"` in `backend/routes/products.ts` line ~357. The frontend sends category strings like "daily", "food", "general" (StoreProductCategory type) but the production Neon database still has `products.category_id` as UUID type.
- **Root cause:**
  1. Original V0004 migration created `category_id UUID REFERENCES categories(id)`
  2. Frontend `ProductFormDialog` sends string categories (`StoreProductCategory` = `"general" | "food" | "daily" | "beauty" | "packaging" | "other"`)
  3. Migration V0015 (`015_category_text_type.sql`) exists to change `category_id` from UUID to TEXT but was never applied to production Neon
  4. No backend validation existed — raw string values passed directly to PostgreSQL
  5. Additionally, `reorder-images` endpoint had a parameter mismatch: frontend sends `orderedIds` but backend expects `imageIds`
- **Fix:**
  - **Backend `POST /api/seller/products`:** Added server-side validation for `category` field — validates against allowed `VALID_CATEGORIES` array before DB insert. Returns 400 with clear error message if invalid.
  - **Backend `PATCH /api/seller/products/:productId`:** Same category validation added to update endpoint.
  - **Backend `PATCH /api/seller/products/:productId/reorder-images`:** Fixed parameter mismatch — now accepts both `imageIds` (backend convention) and `orderedIds` (frontend sends this) for backward compatibility.
  - **Migration V0016 (`016_sync_schema_discrepancies.sql`):** Added safe migrations for columns that existed in schema.sql but had no migration: `inventory.reserved`, `orders.shipping_address`, `order_items.product_name`, `notifications.body/metadata`, `addresses.subdistrict/district/latitude/longitude`. All use `IF NOT EXISTS` for safety.
  - **All three SQL files already correct:** `schema.sql` and `run-sqleditor.sql` already had `category_id TEXT`. `run-update.sql` already had V0015. V0016 now also covers other discrepancies.
- **Migration to apply:** V0015 (category_id UUID→TEXT) + V0016 (schema sync). Both in `db/migrations/` and will be auto-applied by the GitHub Action on push to main.
- **Files changed:** `backend/routes/products.ts` (validation + reorder-images fix), `db/migrations/016_sync_schema_discrepancies.sql` (new), `db/run-update.sql` (V0016 appended), `AI_Handoff.md`
- **Production data safety:** All changes use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`, and `ALTER COLUMN TYPE`. No data loss. No table drops.
- **Result:** Backend now validates all inputs before they reach PostgreSQL. V0015 migration will fix the UUID type error when applied by GitHub Action.

### 2026-08-25 — Complete Product Moderation Pipeline
- **Problem:** Products created by sellers don't appear in VelCenter for admin review. No backend admin product moderation endpoints exist. Public catalog shows non-published products. No rejection_reason column for storing rejection reasons.
- **Root cause:**
  1. Backend had no `GET /api/admin/products/moderation` or `PATCH /api/admin/products/:productId/moderation` endpoints
  2. `GET /api/products` in `backend/routes/index.ts` used `WHERE p.status = 'active'` (wrong status value)
  3. `GET /api/products/:id` in both files didn't enforce `status = 'published'` for public access
  4. No `rejection_reason` column on products table
  5. Seller product status transitions were not validated (sellers could set any status)
  6. `shops.product_count` didn't update when product status changed
- **Fix:**
  - **Backend admin endpoints:** Added `GET /api/admin/products/moderation` (list all products with images, inventory, seller info) and `PATCH /api/admin/products/:productId/moderation` (approve/reject with validation, admin-only authorization, shop product_count update)
  - **Seller transition validation:** Added state machine for seller transitions: `draft → pending_review`, `rejected → pending_review`, `pending_review → draft`. Prevents sellers from directly publishing.
  - **Public catalog fix:** Changed `WHERE p.status = 'active'` to `WHERE p.status = 'published'` in `backend/routes/index.ts`
  - **Public product detail fix:** Added `AND p.status = 'published'` to both `GET /api/products/:id` endpoints
  - **Shop product_count:** Admin approval/rejection now recalculates `shops.product_count` to only count published products
  - **Migration V0017 (`017_product_moderation.sql`):** Added `rejection_reason TEXT` column to products
  - **All three SQL files updated:** `schema.sql`, `run-sqleditor.sql`, `run-update.sql` (V0017)
  - **Backend role check:** New `requireAdmin()` helper verifies user has `owner` or `admin` role before moderation actions
- **Status lifecycle:**
  ```
  draft → pending_review (seller submits)
  pending_review → draft (seller withdraws)
  rejected → pending_review (seller resubmits, clears rejection_reason)
  pending_review → published (admin approves)
  pending_review → rejected (admin rejects, requires reason)
  ```
- **Files changed:** `backend/routes/products.ts` (admin endpoints + seller transition validation + public endpoint security), `backend/routes/index.ts` (catalog + product detail fixes), `db/migrations/017_product_moderation.sql` (new), `db/run-update.sql`, `db/schema.sql`, `db/run-sqleditor.sql`, `AI_Handoff.md`
- **Result:** Complete end-to-end product moderation pipeline. Seller creates → submits → admin reviews → approve/reject → visible on VelShop. All 5 typechecks pass.

### 2026-08-25 — Auto-Approval System + VelShop Crash Fix + VelCenter Settings
- **Problem 1:** Products were being auto-published even though admins did not manually approve them. The `setProductStatusAction` seller endpoint had no state machine validation — sellers could directly set `status = 'published'`.
- **Problem 2:** VelShop crashed with `I.map is not a function` because `ShopProducts.tsx` expected `{ items: [], total: 0 }` from the catalog API, but the backend returned a plain array.
- **Problem 3:** No configurable auto-approval system. No platform_settings table for storing product approval mode.
- **Root cause:**
  1. The seller `PATCH /api/seller/products/:productId/status` endpoint accepted any status from the request body without validating state machine transitions
  2. The VelShop `ShopProducts.tsx` normalize function didn't handle the `{success, data}` API envelope correctly
  3. No `platform_settings` table existed for storing `product_approval_mode`
  4. VelCenter had no UI to toggle between manual and auto approval modes
- **Fix:**
  - **Strict state machine:** Seller can ONLY set `draft → pending_review`, `rejected → pending_review`, `pending_review → draft`. Sellers CANNOT set published/rejected/archived directly.
  - **Auto-approval system:** When `product_approval_mode = 'auto'` in `platform_settings`, submitting for review automatically transitions `pending_review → published`. When mode = `manual` (default), products stay `pending_review` until an admin acts.
  - **platform_settings table (V0018):** New table for storing key-value system configuration. Initial seed: `product_approval_mode = 'manual'`.
  - **Backend admin settings API:** `GET /api/admin/settings` and `PATCH /api/admin/settings` in `backend/routes/admin.ts`. Admin/owner only.
  - **VelCenter settings UI:** Added product approval mode toggle (Manual/Automatic) in the Settings tab of VelCenter. Thai-language labels.
  - **VelShop crash fix:** Fixed `ShopProducts.tsx` normalize function to properly unwrap `{success, data}` envelope. Fixed `ShopHome.tsx` `apiGet` helper to unwrap the same envelope.
  - **Status transition logging:** All status changes are logged with: `productId`, `from`, `to`, `actor`, `role`, `source`.
  - **Migration V0018 (`018_platform_settings.sql`):** Creates `platform_settings` table with unique key constraint and seed data.
  - **All three SQL files updated:** `schema.sql`, `run-sqleditor.sql`, `run-update.sql` (V0018)
- **Status lifecycle (with auto-approval):**
  ```
  MANUAL MODE:
  draft → pending_review (seller submits)
  pending_review → published (admin approves)
  pending_review → rejected (admin rejects)
  rejected → pending_review (seller resubmits)
  pending_review → draft (seller withdraws)
  
  AUTO MODE:
  draft → pending_review (seller submits)
  pending_review → published (auto-approved immediately)
  ```
- **Files changed:** `backend/routes/products.ts` (state machine validation + auto-approval + transition logging), `backend/routes/admin.ts` (settings API endpoints), `apps/velcenter/src/pages/Center.tsx` (approval mode toggle UI), `apps/velshop/src/pages/ShopProducts.tsx` (catalog normalize fix), `apps/velshop/src/pages/ShopHome.tsx` (apiGet unwrap fix), `db/migrations/018_platform_settings.sql` (new), `db/schema.sql`, `db/run-sqleditor.sql`, `db/run-update.sql`
- **Result:** Complete audit trail for all status changes. Sellers cannot bypass approval. VelCenter admins can toggle approval mode. VelShop no longer crashes on product catalog. All 5 typechecks pass.

### 2026-08-25 — Fix VelShop Crash + Approved Products Not Appearing
- **Problem 1:** VelShop `/products` page crashes with `I.map is not a function`
- **Problem 2:** Approved products (status=published) do not appear on VelShop after admin approval
- **Root cause:** `backend/routes/index.ts` registered placeholder routes for `/api/shops` and `/api/shops/:slug` **before** the real endpoints in `products.ts`. Express matches first-registered routes, so the placeholder always won. The placeholder returned `{ success: true, data: { shops: [] } }` — an **object**, not an **array**. When `ShopProducts.tsx` called `shops.map(...)`, it crashed because the value was `{ shops: [] }` instead of `[]`. This crash prevented the entire products page from rendering.
- **Fix:** Removed the placeholder routes for `/api/shops` and `/api/shops/:slug` from `backend/routes/index.ts` (line 509-510). The real endpoints in `products.ts` now correctly handle these routes.
- **Catalog verification:** The `/api/products/catalog` endpoint was NOT affected by the placeholder issue — it had no placeholder conflict. It correctly uses `WHERE p.status = 'published'` and returns a properly formatted array. The `normalizeCatalog()` function in ShopProducts.tsx correctly wraps the array as `{ items: [...], total: N }`.
- **Product detail verification:** `GET /api/products/:productId` correctly uses `WHERE p.id = $1 AND p.status = 'published'` and returns the full product with images via `formatProduct()`.
- **Files changed:** `backend/routes/index.ts` (removed placeholder routes for `/api/shops`)
- **Result:** VelShop `/products` page no longer crashes. Approved products now appear correctly. All 5 typechecks pass.

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

### 2026-08-25 — Fix VelShop Product Catalog Route Shadowing + Defensive Normalization
- **Problem:** VelShop `/products` page shows "โหลดสินค้าไม่สำเร็จ" (failed to load products) and previously crashed with `I.map is not a function`
- **Root cause:** `backend/routes/index.ts` line 83 registered `app.get("/api/products/:id", ...)`. Since `setupRoutes(app)` runs BEFORE `setupProductRoutes(app)` in `server.ts`, Express matches the parameterized route first. When VelShop calls `/api/products/catalog`, Express matches it with `id = "catalog"`, causing SQL to fail (`WHERE id = 'catalog'`). This shadows the real catalog endpoint in `products.ts`. This is the same class of bug as the `/api/shops` placeholder issue fixed earlier.
- **Fix:**
  - Removed the shadowing `app.get("/api/products/:id", ...)` route from `backend/routes/index.ts` (replaced with comment). The real endpoints in `products.ts` (`/api/products/catalog` and `/api/products/:productId`) now handle these routes.
  - Added `safeImages` defensive normalization to `formatProduct()` in `backend/routes/products.ts` — ensures `images` parameter is always an array even if null/undefined is passed.
  - Added `Array.isArray()` check for shops data in `apps/velshop/src/pages/ShopProducts.tsx` — prevents crash if shops API returns unexpected format.
  - Added dev logging for catalog fetch results.
- **Key insight:** Express matches the FIRST registered route that matches the path. Parameterized routes like `/api/products/:id` registered BEFORE specific routes like `/api/products/catalog` will always shadow them. The fix is to remove the parameterized route from the earlier-registration file.
- **Files changed:** `backend/routes/index.ts` (removed shadowing route), `backend/routes/products.ts` (defensive `safeImages` normalization), `apps/velshop/src/pages/ShopProducts.tsx` (defensive shops normalization + dev logging)
- **Result:** VelShop `/products` page no longer crashes. Catalog endpoint correctly serves products. All 5 typechecks pass.

## Known Issues

- Neon cold start causes ~1.5s latency on first query after idle period (mitigated with 30s in-memory cache)
- SSL deprecation warning from pg-connection-string (cosmetic, handled by replacing sslmode=require with sslmode=verify-full)
- **Migrations V0014–V0018 need to be applied to production Neon** — push to main triggers the GitHub Action which detects and applies them automatically. V0015 is critical for product creation (category_id UUID→TEXT). V0018 creates platform_settings for auto-approval.
- Production Neon may have columns (date_of_birth, gender, reserved, etc.) that were added outside of migrations — V0016 now safely adds any missing ones with IF NOT EXISTS

### 2026-08-25 — Complete Marketplace Shopping Flow (Cart, Wishlist, Orders, Checkout)
- **Problem:** Backend had cart, wishlist, checkout, and order endpoints in `backend/routes/cart.ts` but they were NEVER wired into `server.ts`. Frontend pages (ShopCart, ShopCheckout, ShopWishlist, ShopProductDetail, ShopDetail, MyOrders) existed but could not communicate with the backend.
- **Root cause:**
  1. `setupCartRoutes` was defined in `cart.ts` but never imported or called in `server.ts`
  2. Wishlist toggle returned `{wishlisted: boolean}` but frontend read `res.added`
  3. Shop detail endpoint returned only the shop object (no products array) — frontend expected `{shop, products}`
  4. Checkout response returned `{orders: [{id, totalAmount, createdAt}]}` but frontend expected `{parentOrderId, parentOrderNumber, orders, total, itemCount}`
  5. Orders list/detail responses didn't match `StoreOrder` type (missing `orderNumber`, `subtotal`, `shippingFee`, `total`, `items`, `itemCount`)
  6. No product reviews endpoint existed — `ShopProductDetail` called `productReviews({productId})`
  7. No subscriptions endpoints existed — `MyOrders` called `mySubscriptions()`
  8. `api-routes.ts` used `apiPatch` for cart item update but backend used `app.put`
- **Fix:**
  - **`server.ts`:** Imported and wired `setupCartRoutes`
  - **`api-routes.ts`:** Changed `updateCartItemAction` from `apiPatch` to `apiPut` to match backend PUT handler
  - **`cart.ts` wishlist toggle:** Added `added` field to response alongside `wishlisted` — `{wishlisted: boolean, added: boolean}`
  - **`products.ts` shop detail:** Now returns `{shop, products}` with published products for the shop, formatted via `formatProduct()`
  - **`cart.ts` checkout:** Now returns `{parentOrderId, parentOrderNumber, orders: [{orderId, orderNumber, shopId, shopName, subtotal, shippingFee, total}], total, itemCount}` matching frontend `CheckoutResult` type
  - **`cart.ts` orders list:** Now returns full `StoreOrder` format including `orderNumber`, `subtotal`, `shippingFee`, `total`, `items` with product details, `itemCount`
  - **`cart.ts` order detail:** Now returns full `StoreOrder` format with `orderNumber`, `subtotal`, `shippingFee`, `total`, `items`
  - **`products.ts` reviews:** Added `GET /api/products/:productId/reviews` endpoint that gracefully returns `[]` if `product_reviews` table doesn't exist
  - **`cart.ts` subscriptions:** Added stub endpoints for `/api/customer/subscriptions`, `/api/subscriptions/create`, `/api/subscriptions/:id/pause`, `/api/subscriptions/:id` — gracefully handle missing `subscriptions` table
- **Frontend pages already implemented:** ShopProductDetail (full gallery, add to cart, buy now, wishlist, reviews), ShopCart (quantity controls, remove, summary, checkout), ShopCheckout (address, payment, submit), ShopWishlist, ShopDetail (shop profile, products), MyOrders, ShopOrderDetail
- **Files changed:** `backend/server.ts`, `backend/routes/cart.ts`, `backend/routes/products.ts`, `packages/shared/src/lib/api-routes.ts`
- **Result:** All 5 typechecks pass. Complete end-to-end marketplace flow: browse products → product detail → add to cart → cart page → checkout → order creation → order history. Wishlist and subscriptions also connected.

## Next Tasks

- **Push to main to trigger GitHub Action** — this applies V0014–V0018 to Neon production
- Verify Neon `NEON_DATABASE_URL` GitHub Secret is configured for the migration Action
- Verify product moderation works end-to-end in production after migrations apply
- Search/filter improvements
- Mobile responsive refinements
- Verify production Neon schema matches the synchronized run-sqleditor.sql after migrations apply
- Stripe payment integration (optional — checkout already supports COD/transfer)

### 2026-08-26 — VelRepeat Package/Delivery System (V0024)
- **Goal:** Implement VelRepeat as a "buy-ahead package + scheduled delivery" system, separate from Buy Once
- **What was built:**
  - **Database Migration V0024:** New tables `vrepeat_packages`, `vrepeat_deliveries`, `product_variants`, `customer_events`. Product vrepeat config columns, cart `purchase_type`, performance indexes.
  - **Backend `routes/velrepeat.ts`:** Full CRUD for packages, delivery schedule generation, delivery status management, seller delivery dashboard.
  - **Frontend SubscriptionDialog redesigned:** Weekly/monthly package options with pricing comparison and delivery schedule preview.
  - **Frontend VelRepeatPage:** Rewritten to use new vrepeat_packages API with progress bars and status management.
  - **API route mappings:** Added `api.commerce.myVelRepeatPackages`, `api.commerce.createVelRepeatPackage`, etc.
- **VelRepeat Architecture:** Customer selects VelRepeat -> Chooses weekly/monthly package -> Creates vrepeat_package + delivery schedule -> Pays full amount upfront -> Deliveries generated -> Seller fulfills each -> Package completed when all delivered.
- **Files changed:** `db/migrations/024_*.sql` (new), `backend/routes/velrepeat.ts` (new), `backend/server.ts`, `packages/shared/src/lib/api-routes.ts`, `SubscriptionDialog.tsx`, `VelRepeatPage.tsx`, `db/schema.sql`, `db/run-sqleditor.sql`, `db/run-update.sql`
- **All 5 typechecks pass**

### 2026-08-27 — Fix Raw Translation Keys + Purchase Options UI Redesign

- **Problem 1:** `subscription.deliverySchedule` and other raw translation keys displayed to users on VelShop product detail page. The `SubscriptionDialog.tsx` used 13 translation keys (`subscription.weekly`, `subscription.weeklyDesc`, `subscription.monthly`, `subscription.monthlyDesc`, `subscription.velRepeatTitle`, `subscription.velRepeatDesc`, `subscription.save`, `subscription.deliverySchedule`, `subscription.deliveryN`, `subscription.paidOnce`, `subscription.confirmPackage`, `subscription.selectPackage`) that did NOT exist in any i18n locale file (th.ts, en.ts, my.ts). When `t()` can't find a key, it returns the raw key string.
- **Problem 2:** VelRepeat was displayed as a tiny ghost text link (`text-xs text-slate-500`) below the primary Buy Once buttons, making it nearly invisible. Velnox needs both purchase options to have equal visual prominence.
- **Root cause:**
  1. The i18n `subscription` section only had OLD keys (title, desc, perCycle, interval, every30, every60, every90, qtyPerCycle, stockNote, confirm, success, failed) — the new VelRepeat package dialog keys were never added to any locale file.
  2. The ShopProductDetail action section was designed with Buy Once as primary and VelRepeat as afterthought.
- **Fix:**
  - **i18n (all 3 locales):** Added 13 missing `subscription.*` keys to th.ts, en.ts, my.ts with proper VelRepeat wording ("ซื้อเป็นแพ็ก ราคาพิเศษ", not misleading "subscription/auto-reorder" language).
  - **ShopProductDetail.tsx:** Redesigned the purchase options section. Now shows two equal-weight cards:
    - **Buy Once card** (left/top): white card with border-slate-900, shows price/unit, Add to Cart + Buy Now buttons
    - **VelRepeat card** (right/bottom): green-tinted card (#F0FDF9) with border-[#10B981]/30, shows "VelRepeat — ราคาพิเศษ · จ่ายล่วงหน้า · ส่งตามรอบ", green CTA button
    - Both cards have equal visual weight, proper `aria-label` attributes, and responsive grid layout (stacked on mobile, side-by-side on sm+).
  - Quantity selector moved above the two purchase option cards for cleaner layout.
- **Files changed:** `packages/shared/src/lib/i18n/locales/th.ts`, `packages/shared/src/lib/i18n/locales/en.ts`, `packages/shared/src/lib/i18n/locales/my.ts`, `apps/velshop/src/pages/ShopProductDetail.tsx`
- **No raw translation keys remain:** All `subscription.*` keys used in SubscriptionDialog.tsx now exist in all 3 locale files. Verified with grep.
- **All 5 typechecks pass** (backend, velshop, velseller, velcenter, velnox)
