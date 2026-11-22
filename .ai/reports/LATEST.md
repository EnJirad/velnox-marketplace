# Task Report: Velnox Clean Rebuild Initiative — Phase 0: Rebuild Strategy & Legacy Audit

## สรุปงาน
ได้ดำเนินการตามคำสั่งของเจ้าของโครงการ (Project Owner) ในการเปลี่ยนยุทธศาสตร์การพัฒนาของ Velnox Marketplace จากการ Migrate ระบบเดิม เป็น **"Clean Rebuild Initiative"** (การสร้างระบบใหม่ทั้งหมดบน Clean Architecture โดยใช้ Cloudflare-First และ Clean Database) เนื่องจากได้รับการยืนยันว่าไม่มีข้อมูลลูกค้า ข้อมูลคำสั่งซื้อ หรือข้อมูลทางการเงินที่มีมูลค่าในระบบเก่าที่จำเป็นต้องย้าย

การดำเนินงานใน Phase 0 เสร็จสิ้นสมบูรณ์ มีรายละเอียดดังนี้:

1. **ยืนยันการตัดสินใจด้านสถาปัตยกรรม (Owner Architecture Decision):**
   - **Target Frontend:** Cloudflare Pages (React 19, TypeScript, Vite, Tailwind CSS) สำหรับทั้ง 4 แอปพลิเคชัน (`velshop`, `velseller`, `velcenter`, `velnox`)
   - **Target Backend:** Cloudflare Workers (TypeScript + Hono Framework) ออกแบบเป็น Modular Monolith ภายใต้ REST API กลาง `api.velnox.live`
   - **Target Database:** Neon PostgreSQL เป็น Single Source of Truth ถาวร โดยเริ่มต้นด้วย Clean Database Schema ที่ออกแบบใหม่ตามความต้องการทางธุรกิจจริง (ไม่มีการสืบทอด 62 ตารางเดิม)
   - **Target Storage:** Cloudflare R2 ผ่าน Native Worker Bindings (`env.R2_BUCKET`) ไร้ค่า Egress พร้อมบันทึก Metadata ใน Neon
   - **Target Realtime:** Cloudflare Durable Objects รองรับ Stateful WebSockets แบบกระจายศูนย์ แทนที่ Node `ws` ในหน่วยความจำเดิม
   - **Target Background:** Cloudflare Queues สำหรับงานเบื้องหลังและ FCM Push Notifications

2. **การตรวจสอบและจัดหมวดหมู่โค้ดเดิม (Legacy Audit & Code Classification):**
   - **โค้ดที่นำกลับมาใช้ใหม่ได้ทันที (Reusable):**
     - `@velnox/validation`: Zod schemas ทั้งหมด (money satang, address, auth, primitives)
     - `@velnox/api-contract`: OpenAPI 3.1.0 และ Standard API Envelopes (`ApiResponse<T>`)
     - `@velnox/api-client`: Typed Fetch Client
     - `@velnox/ledger`: ระบบ Double-Entry Ledger Invariant (`Debits == Credits`)
     - `@velnox/shared`: Design System, Squircle theme, ระบบพจนานุกรม 3 ภาษา (ไทย, อังกฤษ, พม่า)
     - `backend/src/modules/`: Pure Domain Business Logic (Cart, Catalog tree, Inventory reservation math, Order state machine)
     - `apps/*`: Frontends ทั้ง 4 แอปที่ทันสมัยและพร้อมต่อยอด
   - **โค้ดที่เป็นข้อมูลอ้างอิงเท่านั้น (Reference Only):**
     - `backend/routes/*.ts` และ `backend/lib/*.ts`: อ้างอิง Flow ธุรกิจและ Edge cases เท่านั้น ห้าม Import เข้าสู่ Workers backend
   - **โค้ดและโครงสร้างที่ยกเลิกใช้งาน (Obsolete):**
     - Express monolith (`backend/server.ts`)
     - Node-specific dependencies (`cookie-parser`, `cors`, `helmet`, `ws`)
     - AWS S3 SDK for R2
     - Node TCP connection pool (`pg`)
     - Legacy Database Schema (62 tables) ใน `db/schema.sql`
     - Render และ Vercel deployment configurations

3. **นโยบายความปลอดภัยของฐานข้อมูล (Database Reset Decision):**
   - ฐานข้อมูลเดิมใน Neon จะไม่ถูกแตะต้อง ไม่ถูกแก้ไข และไม่ถูกลบทิ้ง
   - สถานะการ Provision ฐานข้อมูล Neon ชุดใหม่บน Cloud ถูกจัดให้อยู่ในสถานะ **BLOCKED** จนกว่าเจ้าของโครงการจะสร้าง Neon Project ใหม่ตามความเหมาะสม
   - ในระหว่างนี้ การพัฒนาและการทดสอบทั้งหมดจะดำเนินต่อไปบน Isolated Local PostgreSQL เพื่อความปลอดภัยสูงสุด

