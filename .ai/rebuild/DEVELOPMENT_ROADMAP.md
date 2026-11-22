# Velnox Marketplace — Master Development Roadmap
**Version:** 3.0.0  
**Date:** 2026-11-22  
**Status:** ACTIVE  

---

## Roadmap Overview (แผนการพัฒนาระยะยาว)

แผนการพัฒนา Velnox Marketplace แบ่งออกเป็น 2 ช่วงหลักอย่างชัดเจน:
1. **Node.js Modular Core Rebuild (Milestones 1–8):** สลายโค้ดเดิมสู่ Modular Monolith, สร้าง Shared Packages, ระบบบัญชีคู่, ตรวจสอบ Invariants และเขียน E2E/Security Test Suites (เสร็จสิ้นสมบูรณ์ 100%)
2. **Cloudflare-First Target Migration (Roadmap CF-0 ถึง CF-11):** ย้ายการโฮสต์และรันไทม์สู่ Cloudflare Pages, Cloudflare Workers (Hono), Cloudflare R2, และ Cloudflare Durable Objects โดยมี Neon PostgreSQL เป็น Single Source of Truth ถาวร (อ้างอิง: `docs/architecture/CLOUDFLARE_MIGRATION_ROADMAP.md`)

```
[ Phase 1: Audit & Blueprint ] ──────────────────────────────────────────► (COMPLETED)
           │
           ▼
[ Node.js Modular Core Rebuild (Milestones 1–8) ] ───────────────────────► (COMPLETED & VERIFIED)
 • M1: Monorepo Foundation & API Contracts Package                         (COMPLETED)
 • M2: Versioned Database Migrations & Ledger Core                         (COMPLETED)
 • M3: Modular Backend Core & Unified Dual-Token Auth                      (COMPLETED)
 • M4: Commerce Core Domains (Catalog, Cart, Checkout, Inventory)          (COMPLETED)
 • M5: Payment, Webhooks & Automated Settlement Engine                     (COMPLETED)
 • M6: Frontend SPA Modularization & _redirects Routing                    (COMPLETED)
 • M7: Realtime Hub Core (In-memory) & Honest FCM Architecture             (COMPLETED)
 • M8: Full E2E Integration Suite & OWASP Top 10 Security Audit            (COMPLETED)
           │
           ▼
[ Cloudflare Migration Roadmap (CF-0 to CF-11) ] ────────────────────────► (IN PROGRESS)
 • CF-0: Architecture Truth Reset & Documentation Alignment                (COMPLETED)
 • CF-1: Cloudflare Workers Foundation (Hono + TypeScript)                 (NEXT ACTIVE)
 • CF-2: Neon Connectivity via @neondatabase/serverless                   (PLANNED)
 • CF-3: Authentication on Workers Runtime                                 (PLANNED)
 • CF-4: Catalog Read APIs & KV Cache                                      (PLANNED)
 • CF-5: Commerce Write APIs & Guarded Inventory                          (PLANNED)
 • CF-6: Payments & Ledger on Workers                                      (PLANNED)
 • CF-7: Cloudflare R2 Native Bindings                                    (PLANNED)
 • CF-8: Realtime Durable Objects & Cloudflare Queues                     (PLANNED)
 • CF-9: Frontend Cloudflare Pages Staging Deployment                     (PLANNED)
 • CF-10: Full Staging Security & Load Verification                        (PLANNED)
 • CF-11: Production Cutover & Vercel/Render Retirement (Owner Authorized) (PLANNED)
```

---

## Detailed Milestones & Tasks

### Milestone 1: Monorepo Foundation & API Contract Package (COMPLETED)
- **Status:** COMPLETED (2026-11-22)
- **Objective:** ปรับโครงสร้าง Monorepo สร้าง Package กลางสำหรับ Shared Types, Zod Schemas, API Contract (OpenAPI) และ UI System
- **Key Modules/Files:**
  - `packages/shared/src/index.ts` (Entry point resolved)
  - `packages/config` (@velnox/config)
  - `packages/validation` (@velnox/validation)
  - `packages/api-contract` (@velnox/api-contract & OpenAPI 3.1 generator)
  - `packages/api-client` (@velnox/api-client)
- **Dependencies:** None
- **Acceptance Criteria:** Typecheck และ Contract Tests ผ่าน 100%, Packages เชื่อมโยงใน Monorepo สำเร็จ
- **Risk:** Low (Completed)

### Milestone 2: Versioned Database Migration Engine & Ledger Core (COMPLETED)
- **Status:** COMPLETED (2026-11-22)
- **Objective:** แปลงระบบฐานข้อมูลจากการรันสคริปต์มือ `run-sqleditor.sql` สู่ระบบ Automated Migration Scripts ที่มีหมายเลขเวอร์ชันและ Checksum พร้อมสร้าง Double-Entry Ledger Core
- **Key Modules/Files:**
  - `database/migrations/0001_initial_schema.sql`
  - `database/src/migrator.ts` & `database/migrate.ts`
  - `packages/ledger` (@velnox/ledger)
  - `backend/src/core/ledger/ledger-service.ts`
  - Automated tests (18 tests passed)
