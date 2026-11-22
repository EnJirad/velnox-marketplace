# Velnox AI Handoff — Current State
**Last verified:** 2026-11-22 · **Branch:** `main` · **Focus:** Clean Rebuild Initiative · Phase 0 Complete

---

## 0. Current Project State: CLEAN REBUILD INITIATIVE (PHASE 0 COMPLETE)
- **Active Initiative:** Velnox Clean Rebuild Initiative (Cloudflare-First · Clean Database)
- **Last Completed Milestone:** **Phase 0 (Rebuild Strategy & Legacy Audit)**
- **Next Active Milestone:** **Phase 1 (New Foundation — Monorepo, TypeScript, Hono Workers Skeleton, /health)**

### Approved Rebuild Directives (MANDATORY):
- **STRATEGY:** Full clean rebuild designed for Cloudflare from day one. We are NOT continuing a legacy backend migration.
- **TARGET BACKEND:** **Cloudflare Workers** (`workers/api`) running **Hono Framework** in TypeScript, Modular Monolith at `api.velnox.live`.
- **PRIMARY DATABASE:** **Neon PostgreSQL** (Permanent Single Source of Truth). Clean database schema designed from actual business requirements. Zero legacy data migration.
- **DATABASE PROVISIONING STATUS:** **BLOCKED** for production/cloud until owner creates a new dedicated Neon project. Local isolated PostgreSQL instance is used for local development and testing. Never touch or delete existing Neon databases.
- **FRONTEND HOSTING:** **Cloudflare Pages** (`shop.velnox.live`, `seller.velnox.live`, `center.velnox.live`, `velnox.live`).
- **OBJECT STORAGE:** **Cloudflare R2** via native Workers bindings (`env.R2_BUCKET`), eliminating S3 SDK overhead and egress costs. File metadata recorded in Neon.
- **REALTIME:** **Cloudflare Durable Objects** (Distributed stateful WebSockets, presence tracking, chat room pub/sub).
- **BACKGROUND PROCESSING:** **Cloudflare Queues** (Asynchronous tasks, retries, FCM notifications).
- **LEGACY CODE:** Legacy Express monolith (`backend/server.ts`) and 62-table schema (`db/schema.sql`) are **REFERENCE ONLY**. Legacy code must never be imported into Workers.

### Core Architecture Artifacts:
- **Clean Rebuild Architecture:** [`docs/architecture/VELNOX_CLEAN_REBUILD_ARCHITECTURE.md`](file:///workspace/quiet-hopper/docs/architecture/VELNOX_CLEAN_REBUILD_ARCHITECTURE.md)
- **Canonical Architecture:** [`docs/architecture/VELNOX_CANONICAL_ARCHITECTURE.md`](file:///workspace/quiet-hopper/docs/architecture/VELNOX_CANONICAL_ARCHITECTURE.md)
- **Rebuild Roadmap:** [`docs/architecture/VELNOX_CLEAN_REBUILD_ROADMAP.md`](file:///workspace/quiet-hopper/docs/architecture/VELNOX_CLEAN_REBUILD_ROADMAP.md)
- **Latest Report:** [`.ai/reports/LATEST.md`](file:///workspace/quiet-hopper/.ai/reports/LATEST.md)

---

## 1. Master Rebuild Sequence (Phases 0–8)
- [x] **Phase 0: Rebuild Strategy & Legacy Audit** (COMPLETED 2026-11-22)
- [ ] **Phase 1: New Foundation (Monorepo, TS Config, Hono Workers Skeleton, /health)** (NEXT ACTIVE)
- [ ] **Phase 2: Database & Identity (Clean Neon Schema, Migrations, Web Crypto Auth, RBAC)**
- [ ] **Phase 3: Marketplace Core (Sellers, Shops, Categories, Products, R2 Media)**
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
