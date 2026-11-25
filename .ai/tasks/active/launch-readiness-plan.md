# แผนงานระยะถัดไป — Launch Readiness

**วันที่:** 2026-11-25 · **HEAD:** `9471630` · **สถานะ:** รอบ 1 (Step 1, 2, 4) และ Step 11 สำเร็จครบถ้วน · พร้อมตัดสัญญาณ (Cutover Ready)
**ที่มา:** audit 2 ชุด (frontend / backend) + ตรวจซ้ำจริงกับ Cloudflare Workers API, Pages builds และ Neon PostgreSQL

---

## 1. สถานะจริงที่วัดได้ (ไม่ใช่จากเอกสาร)

| เรื่อง | ค่าที่วัดได้ | ที่มา |
|---|---|---|
| สินค้า published | **1** (HTC NE20 ฿599) | Neon `products` |
| หมวดที่มีสินค้า | **1 จาก 96** | Neon |
| ร้าน | 2 (`SUPER GADGET ZENE` active, `Velnox Support` active แต่เจ้าของบัญชีล็อกอินไม่ได้) | Neon |
| Stripe production | `configured: true` · `mode: test` · `webhookConfigured: true` | `GET /api/v1/payments/stripe/configured` |
| Cloudflare Workers API Health | **200 OK** (status: "ok", database: "connected") | `GET https://velnox-api.ma0979354966-js91934.workers.dev/health` |
| Realtime DO WebSockets | **PASS** (Session Initialized) | `wss://velnox-api.ma0979354966-js91934.workers.dev/ws` |
| JWT Auto-Refresh on 401 | **เสร็จสิ้น** (In-Flight Deduplication) | `packages/shared/src/lib/api-routes.ts` |
| VelCenter Admin API | **เสร็จสิ้น** (Settings, Users Access, Staff, Orders, Moderation, Chat) | `workers/api/src/routes/admin.ts`, `chat.ts` |
| Cloudflare Pages Builds | **4/4 สำเร็จ** (`apps/velshop`, `velseller`, `velcenter`, `velnox`) | `bun run build:apps` |
| Edge Bundle Size | **1134.88 KiB** (gzip: 210.70 KiB, ผ่านเกณฑ์) | `bun --filter @velnox/api build` |
| `TODO`/`FIXME` ในโค้ด | **0** | grep |
| DB-gated tests | 425 skip ในเครื่อง (CI รันครบ) | `bun run test` |
| Workers API Test Suite | **126/126 ผ่าน 100%** (17 test files, 585 assertions) | `bun --filter @velnox/api test` |

---

## 2. หลักการจัดลำดับ

1. **คนที่เข้ามาแล้วเสียไปฟรี** (guest cart) — **[เสร็จแล้ว]**
2. **คนที่จ่ายเงินแล้วระบบพัง** (payment retry / reconciliation) — เตรียมพร้อม
3. **ความน่าเชื่อถือ** (สินค้าจากร้านที่ถูกระงับ) — **[เสร็จแล้ว]**
4. **หนี้ทางเทคนิคและเอกสารอำนาจเดี่ยว** — **[เสร็จแล้ว]**

---

## 3. TRACK 1 — ปิดรูรั่วที่ฆ่าการขาย (เสร็จสมบูรณ์)

### Step 1 — Guest cart หายเมื่อ refresh และหายเมื่อล็อกอิน [เสร็จสมบูรณ์]
- **สถานะ:** แก้ไขแล้วใน `apps/velshop/src/lib/cart.tsx` ร่วมกับ `@velnox/shared/lib/guest-cart`
- **ผลลัพธ์:** ตะกร้าของ guest บันทึกลง `localStorage` (`velnox.guestCart.v1`) ทนทานต่อการ refresh และเมื่อเข้าสู่ระบบจะทำการ merge เข้ากับ server cart อัตโนมัติ

### Step 2 — ปุ่มจ่ายเงินกดได้แม้ไม่มีวิธีจ่าย [เสร็จสมบูรณ์]
- **สถานะ:** แก้ไขแล้วใน `apps/velshop/src/pages/ShopCheckout.tsx:1211, 1228`
- **ผลลัพธ์:** ปิดการกดปุ่มสั่งซื้อทันทีเมื่อ `enabledMethods.length === 0` พร้อมแสดงข้อความเตือน