4. **การจัดทำเอกสารสถาปัตยกรรมหลักและแผนงานใหม่ (Deliverables):**
   - สร้างเอกสาร [`docs/architecture/VELNOX_CLEAN_REBUILD_ARCHITECTURE.md`](file:///workspace/quiet-hopper/docs/architecture/VELNOX_CLEAN_REBUILD_ARCHITECTURE.md)
   - สร้างเอกสาร [`docs/architecture/VELNOX_CLEAN_REBUILD_ROADMAP.md`](file:///workspace/quiet-hopper/docs/architecture/VELNOX_CLEAN_REBUILD_ROADMAP.md)
   - สร้างเอกสาร [`.ai/rebuild/CLEAN_REBUILD_ARCHITECTURE.md`](file:///workspace/quiet-hopper/.ai/rebuild/CLEAN_REBUILD_ARCHITECTURE.md)
   - สร้างเอกสาร [`.ai/rebuild/MASTER_REBUILD_ROADMAP.md`](file:///workspace/quiet-hopper/.ai/rebuild/MASTER_REBUILD_ROADMAP.md)
   - ปรับปรุงข้อกำหนดใน `AGENTS.md`, `.ai/office/QUICK_START.md`, และ `.ai/AI_HANDOFF.md` ให้ทุก AI Agent เข้าใจตรงกัน

## ไฟล์ที่เปลี่ยนแปลง
- `docs/architecture/VELNOX_CLEAN_REBUILD_ARCHITECTURE.md` (สร้างใหม่ — นิยามสถาปัตยกรรม Clean Rebuild)
- `docs/architecture/VELNOX_CLEAN_REBUILD_ROADMAP.md` (สร้างใหม่ — แผนงานหลัก Phases 0 ถึง 8)
- `.ai/rebuild/CLEAN_REBUILD_ARCHITECTURE.md` (สร้างใหม่ — เอกสารสถาปัตยกรรมสำหรับ AI Rebuild)
- `.ai/rebuild/MASTER_REBUILD_ROADMAP.md` (สร้างใหม่ — แผนงานสำหรับ AI Rebuild)
- `.ai/history/2026-11-22-phase-0-clean-rebuild-audit.md` (สร้างใหม่ — บันทึกประวัติการดำเนินงานประจำ Session)
- `docs/architecture/VELNOX_CANONICAL_ARCHITECTURE.md` (ปรับปรุง — ระบุข้อกำหนด Clean Rebuild Initiative และ Clean Database)
- `AGENTS.md` (ปรับปรุง — นิยาม Initiative และนโยบาย Clean Database)
- `.ai/office/QUICK_START.md` (ปรับปรุง — ลำดับการอ่านเอกสารสถาปัตยกรรมใหม่)
- `.ai/AI_HANDOFF.md` (ปรับปรุง — สรุปสถานะโครงการ Phase 0 Complete และตั้ง Phase 1 เป็น Next Active)
- `.ai/reports/LATEST.md` (รายงานฉบับนี้)

## ผลการทดสอบ
- **Git Hygiene (`git diff --check`):** สะอาดสมบูรณ์ 100% ไม่มี whitespace หรือ formatting errors
- **Frontend Typecheck (Apps):** ผ่านสะอาด 100% ครบทั้ง 4 แอปพลิเคชัน (`velshop`, `velseller`, `velcenter`, `velnox`)
- **Full Domain Test Suite (`bun run test:rebuild`):** ผ่าน 87/87 tests (29 test suites)
- **Package Contract Tests:** ผ่าน 28/28 tests (ภายใต้ Isolated Test DB configuration)
- **Database Engine Migration Unit Tests:** ผ่าน 7/7 tests
- **Ledger Invariants Unit Tests:** ผ่าน 8/8 tests

## สถานะ Git
- **Branch:** `main`
- **Initial SHA:** `3c5eab25414a88f19777249f8bbc7f227e2806de`
- **Remote Status:** ติดตามการเปลี่ยนแปลงในเครื่อง พร้อม Commit และ Push หลังการตรวจสอบความถูกต้อง

## สถานะ Checklist
- **Android Harness Native Checklist:** ไม่พบฟังก์ชัน/Tool สำหรับ Checklist ของ Android Harness ในสภาพแวดล้อมปัจจุบัน จึงใช้ Checklist จำลองในข้อความสนทนาเป็น Temporary Fallback
- [x] Git preflight
- [x] Architecture audit
- [x] Legacy backend audit
- [x] Database audit
- [x] Storage audit
- [x] Frontend audit
- [x] Reusable code inventory
- [x] Obsolete code inventory
- [x] New architecture document
- [x] New rebuild roadmap
- [x] AI instruction alignment
- [x] Legacy/rebuild status distinction

## ปัญหาที่ยังคงเหลือ (Blockers / Gaps)
- **Cloud Database Provisioning:** อยู่ในสถานะ **BLOCKED** จนกว่าเจ้าของโครงการจะทำการสร้าง Neon Database/Project ใหม่สำหรับ Clean Rebuild (ระบบใช้ Local Isolated DB สำหรับการทดสอบในปัจจุบัน ไม่กระทบการทำงานของ Phase 1)
- **Package TSConfig Alignment:** ใน Phase 1 จะต้องปรับแต่ง TypeScript configuration ของ packages ให้รองรับ Bun runtime types อย่างสะอาดสำหรับการรันคำสั่ง `bun run typecheck:packages`

## ขั้นตอนถัดไป
- เริ่มต้นดำเนินงาน **PHASE 1 — NEW FOUNDATION**:
  1. จัดโครงสร้าง Monorepo และการตั้งค่า TypeScript / Build pipelines
  2. สร้าง Cloudflare Workers backend (`workers/api`) ด้วย Hono Framework
  3. ติดตั้ง endpoint `GET /health` ตามมาตรฐาน `@velnox/api-contract`
  4. ตั้งค่า Environment validation, Error handling middleware, และ CI/CD foundations
