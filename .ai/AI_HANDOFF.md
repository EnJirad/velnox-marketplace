# Velnox AI Handoff — Current State
**Last verified:** 2026-11-22 · **Branch:** `main` · **Focus:** Velnox Website Rebuild — Milestone 3 Complete

---

## 0. Current Project State: Milestone 3 Complete (Modular Backend Core & Unified Dual-Token Auth)
- **Phase 1 (Audit & Blueprint):** COMPLETED
- **Milestone 1 (Monorepo Foundation & API Contract):** COMPLETED & VERIFIED
- **Milestone 2 (Database Migration Engine & Ledger Core):** COMPLETED & VERIFIED
- **Milestone 3 (Modular Backend Core & Unified Dual-Token Auth):** COMPLETED & VERIFIED
  - `backend/src/core/errors/`: Standard AppError class hierarchy & error codes
  - `backend/src/core/security/jwt.ts`: Pure cryptographic HS256 JWT (zero-dependency, edge-compatible)
  - `backend/src/core/security/password.ts`: scrypt password hashing & timing-safe verification
  - `backend/src/core/security/tokens.ts`: DualTokenService (Access 15m, Refresh 30d, Rotation)
  - `backend/src/core/security/turnstile.ts`: Cloudflare Turnstile bot protection verification gate
  - `backend/src/core/middleware/auth-middleware.ts`: Dual Bearer Header & Cookie auth extractor with role guard
  - `backend/src/modules/identity/`: 4-layer domain architecture (domain, repository, services, routes)
  - Automated tests: 29/29 tests passed across JWT, Password, Tokens, IdentityService, AuthMiddleware, and AuthController
  - Total automated suite across M1-M3: 47/47 tests passed
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
  - M3 Report: `.ai/rebuild/MILESTONE_3_IMPLEMENTATION_REPORT.md`
  - Latest Report: `.ai/reports/LATEST.md`

---

## 1. Next Recommended Milestone: Milestone 4
- **Milestone 4:** Commerce Core Domains (Catalog, Cart, Checkout, Inventory)
  - Refactor monolithic route files (`products.ts` 4,009 lines, `cart.ts` 2,152 lines) into modular domains
  - `backend/src/modules/catalog/`: Categories, Products, Variants, Attributes, Reviews
  - `backend/src/modules/cart/`: Cart management, Pricing pipeline integration
  - `backend/src/modules/checkout/`: Checkout groups, Multi-shop split, Idempotency keys
  - `backend/src/modules/inventory/`: 5-axis inventory state machine (on-hand, reserved, committed, fulfilled, returned) with concurrency locking (`FOR UPDATE NOWAIT`)

---

## 2. Invariants & Rules
- **Database:** Neon PostgreSQL คือ Single Source of Truth ห้ามทำลายข้อมูล ห้ามแทนที่ด้วย Cloudflare D1
- **Canonical Parity:** `db/schema.sql` และ `db/run-sqleditor.sql` ต้องสอดคล้องกันเสมอ
- **Security:** Access Token 15 นาที + Refresh Token Rotation 30 วัน + Token Reuse Detection
- **Dual Response:** Web ได้รับ `httpOnly` secure cookies ข้ามโดเมน; Mobile ได้รับ `AuthTokens` ใน Response Body ตาม API Contract
- **Financial Precision:** ทุกยอดเงินใน Ledger ต้องเป็น `bigint` Minor Satang เท่านั้น ห้ามใช้ Float
- **Language:** สื่อสารกับผู้ใช้เป็นภาษาไทยเสมอ (MANDATORY)
