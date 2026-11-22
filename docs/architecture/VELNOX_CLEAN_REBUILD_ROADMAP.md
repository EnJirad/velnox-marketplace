# Velnox Marketplace — Clean Rebuild Master Roadmap (Phases 0–8)
**Version:** 2.0.0  
**Date:** 2026-11-22  
**Status:** ACTIVE MASTER ROADMAP  
**Authoritative Architecture:** [`docs/architecture/VELNOX_CLEAN_REBUILD_ARCHITECTURE.md`](file:///workspace/quiet-hopper/docs/architecture/VELNOX_CLEAN_REBUILD_ARCHITECTURE.md)

---

## 1. Roadmap Overview & Quality Gates

The Clean Rebuild Initiative establishes a modern Cloudflare-first foundation and clean database for Velnox Marketplace across 9 sequential phases:

```
PHASE 0: Rebuild Strategy & Legacy Audit ──────────────► (COMPLETED)
          │
          ▼
PHASE 1: New Foundation (Workers, Monorepo, /health) ──► (NEXT ACTIVE)
          │
          ▼
PHASE 2: Database & Identity (Clean Neon Schema, Auth)
          │
          ▼
PHASE 3: Marketplace Core (Sellers, Shops, Products, R2)
          │
          ▼
PHASE 4: Commerce Core (Cart, Checkout, Guarded Inventory)
          │
          ▼
PHASE 5: Payment & Finance (Stripe Webhook, Ledger)
          │
          ▼
PHASE 6: Frontend Integration (Pages -> Workers API)
          │
          ▼
PHASE 7: Realtime & Notifications (Durable Objects, Queues)
          │
          ▼
PHASE 8: Quality, Security & Release (E2E, Cutover)
```

---

## 2. Phase Breakdown & Quality Gates

### Phase 0: Rebuild Strategy & Legacy Audit
- **Status:** **COMPLETED** (2026-11-22)
- **Objective:** Reconcile owner architecture decision, audit existing codebase, classify reusable vs. obsolete code, establish clean database policy, and create master architecture and roadmap documents.
- **Key Deliverables:**
  - `docs/architecture/VELNOX_CLEAN_REBUILD_ARCHITECTURE.md`
  - `docs/architecture/VELNOX_CLEAN_REBUILD_ROADMAP.md`
  - `.ai/rebuild/CLEAN_REBUILD_ARCHITECTURE.md`
  - `.ai/rebuild/MASTER_REBUILD_ROADMAP.md`
  - Code classification matrix (Reusable, Reference, Obsolete).
  - Aligned AI directives in `.ai/office/` and `AGENTS.md`.
- **Quality Gate:** Git preflight verified; architecture documented; zero legacy code blindly deleted; legacy role strictly classified as reference.

---

### Phase 1: New Foundation (Monorepo & Workers Skeleton)
- **Status:** **NEXT ACTIVE**
- **Objective:** Establish the Cloudflare Workers backend (`workers/api`), shared TypeScript configuration, build system, standard response envelopes, and test pipeline.
- **Key Deliverables:**
  - `workers/api/wrangler.jsonc` (Cloudflare Workers configuration)
  - `workers/api/src/index.ts` (Hono application entry point)
  - Working endpoint: `GET /health` conforming to `@velnox/api-contract`
  - Shared error handling middleware adapting domain errors to HTTP envelopes.
  - Workspace configuration: TypeScript build and linting pipelines.
  - Resolution of TypeScript package typecheck configuration for Bun runtime.
- **Quality Gate:** `GET /health` passes automated contract tests; `bun run typecheck` passes cleanly across all workspaces; zero Node.js-only imports in `workers/api`.

---

### Phase 2: Database & Identity
- **Status:** PLANNED
- **Objective:** Establish clean Neon database connectivity, design the clean relational schema, create versioned migrations, and implement dual-token authentication and RBAC.
- **Key Deliverables:**
  - Owner provisions clean Neon database instance (or blocked -> isolated local PostgreSQL fallback).
  - Clean initial schema (`database/migrations/0001_clean_initial_schema.sql`):
    - `users`, `auth_identities`, `sessions`, `refresh_tokens`
    - Proper foreign keys, UUIDs, UTC timestamps, and indexes.
  - Workers database client using `@neondatabase/serverless`.
  - Authentication routes in Hono:
    - `POST /api/v1/auth/register`
    - `POST /api/v1/auth/login`
    - `POST /api/v1/auth/refresh`
    - `POST /api/v1/auth/logout`
    - `GET /api/v1/auth/me`
  - Web Crypto-based HS256 JWT implementation.
  - Role-based access control (RBAC) middleware.
- **Quality Gate:** Identity tests pass in Workers environment; cookies set with HttpOnly, Secure, SameSite=None; fail-closed database safety verified.

---

### Phase 3: Marketplace Core
- **Status:** PLANNED
- **Objective:** Build seller onboarding, shop profiles, categories, product catalog, variants, and Cloudflare R2 media uploads.
- **Key Deliverables:**
  - Clean database tables: `sellers`, `shops`, `categories`, `products`, `product_variants`, `media_objects`.
  - Seller onboarding and shop management endpoints.
  - Hierarchical category tree endpoints with Edge KV caching.
  - Product CRUD, filtering, search, and visibility management.
  - Cloudflare R2 native binding (`env.R2_BUCKET`) for image upload and verification.
- **Quality Gate:** Product catalog endpoints respond in < 50ms at edge; image uploads enforce MIME type, size limit, and ownership.

---

### Phase 4: Commerce Core
- **Status:** PLANNED
- **Objective:** Implement shopping cart, checkout orchestration, atomic guarded inventory reservations, and order lifecycle state machines.
- **Key Deliverables:**
  - Clean database tables: `carts`, `cart_items`, `checkout_groups`, `orders`, `order_items`.
  - Cart management endpoints (add, update, remove, group by shop).
  - Checkout session creation with multi-shop order splitting.
  - Guarded inventory reservation SQL preventing overselling.
  - Order state machine (`pending_payment`, `paid`, `processing`, `shipped`, `delivered`, `cancelled`).
- **Quality Gate:** Concurrent checkout tests prove zero overselling; multi-shop carts split cleanly into seller-owned orders.

---

### Phase 5: Payment & Finance
- **Status:** PLANNED
- **Objective:** Integrate Stripe test-mode payments, signature-verified webhooks, and the double-entry financial ledger.
- **Key Deliverables:**
  - Stripe payment intent creation (`POST /api/v1/payments/create-intent`).
  - Webhook endpoint (`POST /api/v1/payments/stripe/webhook`) with Web Crypto HMAC verification and replay protection.
  - Clean database tables: `ledger_accounts`, `ledger_entries`, `seller_settlements`.
  - Double-entry ledger postings: `Total Debits == Total Credits` with integer satang precision.
  - Seller settlement calculation engine.
- **Quality Gate:** Zero-float arithmetic verified; duplicate webhook deliveries handled idempotently; ledger invariant holds 100%.

---

### Phase 6: Frontend Integration
- **Status:** PLANNED
- **Objective:** Connect all 4 React applications on Cloudflare Pages to the new Workers API (`api.velnox.live`) using `@velnox/api-client`.
- **Key Deliverables:**
  - Update `apps/velshop`, `apps/velseller`, `apps/velcenter`, `apps/velnox` to consume `/api/v1/*`.
  - Remove legacy Express endpoint assumptions and mock data fallbacks.
  - Implement real loading, error, empty, and success UI states.
  - Verify Cloudflare Pages preview deployments.
- **Quality Gate:** All user flows (browse, register, login, add to cart, checkout, seller dashboard) succeed against Workers API.

---

### Phase 7: Realtime & Notifications
- **Status:** PLANNED
- **Objective:** Implement Cloudflare Durable Objects for distributed WebSockets, chat coordination, presence tracking, and Cloudflare Queues for push notifications.
- **Key Deliverables:**
  - Durable Object class for realtime connection management.
  - WebSocket upgrade endpoint (`GET /api/v1/realtime/ws`).
  - Multi-tab presence tracking and active conversation viewing detection.
  - Cloudflare Queue consumer for FCM push notification dispatch with retry handling.
- **Quality Gate:** Realtime messages delivered across edge nodes in < 100ms; push notifications suppressed when recipient is active in chat.

---

### Phase 8: Quality, Security & Release
- **Status:** PLANNED
- **Objective:** Comprehensive end-to-end verification, OWASP Top 10 security audit, performance load testing, and production cutover readiness.
- **Key Deliverables:**
  - Automated E2E test suite covering entire customer and seller lifecycle.
  - Security audit: IDOR, CSRF, XSS, rate limiting, token revocation, header security.
  - Concurrency and load testing.
  - Owner-approved cutover runbook execution and legacy infrastructure decommission.
- **Quality Gate:** 100% test pass rate; zero critical security vulnerabilities; owner authorization for production cutover.
