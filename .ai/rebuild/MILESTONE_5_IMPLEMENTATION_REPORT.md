# รายงานผลการดำเนินงาน Milestone 5: Payment, Webhooks & Automated Settlement Engine

**วันที่:** 2026-11-22  
**สถานะ:** COMPLETED & FULLY VERIFIED (ผ่านการทดสอบ 66/66 ชุดทดสอบ)  
**Branch:** `main`

---

## 1. วัตถุประสงค์ของ Milestone 5
ปรับปรุงสถาปัตยกรรมระบบการเงินและการชำระเงินจาก Route ยักษ์ `backend/routes/stripe.ts` (3,122 บรรทัด) สู่ Modular Architecture ภายใต้ `backend/src/modules/payment/` และ `backend/src/modules/ledger/` พร้อมระบบ Settlement และ Double-Entry Ledger อัตโนมัติ:
- ตรวจสอบลายเซ็น Stripe Webhook (HMAC-SHA256) อย่างปลอดภัยและป้องกัน Replay Attacks (Timestamp Tolerance 300 วินาที)
- จัดการ Claim Webhook Event แบบ Idempotent (`INSERT ... ON CONFLICT DO NOTHING`)
- ล็อก Order แถวในลำดับที่แน่นอน (`id ASC`) ป้องกันปัญหา Deadlock (AB-BA)
- ทำการ Commit สต็อกเมื่อการชำระเงินสำเร็จ และ Release สต็อกเมื่อการชำระเงินหมดอายุ/ล้มเหลว
- บันทึกธุรกรรม Double-Entry Ledger อัตโนมัติด้วยหน่วยสตางค์ (`bigint`) โดยพิสูจน์ความสมดุล $\sum\text{Debits} == \sum\text{Credits}$ ก่อนบันทึก
- บันทึกค่าธรรมเนียมแพลตฟอร์ม (Commission) และคำนวณยอดค้างจ่ายผู้ขาย (Seller Payable) อย่างแม่นยำ ปราศจาก Floating Point
- รองรับกระบวนการโอนเงินให้ผู้ขาย (Seller Settlement / Payout) และการคืนเงินลูกค้า (Customer Refund)

---

## 2. โมดูลและไฟล์ที่สร้างขึ้นใหม่

### 2.1 Domain Layer
- `backend/src/modules/payment/domain/payment.ts`:
  - นิยามสถานะการชำระเงิน (`PaymentStatus`, `PaymentMethodId`, `RefundStatus`)
  - ฟังก์ชันคำนวณส่วนแบ่งแพลตฟอร์ม `calculatePlatformFeeMinor` และยอดจ่ายผู้ขาย `calculateSellerPayableMinor` ด้วย `bigint` satangs (zero-float)
  - ฟังก์ชันตรวจสอบลายเซ็น `verifyStripeSignature` ผ่าน WebCrypto/HMAC-SHA256 พร้อมการเทียบแบบ Constant-time (`crypto.timingSafeEqual`)
- `backend/src/modules/ledger/domain/ledger.ts`:
  - Re-export core ledger primitives และ transaction builders จาก `@velnox/ledger`

### 2.2 Repository Layer
- `backend/src/modules/payment/repository/payment-repository.ts`:
  - `createPayment`: สร้างข้อมูลการชำระเงินในตาราง `payments`
  - `claimPaymentEvent`: Claim webhook event ด้วย `INSERT INTO payment_events ... ON CONFLICT DO NOTHING` พร้อม Re-arm event ที่เคยล้มเหลว
  - `lockOrders` & `lockOrdersForCheckoutGroup`: ล็อก Order แถวด้วย `SELECT ... FOR UPDATE` ตามลำดับ `id ASC` เพื่อขจัด Deadlock
  - `markOrdersPaid`: อัปเดตสถานะเป็น `paid` เฉพาะคำสั่งซื้อที่อยู่ในสถานะ `pending`/`pending_payment` และยังไม่ปล่อยสต็อก
  - `markOrdersFailed`: อัปเดตคำสั่งซื้อสู่สถานะ Terminal (`payment_failed` หรือ `cancelled`)
  - `createCommissionRecord` & `createSettlementRecord`: บันทึกข้อมูลคอมมิชชันและการชำระเงิน

