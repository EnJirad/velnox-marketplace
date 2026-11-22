# Velnox Marketplace — Clean Rebuild Architecture
**Version:** 2.0.0  
**Date:** 2026-11-22  
**Status:** AUTHORITATIVE ARCHITECTURAL STANDARD  
**Initiative:** Clean Rebuild Initiative (Cloudflare-First · Clean Database)

---

> [!IMPORTANT]
> ### OWNER ARCHITECTURAL DIRECTIVE — CLEAN REBUILD MANDATE
> 
> 1. **STRATEGY:** Velnox Marketplace is undergoing a **Clean Rebuild**, NOT a legacy backend migration.
> 2. **NO DATA MIGRATION:** The project owner has confirmed that there is NO valuable production customer data, real order history, or financial data that needs to be preserved. We start with a **CLEAN DATABASE ENVIRONMENT**.
> 3. **TARGET BACKEND:** **Cloudflare Workers** with **Hono** framework (TypeScript, Modular Monolith, Web Standards Fetch API, REST at `api.velnox.live`).
> 4. **PRIMARY DATABASE:** **Neon PostgreSQL** (Permanent Single Source of Truth). We do NOT inherit the legacy 62-table schema. We design a clean, normalized, production-grade schema based on actual business requirements.
> 5. **STORAGE:** **Cloudflare R2** with native Worker bindings (`env.R2_BUCKET`), eliminating AWS S3 SDK overhead and egress costs. File metadata recorded in Neon.
> 6. **REALTIME:** **Cloudflare Durable Objects** (Distributed stateful WebSockets, room pub/sub, presence, chat) replacing process-local Node.js `ws` Maps.
> 7. **BACKGROUND PROCESSING:** **Cloudflare Queues** for asynchronous jobs, retries, and FCM push notifications.
> 8. **FRONTEND HOSTING:** **Cloudflare Pages** for all 4 SPAs (`velnox.live`, `shop.velnox.live`, `seller.velnox.live`, `center.velnox.live`).
> 9. **LEGACY ROLE:** The legacy Node.js/Express backend on Render and existing schema are **REFERENCE ONLY** for business logic, UI flows, and lessons learned. Legacy code MUST NOT become a dependency of the new backend.

---

## 1. High-Level Target Topology

```
                                  [ Cloudflare Global Edge Network ]
                             (Anycast DNS, Edge SSL/TLS, WAF, DDoS Protection)
                                                   │
                  ┌────────────────────────────────┼────────────────────────────────┐
                  ▼                                ▼                                ▼
     [ Cloudflare Pages ] (Frontends)   [ Cloudflare Workers ] (Backend API)  [ Cloudflare R2 ] (Media)
     ┌──────────────────────────────┐   ┌──────────────────────────────┐      ┌─────────────────────────┐
     │ shop.velnox.live    (Shop)   │   │ api.velnox.live              │      │ Product & Shop Images   │
     │ seller.velnox.live  (Seller) │   │ • Hono Framework (TypeScript)│      │ Verification Documents  │
     │ center.velnox.live  (Center) │   │ • Modular Monolith /api/v1/* │      │ Chat Attachments        │
     │ velnox.live         (Landing)│   │ • Web Standards Fetch API    │      │ Zero Egress Fees        │
     └──────────────┬───────────────┘   └──────────────┬───────────────┘      └─────────────────────────┘
                    │                                  │
                    └──────── HTTPS / REST ────────────┤
                                                       │
                                    ┌──────────────────┴──────────────────┐
                                    ▼                                     ▼
                       [ Cloudflare Durable Objects ]            [ Cloudflare Queues ]
                       • Distributed Realtime WebSockets         • Async Event Processing
                       • Multi-Tab Presence Coordination         • FCM Notification Retries
                       • Chat Thread State Management            • Financial Reconciliations
                                    │
                                    ▼
                        ┌───────────────────────────────┐
                        │       Neon PostgreSQL         │
                        │   (SINGLE SOURCE OF TRUTH)    │
                        │   • Clean Rebuilt Schema      │
                        │   • ACID Financial Ledger     │
                        │   • Atomic Guarded Inventory  │
                        │   • @neondatabase/serverless  │
                        └───────────────────────────────┘
```

