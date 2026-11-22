# Velnox AI Handoff — Current State
**Last verified:** 2026-11-22 · **Branch:** `main` · **Focus:** Velnox Website Rebuild — Milestone 7 Complete

---

## 0. Current Project State: Milestone 7 Complete (Realtime Hub & Push Notifications)
- **Phase 1 (Audit & Blueprint):** COMPLETED
- **Milestone 1 (Monorepo Foundation & API Contract):** COMPLETED & VERIFIED
- **Milestone 2 (Database Migration Engine & Ledger Core):** COMPLETED & VERIFIED
- **Milestone 3 (Modular Backend Core & Unified Dual-Token Auth):** COMPLETED & VERIFIED
- **Milestone 4 (Commerce Core Domains):** COMPLETED & VERIFIED
- **Milestone 5 (Payment, Webhooks & Automated Settlement Engine):** COMPLETED & VERIFIED
- **Milestone 6 (Frontends Rebuild & Cloudflare Pages Deployment):** COMPLETED & VERIFIED
- **Milestone 7 (Realtime Hub & Push Notifications):** COMPLETED & VERIFIED
  - `backend/src/modules/realtime/`: Domain, Services, Routes
  - Scalable Realtime Pub/Sub Hub with user-level routing and multi-tab connection presence
  - Push Notification Engine with FCM support and active conversation viewing suppression
  - In-app notification persistence in database
  - Automated tests: 70/70 tests passed across 16 suites
- **Hosting Alignment (ADR-001):**
  - Cloudflare Pages (Frontend) + Cloudflare Workers (API Gateway)
  - Neon PostgreSQL: Single Source of Truth
  - Vercel: Deprecated from target architecture; `vercel.json` retained until Milestone 8 DNS cutover
- **Key Artifacts:**
  - ADR: `docs/architecture/ADR-001-cloudflare-first-hosting.md`
  - Blueprint: `.ai/rebuild/MASTER_ARCHITECTURE_BLUEPRINT.md`
  - Roadmap: `.ai/rebuild/DEVELOPMENT_ROADMAP.md`
  - Reports: `.ai/rebuild/MILESTONE_1_IMPLEMENTATION_REPORT.md` through `MILESTONE_7_IMPLEMENTATION_REPORT.md`
  - Latest Report: `.ai/reports/LATEST.md`

---

## 1. Next Recommended Milestone: Milestone 8 (FINAL CUTOVER)
- **Milestone 8:** Full E2E Integration, Production Cutover & Vercel Retirement
  - Execute full E2E test runs covering all flows (Auth, Catalog, Cart, Checkout, Stripe, Ledger, Realtime)
  - Security audit (OWASP Top 10, anti-replay, rate limiting)
  - Data reconcile audit (`verifyLedgerIntegrity`)
  - Cloudflare DNS Cutover plan & verification
  - Deprecate legacy monolithic files

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
