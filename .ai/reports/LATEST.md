# LATEST — 2026-11-09 · Cart rules, 6 carriers, QR checkout on our own page

**Branch:** `main` · **HEAD:** `7aa62e0` (in sync with origin) · **NOT pushed** (no commit — awaiting approval)

## ทำอะไรไปแล้ว

### 1) กฎตะกร้าแบบ marketplace (Shopee / Lazada / TikTok Shop)
- **เพดาน 100 ชิ้นต่อการสั่งซื้อ** — `backend/lib/order-limits.ts` (ใหม่) บังคับใช้ 3 จุด:
  `POST /api/customer/cart/add`, `PUT /api/customer/cart/item/:id`, และ **authoritative** ที่
  `POST /api/customer/checkout` (400 `ORDER_LIMIT_EXCEEDED` พร้อมบอกจำนวนที่เกิน) — client หลอกไม่ได้
- **หน้าตะกร้า** แสดงจำนวนที่เลือก/เพดาน + แบนเนอร์เตือน + ปุ่มชำระเงินถูกล็อกเมื่อเกิน
- **ติ๊กเลือกได้ต่อชิ้น / ต่อร้าน / ทั้งหมด** และ **แยกออเดอร์ต่อร้าน** — มีอยู่แล้วในระบบเดิม
  (`cart-selection.ts`, `selectedCartItems`, `shop_id` grouping) → แต่ละร้าน = 1 ออเดอร์ = 1 พัสดุ = 1 เลขพัสดุ

### 2) ขนส่ง 6 เจ้า พร้อมต่อ API
- เพิ่ม **Kerry Express** (`KERRY_API_KEY`/`KERRY_API_SECRET`) และ **ไปรษณีย์ไทย**
  (`THAILANDPOST_API_TOKEN` — official Track & Trace v1) เป็น adapter จริงใน registry
- สถานะจริง: `THAILANDPOST` = **READY→PARTIAL** เมื่อใส่ token, `KERRY` = **BLOCKED** จนได้ merchant key,
  J&T/Flash = BLOCKED, SPX = UNSUPPORTED, TNT = PARTIAL
- seller ship dialog เลือกขนส่งได้ 6 เจ้า · VelCenter filter เพิ่ม KERRY/THAILANDPOST
- **ใส่ key แล้วใช้งานได้ทันที ไม่ต้องแก้โค้ด**

### 3) จ่ายเงิน: QR PromptPay บนเว็บเราเอง
- `backend/routes/payment-qr.ts` — `POST /api/payments/promptpay/intent` สร้าง Stripe PaymentIntent
  (`promptpay`) คืน EMVCo payload + PNG; ยอดมาจาก `orders.total_amount` เท่านั้น, ownership อยู่ใน WHERE
- หน้าใหม่ `apps/velshop/src/pages/ShopPaymentQr.tsx` (`/orders/:orderId/pay`) — QR ใน card ของเรา,
  นับถอยหลัง, poll สถานะ, กดจ่ายแล้วเด้งกลับหน้าออเดอร์ (ไม่ไป checkout.stripe.com)
- ปุ่ม "จ่ายด้วย PromptPay QR" ในหน้า Order Detail
- **Fail-closed**: ไม่มี Stripe key → 503 `PAYMENTS_NOT_CONFIGURED` + หน้าอธิบายของเรา ไม่มี QR ปลอม
- Payment registry เพิ่ม `TRUEMONEY` / `LINEPAY` เป็น **disabled + เหตุผล** (Stripe ไม่มี rail ให้ใน TH)

## ไฟล์
- **Add:** `backend/lib/order-limits.ts`, `backend/routes/payment-qr.ts`,
  `backend/lib/tracking/carriers/{kerry,thailand-post}.ts`,
  `apps/velshop/src/pages/ShopPaymentQr.tsx`, `backend/tests/order-limits.test.ts`,
  `.ai/context/shipping-and-payments.md`
- **Mod:** `cart.ts`, `server.ts`, `payment-config.ts`, `tracking/{types,normalizer,carrier-adapter}.ts`,
  `ShopCart.tsx`, `ShopOrderDetail.tsx`, `main.tsx`, `SellerOrderDetail.tsx`, `TrackingTab.tsx`,
  `api-routes.ts`, i18n th/en/my

## ทดสอบ (รันจริง)
- `bun test tests/order-limits.test.ts` → **10 pass**
- cart / multi-shop checkout / payment foundation / tracking adapters+normalizer → **152 pass, 0 fail**
- typecheck 4 apps ✅ · i18n parity **2256 × 3** ✅ · `git diff --check` ✅

## ยังไม่ได้ทดสอบ (ต้องมี key)
- เรียก carrier จริง (Kerry / ไปรษณีย์ / J&T / Flash) — BLOCKED ไม่มี credential
- Stripe PaymentIntent จริง — BLOCKED ไม่มี key ใน environment นี้
- Multi-shop group ยังใช้ Stripe Checkout Session (group-level intent ยังไม่ทำ — ระบุใน §5 ของเอกสาร)

## Next
1. อนุมัติ commit/push
2. ขอ token ไปรษณีย์ไทย (ฟรี) → ทดสอบ 1 เลขจริง → เปลี่ยนเป็น VERIFIED
3. ขอ merchant API Kerry/J&T/Flash
4. ทำ group-level PromptPay intent ให้ multi-shop จ่าย QR บนเว็บเราได้ทั้งหมด
