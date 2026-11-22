# Velnox AI Handoff — Current State
**Last verified:** 2026-11-22 · **Branch:** `main` · **Focus:** Architecture Truth Reset & Cloudflare-First Alignment Complete (CF-0)

---

## 0. Current Project State: ARCHITECTURE TRUTH RESET COMPLETE (CF-0)
- **Active Focus:** Cloudflare Migration Roadmap (CF-0 through CF-11)
- **Last Completed Milestone:** **CF-0 (Architecture Truth Reset & Documentation Alignment)**
- **Next Active Milestone:** **CF-1 (Cloudflare Workers Foundation — Hono + TypeScript)**

### Canonical Architecture Directives (MANDATORY):
- **TARGET BACKEND:** **Cloudflare Workers** (Hono Framework, TypeScript, Modular Monolith, Web Standards Fetch API).
- **PRIMARY DATABASE:** **Neon PostgreSQL** (Permanent Single Source of Truth — 62 tables, ACID ledger, conditional stock guards). Workers connects to Neon via `@neondatabase/serverless` over WebSockets/HTTP. Never replace Neon with D1, MongoDB, or Supabase.
- **FRONTEND HOSTING:** **Cloudflare Pages** (`shop.velnox.live`, `seller.velnox.live`, `center.velnox.live`, `velnox.live`). Static SPA Vite bundles with `_redirects`.
- **OBJECT STORAGE:** **Cloudflare R2** (Zero egress media storage with native Worker bindings).
- **REALTIME:** **Cloudflare Durable Objects** (Distributed stateful WebSockets, presence tracking, room pub/sub).
- **BACKGROUND JOBS:** **Cloudflare Queues** (Asynchronous tasks, retries, FCM notifications).
- **RENDER:** **LEGACY BACKEND INFRASTRUCTURE DURING MIGRATION — NOT THE TARGET ARCHITECTURE**.
- **VERCEL:** **LEGACY FRONTEND INFRASTRUCTURE DURING MIGRATION — NOT THE TARGET ARCHITECTURE**.

### Core Architecture Artifacts:
- **Canonical Architecture:** [`docs/architecture/VELNOX_CANONICAL_ARCHITECTURE.md`](file:///workspace/quiet-hopper/docs/architecture/VELNOX_CANONICAL_ARCHITECTURE.md)
- **Migration Roadmap:** [`docs/architecture/CLOUDFLARE_MIGRATION_ROADMAP.md`](file:///workspace/quiet-hopper/docs/architecture/CLOUDFLARE_MIGRATION_ROADMAP.md)
- **Cutover Runbook:** [`docs/CLOUDFLARE_CUTOVER_RUNBOOK.md`](file:///workspace/quiet-hopper/docs/CLOUDFLARE_CUTOVER_RUNBOOK.md)
- **Latest Report:** [`.ai/reports/LATEST.md`](file:///workspace/quiet-hopper/.ai/reports/LATEST.md)
- **Smoke Test Tool:** [`scripts/verify-cutover.ts`](file:///workspace/quiet-hopper/scripts/verify-cutover.ts) (`bun run cutover:verify`)

---

## 1. Cloudflare Migration Sequence (CF-0 to CF-11)
- [x] **CF-0: Architecture Truth & Infrastructure Inventory** (COMPLETED)
- [ ] **CF-1: Cloudflare Workers Foundation (Hono, Types, Config)** (NEXT ACTIVE)
- [ ] **CF-2: Neon Connectivity (@neondatabase/serverless)**
- [ ] **CF-3: Identity & Dual-Token Authentication on Workers**
- [ ] **CF-4: Catalog & Read-Only APIs (KV Cache)**
- [ ] **CF-5: Commerce Write APIs (Cart, Checkout, Guarded Inventory)**
- [ ] **CF-6: Payments, Stripe Webhooks & Financial Ledger**
- [ ] **CF-7: Cloudflare R2 Native Bindings Migration**
- [ ] **CF-8: Durable Objects Realtime Hub & Queues**
- [ ] **CF-9: Frontend Cloudflare Pages Alignment**
- [ ] **CF-10: Full Staging Verification & Security Audit**
- [ ] **CF-11: Production Cutover & Legacy Retirement** (Requires Owner Authorization)

---

## 2. Invariants & Rules for All AI Agents
- **Startup Order:** `AGENTS.md` ➜ `.ai/office/QUICK_START.md` ➜ `docs/architecture/VELNOX_CANONICAL_ARCHITECTURE.md` ➜ `.ai/AI_HANDOFF.md` ➜ `.ai/reports/LATEST.md` ➜ inspect actual code.
- **Render Rule:** Never assume Render is the target backend. If working on legacy code on Render, do not silently extend it as if it were permanent.
- **Database Safety:** Neon PostgreSQL is Single Source of Truth. The fail-closed database guard (`backend/db/test-database.ts`) protects production. Never test against production.
- **Financial Precision:** BigInt satang minor units only. No floats. Double-entry ledger invariant: Debits == Credits.
- **Communication:** Thai language for all user-facing communication (MANDATORY).
