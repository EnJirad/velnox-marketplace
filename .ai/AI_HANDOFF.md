# Velnox AI Handoff — Current State
**Last verified:** 2026-11-22 · **Branch:** `main` · **Focus:** Clean Rebuild Initiative · Phase 2 Complete

---

## 0. Current Project State: CLEAN REBUILD INITIATIVE (PHASE 2 COMPLETE)
- **Active Initiative:** Velnox Clean Rebuild Initiative (Cloudflare-First · Clean Database)
- **Last Completed Milestone:** **Phase 2 (Database & Identity — Clean Schema, Web Crypto Auth, Dual Tokens, RBAC)**
- **Next Active Milestone:** **Phase 3 (Marketplace Core — Sellers, Shops, Categories, Products, R2 Media)**

### Approved Rebuild Directives (MANDATORY):
- **STRATEGY:** Full clean rebuild designed for Cloudflare from day one. We are NOT continuing a legacy backend migration.
- **TARGET BACKEND:** **Cloudflare Workers** (`workers/api`) running **Hono Framework** in TypeScript, Modular Monolith at `api.velnox.live`.
- **DATABASE CONNECTIVITY:** Cloudflare Workers connects to Neon PostgreSQL via `@neondatabase/serverless` over WebSockets/HTTP.
- **CLEAN IDENTITY SCHEMA:** Production migration `0001_identity.sql` established with `users`, `auth_identities`, and `refresh_tokens`. Strict UUIDs, check constraints, indexes, and UTC timestamps. Zero legacy schema baggage.
- **SECURITY ARCHITECTURE:** Pure Web Crypto API implementations for HS256 JWT, PBKDF2 password hashing (100k iterations, SHA-256), and timing-safe equality. Dual tokens: 15-min Access Token + 7-day Refresh Token with Refresh Token Rotation.
- **COOKIES & SESSIONS:** HttpOnly, Secure, SameSite=None session and refresh cookies for web; Authorization header tokens for mobile clients.
- **DATABASE PROVISIONING STATUS:** Cloud Neon project can be pointed via `DATABASE_URL`. Testing uses isolated database or in-memory repository to guarantee production safety.
- **FRONTEND HOSTING:** **Cloudflare Pages** (`shop.velnox.live`, `seller.velnox.live`, `center.velnox.live`, `velnox.live`).
- **STORAGE:** **Cloudflare R2** via native Workers bindings (`env.R2_BUCKET`), eliminating S3 SDK overhead.

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
- [ ] **Phase 3: Marketplace Core (Sellers, Shops, Categories, Products, R2 Media)** (NEXT ACTIVE)
- [ ] **Phase 4: Commerce Core (Cart, Checkout, Guarded Inventory Reservations, Orders)**
- [ ] **Phase 5: Payment & Finance (Stripe Webhook, Double-Entry Ledger, Settlements)**
- [ ] **Phase 6: Frontend Integration (Pages -> Workers API, Real States, Zero Mocks)**
- [ ] **Phase 7: Realtime & Notifications (Durable Objects WebSockets, Queues, FCM)**
- [ ] **Phase 8: Quality, Security & Release (E2E Tests, OWASP Audit, Production Cutover)**

---

## 2. Invariants & Rules for All AI Agents
- **Startup Order:** `AGENTS.md` ➜ `.ai/office/QUICK_START.md` ➜ `docs/architecture/VELNOX_CANONICAL_ARCHITECTURE.md` ➜ `.ai/AI_HANDOFF.md` ➜ `.ai/reports/LATEST.md` ➜ inspect actual code.
- **Clean Rebuild Mandate:** Do not attempt to fix or migrate legacy Express routes or legacy database data. Build the clean Workers backend and clean schema.
- **Fail-Closed DB Guard:** Never test against production Neon. Tests must use `TEST_DATABASE_URL` pointing to disposable/local PostgreSQL.
- **Financial Precision:** Integer satang minor units (`BigInt`) only. No floats. Double-entry ledger invariant: Debits == Credits.
- **Communication:** Thai language for all user-facing communication (MANDATORY).
