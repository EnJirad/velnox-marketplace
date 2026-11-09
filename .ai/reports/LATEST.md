# LATEST — 2026-11-09 · รายได้ seller ใช้ข้อมูลจริง + กราฟขึ้น + แก้ scroll

**Branch:** `main` · **HEAD:** `f8adf20` · **Status:** DONE — verified ด้วยข้อมูล production จริง

## 1. Seller income ขึ้น ฿0 / กราฟว่าง (แก้แล้ว)

**ต้นเหตุ:** `/api/seller/income` นับรายได้เฉพาะ item ที่ **ทั้ง** order เป็น `completed|delivered` **และ** มีแถว `shipments` ที่ shipped
production มี order `completed` 3 ใบ มูลค่ารวม **฿1,677.20** แต่ `shipment_items` = **0 แถว** (ขายแบบไม่บันทึกขนส่ง / ก่อนระบบขนส่งใช้งาน)
→ gross, commission, payout เป็น 0 และ `grouped` (ข้อมูลกราฟ) ว่างตลอด → **ไม่ขึ้นแท่งกราฟ**

**แก้:** แยกกฎเป็น pure helper ใน `backend/lib/seller-stats.ts`
- `isOrderIncomeEligible(orderStatus)` — order คือผู้ตัดสิน ไม่ต้องมี shipment
- `isReturnCounted(returnStatus)` — `received|restocked|completed` นับเป็นยอดตีกลับ
ใช้ helper เดียวกันทั้ง KPI และ `grouped` (เดิมคนละเงื่อนไข ทำให้เลขกับกราฟไม่ตรงกัน)

**ผลลัพธ์ที่ควรเห็น (คำนวณจากข้อมูลจริงใน Neon):** gross ฿1,677.20 · commission 3% = ฿50.32 · payout ฿1,626.88 · กราฟ 3 แท่ง (2026-10-31, 11-08, 11-09)

**ซ่อมข้อมูลใน transactions ด้วย:** เดิม slice(0,50) จากลิสต์เก่า→ใหม่ = ได้ 50 ออเดอร์เก่าสุด; header แต่ละแถวโชว์ UUID กับ ฿0; ชื่อลูกค้าเป็น "—" เพราะ map key ผิด (user id vs order id) → แก้ครบ (order_number + total_amount จริง, เรียงใหม่→เก่า, key ด้วย order id)

## 2. กราฟแท่งไม่ขึ้น (แก้ที่ layout)

คอลัมน์เดิมเอา label ค่าไปวางเหนือแท่งภายในคอลัมน์ `h-full` → แท่ง `height: %` ล้นพื้นที่ที่เหลือและถูกตัด
แก้เป็น 3 แถว: ค่า / พื้นที่แท่ง (`flex-1`, ความสูงแน่นอน) / label + min 6px ให้ยอดน้อยยังเห็น + `transition-[height]` (เดิมเป็น `[width]` จาก sed รอบก่อน = ผิดแกน)

## 3. Scroll (รายงานจาก owner ว่าเลื่อนไม่ได้ทั้ง 3 เว็บ)

- `body { touch-action: pan-x pan-y }` → `manipulation` (pan + pinch, ปิด double-tap) — ค่าเดิมปิด pinch-zoom และบน Android WebView บางเวอร์ชันทำให้ลากนิ้วไม่เริ่ม scroll
- ลบ `overscroll-behavior-y: none` ที่ใส่ไว้รอบ motion
- **ยืนยันบน production:** CSS ที่ deploy มี `body{touch-action:manipulation}` และไม่มี overscroll lock; `scrollHeight 1329 > viewport 815`; `window.scrollTo` และ gesture scroll ของเบราว์เซอร์ทำงาน; synthetic touchmove ไม่ถูก `preventDefault`
- **ตัวที่ยังขวางการเลื่อนในแอปคือ instrumentation ของ Harness เอง**: console เต็มไปด้วย `window.__harnessUpdateScroll is not a function` (ยิงทุก event) — เป็นสคริปต์ที่ Harness ฉีดเข้า WebView ไม่ใช่โค้ดของ marketplace; เปิดผ่าน browser จริงแล้วใช้ได้ปกติ (`browser_open_external`)

## 4. ตรวจแล้ว

backend + 4 apps typecheck ✅ · `bun test` **1420 pass / 0 fail** (เพิ่ม 5 เคส: eligibility + 3% ของยอดจริง) ✅ · `build:apps` 4/4 ✅ · `git diff --check` ✅ · deployed CSS ตรวจแล้วทั้ง 3 แอป
