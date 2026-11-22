# Velnox Marketplace — Canonical Architecture Document
**Version:** 1.0.0  
**Date:** 2026-11-22  
**Status:** AUTHORITATIVE CANONICAL DEFINITION  
**Applies To:** All AI Agents, Software Engineers, Architects, and Project Stakeholders

---

> [!IMPORTANT]
> **MANDATORY ARCHITECTURE DIRECTIVE — READ BEFORE TOUCHING ANY CODE**
> 
> - **INITIATIVE:** **Clean Rebuild Initiative** (Not a legacy backend migration).
> - **TARGET BACKEND:** **Cloudflare Workers** (TypeScript + Hono Framework, Modular Monolith, Web Standards)
> - **PRIMARY DATABASE:** **Neon PostgreSQL** (Permanent Single Source of Truth — Clean Database Schema, zero customer data migration needed).
> - **FRONTEND HOSTING:** **Cloudflare Pages** (All 4 Static SPAs: `velnox.live`, `shop.velnox.live`, `seller.velnox.live`, `center.velnox.live`)
> - **OBJECT STORAGE:** **Cloudflare R2** (Images, KYC media, attachments — file metadata stored in Neon)
> - **REALTIME:** **Cloudflare Durable Objects** (Distributed stateful WebSockets, presence tracking, chat coordination)
> - **BACKGROUND JOBS:** **Cloudflare Queues** (Asynchronous tasks, retries, notifications — only where required)
> - **RENDER & VERCEL:** **LEGACY INFRASTRUCTURE DURING TRANSITION — NOT THE TARGET ARCHITECTURE**
> - **LEGACY BACKEND:** **REFERENCE ONLY** for business requirements, UI flows, and lessons learned. Do not import into Workers.
>
> All AI agents, future milestones, and technical decisions MUST adhere strictly to this canonical definition. No agent is permitted to treat Render as the target backend or continue expanding the legacy Express architecture under the assumption that it is permanent. Detailed Clean Rebuild Architecture is documented in [`VELNOX_CLEAN_REBUILD_ARCHITECTURE.md`](file:///workspace/quiet-hopper/docs/architecture/VELNOX_CLEAN_REBUILD_ARCHITECTURE.md).

---

## 1. Approved Target Architecture

The long-term approved production architecture for Velnox Marketplace is a unified **Cloudflare-First Edge + Neon PostgreSQL** platform:

```
                                  [ Cloudflare Global Edge Network ]
                             (Anycast DNS, Edge SSL/TLS, WAF, CDN, DDoS)
                                                  │
                 ┌────────────────────────────────┼────────────────────────────────┐
                 ▼                                ▼                                ▼
    [ Cloudflare Pages ] (Frontends)   [ Cloudflare Workers ] (Backend API)  [ Cloudflare R2 ] (Media)
    ┌──────────────────────────────┐   ┌──────────────────────────────┐      ┌─────────────────────────┐
    │ shop.velnox.live    (Shop)   │   │ api.velnox.live              │      │ Product & Shop Images   │
    │ seller.velnox.live  (Seller) │   │ • Hono Framework (TypeScript)│      │ KYC & Verification Docs │
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
                       │   • 62 Relational Tables      │
                       │   • ACID Financial Ledger     │
                       │   • Guarded Stock Reserv.     │
                       │   • PgBouncer / Serverless    │
                       └───────────────────────────────┘
```

### 1.1 Key Principles of Target Architecture
1. **Unified Edge Presence:** All customer and seller traffic terminates at Cloudflare Edge. Zero multi-hop cross-cloud latency.
2. **Single Primary Database:** Neon PostgreSQL is the permanent relational database. PostgreSQL transaction semantics, foreign key cascades, and check constraints guarantee commercial integrity.
3. **Web Standards Core:** Backend runs on Cloudflare Workers using standard `Request`, `Response`, `fetch`, and `crypto.subtle`.
4. **Single Source of Truth:** Neon holds all financial, order, user, catalog, inventory, and ledger state. No duplicate databases.
5. **Separation of Media vs. State:** Binary files live in R2; file references, keys, ownership, and content types live in Neon.

---

## 2. Existing Architecture & Inventory

The repository currently contains:

1. **Frontends (`apps/`):**
   - `apps/velshop`: React 19 + Vite 7 SPA (Customer storefront)
   - `apps/velseller`: React 19 + Vite 7 SPA (Seller operations dashboard)
   - `apps/velcenter`: React 19 + Vite 7 SPA (Marketplace management & admin console)
   - `apps/velnox`: React 19 + Vite 7 SPA (Corporate landing page)
   - *Status:* Static SPA builds passing 100%. `_redirects` configured for Cloudflare Pages.
2. **Current Monolith Backend (`backend/`):**
   - `backend/server.ts` & `backend/routes/`: Node.js Express server running on Render (`velnox-api.onrender.com`).
   - Uses `express`, `cors`, `helmet`, `cookie-parser`, `ws`, `pg`, `@aws-sdk/client-s3`.
   - *Status:* Operational on Render as **Legacy/Current Infrastructure**.
3. **Modular Domain Core (`backend/src/modules/`):**
   - Clean Hexagonal / Domain-driven modules (`identity`, `catalog`, `cart`, `inventory`, `checkout`, `payment`, `ledger`, `realtime`).
   - Pure domain business logic, isolated repository interfaces, and domain services.
   - Fully verified by 87 automated tests in `backend/tests/`.
   - *Status:* Ready for incremental mounting into Cloudflare Workers with Hono.
4. **Shared Packages (`packages/`):**
   - `packages/shared`: Shared UI components, Thai/English/Burmese i18n dictionaries.
   - `packages/validation`: Zod schemas for addresses, money, tokens, pagination, and auth.
   - `packages/api-contract`: OpenAPI 3.1.0 specification and standardized response envelopes.
   - `packages/api-client`: Typed fetch API client.
   - `packages/ledger`: Pure double-entry accounting invariants and transaction factories.
5. **Database:**
   - Neon PostgreSQL (Singapore / AWS ap-southeast-1 pooler).
   - 62 tables, strict check constraints, versioned migrations under `database/migrations/`.

---

## 3. Legacy Infrastructure (To Be Decommissioned Post-Cutover)

| Infrastructure | Current Role | Target Fate | Retirement Condition |
|---|---|---|---|
| **Vercel** | Hosts legacy frontend deployments (`velshop.vercel.app`, etc.) | **DEPRECATED & RETIRED** | 48–72 hours of stable traffic on Cloudflare Pages |
| **Render** | Hosts legacy Node.js Express backend (`velnox-api.onrender.com`) | **DEPRECATED & RETIRED** | All routes migrated to Cloudflare Workers and verified |
| **Express.js** | Node HTTP framework | **REPLACED BY HONO** | Complete Workers API parity |
| **`ws` (Node)** | Process-local WebSocket | **REPLACED BY DURABLE OBJECTS** | Distributed WebSocket hub implemented |
| **AWS S3 SDK** | R2 S3-compatible API wrapper | **REPLACED BY NATIVE R2 BINDINGS** | Workers R2 direct binding implemented |

> [!CAUTION]
> **SAFETY RULE:** Legacy infrastructure MUST remain active and untouched until the Cloudflare target architecture is fully implemented, verified, and cut over under explicit owner authorization. Never delete or disconnect Render or Vercel prematurely.

---

## 4. Current Migration Status Matrix

| Component | Current Implementation | Approved Target | Status | Evidence | Remaining Work |
|---|---|---|---|---|---|
| **Frontend Hosting** | Vercel deployments (`velshop.vercel.app`) | Cloudflare Pages (`shop.velnox.live`, etc.) | **PARTIALLY IMPLEMENTED** | Vite builds succeed (`dist/`), `_redirects` files present | Connect GitHub repo to Cloudflare Pages; point custom domains |
| **Backend API** | Node.js Express (`backend/server.ts`) on Render | Cloudflare Workers + Hono (`api.velnox.live`) | **PLANNED** | Express backend running; zero `wrangler.json`, zero Hono code | Initialize Workers project, mount `backend/src/modules/` |
| **API Domain** | `velnox-api.onrender.com` | `https://api.velnox.live` | **PLANNED** | `api.velnox.live` returns `ENOTFOUND` | Add CNAME record in Cloudflare DNS proxy |
| **Primary Database** | Neon PostgreSQL | Neon PostgreSQL | **VERIFIED IMPLEMENTED** | `db/schema.sql`, 62 tables, test guards active | Maintain single source of truth; zero replacement |
| **Database Migrations** | Custom SHA-256 migrator (`database/migrate.ts`) | Automated versioned migrations | **VERIFIED IMPLEMENTED** | `database/migrations/0001_initial_schema.sql`, 7 unit tests | Continue sequential versioning |
| **DB Connection Strategy** | Node.js `pg` driver (TCP pooler) | `@neondatabase/serverless` (WebSocket/HTTP) | **PLANNED** | `backend/package.json` uses `pg` | Install & test `@neondatabase/serverless` for Workers |
| **File Storage** | Cloudflare R2 via AWS S3 SDK | Cloudflare R2 via Native Worker Bindings | **PARTIALLY IMPLEMENTED** | R2 credentials in `.env`, S3 SDK in `upload.ts` | Implement native R2 Worker bindings (`env.R2_BUCKET`) |
| **Realtime WebSockets** | In-memory `RealtimeHub` (Node `ws`) | Cloudflare Durable Objects | **PLANNED** | Process-local `Map` in `realtime-hub.ts` | Implement Durable Object class for distributed hub |
| **Push Notifications** | FCM payload formatter (honest reporting) | Cloudflare Queues + FCM HTTP v1 | **BLOCKED** | Reports `blocked_missing_credentials` | Add Firebase Service Account credentials to environment |
| **Background Jobs** | `setInterval` in Node.js process | Cloudflare Queues & Cron Triggers | **PLANNED** | `jobs/payment-reservation-scheduler.js` in Node | Port to Cloudflare Worker Cron & Queue consumers |
| **Authentication** | Dual-Token (JWT HS256, scrypt, HttpOnly cookie) | Same logic on Cloudflare Workers | **VERIFIED IMPLEMENTED** (Logic) / **PLANNED** (Runtime) | 29 identity tests pass in Node | Port scrypt/JWT verification to Web Crypto API / WASM |
| **Payment & Ledger** | Stripe Webhook + Zero-float Satang + Ledger | Same logic on Cloudflare Workers | **VERIFIED IMPLEMENTED** (Domain) / **PLANNED** (Runtime) | 9 payment tests, 11 ledger tests pass | Mount Stripe webhook in Hono using Web Standards `Request` |
| **CI/CD & Monorepo** | GitHub Actions (`ci.yml`), Bun workspaces | Unified Monorepo CI + Cloudflare Wrangler Deploy | **VERIFIED IMPLEMENTED** (Test) / **PLANNED** (Deploy) | Typecheck 5/5 clean, 87/87 tests pass | Add Wrangler deploy workflow for Workers & Pages |
| **DNS & Edge** | Cloudflare DNS (`velnox.live`) | Cloudflare DNS Proxied (Orange Cloud) | **PARTIALLY IMPLEMENTED** | `velnox.live` resolves 200, subdomains `ENOTFOUND` | Owner adds CNAME records in Cloudflare DNS |
| **Production Cutover** | Runbook drafted (`CLOUDFLARE_CUTOVER_RUNBOOK.md`) | Zero-downtime cutover & soak | **PLANNED** | Smoke test script ready (`bun run cutover:verify`) | Execute migration milestones CF-0 through CF-10 first |

---

## 5. Subsystem Strategies

### 5.1 Database Strategy — Neon PostgreSQL
- **Permanent Source of Truth:** Neon PostgreSQL holds all relational, commerce, user, and financial state.
- **Strict Prohibitions:**
  - Never replace Neon with Cloudflare D1, MongoDB, Firebase, or Supabase.
  - Never introduce a secondary database that duplicates transactional state.
- **Workers Connectivity:**
  - Cloudflare Workers cannot use standard Node.js TCP `net` sockets without special handling.
  - Workers will connect to Neon via `@neondatabase/serverless` over WebSockets / HTTP tunnel, utilizing PgBouncer connection pooling.
  - Transaction atomicity must be preserved using `@neondatabase/serverless` transaction wrappers.

### 5.2 Backend Strategy — Cloudflare Workers + Hono
- **Framework:** Hono (ultra-fast, typed, Web Standards-compliant, first-class Cloudflare Workers support).
- **Pattern:** Modular Monolith. All domains (`identity`, `catalog`, `cart`, `checkout`, `payment`, `ledger`, `realtime`) exist in one repository and deploy to one Workers project under `api.velnox.live`.
- **API Contracts:** Strictly validated via `@velnox/validation` (Zod) and conform to `@velnox/api-contract`.
- **Runtime:** Pure Web Standards (`fetch`, `Headers`, `Request`, `Response`, `crypto.subtle`). Zero reliance on Node-only internals (`fs`, `net`, `http`, native C++ bindings).

### 5.3 Frontend Strategy — Cloudflare Pages
- **Applications:** VelShop, VelSeller, VelCenter, VelNox.
- **Tech Stack:** React 19, TypeScript, Vite 7, Tailwind CSS v4, React Router v7.
- **Deployment:** Static SPA bundles (`dist/`) deployed to Cloudflare Pages.
- **Routing:** Handled client-side. Every app includes `_redirects` (`/* /index.html 200`) to prevent 404s on deep links.
- **Security:** CSP, CORS, and HttpOnly session cookies issued by `api.velnox.live` on the same parent domain (`.velnox.live`).

### 5.4 Storage Strategy — Cloudflare R2
- **Direct Binding:** Cloudflare Workers use native `env.R2_BUCKET` binding for internal upload processing, verification, and deletion.
- **Zero Egress:** Cloudflare R2 incurs zero egress fees, dramatically reducing operational costs.
- **Client Direct Uploads:** Workers generate pre-signed upload URLs for large media, allowing clients to PUT directly to R2.
- **Metadata in Neon:** Object keys, file sizes, MIME types, upload timestamps, and owner IDs are saved in the `media` or relational tables in Neon.

### 5.5 Realtime Strategy — Cloudflare Durable Objects
- **Why Durable Objects:** In-memory Maps on Render cannot scale across multiple container instances without Redis. Cloudflare Durable Objects provide strongly consistent, globally coordinated stateful WebSocket endpoints without managing Redis clusters.
- **Realtime Capabilities:**
  - Client WebSocket connection lifecycle.
  - Room/channel subscription management (`order:<id>`, `user:<id>`, `chat:<conversation_id>`).
  - Active conversation viewing presence (suppressing redundant mobile push notifications).
  - Fan-out broadcast delivery to all active connections of a user across multiple tabs/devices.

### 5.6 Background Jobs Strategy — Cloudflare Queues
- **Asynchronous Execution:** Used for non-blocking work that can retry independently:
  - Stripe webhook background reconciliations.
  - Firebase Cloud Messaging (FCM) mobile push notification dispatch with exponential backoff.
  - Inventory reservation release upon 30-minute expiration (via Cloudflare Cron Trigger).
- **Dead-Letter Handling:** Failed messages after maximum retry attempts are routed to a dead-letter queue for inspection.

---

## 6. Security Principles

1. **Deny by Default:** Every API endpoint validates authentication and RBAC server-side using `assertUserRole`. Hiding UI buttons is never a security control.
2. **Dual-Token Lifecycle:**
   - Web: Short-lived Access Token in memory/cookie + Refresh Token in `HttpOnly; Secure; SameSite=None` cookie.
   - Mobile: Bearer Access Token in Authorization header + Refresh Token rotation via JSON body.
3. **Timing-Safe Cryptography:** All password checks use `scrypt` with `crypto.timingSafeEqual`. All webhook signatures use HMAC-SHA256 with timing-safe comparisons.
4. **Anti-Replay Window:** Webhooks enforce a strict timestamp check (< 300 seconds). Revoked tokens are tracked in Neon / KV.
5. **No Secrets in Output:** Zero tokens, passwords, database connection strings, or private keys in logs, commits, or reports.

---

## 7. Migration Principles & Prohibited Decisions

### What Future Agents MUST Do:
- Treat Cloudflare Workers as the ONLY approved target backend.
- Maintain Neon PostgreSQL as the primary database.
- Port modular business logic from `backend/src/modules/` into Cloudflare Workers with Hono.
- Keep all unit, contract, and integration tests passing.
- Follow the incremental roadmap (`docs/architecture/CLOUDFLARE_MIGRATION_ROADMAP.md`).

### What Future Agents MUST NEVER Do (PROHIBITED):
- **NEVER** treat Render as the target backend.
- **NEVER** add new features exclusively to the legacy Express `backend/routes/` without porting to the target modular architecture.
- **NEVER** replace Neon PostgreSQL with Cloudflare D1, Supabase, Firebase, or MongoDB.
- **NEVER** introduce a second primary database.
- **NEVER** delete or disconnect Render or Vercel before cutover is authorized.
- **NEVER** execute production migrations or modify production DNS without explicit owner authorization.
- **NEVER** fabricate test results or mark milestones complete without real code, bindings, and verified test execution.

---

## 8. Cutover Governance & Approval Gate

1. **Pre-requisite:** Milestones CF-0 through CF-10 must be completed and verified in Staging.
2. **Authority:** Production Cutover (CF-11) requires **explicit, written authorization from the Project Owner**.
3. **Execution:** Follow [CLOUDFLARE_CUTOVER_RUNBOOK.md](file:///workspace/quiet-hopper/docs/CLOUDFLARE_CUTOVER_RUNBOOK.md).
4. **Verification:** Execute `bun run cutover:verify` to confirm live Edge resolution, SSL, SPA deep links, and API health.
5. **Soak Period:** Legacy Vercel and Render services remain active in parallel for 48–72 hours before decommissioning.