---

## 2. Component Architecture & System Boundaries

### 2.1 Backend API — Cloudflare Workers (`workers/api`)
- **Runtime:** Cloudflare Workers (V8 isolates at edge).
- **Routing & Framework:** **Hono** (lightweight, ultra-fast, built for Web Standards `Request`/`Response`).
- **Architecture Pattern:** **Modular Monolith**.
  ```
  workers/api/
  ├── wrangler.jsonc
  └── src/
      ├── app.ts
      ├── index.ts
      ├── middleware/
      │   ├── auth.ts
      │   ├── error.ts
      │   └── rate-limit.ts
      ├── core/
      │   ├── database/
      │   ├── security/
      │   └── errors/
      └── modules/
          ├── identity/
          ├── users/
          ├── sellers/
          ├── shops/
          ├── catalog/
          ├── cart/
          ├── inventory/
          ├── checkout/
          ├── orders/
          ├── payments/
          ├── finance/
          ├── shipping/
          ├── realtime/
          ├── notifications/
          └── center/
  ```
- **Validation:** Zod schemas shared across API contracts (`@velnox/validation`).
- **Response Format:** Standardized envelope (`ApiResponse<T>` / `ApiErrorResponse`) from `@velnox/api-contract`.

### 2.2 Database — Clean Neon PostgreSQL
- **Permanent Source of Truth:** Neon PostgreSQL remains the sole authoritative store.
- **Clean Schema Policy:**
  - Zero legacy table baggage.
  - Strict UUID primary keys (`gen_random_uuid()`).
  - Strict Foreign Keys with appropriate `ON DELETE` rules.
  - Check constraints for data validity (e.g. `amount >= 0`, `status IN (...)`).
  - Money stored strictly as `BIGINT` in minor units (satang). Floating-point values are forbidden.
  - UTC timestamps (`TIMESTAMPTZ DEFAULT NOW()`).
- **Workers Connectivity:**
  - Cloudflare Workers connect using `@neondatabase/serverless` via WebSocket/HTTP tunnel.
  - Connection pooling managed via Neon's PgBouncer pooler.
  - Clean migration engine using versioned migrations (`database/migrations/`).
- **Database Safety Guard:**
  - Production connection strings are protected by fail-closed guards.
  - If a new Neon database has not yet been provisioned by the owner, database provisioning is marked **BLOCKED**, and local isolated PostgreSQL is used for development and testing.

### 2.3 Storage — Cloudflare R2
- **Direct Workers Binding:** `env.R2_BUCKET`.
- **Zero Egress:** Cloudflare R2 provides zero egress fees when accessed via Workers or public CDN domains.
- **Upload Flow:**
  1. Frontend requests presigned URL or uploads directly via authenticated Worker endpoint.
  2. Worker verifies user authentication, upload purpose, allowed MIME types, and file size limits (5 MB max for images).
  3. Worker records object metadata (key, size, content type, owner, purpose) into Neon PostgreSQL.
  4. Binary payload is stored directly in R2.

### 2.4 Realtime — Cloudflare Durable Objects
- **Stateful Edge Coordination:** Durable Objects provide strongly consistent, distributed in-memory state.
- **Capabilities:**
  - Stateful WebSocket termination at the Cloudflare Edge.
  - Multi-tab user presence tracking without central Redis bottlenecks.
  - Chat room coordination and real-time event broadcasting.
  - Push notification suppression when a user is actively viewing a conversation.

### 2.5 Frontends — Cloudflare Pages
- **Applications:**
  - `apps/velshop`: Customer marketplace SPA (`shop.velnox.live`)
  - `apps/velseller`: Seller management SPA (`seller.velnox.live`)
  - `apps/velcenter`: Platform admin console SPA (`center.velnox.live`)
  - `apps/velnox`: Corporate landing page (`velnox.live`)
