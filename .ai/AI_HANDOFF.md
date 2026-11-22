# Velnox AI Handoff — Current State
**Last verified:** 2026-11-22 · **Branch:** `main` · **Focus:** Clean Rebuild Initiative · Phase 3 Complete

---

## 0. Current Project State: CLEAN REBUILD INITIATIVE (PHASE 3 COMPLETE)
- **Active Initiative:** Velnox Clean Rebuild Initiative (Cloudflare-First · Clean Database)
- **Last Completed Milestone:** **Phase 3 (Marketplace Core — Sellers, Shops, Categories, Products, R2 Media)**
- **Next Active Milestone:** **Phase 4 (Commerce Core — Cart, Checkout, Guarded Inventory Reservations, Orders)**

### Approved Rebuild Directives (MANDATORY):
- **STRATEGY:** Full clean rebuild designed for Cloudflare from day one. We are NOT continuing a legacy backend migration.
- **TARGET BACKEND:** **Cloudflare Workers** (`workers/api`) running **Hono Framework** in TypeScript, Modular Monolith at `api.velnox.live`.
- **DATABASE CONNECTIVITY:** Cloudflare Workers connects to Neon PostgreSQL via `@neondatabase/serverless` over WebSockets/HTTP.
- **CLEAN CORE SCHEMA:** Production migrations `0001_identity.sql` and `0002_marketplace_core.sql` established with `users`, `auth_identities`, `refresh_tokens`, `sellers`, `shops`, `categories`, `products`, `product_variants`, and `media_objects`. Strict UUIDs, foreign keys, check constraints, composite indexes, and UTC timestamps.
- **MEDIA & STORAGE:** Native **Cloudflare R2** bindings (`env.R2_BUCKET`), 5 MB limit, WebP/JPEG/PNG validation, structured object key format (`<purpose>/<userId>/<timestamp>-<randomId>.<ext>`), and zero egress fee public URLs.
- **CATALOG & SELLER DOMAIN:** Hierarchical category tree builder (L1 -> L2 -> L3), full product listing with search/filter/pagination/sorting, satang minor units mapped to decimal currency, seller onboarding, shop profile management, and product CRUD with shop ownership enforcement.
- **COOKIES & SESSIONS:** HttpOnly, Secure, SameSite=None session and refresh cookies for web; Authorization header tokens for mobile clients.
- **FRONTEND HOSTING:** **Cloudflare Pages** (`shop.velnox.live`, `seller.velnox.live`, `center.velnox.live`, `velnox.live`).

### Core Architecture Artifacts:
- **Clean Rebuild Architecture:** [`docs/architecture/VELNOX_CLEAN_REBUILD_ARCHITECTURE.md`](file:///workspace/quiet-hopper/docs/architecture/VELNOX_CLEAN_REBUILD_ARCHITECTURE.md)
- **Canonical Architecture:** [`docs/architecture/VELNOX_CANONICAL_ARCHITECTURE.md`](file:///workspace/quiet-hopper/docs/architecture/VELNOX_CANONICAL_ARCHITECTURE.md)
- **Rebuild Roadmap:** [`docs/architecture/VELNOX_CLEAN_REBUILD_ROADMAP.md`](file:///workspace/quiet-hopper/docs/architecture/VELNOX_CLEAN_REBUILD_ROADMAP.md)
- **Latest Report:** [`.ai/reports/LATEST.md`](file:///workspace/quiet-hopper/.ai/reports/LATEST.md)

---

## 1. Master Rebuild Sequence (Phases 0–8)
- [x] **Phase 0: Rebuild Strategy & Legacy Audit** (COMPLETED 2026-11-22)
- [x] **Phase 1: New Foundation (Monorepo, TS Config, Hono Workers Skeleton, /health)** (COMPLETED 2026-11-22)
- [x] **Phase 2: Database & Identity (Clean Schema, Web Crypto Auth, Dual Tokens, RBAC)** (COMPLETED 2026-11-22)
- [x] **Phase 3: Marketplace Core (Sellers, Shops, Categories, Products, R2 Media)** (COMPLETED 2026-11-22)
- [ ] **Phase 4: Commerce Core (Cart, Checkout, Guarded Inventory Reservations, Orders)** (NEXT ACTIVE)
- [ ] **Phase 5: Payment & Finance (Stripe Webhook, Double-Entry Ledger, Settlements)**
- [ ] **Phase 6: Frontend Integration (Pages -> Workers API, Real States, Zero Mocks)**
- [ ] **Phase 7: Realtime & Notifications (Durable Objects WebSockets, Queues, FCM)**
- [ ] **Phase 8: Quality, Security & Release (E2E Tests, OWASP Audit, Production Cutover)**

---

## 2. Invariants & Rules for All AI Agents
- **Startup Order:** `AGENTS.md` ➜ `.ai/office/QUICK_START.md` ➜ `docs/architecture/VELNOX_CANONICAL_ARCHITECTURE.md` ➜ `.ai/AI_HANDOFF.md` ➜ `.ai/reports/LATEST.md` ➜ inspect actual code.
- **Clean Rebuild Mandate:** Do not attempt to fix or migrate legacy Express routes or legacy database data. Build the clean Workers backend and clean schema.
- **Fail-Closed DB Guard:** Never test against production Neon. Tests must use `TEST_DATABASE_URL` pointing to disposable/local PostgreSQL or in-memory mock repository.
- **Financial Precision:** Integer satang minor units (`BigInt`) only. No floats. Double-entry ledger invariant: Debits == Credits.
- **Communication:** Thai language for all user-facing communication (MANDATORY).
