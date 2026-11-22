# Velnox AI Handoff — Current State
**Last verified:** 2026-11-22 · **Branch:** `main` · **Focus:** Velnox Website Rebuild — Milestone 2 Complete

---

## 0. Current Project State: Milestone 2 Complete (Database Migration Engine & Ledger Core)
- **Phase 1 (Audit & Blueprint):** COMPLETED
- **Milestone 1 (Monorepo Foundation & API Contract):** COMPLETED & VERIFIED
- **Milestone 2 (Database Migration Engine & Ledger Core):** COMPLETED & VERIFIED
  - `database/migrations/0001_initial_schema.sql`: Authoritative initial schema matching canonical `db/schema.sql`
  - `database/src/migrator.ts` & `database/migrate.ts`: Anti-tampering SHA-256 checksum migration runner with atomic transaction rollback
  - `@velnox/ledger`: Double-entry accounting package with strict mathematical balance invariants, satang `bigint` precision, and zero-float guarantee
  - `backend/src/core/ledger/ledger-service.ts`: Atomic PostgreSQL transaction persistence service with idempotent deduplication (`23505`)
  - Test verification: 18/18 tests passed across `@velnox/ledger`, `Migrator`, and `LedgerService`
- **Hosting Alignment (ADR-001):**
  - Cloudflare Pages (Frontend) + Cloudflare Workers (API Gateway)
  - Neon PostgreSQL: Single Source of Truth
  - Vercel: Deprecated from target architecture; `vercel.json` retained until Milestone 8 DNS cutover
- **Key Artifacts:**
  - ADR: `docs/architecture/ADR-001-cloudflare-first-hosting.md`
  - Blueprint: `.ai/rebuild/MASTER_ARCHITECTURE_BLUEPRINT.md`
  - Roadmap: `.ai/rebuild/DEVELOPMENT_ROADMAP.md`
  - M1 Report: `.ai/rebuild/MILESTONE_1_IMPLEMENTATION_REPORT.md`
  - M2 Report: `.ai/rebuild/MILESTONE_2_IMPLEMENTATION_REPORT.md`
  - Latest Report: `.ai/reports/LATEST.md`

---

## 1. Next Recommended Milestone: Milestone 3
- **Milestone 3:** Modular Backend Core & Unified Dual-Token Auth
  - Transition backend architecture towards Modular Monolith structure (`backend/src/core/`, `backend/src/modules/identity/`)
  - Unified Authentication supporting both Web (httpOnly Cookie) and Mobile (Bearer Token + Refresh Token Rotation)
  - Cloudflare Turnstile bot protection gate & Distributed token revocation
  - CSRF Origin Guard and Rate Limiting

---

## 2. Invariants & Rules
- **Database:** Neon PostgreSQL คือ Single Source of Truth ห้ามทำลายข้อมูล ห้ามแทนที่ด้วย Cloudflare D1
- **Canonical Parity:** `db/schema.sql` และ `db/run-sqleditor.sql` ต้องสอดคล้องกันเสมอ
- **Financial Precision:** ทุกยอดเงินใน Ledger ต้องเป็น `bigint` Minor Satang เท่านั้น ห้ามใช้ Float
- **Double-Entry:** ทุกธุรกรรมต้องมีผลรวมเดบิตเท่ากับผลรวมเครดิตเสมอ ($\sum \text{Debits} == \sum \text{Credits}$)
- **Language:** สื่อสารกับผู้ใช้เป็นภาษาไทยเสมอ (MANDATORY)