- **Hosting:** Cloudflare Pages with `_redirects` (`/* /index.html 200`).
- **Communication:** Frontends communicate exclusively with `https://api.velnox.live/api/v1/*` using `@velnox/api-client`. Frontends never touch the database or hold server secrets.

---

## 3. Legacy Audit & Code Classification

| Component | Repository Path | Classification | Treatment & Action |
|---|---|---|---|
| **Express Server** | `backend/server.ts` | **OBSOLETE** | Do not import into Workers. Replace with Hono in `workers/api`. Keep in repo for reference only. |
| **Express Routes** | `backend/routes/*.ts` | **OBSOLETE / REFERENCE** | Business rules serve as reference; route implementations must be rewritten for Hono and Web Standards. |
| **Node WS Hub** | `backend/realtime/` | **OBSOLETE** | Replace with Cloudflare Durable Objects. |
| **S3 SDK Storage** | `backend/routes/upload.ts` | **OBSOLETE** | Replace with native Cloudflare R2 bindings (`env.R2_BUCKET`). |
| **Legacy DB Schema** | `db/schema.sql` (62 tables) | **OBSOLETE / REFERENCE** | Do not migrate. Design clean schema in Phase 2 based on clean business requirements. |
| **Legacy Migrator** | `database/migrate.ts` | **REUSABLE / ADAPTABLE** | SHA-256 checksum verification engine is clean and unit-tested; adapt for clean migrations. |
| **Domain Logic** | `backend/src/modules/` | **REUSABLE** | Pure domain calculations (satang math, cart grouping, state machines) can be ported directly into Workers. |
| **Zod Validation** | `packages/validation/` | **REUSABLE** | Full validation suite for money, email, phone, addresses, auth. |
| **API Contract** | `packages/api-contract/` | **REUSABLE** | Standard response envelopes, error schemas, OpenAPI definitions. |
| **API Client** | `packages/api-client/` | **REUSABLE** | Fetch-based client ready for browser and Workers. |
| **Double-Entry Ledger** | `packages/ledger/` | **REUSABLE** | Pure financial accounting invariant engine (`Debits == Credits`). |
| **Shared UI & i18n** | `packages/shared/` | **REUSABLE** | Design tokens, squircle components, Thai/English/Burmese dictionaries. |
| **React Frontends** | `apps/*` | **REUSABLE** | React 19 + Tailwind SPAs ready for Pages deployment. |
| **Render Deploy** | `render.yaml` / Render configs | **OBSOLETE** | To be decommissioned post-cutover. |
| **Vercel Configs** | `vercel.json` | **OBSOLETE** | Superseded by Cloudflare Pages. |

---

## 4. Security & Compliance Principles

1. **Authentication & Session Management:**
   - Dual-token architecture: Short-lived Access Token (15 min) + Long-lived Refresh Token (7 days).
   - Web clients: HttpOnly, Secure, SameSite=None session cookies.
   - Mobile clients: Bearer tokens in Authorization header.
   - Web Crypto API (`crypto.subtle`) for HS256 JWT signing and verification inside Workers.
2. **Access Control & RBAC:**
   - Roles: `customer`, `seller`, `center_admin`, `center_staff`, `center_superadmin`.
   - Strict server-side ownership verification: users can only access their own orders, carts, and addresses; sellers can only access their own shop products and orders.
3. **Financial Safety & Accuracy:**
   - All monetary calculations use integer satang (minor units) with `BigInt`.
   - Floating-point currency arithmetic is strictly prohibited.
   - Double-entry ledger guarantees `Debits == Credits` on every financial movement.
4. **Inventory Safety:**
   - Guarded conditional SQL updates prevent race conditions and overselling:
     `UPDATE products SET reserved_quantity = reserved_quantity + $qty WHERE id = $id AND (total_quantity - reserved_quantity) >= $qty;`