### 2.3 Services Layer
- `backend/src/modules/payment/services/payment-service.ts`:
  - `getAvailablePaymentMethods`: ระบบค้นหาวิธีการชำระเงินที่เปิดใช้งาน (CARD, PROMPTPAY, COD)
  - `createPaymentAttempt`: ตรวจสอบ Deadline 30 นาที และสร้าง Payment Attempt
  - `handleStripeWebhook`: ประมวลผล Webhook ทั้งหมด (`checkout.session.completed`, `payment_intent.succeeded`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded`)
  - เชื่อมโยงสต็อก (`InventoryRepository.commitStock` / `releaseStock`)
  - เชื่อมโยงบัญชีแยกประเภทคู่ (`LedgerService.recordTransaction` ผ่าน `createCustomerPaymentTransaction`, `createSellerSettlementTransaction`, `createRefundTransaction`)
  - `executeSellerSettlement`: ดำเนินการตัดรอบโอนเงินให้ผู้ขาย โดยตรวจสอบยอดค้างจ่ายจริงใน Ledger ก่อนทำธุรกรรม
- `backend/src/modules/ledger/services/ledger-domain-service.ts`:
  - `getAccountBalance`: คำนวณยอดคงเหลือของบัญชีตาม Natural Sign ทางบัญชี (Assets: Debit normal, Liabilities/Revenue: Credit normal)
  - `getSellerPayableBalance`: ตรวจสอบยอดเงินสะสมที่แพลตฟอร์มค้างจ่ายให้ผู้ขาย
  - `verifyLedgerIntegrity`: ตรวจสอบความถูกต้องทางคณิตศาสตร์ของ Ledger ทั้งระบบ ($\sum\text{Debits} == \sum\text{Credits}$) และไม่มีค่าย่อยติดลบ

### 2.4 Routes / Controller Layer
- `backend/src/modules/payment/routes/payment-routes.ts`:
  - `PaymentController` สำหรับ REST API / Edge Workers:
    - `GET /api/v1/payments/methods`
    - `POST /api/v1/payments/checkout`
    - `POST /api/v1/payments/stripe/webhook`
    - `GET /api/v1/payments/:orderId`
    - `POST /api/v1/payments/settlements/execute`

---

## 3. ผลการทดสอบ (Automated Verification)
รันชุดทดสอบผ่าน Node.js Native Test Runner (`--experimental-strip-types`):
- `backend/tests/payment/payment-service.test.ts` (5 tests passed)
- `backend/tests/payment/settlement-ledger.test.ts` (4 tests passed)
- **ผลการทดสอบรวมทุก Milestone: 66 ผ่าน / 0 ไม่ผ่าน (100% PASS across 15 suites)**
  - Milestone 1 (API Contracts & Primitives)
  - Milestone 2 (Ledger Invariants & Database Migration Engine)
  - Milestone 3 (Identity, Auth, Crypto JWT, Password Hashing, Refresh Rotation)
  - Milestone 4 (Catalog, Inventory Concurrency, Cart Grouping, Checkout Split)
  - Milestone 5 (Payment Webhooks, Stock Commit, Settlement Engine & Ledger Auditing)

---

## 4. สถานะและขั้นตอนถัดไป
Milestone 5 เสร็จสมบูรณ์อย่างเป็นทางการ พร้อมส่งมอบสู่ **Milestone 6: Frontends Rebuild & Cloudflare Pages Deployment** เพื่อเชื่อมต่อ VelShop, VelSeller, และ VelCenter เข้ากับ Monorepo API Contracts และ Cloudflare Pages Architecture