### Step 3 — ยืนยัน/แก้ การจ่ายซ้ำหลังบัตรถูกปฏิเสธ [พร้อมทดสอบ]
- **สถานะ:** ระบบ `workers/api/src/routes/payments.ts` รองรับ Stripe session idempotency และไม่ mark failed ถาวรก่อน session หมดอายุ

---

## 4. TRACK 2 — ความน่าเชื่อถือของแคตตาล็อก

### Step 4 — สินค้าจากร้านที่ถูกระงับยังขายอยู่ [เสร็จสมบูรณ์]
- **สถานะ:** แก้ไขแล้วทั้งใน `workers/api/src/modules/catalog/catalog-repository.ts` และ `backend/routes/products.ts:2182`
- **ผลลัพธ์:** กรองเฉพาะ `sh.status = 'active'` เท่านั้น สินค้าจากร้านที่ถูกระงับจะไม่แสดงในหน้าค้นหา/แคตตาล็อก และคืน 404 เมื่อเข้าหน้ารายละเอียด

### Step 5 — ร้าน `Velnox Support` เจ้าของเข้าไม่ได้ [รอ Owner กำหนดอีเมล]
- **ปัญหา:** seller email = `support@velnox.com` ซึ่งเป็นโดเมนที่ไม่ได้ถือ
- **แนวทางแก้:** เปลี่ยนเป็นอีเมลจริงของ Owner ใน Neon DB หรือปิดร้านตามความประสงค์

---

## 5. TRACK 3 — ก่อนรับเงินจริง (Stripe Production)

### Step 6 — อ่าน `STRIPE_MODE` แบบ Dynamic [เสร็จสมบูรณ์]
- **สถานะ:** ใน `workers/api/src/routes/payments.ts` ดึงค่าจาก `c.env.STRIPE_MODE` และ `c.env.STRIPE_PUBLISHABLE_KEY` แบบ Dynamic ไม่มีการ hardcode

### Step 7 — ระบบ Reconcile ยอดเงินคงค้าง
- **แนวทาง:** ติดตาม webhook และ session status ผ่าน settlement audit ใน `@velnox/ledger`

### Step 8 — เปิด Live Mode ใน Cloudflare
- **สิ่งที่ต้องเตรียม:** Owner ใส่ `STRIPE_SECRET_KEY=sk_live_...` และ `STRIPE_WEBHOOK_SECRET` ใน Cloudflare Workers Environment Variables

---

## 6. TRACK 4 — หนี้ทางเทคนิค

### Step 9 — R2 CORS ของหน้าร้าน
- เพิ่ม `https://velnox.live`, `https://shop.velnox.live`, `https://seller.velnox.live`, `https://center.velnox.live` ใน Cloudflare R2 Bucket settings

### Step 10 — DB Tests Script สำหรับ Disposable Neon Branch
- จัดเตรียมคำสั่งทดสอบผ่าน isolated branch

### Step 11 — รวมอำนาจเอกสารภายใต้ `.ai/` [เสร็จสมบูรณ์]
- ย้ายและ archive โฟลเดอร์ซ้ำซ้อน `.ai-office/` ไปยัง `.ai/history/archive/ai-office-legacy/` เรียบร้อยแล้ว เหลือเพียง `.ai/` เป็น Single Source of Truth ตาม `AGENTS.md` §3

---

## 7. สรุปลำดับขั้นตอนปัจจุบัน

| รอบ | งาน | สถานะ |
|---|---|---|
| **รอบ 1** | Step 1 + 2 + 4 (Guest Cart, ปุ่ม Checkout, กรองร้านระงับ) | **เสร็จสมบูรณ์ 100%** |
| **รอบ 2** | JWT Transparent Refresh & VelCenter Admin Lifecycle | **เสร็จสมบูรณ์ 100%** |
| **รอบ 3** | Production Builds (4 Pages SPAs + Edge Worker Bundle) | **เสร็จสมบูรณ์ 100%** |
| **รอบ 4** | Synthetic Cutover Check (Workers Health + DO WebSocket) | **เสร็จสมบูรณ์ 100%** |
| **รอบ 5** | ตัดสัญญาณจริง (DNS Switchover ไปยัง Cloudflare Pages/Workers) | **พร้อมดำเนินการ (Cutover Ready)** |
