# LATEST — 2026-11-08 · CRITICAL fix: customer order tracking 500

**Branch:** `main` · **HEAD:** `5a8359a` (origin/main, in sync) · **NOT pushed** (no commit made — task rule: ห้าม commit/push โดยไม่ได้รับอนุญาต, ค้าง fix)

## 1. สรุปงาน (Thai)

แก้ bug CRITICAL: ลูกค้าที่ล็อกอินเปิด Order Details → Track Shipment แล้วเห็น
**"ไม่พบออเดอร์ / Failed to fetch order"** ทั้งที่ออเดอร์มีอยู่จริง

**สาเหตุจริง (VERIFIED จาก schema จริงของ production Neon):** ระบบ tracking
(commit `96bbb74`) ขยาย query ของ `fetchShipmentsForOrder()` ให้เลือกคอลัมน์ใหม่ 6 ตัว
บน `shipments` + `carrier_status` บน `tracking_events` **โดยไม่มี fallback** —
แต่ production ยังไม่ถูก reconcile (ตรวจแล้ว: คอลัมน์ทั้งหมดไม่มีในตารางจริง)
PostgreSQL ตอบ `42703 undefined_column` → ทั้งหน้า order detail เอา 500
DB_ERROR → แสดง "ไม่พบออเดอร์" ทั้งที่ออเดอร์มีจริง

**การแก้:** เพิ่ม fallback แบบเฉพาะเจาะจง — เฉพาะ error class `42703` / `42P01`
(schema gap) เท่านั้นที่จะย้อนกลับไปใช้ projection เดิม (อ่าน order ได้เหมือนเดิม,
คอลัมน์ใหม่เป็น null) ส่วน error อื่น rethrow เพื่อไม่ซ่อนความล้มเหลวจริง
ครอบคลุม reader ทุกตำแหน่งที่อ่านคอลัมน์ใหม่ + ปรับการแสดง error ใน ShopTracking
(แยก 401/403/404/5xx/network + ปุ่ม Retry ไม่แสดง backend error เป็น "ไม่พบออเดอร์")

## 2. สถานะ

| รายการ | สถานะ |
|---|---|
| Root cause | **VERIFIED** — production schema ตรวจจริง (shipments 12 col / tracking_events 5 col, ไม่มีคอลัมน์ tracking) |
| Fix โค้ด | **FIXED** — fallback ทุกจุด + UI classification, test ผ่าน |
| Migration DB จริง | **BLOCKED** — ต้องรัน `db/run-sqleditor.sql` ใน Neon SQL Editor (owner) |
| Render logs | **BLOCKED** — ไม่มีสิทธิ์เข้า Render ใน environment นี้ |

## 3. ไฟล์ที่เปลี่ยน (งานนี้)

- **Mod:** `backend/lib/order-read.ts` (fallback shipments+events), `backend/lib/tracking/shipment-repo.ts` (+`isSchemaGapError`, fallback), `backend/lib/tracking/tracking-service.ts` (events fallback), `backend/routes/tracking.ts` (admin search/detail fallback), `apps/velshop/src/pages/ShopTracking.tsx` (classification + Retry), i18n `th/en/my`
- **Add:** `backend/tests/order-read-schema-fallback.test.ts`

## 4. Tests

- `order-read-schema-fallback.test.ts` → **5 pass** (fallback shipments/events/non-schema rethrow/repo/happy-path)
- tracking batch + order consumers → 129 pass / 54 skip / **2 fail เดิม** (seller-order-ux pre-existing, ยืนยัน baseline แล้ว)
- backend `tsc` clean (เฉพาะ error เดิม auth.ts) · 4 apps typecheck ✅ · i18n 2235×3 ✅ · `git diff --check` ✅ · velshop build ✅

## 5. ขั้นตอนถัดไป

1. รัน `db/run-sqleditor.sql` กับ production Neon (เพิ่ม 6 column + carrier_status + indexes) — หลังนี้ tracking refresh/adapter จะทำงานเต็มรูปแบบ
2. ขออนุมัติ commit + push
3. ตรวจ Render logs จริงของ request ที่ fail (เมื่อมีสิทธิ์)