- **Dependencies:** Milestone 1
- **Acceptance Criteria:** Checksum verification, transaction atomicity, double-entry mathematical invariants passed 100%
- **Risk:** Low (Completed without modifying production DB)

### Milestone 3: Modular Backend Core & Unified Dual-Token Auth (COMPLETED)
- **Status:** COMPLETED (2026-11-22)
- **Objective:** สร้างโครงสร้าง Modular Monolith Backend พร้อมระบบ Authentication ใหม่ที่รองรับทั้ง Web (Cookie) และ Mobile (Bearer Token + Refresh Token Rotation)
- **Key Modules/Files:**
  - `backend/src/core/errors/` & `backend/src/core/security/` (Pure HS256 JWT, scrypt password hashing, Turnstile bot gate)
  - `backend/src/core/middleware/auth-middleware.ts` (Dual Bearer / Cookie extractor, role guard)
  - `backend/src/modules/identity/` (UserRepository, TokenRepository, IdentityService, AuthController)
  - Automated tests (29 tests passed)
- **Dependencies:** Milestone 1, Milestone 2
- **Acceptance Criteria:** Dual Tokens (Access 15m + Refresh 30d), Refresh Token Rotation, Dual Response (Cookie for Web, Body for Mobile) ผ่านการทดสอบ 100%
- **Risk:** Low (Completed)

### Milestone 4: Commerce Core Domains (Catalog, Cart, Checkout, Inventory) (COMPLETED)
- **Status:** COMPLETED (2026-11-22)
- **Objective:** สลาย Route ยักษ์ `products.ts` (4,009 บรรทัด) และ `cart.ts` (2,152 บรรทัด) ออกเป็น Modular Domains
- **Key Modules/Files:**
  - `backend/src/modules/catalog/` (Category Tree, Product Listing & Detail)
  - `backend/src/modules/inventory/` (Atomic Guarded Stock Reservation & Movement Audit)
  - `backend/src/modules/cart/` (Multi-shop Item Grouping, Exact Minor Totals)
  - `backend/src/modules/checkout/` (Checkout Groups, Multi-shop Split, 30-min Deadline, Idempotent Replay)
  - Automated tests (10 tests passed, total 57 tests passed)
- **Dependencies:** Milestone 3
- **Acceptance Criteria:** แยกหมวดหมู่สินค้าชัดเจน สต็อกสินค้าแยกมิติป้องกัน Race Condition ทดสอบ Concurrency และ Idempotency ผ่าน 100%
- **Risk:** Low (Completed)

### Milestone 5: Payment, Webhooks & Automated Settlement Engine (COMPLETED)
- **Status:** COMPLETED (2026-11-22)
- **Objective:** ปรับปรุงโมดูล `stripe.ts` (3,122 บรรทัด) และระบบการเงินให้มี Idempotency และตรวจสอบความถูกต้องย้อนหลังได้ 100%
- **Key Modules/Files:**
  - `backend/src/modules/payment/` (Domain, Repository, Services, Routes)
  - `backend/src/modules/ledger/` (Double-entry Ledger integration, account balance & integrity audit)
  - Webhook processing with raw body HMAC-SHA256 signature validation & replay protection
  - Automated Settlement Engine & Inventory Commit/Release coordination
  - Automated tests (9 tests passed, total 66 tests passed)
- **Dependencies:** Milestone 4
- **Acceptance Criteria:** คำสั่งซื้อซ้ำหรือ Webhook ซ้ำต้องไม่หักเงินซ้ำ ยอดเงินและคอมมิชชันใน Ledger ตรงกับ Statement จริง
- **Risk:** Low (Completed)

### Milestone 6: Frontends Rebuild & Cloudflare Pages Deployment (COMPLETED)
- **Status:** COMPLETED (2026-11-22)
- **Objective:** ปรับปรุง Frontend Applications (VelShop, VelSeller, VelCenter) ให้เชื่อมต่อกับ API Contract ใหม่, แยกโมดูล `Center.tsx` (2,384 บรรทัด) ออกเป็นโมดูลย่อย, และจัดเตรียมการ Deploy สู่ **Cloudflare Pages Static Hosting** พร้อมระบบ SPA Routing (`/* /index.html 200`)
- **Key Modules/Files:**
  - `apps/velshop/public/_redirects` (`shop.velnox.live`)
  - `apps/velseller/public/_redirects` (`seller.velnox.live`)
  - `apps/velcenter/public/_redirects` (`center.velnox.live`)
  - `apps/velnox/public/_redirects` (`velnox.live`)
  - `apps/velcenter/src/components/OverviewTab.tsx`
  - `apps/velcenter/src/components/OrdersTab.tsx`
  - `apps/velcenter/src/components/CustomerUsersTab.tsx`
  - `apps/velcenter/src/components/SettingsTab.tsx`
  - `apps/velcenter/src/pages/Center.tsx` (Decomposed)
