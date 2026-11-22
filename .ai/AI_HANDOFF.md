# Velnox AI Handoff — Current State
**Last verified:** 2026-11-22 · **Branch:** `main` · **Focus:** Velnox Website Rebuild — Architecture Alignment & Milestone 1 Verified

---

## 0. Current Project State: Milestone 1 Verified & Cloudflare Aligned
- **Phase 1 (Audit & Blueprint):** COMPLETED
- **Milestone 1 (Monorepo Foundation & API Contract):** VERIFIED & COMPLETED
  - `@velnox/shared/src/index.ts`: Public entry point with extensionless imports
  - `@velnox/config`: TypeScript base configs and platform constants
  - `@velnox/validation`: Zod schemas and validation primitives (tests passing)
  - `@velnox/api-contract`: v1 domain contracts and OpenAPI 3.1.0 generator (tests passing)
  - `@velnox/api-client`: Type-safe isomorphic client with envelope unwrapping (tests passing)
  - Quality gate test suite: `backend/tests/packages-contracts.test.ts` (passing)
- **Architecture Alignment (ADR-001):** COMPLETED
  - Cloudflare Pages: Target frontend hosting for all 4 apps (`shop.velnox.live`, `seller.velnox.live`, `center.velnox.live`, `velnox.live`)
  - Cloudflare Workers: Target backend API runtime (`api.velnox.live`)
  - Cloudflare R2: Media and object storage (Native bindings)
  - Neon PostgreSQL: Single Source of Truth (D1 rejected for core DB)
  - Vercel Deprecation Policy: Removed from target architecture; `vercel.json` retained safely until Milestone 8 DNS cutover
- **CI Test Status Classification:**
  - `Typecheck apps and backend`: PRE-EXISTING baseline failure (legacy apps/backend type errors)
  - `Reconciler behaviour (idempotency, cases A–I)`: PRE-EXISTING baseline failure
  - `backend/tests` unit test failures: PRE-EXISTING baseline failure (missing VBadge, preauth isolation)
  - Milestone 1 Introduced failures: ZERO (all new packages pass typecheck and unit tests cleanly)
- **Key Artifacts:**
  - ADR: `docs/architecture/ADR-001-cloudflare-first-hosting.md`
  - Blueprint: `.ai/rebuild/MASTER_ARCHITECTURE_BLUEPRINT.md`
  - Roadmap: `.ai/rebuild/DEVELOPMENT_ROADMAP.md`
  - Audit Report: `.ai/rebuild/MASTER_AUDIT_REPORT.md`
  - Milestone 1 Report: `.ai/rebuild/MILESTONE_1_IMPLEMENTATION_REPORT.md`
  - Latest Report: `.ai/reports/LATEST.md`

---

## 1. Next Recommended Milestone: Milestone 2
- **Milestone 2:** Versioned Database Migration Engine & Ledger Core
  - Setup version-controlled database migrations (`database/migrations/`)
  - Verify and validate the 62 tables on Neon PostgreSQL
  - Double-entry ledger core invariants and idempotency keys
  - **Note:** Do NOT start Milestone 2 prematurely until instructed.

---

## 2. Invariants & Rules
- **Database:** Neon PostgreSQL คือ Single Source of Truth ห้ามทำลายข้อมูล ห้ามแทนที่ด้วย Cloudflare D1
- **Hosting Target:** Cloudflare Pages (Frontend) + Cloudflare Workers (API)
- **Vercel Policy:** ห้ามลบ `vercel.json` หรือการตั้งค่าโปรดักชันเดิมจนกว่าจะถึงขั้นตอน Milestone 8 DNS Cutover
- **Monorepo:** รักษาความเข้ากันได้ของ Bun Workspaces และ `bun.lock`
- **API First:** ทุก Endpoint ต้องมี Contract รองรับทั้ง Web และ Mobile
- **Language:** สื่อสารกับผู้ใช้เป็นภาษาไทยเสมอ (MANDATORY)
