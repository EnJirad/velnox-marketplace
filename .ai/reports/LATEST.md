# LATEST — 2026-11-22 · สำเร็จ Milestone 4: Commerce Core Domains
**Branch:** `main` · **Status:** DONE · สลาย Route ยักษ์สู่ 4 โดเมนการค้าหลัก (Catalog, Cart, Checkout, Inventory) พร้อม Concurrency Guard เรียบร้อย 100%

---

## 1. สรุปผลงานที่ดำเนินการใน Milestone 4

1. **Catalog Domain (`backend/src/modules/catalog/`):**
   - จัดการลำดับชั้นหมวดหมู่สินค้า 96 หมวดหมู่ด้วย `buildCategoryTree`
   - เชื่อมต่อสินค้ากับหมวดหมู่ด้วย `c.slug = p.category_id` ป้องกันปัญหาหมวดหมู่หาย
   - พัฒนาระบบค้นหาและแสดงรายการสินค้าพร้อมตัวกรอง และดึงรายละเอียดสินค้า (Product Detail)

2. **Inventory Domain (`backend/src/modules/inventory/`):**
   - พัฒนาระบบตัดสต็อกระดับ Concurrency Guard ด้วย Conditional Atomic UPDATE ป้องกัน Race Condition และการขายสินค้าเกินจำนวนสต็อก (Overselling)
   - มีระบบ Release Stock (เมื่อยกเลิกออเดอร์หรือหมดเวลาชำระเงิน) และ Commit Stock (เมื่อชำระเงินสำเร็จ)
   - บันทึกประวัติการเคลื่อนไหวของสต็อกลงตาราง `inventory_movements` ทุกครั้ง

3. **Cart Domain (`backend/src/modules/cart/`):**
   - พัฒนาระบบตะกร้าสินค้าพร้อมการจัดกลุ่มสินค้าตามร้านค้าผู้ขาย (`shop_id`) อัตโนมัติ รองรับ Multi-vendor Marketplace
   - คำนวณยอดเงินรวม (Subtotal และ Grand Total) ด้วยหน่วย Minor Satang (`bigint`) ทั้งหมด ปราศจาก Floating-point Discrepancy

4. **Checkout Domain (`backend/src/modules/checkout/`):**
   - **Idempotency Guard:** ตรวจสอบ `idempotency_key` จากตาราง `checkout_groups` ป้องกันการสร้างออเดอร์หรือตัดสต็อกซ้ำเมื่อผู้ใช้กดยืนยันซ้ำ
   - **Multi-shop Order Split:** แยกออเดอร์ในตะกร้าออกเป็น 1 `order` ต่อ 1 ร้านค้า (`shop_id`) ภายใต้ `checkout_group` เดียวกัน
   - **Atomic Inventory Reservation:** ดำเนินการตัดสต็อกสินค้าทุกชิ้นในคำสั่งซื้อภายใต้ Database Transaction เดียวกัน (`BEGIN ... COMMIT`)
   - **Fixed 30-Minute Reservation Window:** กำหนดระยะเวลาการจองสต็อกคงที่ 30 นาที (`payment_expires_at = NOW() + 30 min`) จากเวลาเซิร์ฟเวอร์อย่างเข้มงวด

5. **ผลการทดสอบ (Quality Gate):**
   - Unit Tests ของทั้ง 4 โดเมนพาณิชย์ผ่าน 10/10 ข้อ
   - รวมการทดสอบเข้าสู่ Contract Quality Gate ใน [backend/tests/packages-contracts.test.ts](file:///workspace/quiet-hopper/backend/tests/packages-contracts.test.ts)
   - รวมการทดสอบทั้งหมดของระบบ Rebuild ตั้งแต่ Milestone 1 ถึง 4 ผ่าน 57/57 ข้อ 100%

---

## 2. ไฟล์ที่สร้างและเปลี่ยนแปลง

- `backend/src/modules/catalog/*` *(สร้างใหม่)*: Category & Product Domain, Repository, Service, Routes
- `backend/src/modules/inventory/*` *(สร้างใหม่)*: Inventory Concurrency Guard & Movement Audit
- `backend/src/modules/cart/*` *(สร้างใหม่)*: Multi-shop Cart Grouping & Minor Calculations
- `backend/src/modules/checkout/*` *(สร้างใหม่)*: Multi-shop Order Split, 30-min Deadline & Idempotency
- `backend/tests/commerce/*.test.ts` *(สร้างใหม่)*: 4 test suites ครอบคลุม 10 กรณีทดสอบ
- `backend/tests/packages-contracts.test.ts` *(แก้ไข)*: เพิ่มการทดสอบ Commerce Contracts
- `package.json` *(แก้ไข)*: เพิ่ม script `test:commerce`
- `.ai/rebuild/MILESTONE_4_IMPLEMENTATION_REPORT.md` *(สร้างใหม่)*: รายงานผลการดำเนินงาน Milestone 4
- `.ai/rebuild/DEVELOPMENT_ROADMAP.md` *(แก้ไข)*: ปรับปรุงสถานะ Milestone 4 เป็น COMPLETED
- `.ai/AI_HANDOFF.md` *(แก้ไข)*: อัปเดตสถานะล่าสุดของโครงการ
- `.ai/reports/LATEST.md` *(แก้ไข)*: สรุปผลการดำเนินงานรอบล่าสุด

---

## 3. ขั้นตอนถัดไป (Next Step)

ระบบมีความพร้อม 100% ในการดำเนินการ **Milestone 5: Payment, Webhooks & Automated Settlement Engine**:
- ปรับปรุงโมดูล `stripe.ts` (3,122 บรรทัด) สู่ `backend/src/modules/payment/`
- จัดการ Stripe Checkout Sessions (Card, PromptPay QR)
- ประมวลผล Stripe Webhooks พร้อมระบบ Replay Protection และ Raw Body Signature Verification
- ผนวกการบันทึกบัญชี Double-Entry Ledger อัตโนมัติ (`@velnox/ledger`) เมื่อการชำระเงินสำเร็จและการเคลียร์ยอดให้ผู้ขาย (Settlement)
