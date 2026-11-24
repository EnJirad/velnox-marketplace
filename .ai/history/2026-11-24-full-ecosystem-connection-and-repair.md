# Full Ecosystem Audit, Connection & Repair Across All 4 Velnox Apps & Cloudflare Workers

**Date:** 2026-11-24
**Scope:** Complete cross-application audit and connection across:
- `apps/velshop` (Customer Storefront)
- `apps/velseller` (Seller Center)
- `apps/velcenter` (Operations & Admin Center)
- `apps/velnox` (Landing & Company Portal)
- `workers/api` (Cloudflare Workers API · api.velnox.live)
- Neon PostgreSQL, Cloudflare R2, Durable Objects WebSocket Hub

---

## 1. Problem Statement & User Directive
The user requested a complete ecosystem audit and repair across ALL 4 websites/frontends and the backend:
`"ไม่ใช่แค่ 2 ปัญหานี้แต่ทั้งหมดเลยช่วยตรวจสอบและเชื่อมต่อให้มันถูกต้องทั้งหมดช่วยไล่เช็คทั้งหมดแล้วปรับปรุงให้ด้วยไม่ใช่แค่ปรับปรุงแค่เว็บนี้แต่ปรับปรุงทุกเว็บให้มันถูกต้องทั้งหมด OK ทำให้ฉันหน่อยวางแผนแล้วก็ปรับลงมา"`

## 2. Issues Discovered During Cross-App Audit
1. **Missing Customer & Storefront Endpoints (`/api/customer/*`):**
   - Frontends (`velshop`) called `/api/customer/profile`, `/api/customer/account-summary`, `/api/customer/profile-image/*`, `/api/customer/addresses`, `/api/customer/cart`, `/api/customer/checkout`, `/api/customer/wishlist`.
   - `workers/api` lacked these customer endpoints entirely, resulting in 404 errors during checkout, cart addition, profile updates, and address management.
2. **Missing Seller Operations Endpoints (`/api/seller/*`):**
   - Frontends (`velseller`) called `/api/seller/status`, `/api/seller/verification`, `/api/seller/evidence/*`, `/api/seller/orders`, `/api/seller/income`, `/api/seller/reorder-suggestions`, `/api/seller/goals`, `/api/seller/products/*`.
   - Several of these routes were missing or lacked proper RBAC guarding.
3. **Public Aliases Precedence & Prefix Hijacking:**
   - In Hono routing, parameterized routes like `/categories/:slug` and `/payments/:id` took precedence over static routes (`/categories/tree`, `/payments/methods`, `/payments/stripe/configured`) when declared first or when sub-apps were mounted at conflicting prefixes.
4. **Realtime WebSocket Reconnection State in VelSeller & VelShop:**
   - `ShopChat.tsx` and `SellerChat.tsx` displayed misleading reconnecting indicators due to checking `realtimeState !== "open"`.
   - WebSocket handshakes in cross-domain environments required JWT token query parameters (`?token=${token}`) to authenticate without reliance on third-party cookies.

## 3. Work Implemented
1. **Customer Routes (`workers/api/src/routes/customer.ts`):**
   - Created full customer router covering profiles, account summary badge counts, avatar uploads (intent, save, direct), address CRUD backed by Neon DB, cart management, checkout quotes, order listing/tracking/cancellation, and wishlist toggling.
2. **Seller Routes (`workers/api/src/routes/seller.ts`):**
   - Added seller status, KYC verification submission, evidence upload intent/confirm, order management, revenue and settlement calculations, reorder suggestions, product CRUD with strict RBAC (`requireRole("seller", "admin")`), and seller goals.
3. **Payment & Stripe Routes (`workers/api/src/routes/payments.ts`):**
   - Corrected routing order so `/methods`, `/stripe/configured`, `/configured`, `/checkout`, and `/payment-status` execute before parameterized `/:id`.
   - Provided seamless compatibility for frontend payment method selectors and Stripe Checkout sessions.
4. **Catalog & Storefront Routes (`workers/api/src/routes/catalog.ts`):**
   - Corrected route declaration order to register `/categories/tree`, `/tree`, `/categories/stats`, and `/stats` before parameterized `/categories/:slug`.
   - Added storefront aliases for shops, reviews, and announcements.
5. **Realtime Chat Sync (`ShopChat.tsx`, `SellerChat.tsx`, `Center.tsx`):**
   - Standardized WebSocket connection to use token query parameter.
   - Refined banner display logic to trigger strictly on `"connecting"` or `"reconnecting"`.
6. **Cross-App Automated Test Suite (`workers/api/tests/customer.test.ts`):**
   - Created comprehensive integration test suite covering customer workflows, seller operations, and public storefront endpoints.

## 4. Verification Results
- **Workers API Test Suite:** 112 / 112 tests PASS across 17 test files.
- **Typecheck:** 0 errors across all 9 workspaces (`velshop`, `velseller`, `velcenter`, `velnox`, `validation`, `api-contract`, `api-client`, `ledger`, `@velnox/api`).
- **Production Builds:**
  - `apps/velshop`: Vite 7 production bundle built successfully.
  - `apps/velseller`: Vite 7 production bundle built successfully.
  - `apps/velcenter`: Vite 7 production bundle built successfully.
  - `apps/velnox`: Vite 7 production bundle built successfully.
  - `workers/api`: Wrangler deploy dry-run bundle built successfully (1091 KiB).
- **Git Diff Check:** Clean, zero whitespace or syntax errors.
