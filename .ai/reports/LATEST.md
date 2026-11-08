# LATEST — 2026-11-08 · Integrated Multi-Carrier Tracking

**Branch:** `main` · **HEAD:** `6bcf283` (start) → HEAD unchanged **NOT PUSHED** (no commit made — task rule: ห้าม Commit/Push โดยไม่ได้รับอนุญาต)

## สรุปงาน (Thai)

สร้างระบบติดตามพัสดุแบบรวมศูนย์บน backend เดิม (Express + Neon) โดยขยายระบบ shipment เดิม
(`shipments` + `tracking_events` + `order-shipment.ts`) ไม่สร้างระบบใหม่ซ้ำซ้อน จุดแกนคือ
`backend/lib/tracking/` (Adapter contract + Normalizer + Safe-fetch + 4 Carrier adapter +
Service ที่มี cache/dedup/cooldown) + `backend/routes/tracking.ts` (Customer/Seller/Admin)
+ หน้า UI ใน VelShop/Velseller/Velcenter + i18n 3 ภาษา

## Carrier status (จริง, ทดสอบเมื่อ 2026-11-08)

| Carrier | Result | สถานะ |
|---|---|---|
| J&T TH | HTTP 200 แต่มี captcha (code 20005) | **BLOCKED** (ต้องได้สิทธิ์ merchant API ทางการ) |
| Flash | anti-bot 5 วิ ตอบ HTML | **BLOCKED** (ต้องได้สิทธิ์ B2B API ทางการ) |
| SPX | internal portal API, error เสมอ | **UNSUPPORTED** |
| TNT | HTTP 200 JSON จริง, not-found ถูกต้อง | **PARTIAL** (ยังไม่ได้ทดสอบเลขจริง) |

## Tests

- Backend `tsc --noEmit` ผ่าน (มี error เดิมเฉพาะ `routes/auth.ts`)
- `bun test tests/tracking-normalizer.test.ts tests/tracking-adapters.test.ts tests/tracking-safe-fetch.test.ts` → **ผ่านทั้งหมด**
- reconciler / schema-drift / sql-reference-coverage → ผ่าน
- typecheck 4 apps + i18n parity (2215×3) → ผ่าน
- Full-suite: fail เดิมจาก Phase 2 UI overhaul + env (ยืนยันบน baseline ด้วย stash)

## ไฟล์หลัก

- Add: `backend/lib/tracking/*` (10 ไฟล์), `backend/routes/tracking.ts`, `apps/velcenter/src/components/TrackingTab.tsx`, test 3 ไฟล์, `.ai/context/tracking.md`, history
- Mod: `db/schema.sql`, `db/run-sqleditor.sql`, `backend/server.ts`, `backend/middleware/rate-limit.ts`, `backend/lib/order-read.ts`, `packages/shared/src/lib/api-routes.ts|commerce.ts|i18n/*`, `apps/velshop/src/pages/ShopTracking.tsx`, `apps/velseller/src/pages/SellerOrderDetail.tsx`, `apps/velcenter/src/pages/Center.tsx`, `.ai/AI_HANDOFF.md`, `.ai/office/QUICK_START.md`

## เหลือ/ขั้นต่อไป

- ขอสิทธิ์ทางการ (official access) สำหรับ J&T / Flash / SPX
- ตั้ง `TEST_DATABASE_URL` เพื่อรัน integration test กับ DB จริง
- ขออนุมัติ commit + push (ยังไม่ได้ทำตามกฎข้อ 13 ของงาน)
