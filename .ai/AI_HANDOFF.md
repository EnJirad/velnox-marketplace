# Velnox AI Handoff — Current State
**Last verified:** 2026-11-22 · **Branch:** `main` · **Focus:** Velnox Website Rebuild — Milestone 4 Complete

---

## 0. Current Project State: Milestone 4 Complete (Commerce Core Domains)
- **Phase 1 (Audit & Blueprint):** COMPLETED
- **Milestone 1 (Monorepo Foundation & API Contract):** COMPLETED & VERIFIED
- **Milestone 2 (Database Migration Engine & Ledger Core):** COMPLETED & VERIFIED
- **Milestone 3 (Modular Backend Core & Unified Dual-Token Auth):** COMPLETED & VERIFIED
- **Milestone 4 (Commerce Core Domains):** COMPLETED & VERIFIED
  - `backend/src/modules/catalog/`: Hierarchical Category Tree (96 categories) & Product Catalog
  - `backend/src/modules/inventory/`: Concurrency-guarded conditional update reservation & movement audit log
  - `backend/src/modules/cart/`: Multi-shop item grouping with exact satang `bigint` calculations
  - `backend/src/modules/checkout/`: Multi-shop order splitting under `checkout_groups`, fixed 30-minute reservation deadline, and idempotent replay
  - Automated tests: 10/10 tests passed across Commerce Core (57/57 tests passed across all milestones)
- **Hosting Alignment (ADR-001):**
  - Cloudflare Pages (Frontend) + Cloudflare Workers (API Gateway)
  - Neon PostgreSQL: Single Source of Truth
  - Vercel: Deprecated from target architecture; `vercel.json` retained until Milestone 8 DNS cutover
- **Key Artifacts:**
  - ADR: `docs/architecture/ADR-001-cloudflare-first-hosting.md`
  - Blueprint: `.ai/rebuild/MASTER_ARCHITECTURE_BLUEPRINT.md`
  - Roadmap: `.ai/rebuild/DEVELOPMENT_ROADMAP.md`
  - Reports: `.ai/rebuild/MILESTONE_1_IMPLEMENTATION_REPORT.md` through `MILESTONE_4_IMPLEMENTATION_REPORT.md`
  - Latest Report: `.ai/reports/LATEST.md`

---

## 1. Next Recommended Milestone: Milestone 5
- **Milestone 5:** Payment, Webhooks & Automated Settlement Engine
  - Refactor monolithic `stripe.ts` (3,122 lines) into `backend/src/modules/payment/`
  - Stripe Checkout Session creation, PromptPay QR, Credit Card
  - Raw body signature-verified webhook processing with replay protection
  - Automated Settlement Engine: integrating double-entry ledger postings (`@velnox/ledger` & `LedgerService`) on payment settlement and seller payouts
  - Order cancellation and stock release coordinator (`releaseOrderInventory`)

---

## 2. Invariants & Rules
- **Database:** Neon PostgreSQL คือ Single Source of Truth ห้ามทำลายข้อมูล ห้ามแทนที่ด้วย Cloudflare D1
- **Canonical Parity:** `db/schema.sql` และ `db/run-sqleditor.sql` ต้องสอดคล้องกันเสมอ
- **Inventory Concurrency:** การตัดสต็อกต้องใช้ Conditional Guarded UPDATE เพื่อป้องกัน Overselling
- **Checkout Idempotency:** การส่ง Idempotency Key ซ้ำต้องคืนค่าผลลัพธ์เดิมโดยไม่สร้างออเดอร์หรือตัดสต็อกซ้ำ
- **Reservation Window:** ระยะเวลาจองสต็อกคงที่ 30 นาที (`payment_expires_at = NOW() + 30 min`) จาก Server Clock เท่านั้น
- **Financial Precision:** ทุกยอดเงินต้องคำนวณด้วย `bigint` Minor Satang เท่านั้น ห้ามใช้ Float
- **Language:** สื่อสารกับผู้ใช้เป็นภาษาไทยเสมอ (MANDATORY)
