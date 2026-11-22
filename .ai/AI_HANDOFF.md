# Velnox AI Handoff — Current State
**Last verified:** 2026-11-22 · **Branch:** `main` · **Focus:** Velnox Website Rebuild — Milestone 6 Complete

---

## 0. Current Project State: Milestone 6 Complete (Frontends & Cloudflare Pages)
- **Phase 1 (Audit & Blueprint):** COMPLETED
- **Milestone 1 (Monorepo Foundation & API Contract):** COMPLETED & VERIFIED
- **Milestone 2 (Database Migration Engine & Ledger Core):** COMPLETED & VERIFIED
- **Milestone 3 (Modular Backend Core & Unified Dual-Token Auth):** COMPLETED & VERIFIED
- **Milestone 4 (Commerce Core Domains):** COMPLETED & VERIFIED
- **Milestone 5 (Payment, Webhooks & Automated Settlement Engine):** COMPLETED & VERIFIED
- **Milestone 6 (Frontends Rebuild & Cloudflare Pages Deployment):** COMPLETED & VERIFIED
  - Cloudflare Pages SPA Routing (`/* /index.html 200` in `public/_redirects`) configured across all 4 frontends
  - Decomposed monolithic `Center.tsx` into modular subcomponents:
    - `apps/velcenter/src/components/OverviewTab.tsx`
    - `apps/velcenter/src/components/OrdersTab.tsx`
    - `apps/velcenter/src/components/CustomerUsersTab.tsx`
    - `apps/velcenter/src/components/SettingsTab.tsx`
  - Real Stripe test credentials verified with live Stripe API (balance check, Checkout Session creation, Webhook HMAC-SHA256 signature verification)
  - Vercel configs preserved side-by-side until Milestone 8 DNS cutover
  - Automated tests: 66/66 tests passed across 15 suites
- **Hosting Alignment (ADR-001):**
  - Cloudflare Pages (Frontend) + Cloudflare Workers (API Gateway)
  - Neon PostgreSQL: Single Source of Truth
  - Vercel: Deprecated from target architecture; `vercel.json` retained until Milestone 8 DNS cutover
- **Key Artifacts:**
  - ADR: `docs/architecture/ADR-001-cloudflare-first-hosting.md`
  - Blueprint: `.ai/rebuild/MASTER_ARCHITECTURE_BLUEPRINT.md`
  - Roadmap: `.ai/rebuild/DEVELOPMENT_ROADMAP.md`
  - Reports: `.ai/rebuild/MILESTONE_1_IMPLEMENTATION_REPORT.md` through `MILESTONE_6_IMPLEMENTATION_REPORT.md`
  - Latest Report: `.ai/reports/LATEST.md`

---

## 1. Next Recommended Milestone: Milestone 7
- **Milestone 7:** Realtime Hub & Push Notifications
  - WebSocket gateway migration towards Cloudflare Durable Objects
  - Push notifications dispatch pipeline for mobile apps via FCM
  - Channel subscriptions: order tracking updates, chat messages, stock movements

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