- **Dependencies:** Milestone 4, Milestone 5
- **Acceptance Criteria:** หน้าจอโหลดเร็วระดับ Edge, Responsive สมบูรณ์, รองรับภาษา TH/EN/MY, Preview Deployments บน Cloudflare Pages ทำงานได้ 100% โดยคง Vercel เดิมไว้ขนานกัน
- **Risk:** Low (Completed)

### Milestone 7: Realtime Hub Domain & Push Notification Architecture (COMPLETED IN NODE)
- **Status:** COMPLETED (2026-11-22) — *Durable Objects migration scheduled under CF-8*
- **Objective:** สร้าง Realtime Hub Core (in-memory pub/sub, presence tracking, thread viewing presence) และสถาปัตยกรรม FCM Notification (พร้อมการรายงานสถานะจริง `blocked_missing_credentials`)
- **Key Modules/Files:**
  - `backend/src/modules/realtime/domain/realtime.ts` (Channels & Envelopes)
  - `backend/src/modules/realtime/services/realtime-hub.ts` (Pub/Sub & Presence Tracking)
  - `backend/src/modules/realtime/services/push-notification-service.ts` (FCM HTTP v1 & DB Persistence)
  - `backend/src/modules/realtime/routes/realtime-routes.ts` (Health & Dispatch API)
  - Automated tests (6 tests passed in `realtime-hub.test.ts`)
- **Dependencies:** Milestone 6
- **Acceptance Criteria:** Presence tracking ทำงานถูกต้องข้ามหลายแท็บ, ตัดการเชื่อมต่อและทำลาย state ได้สมบูรณ์, ระงับ push เมื่อกำลังดูแชท, รายงานสถานะ FCM ตามจริง
- **Target Architecture Note:** ในระยะยาว Realtime Hub จะถูกย้ายจาก in-memory Map สู่ Cloudflare Durable Objects ในขั้นตอน CF-8
- **Risk:** Low (Completed in Node.js core)

### Milestone 8: Full E2E Integration Suite & OWASP Top 10 Security Audit (COMPLETED)
- **Status:** COMPLETED (2026-11-22) — *Live DNS Cutover scheduled under CF-11*
- **Objective:** สร้างชุดทดสอบ E2E Integration Suite ครอบคลุม 5 วงจรธุรกิจหลัก, ตรวจสอบความปลอดภัยตามกรอบ OWASP Top 10, ตรวจสอบ Invariant ทางการเงินและสต็อกสินค้า และจัดทำ Runbook สำหรับการ Cutover
- **Key Modules/Files:**
  - `backend/tests/e2e/rebuild-e2e.test.ts` (Full E2E Integration Test Suite covering 5 scenarios)
  - `backend/tests/security/owasp-top10-rebuild.test.ts` (OWASP Top 10 Security Audit Suite)
  - `docs/CLOUDFLARE_CUTOVER_RUNBOOK.md` (Zero-Downtime DNS Cutover & Vercel/Render Retirement Plan)
  - `scripts/verify-cutover.ts` (Automated Synthetic Smoke Test tool)
  - Automated tests (87/87 tests passed across 29 suites with 100% PASS)
- **Dependencies:** All previous rebuild milestones
- **Acceptance Criteria:** E2E tests ผ่าน 100%, OWASP Top 10 ผ่าน 100%, Concurrency load benchmark ผ่าน 0 errors (สูงสุด 389.1 RPS)
- **Target Architecture Note:** แผน Cutover และการปลดระวาง Vercel/Render ถูกเตรียมพร้อมไว้ใน Runbook โดยการสลับ DNS สู่ Cloudflare Pages และ Workers จะเกิดขึ้นในขั้นตอน CF-11 หลังได้รับอนุมัติจากเจ้าของโครงการ
- **Risk:** Low (Core logic verified)

---

## สรุปสถานะโครงการ
- **Node.js Modular Core Rebuild (Milestones 1–8):** สำเร็จสมบูรณ์ 100% (87/87 tests passed)
- **Stabilization & Verification Program (Milestones 7.1–7.3):** สำเร็จสมบูรณ์ 100%
- **Cloudflare Target Migration (CF-0 to CF-11):**
  - **CF-0 (Architecture Truth & Documentation Alignment):** **COMPLETED**
  - **CF-1 (Cloudflare Workers Foundation):** **NEXT ACTIVE**
  - แผนการดำเนินงานฉบับสมบูรณ์: [`docs/architecture/CLOUDFLARE_MIGRATION_ROADMAP.md`](file:///workspace/quiet-hopper/docs/architecture/CLOUDFLARE_MIGRATION_ROADMAP.md)
  - นิยามสถาปัตยกรรมหลัก: [`docs/architecture/VELNOX_CANONICAL_ARCHITECTURE.md`](file:///workspace/quiet-hopper/docs/architecture/VELNOX_CANONICAL_ARCHITECTURE.md)
