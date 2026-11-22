# Velnox Marketplace — Cloudflare Migration Roadmap (CF-0 to CF-11)
**Document Version:** 1.0.0  
**Date:** 2026-11-22  
**Status:** ACTIVE MIGRATION ROADMAP  
**Authoritative Reference:** [`docs/architecture/VELNOX_CANONICAL_ARCHITECTURE.md`](file:///workspace/quiet-hopper/docs/architecture/VELNOX_CANONICAL_ARCHITECTURE.md)

---

## 1. Executive Roadmap Overview

This roadmap defines the sequential, incremental, and safe migration of the Velnox Marketplace backend from legacy Node.js/Express on Render to **Cloudflare Workers (Hono) + Cloudflare Durable Objects + Cloudflare R2**, with **Neon PostgreSQL** as the permanent Single Source of Truth.

```
CF-0: Architecture Truth & Inventory ──────────────► (COMPLETED)
       │
       ▼
CF-1: Workers Foundation (Hono, Types, Config) ───► (NEXT ACTIVE)
       │
       ▼
CF-2: Neon Connectivity (@neondatabase/serverless)
       │
       ▼
CF-3: Identity & Dual-Token Authentication
       │
       ▼
CF-4: Catalog & Read-Only APIs
       │
       ▼
CF-5: Commerce Write APIs (Cart, Checkout, Guarded Inventory)
       │
       ▼
CF-6: Payments, Stripe Webhooks & Financial Ledger
       │
       ▼
CF-7: Cloudflare R2 Native Storage Migration
       │
       ▼
CF-8: Durable Objects (Realtime Hub) & Queues
       │
       ▼
CF-9: Frontend Integration & Pages Alignment
       │
       ▼
CF-10: Full Staging Verification & Security Audit
       │
       ▼
CF-11: Production Cutover & Vercel/Render Retirement (Owner Authorized)
```

---

## 2. Milestone Details & Quality Gates

---

### Milestone CF-0: Architecture Truth & Infrastructure Inventory
- **Status:** **COMPLETED** (2026-11-22)
- **Objective:** Eliminate architectural confusion across repository documents, establish canonical architecture definition, create status matrix, and establish strict migration rules.
- **Key Deliverables:**
  - `docs/architecture/VELNOX_CANONICAL_ARCHITECTURE.md`
  - `docs/architecture/CLOUDFLARE_MIGRATION_ROADMAP.md`
  - Reconciled AI handoff and roadmap documents.
  - Reset AI agent startup instructions.
- **Gate Criteria:** All documents aligned; Render classified as Legacy; Cloudflare Workers classified as Target; zero code destroyed.

---

### Milestone CF-1: Cloudflare Workers Foundation
- **Status:** **NEXT ACTIVE**
- **Objective:** Initialize the Cloudflare Workers backend project using Hono, TypeScript, and Wrangler; configure local development, preview pipelines, and standard response envelopes.
- **Key Deliverables:**
  - `workers/api/wrangler.jsonc` (Workers configuration)
  - `workers/api/src/index.ts` (Hono application entry point)
  - Health check endpoint `GET /health` conforming to `@velnox/api-contract`
  - Shared error handling middleware adapting `AppError` to HTTP responses.
  - Cloudflare environment typing (`Bindings`, `Variables`).
- **Dependencies:** CF-0
- **Gate Criteria:** `wrangler dev` runs locally; `GET /health` passes automated contract tests; zero Node.js-only imports.

---

### Milestone CF-2: Neon Connectivity & Migration Safety
- **Status:** PLANNED
- **Objective:** Establish the Workers-to-Neon connection strategy using `@neondatabase/serverless` over WebSockets/HTTP; verify transaction semantics and connection pooling.
- **Key Deliverables:**
  - `workers/api/src/core/database/neon-client.ts`
  - Transaction execution helper (`db.transaction(async (tx) => ...)`)
  - Integration tests running against isolated test database (Neon production connection string rejected by fail-closed guard).
  - Benchmark connection latency and concurrency behavior.
- **Dependencies:** CF-1
- **Gate Criteria:** ACID transactions rollback correctly on error; zero connection leaks under load; fail-closed production safety verified.

---

### Milestone CF-3: Identity & Dual-Token Authentication
- **Status:** PLANNED
- **Objective:** Port user registration, login, logout, refresh token rotation, and RBAC to Cloudflare Workers using Web Crypto API.
- **Key Deliverables:**
  - Mount `backend/src/modules/identity/` into Workers Hono routes:
    - `POST /api/v1/auth/register`
    - `POST /api/v1/auth/login`
    - `POST /api/v1/auth/refresh`
    - `POST /api/v1/auth/logout`
  - Web Crypto-based JWT signer/verifier (HS256).
  - Password verification compatible with Workers runtime (WASM scrypt or Web Crypto PBKDF2/Argon2 bridge).
  - Cookie helper setting `HttpOnly; Secure; SameSite=None`.
- **Dependencies:** CF-2
- **Gate Criteria:** 29 identity tests pass in Workers environment; cookies match browser security requirements; mobile Bearer token exchange verified.

---

### Milestone CF-4: Catalog & Read-Only APIs
- **Status:** PLANNED
- **Objective:** Migrate public read-only catalog endpoints to Workers with optional Cloudflare KV caching.
- **Key Deliverables:**
  - `GET /api/v1/catalog/categories` (hierarchical tree)
  - `GET /api/v1/catalog/products` (paginated, filtered, search)
  - `GET /api/v1/catalog/products/:id` (product detail & variants)
  - Cloudflare KV integration for category tree caching.
- **Dependencies:** CF-2, CF-3
- **Gate Criteria:** Responses conform 100% to `@velnox/api-contract`; latency under 50ms at Edge; frontend Shop renders catalog cleanly against Workers preview.

---

### Milestone CF-5: Commerce Write APIs (Cart, Checkout, Guarded Inventory)
- **Status:** PLANNED
- **Objective:** Migrate transactional commerce endpoints to Workers; enforce atomic guarded inventory reservation and multi-shop order splitting.
- **Key Deliverables:**
  - `GET /api/v1/cart`, `POST /api/v1/cart/items`, `DELETE /api/v1/cart/items/:id`
  - `POST /api/v1/checkout/create-session` (multi-shop split, 30-min reservation window, idempotency key check)
  - Guarded inventory reservation SQL:
    `UPDATE products SET reserved_quantity = reserved_quantity + $qty WHERE id = $id AND (total_quantity - reserved_quantity) >= $qty;`
- **Dependencies:** CF-4
- **Gate Criteria:** Concurrent checkout tests prove zero stock overselling; duplicate idempotency keys return existing session without duplicate reservations.

---

### Milestone CF-6: Payments, Stripe Webhooks & Financial Ledger
- **Status:** PLANNED
- **Objective:** Migrate Stripe payment flow, webhook handling, and double-entry ledger postings to Workers.
- **Key Deliverables:**
  - `POST /api/v1/payments/stripe/webhook` (raw body signature check using Web Crypto HMAC-SHA256, < 300s replay window)
  - Order state machine transitions (`pending_payment` -> `paid` -> `fulfillment`).
  - Double-entry ledger integration using `@velnox/ledger`:
    - Debit `platform_cash`
    - Credit `seller_payable`
    - Credit `platform_revenue`
    - Verify Invariant: `Total Debits == Total Credits`
  - Automated seller settlement calculation.
- **Dependencies:** CF-5
- **Gate Criteria:** Replay attacks rejected; ledger balances to 0 satang discrepancy; all payment tests pass.

---

### Milestone CF-7: Cloudflare R2 Native Storage Migration
- **Status:** PLANNED
- **Objective:** Replace AWS S3 SDK with native Cloudflare Worker R2 bindings (`env.R2_BUCKET`); generate pre-signed upload URLs for client uploads.
- **Key Deliverables:**
  - `POST /api/v1/upload/presign` (generates pre-signed URL for direct browser-to-R2 upload)
  - Internal image upload handler using `env.R2_BUCKET.put()`
  - File deletion handler using `env.R2_BUCKET.delete()`
  - Image metadata records saved to Neon PostgreSQL (`media` table).
- **Dependencies:** CF-3
- **Gate Criteria:** Large files upload directly to R2 with zero Worker bandwidth overhead; file metadata recorded in Neon; image URLs resolve via public R2 domain.

---

### Milestone CF-8: Realtime Durable Objects & Queues
- **Status:** PLANNED
- **Objective:** Implement distributed stateful WebSockets using Cloudflare Durable Objects; configure Cloudflare Queues for asynchronous background tasks.
- **Key Deliverables:**
  - `RealtimeHubDurableObject` class handling WebSocket connections, room pub/sub (`order:<id>`, `user:<id>`), and active conversation viewing presence.
  - Push notification suppression logic when user is actively reading thread.
  - Cloudflare Queue consumer for background FCM push notification delivery with exponential backoff.
  - Worker Cron trigger for expiring unfulfilled 30-minute stock reservations.
- **Dependencies:** CF-6, CF-7
- **Gate Criteria:** Multi-connection WebSocket presence coordinates reliably across regions; push notifications suppress correctly; Cron trigger releases expired stock.

---

### Milestone CF-9: Frontend Integration & Pages Alignment
- **Status:** PLANNED
- **Objective:** Connect all 4 frontend applications on Cloudflare Pages to the Cloudflare Workers API in preview/staging; verify CORS, cookies, and SPA routing.
- **Key Deliverables:**
  - Configure `VITE_API_URL` pointing to Workers staging endpoint across all 4 apps.
  - Verify HTML5 pushState routing via `_redirects` across all deep links.
  - Verify session cookies pass smoothly with `SameSite=None; Secure`.
- **Dependencies:** CF-1 through CF-8
- **Gate Criteria:** Shop, Seller, Center, and Landing function 100% against Workers backend in browser preview environment; zero CORS errors.

---

### Milestone CF-10: Full Staging Verification & Security Audit
- **Status:** PLANNED
- **Objective:** Execute full end-to-end user journeys, OWASP Top 10 security audit, and concurrency load tests in a dedicated Staging environment.
- **Key Deliverables:**
  - Staging environment running Cloudflare Pages + Cloudflare Workers + Neon Staging DB.
  - Automated E2E test run covering all 5 core commerce journeys.
  - Concurrency benchmark verifying RPS, p50, p95, p99 latencies.
  - Security audit verifying zero P0/P1 vulnerabilities.
- **Dependencies:** CF-9
- **Gate Criteria:** 100% tests pass; zero financial discrepancies; load test proves sub-50ms Edge latency; written sign-off ready for Owner review.

---

### Milestone CF-11: Production Cutover & Legacy Retirement
- **Status:** PLANNED (Requires Owner Authorization)
- **Objective:** Execute zero-downtime DNS cutover from legacy Vercel and Render infrastructure to Cloudflare Pages and Cloudflare Workers.
- **Key Deliverables:**
  - Lower DNS TTL 24 hours prior.
  - Switch CNAME records in Cloudflare DNS (Orange Cloud Proxy active).
  - Run synthetic smoke test (`bun run cutover:verify`).
  - Observe 48–72 hour soak period with zero customer impact.
  - Decommission Vercel custom domains and pause Render Web Service.
- **Dependencies:** CF-10, Owner Authorization
- **Gate Criteria:** Zero downtime recorded; `cutover:verify` passes 100%; legacy infrastructure retired safely.

---

## 3. Migration Safety Guardrails

1. **Zero Downtime:** Legacy Vercel and Render services remain fully operational throughout milestones CF-0 through CF-10.
2. **Neon DB Invariant:** Neon PostgreSQL is never wiped, recreated, or replaced. All migrations preserve existing tables, data, and constraints.
3. **No Blind Production Changes:** No Workers deployment or DNS modification to production may occur without explicit written authorization from the Project Owner.
4. **Isolated Testing:** All intermediate development and benchmark tests MUST use mock or disposable databases. The fail-closed database guard in `backend/db/test-database.ts` must never be bypassed.
