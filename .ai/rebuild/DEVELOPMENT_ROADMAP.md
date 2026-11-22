# Velnox Marketplace — Master Development Roadmap
**Version:** 3.0.0  
**Date:** 2026-11-22  
**Status:** ACTIVE  

---

## Roadmap Overview (แผนการพัฒนาระยะยาว)

แผนการ Rebuild ระบบ Velnox Marketplace แบ่งออกเป็น 8 Milestones ที่ชัดเจน ดำเนินการแบบ Incremental โดยไม่ทำลายฟังก์ชันเดิม และพร้อมตรวจสอบผลผ่าน Quality Gates ในทุกขั้นตอน:

```
[ Phase 1: Audit & Blueprint ] ──────► (COMPLETED)
           │
           ▼
[ Milestone 1: Monorepo Foundation & API Contract Package ] ──► (COMPLETED)
           │
           ▼
[ Milestone 2: Versioned Database Migration Engine & Ledger Core ] ──► (NEXT ACTIVE)
           │
           ▼
[ Milestone 3: Modular Backend Core & Unified Dual-Token Auth ]
           │
           ▼
[ Milestone 4: Commerce Core Domains (Catalog, Cart, Checkout, Inventory) ]
           │
           ▼
[ Milestone 5: Payment, Webhooks & Automated Settlement Engine ]
           │
           ▼
[ Milestone 6: Frontends Rebuild & Cloudflare Pages Alignment (Shop, Seller, Center) ]
           │
           ▼
[ Milestone 7: Realtime Hub (Durable Objects) & Push Notifications (FCM) ]
           │
           ▼
[ Milestone 8: Full E2E Integration, Security Hardening & Production Cutover ]
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

### Milestone 5: Payment, Webhooks & Automated Settlement Engine
- **Objective:** ปรับปรุงโมดูล `stripe.ts` (3,122 บรรทัด) และระบบการเงินให้มี Idempotency และตรวจสอบความถูกต้องย้อนหลังได้ 100%
- **Key Modules/Files:**
  - `backend/src/modules/payment/`
  - `backend/src/modules/ledger/`
  - Webhook processing with raw body validation & replay protection
- **Dependencies:** Milestone 4
- **Acceptance Criteria:** คำสั่งซื้อซ้ำหรือ Webhook ซ้ำต้องไม่หักเงินซ้ำ ยอดเงินและคอมมิชชันใน Ledger ตรงกับ Statement จริง
- **Risk:** Critical (ความถูกต้องทางการเงิน)

### Milestone 6: Frontends Rebuild & Cloudflare Pages Deployment
- **Objective:** ปรับปรุง Frontend Applications (VelShop, VelSeller, VelCenter) ให้เชื่อมต่อกับ API Contract ใหม่, แยกโมดูล `Center.tsx` (2,384 บรรทัด) ออกเป็นโมดูลย่อย, และจัดเตรียมการ Deploy สู่ **Cloudflare Pages Static Hosting** พร้อมระบบ SPA Routing (`/* /index.html 200`)
- **Key Modules/Files:**
  - `apps/velshop/` (`shop.velnox.live`)
  - `apps/velseller/` (`seller.velnox.live`)
  - `apps/velcenter/` (`center.velnox.live`)
  - `apps/velnox/` (`velnox.live`)
  - Cloudflare Pages configuration & build output verification
- **Dependencies:** Milestone 4, Milestone 5
- **Acceptance Criteria:** หน้าจอโหลดเร็วระดับ Edge, Responsive สมบูรณ์, รองรับภาษา TH/EN/MY, Preview Deployments บน Cloudflare Pages ทำงานได้ 100% โดยคง Vercel เดิมไว้ขนานกัน
- **Risk:** Medium

### Milestone 7: Realtime Hub & Push Notifications
- **Objective:** ย้าย WebSocket in-memory สู่ Cloudflare Durable Objects และเพิ่มระบบ Push Notifications ผ่าน FCM สำหรับ Mobile
- **Key Modules/Files:**
  - Realtime WebSocket gateway with Durable Objects
  - Cloudflare Queue consumer for FCM dispatch
- **Dependencies:** Milestone 6
- **Acceptance Criteria:** แชทรับส่งข้อความและรูปภาพแบบ Real-time ข้ามทวีปได้โดยไม่หลุด แจ้งเตือนเข้ามือถือเมื่อมีออเดอร์ใหม่
- **Risk:** Medium

### Milestone 8: Full E2E Integration, Production Cutover & Vercel Retirement
- **Objective:** รัน E2E Tests ครบทุก Flow, ทดสอบความปลอดภัย (OWASP Top 10), ทำ Data Reconcile, สลับ Cloudflare DNS Records สู่ Cloudflare Pages และ Workers เต็มรูปแบบ และดำเนินการปลดระวาง Legacy Vercel Projects หลังยืนยันความเสถียร
- **Dependencies:** All previous milestones
- **Acceptance Criteria:** Automated CI ผ่าน 100%, Load test ผ่าน, Zero defect ในระบบเงินและสต็อก, DNS Cutover สำเร็จราบรื่นไร้ Downtime
- **Risk:** High (ขั้นตอนการปล่อยสู่ Production และสลับ DNS)