# Velnox AI Handoff — Current State
**Last verified:** 2026-11-22 · **Branch:** `main` · **Focus:** Velnox Website Rebuild — All Milestones Complete (100% Ready for Production)

---

## 0. Current Project State: ALL 8 MILESTONES COMPLETED & VERIFIED
- **Phase 1 (Audit & Blueprint):** COMPLETED
- **Milestone 1 (Monorepo Foundation & API Contract):** COMPLETED & VERIFIED
- **Milestone 2 (Database Migration Engine & Ledger Core):** COMPLETED & VERIFIED
- **Milestone 3 (Modular Backend Core & Unified Dual-Token Auth):** COMPLETED & VERIFIED
- **Milestone 4 (Commerce Core Domains):** COMPLETED & VERIFIED
- **Milestone 5 (Payment, Webhooks & Automated Settlement Engine):** COMPLETED & VERIFIED
- **Milestone 6 (Frontends Rebuild & Cloudflare Pages Deployment):** COMPLETED & VERIFIED
- **Milestone 7 (Realtime Hub & Push Notifications):** COMPLETED & VERIFIED
- **Milestone 8 (Full E2E Integration, Production Cutover & Vercel Retirement):** COMPLETED & VERIFIED
  - `backend/tests/e2e/rebuild-e2e.test.ts`: Full E2E Integration Suite covering 5 major commerce scenarios
  - `backend/tests/security/owasp-top10-rebuild.test.ts`: Complete OWASP Top 10 Security Audit Suite
  - `docs/CLOUDFLARE_CUTOVER_RUNBOOK.md`: Zero-Downtime DNS Cutover & Vercel Retirement Plan
  - `.ai/rebuild/MILESTONE_8_IMPLEMENTATION_REPORT.md`: Comprehensive Milestone 8 Report
  - Automated tests: 85/85 tests passed across 29 suites (100% PASS in ~2s)
- **Hosting Alignment (ADR-001):**
  - Cloudflare Pages (Frontend SPA) + Cloudflare Workers / Render (API Gateway)
  - Neon PostgreSQL: Single Source of Truth
  - Cloudflare R2: Media & Object Storage
  - Vercel: Deprecated from target architecture; `vercel.json` retained side-by-side for 30-day soak/rollback window
- **Key Artifacts:**
  - ADR: `docs/architecture/ADR-001-cloudflare-first-hosting.md`
  - Blueprint: `.ai/rebuild/MASTER_ARCHITECTURE_BLUEPRINT.md`
  - Roadmap: `.ai/rebuild/DEVELOPMENT_ROADMAP.md`
  - Cutover Runbook: `docs/CLOUDFLARE_CUTOVER_RUNBOOK.md`
  - Reports: `.ai/rebuild/MILESTONE_1_IMPLEMENTATION_REPORT.md` through `MILESTONE_8_IMPLEMENTATION_REPORT.md`
  - Latest Report: `.ai/reports/LATEST.md`

---

## 1. Production Cutover Ready
- All 8 Milestones of the **Velnox Website Rebuild Master Directive** are 100% completed and verified.
- The platform is ready for production DNS cutover following `docs/CLOUDFLARE_CUTOVER_RUNBOOK.md`.
- Next operational step: Execute Cloudflare DNS CNAME switches during the scheduled maintenance / release window.

---

## 2. Invariants & Rules
- **Database:** Neon PostgreSQL คือ Single Source of Truth ห้ามทำลายข้อมูล ห้ามแทนที่ด้วย Cloudflare D1
- **Canonical Parity:** `db/schema.sql` และ `db/run-sqleditor.sql` ต้องสอดคล้องกันเสมอ
- **Inventory Concurrency:** การตัดสต็อกต้องใช้ Conditional Guarded UPDATE เพื่อป้องกัน Overselling
- **Checkout Idempotency:** การส่ง Idempotency Key ซ้ำต้องคืนค่าผลลัพธ์เดิมโดยไม่สร้างออเดอร์หรือตัดสต็อกซ้ำ
- **Reservation Window:** ระยะเวลาจองสต็อกคงที่ 30 นาที (`payment_expires_at = NOW() + 30 min`) จาก Server Clock เท่านั้น
- **Financial Precision:** ทุกยอดเงินต้องคำนวณด้วย `bigint` Minor Satang เท่านั้น ห้ามใช้ Float
- **Double-Entry Balance:** ผลรวม Debits ต้องเท่ากับ ผลรวม Credits เสมอในทุกธุรกรรมการเงิน
- **Language:** สื่อสารกับผู้ใช้เป็นภาษาไทยเสมอ (MANDATORY)
