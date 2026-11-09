# 2026-11-09 (2) — 263 CI failures: root cause คือ mock.module leak

**Session type:** T3 (test isolation + เงิน/checkout) · **Branch:** `main` · **ก่อนเริ่ม:** HEAD `3b9a8a1` = `origin/main`

## อาการ

CI `Tests` แดงที่ *Run the test suite* 263 เคส (หลังซ่อม typecheck รอบก่อน) ขณะที่รันไฟล์เดียวนอก CI ผ่านเกือบทั้งหมด — อาการไม่สัมพันธ์กับโค้ดที่เพิ่งแก้

## การวินิจฉัย (เรียงตามที่พิสูจน์ได้)

1. ดึง log งานจริงด้วย `gh api .../jobs/<id>/logs` แล้วพบว่ารายละเอียดแรก ๆ คือ
   `client.query is not a function (In 'client.query("SELECT ... FOR UPDATE")', 'client.query' is undefined)`
2. `grep` ทั้ง repo เจอ `mock.module` ที่เดียวในเทสต์: `backend/tests/order-read-schema-fallback.test.ts` เรียก
   `mock.module("../db/index.js", () => ({ query, withTransaction: fn => fn({}) }))` โดยไม่มี restore
3. Bun รันทุกไฟล์เทสต์ในโปรเซสเดียว และ `mock.module` เป็น **process-global** → ไฟล์ที่รันตามหลัง import โมดูลปลอม
   (`withTransaction` ส่ง `{}` ให้ caller ⇒ `client.query` undefined)
4. **ทดลองแก้ด้วย `mock.restore()` + ลงทะเบียนโมดูลจริงซ้ำใน `afterAll`: ไม่สำเร็จ** — probe ยืนยันว่าไฟล์ถัดไปยังได้ stub
   (Bun 1.4.4)
5. ทางที่ได้ผล: **ลบ `mock.module` ออกทั้งหมด** เปลี่ยนเป็น dependency injection

## การแก้

- `backend/lib/order-read.ts` — `fetchShipmentsForOrder(orderId, run = query)` + type `QueryRunner`; queries ทั้ง shipments และ events ใช้ `run`
- `backend/lib/tracking/shipment-repo.ts` — `getShipmentForOrder(orderId, run = query)` แบบเดียวกัน
- `backend/tests/order-read-schema-fallback.test.ts` — เขียนใหม่ทั้งไฟล์ ส่ง fake runner ตรง ๆ; เอกสารในหัวไฟล์อธิบายว่าทำไมห้ามใช้ `mock.module` (กันคน reintroduce)
- `backend/tests/buy-now-checkout.test.ts` — total = subtotal − discount + shipping_fee (server-priced shipping 2026-11-05); `purchaseOf()` เลือกคอลัมน์เงินครบ
- `backend/tests/multi-shop-checkout.test.ts` — group total = ผลรวม order.total_amount (ไม่ hardcode 490)
- `backend/tests/payment-reservation-expiry.test.ts` — `CLOCK_SKEW_MINUTES` 3 วินาที แทน `<= 30` (DB clock vs process clock)
- `backend/tests/checkout-shipping-integrity.test.ts` — quote ของคนอื่น: ยืนยัน "ถูกปฏิเสธ + ไม่มี order + quote ไม่ถูก consume" ไม่ผูกกับลำดับ guard (403 vs 409)

## ผลตรวจ

รันเต็มบน DB จริงในเครื่อง: **1810 pass / 2 fail / 9 skip** (2 fail = `describeDatabaseIdentity` ที่ hardcode ชื่อ db ว่า `velnox_test` — artifact ของเครื่องนี้ — และ multi-shop total ที่แก้หลังรอบนั้นแล้วตรวจซ้ำ 92 pass / 0 fail ครอบคลุม)
4 apps typecheck ✅ · backend typecheck ✅ · `git diff --check` ✅

## บทเรียนที่ต้องจำ

**ห้ามใช้ `mock.module` ใน repo นี้** — Bun ทำ mock เป็น process-global และถอนไม่ได้จริง (1.4.4) ทำให้ไฟล์อื่นพังแบบไกลจากต้นเหตุและอ่านไม่ออก
ถ้าต้องจำลอง I/O ให้เพิ่มพารามิเตอร์ inject (มี pattern อยู่แล้วใน `order-read` / `shipment-repo`)

## วิธีรัน DB suite ในเครื่อง (สรุป)

Neon branch ชั่วคราว + TCP tunnel 127.0.0.1 (เพราะ guard ปฏิเสธ host `*.neon.tech` โดยเจตนา และ `initdb` ติด ICU)
ใช้ `--timeout 90000` (remote DB ช้ากว่า container มาก; 5s ทำให้ false fail) แล้วลบ branch ทิ้ง
รายละเอียดขั้นตอนครบอยู่ใน `.ai/reports/LATEST.md` §วิธีรัน
