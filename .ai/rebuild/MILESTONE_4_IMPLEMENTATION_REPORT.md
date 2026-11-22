# Velnox Rebuild — Milestone 4 Implementation Report
**Date:** 2026-11-22
**Milestone:** Milestone 4: Commerce Core Domains (Catalog, Cart, Checkout, Inventory)
**Status:** COMPLETED & VERIFIED

---

## 1. บทสรุปการดำเนินงาน (Executive Summary)

ใน Milestone 4 ได้ดำเนินการสลายไฟล์ Route ยักษ์ของระบบเดิม (`products.ts` 4,009 บรรทัด และ `cart.ts` 2,152 บรรทัด) สู่ **Commerce Core Modular Domains** จำนวน 4 โดเมนหลักที่มีโครงสร้าง 4 เลเยอร์ (domain, repository, services, routes) อย่างเป็นระเบียบ:

1. **Catalog Domain (`backend/src/modules/catalog/`):**
   - โครงสร้างลำดับชั้นหมวดหมู่สินค้า [backend/src/modules/catalog/domain/category.ts](file:///workspace/quiet-hopper/backend/src/modules/catalog/domain/category.ts) (`buildCategoryTree`) จัดการความสัมพันธ์ Root-Child ของ 96 หมวดหมู่ได้อย่างถูกต้อง
   - การเชื่อมโยง Category เข้ากับ Product [backend/src/modules/catalog/repository/product-repository.ts](file:///workspace/quiet-hopper/backend/src/modules/catalog/repository/product-repository.ts) ใช้ `c.slug = p.category_id` ตาม Canonical Contract ป้องกันปัญหา Category NULL
   - ระบบสืบค้นและแสดงรายการสินค้าพร้อมตัวกรอง (หมวดหมู่, คำค้นหา, ร้านค้า, ราคา) และการแสดงรายละเอียดสินค้า (Product Detail) พร้อมข้อมูลร้านค้าและสต็อก

2. **Inventory Domain (`backend/src/modules/inventory/`):**
   - พัฒนาระบบตัดสต็อกระดับ Concurrency Guard ใน [backend/src/modules/inventory/repository/inventory-repository.ts](file:///workspace/quiet-hopper/backend/src/modules/inventory/repository/inventory-repository.ts) ด้วย Conditional Atomic SQL:
     ```sql
     UPDATE inventory SET reserved = reserved + $1, updated_at = NOW()
     WHERE product_id = $2 AND quantity - reserved >= $1
     RETURNING id;
     ```
   - ป้องกันปัญหา Overselling และ Race Condition ในช่วงที่มีคำสั่งซื้อพร้อมกันหลายรายการ
   - มีระบบ Release Stock (เมื่อยกเลิกออเดอร์หรือหมดเวลาชำระเงิน) และ Commit Stock (เมื่อชำระเงินสำเร็จ)
   - บันทึกประวัติการเคลื่อนไหวของสต็อกลงตาราง `inventory_movements` ทุกครั้ง

3. **Cart Domain (`backend/src/modules/cart/`):**
   - พัฒนาระบบตะกร้าสินค้าใน [backend/src/modules/cart/domain/cart.ts](file:///workspace/quiet-hopper/backend/src/modules/cart/domain/cart.ts)
   - ฟังก์ชัน `groupCartItems` จัดกลุ่มสินค้าตามร้านค้าผู้ขาย (`shop_id`) โดยอัตโนมัติ เพื่อรองรับ Multi-vendor Checkout
   - คำนวณยอดเงินรวม (Subtotal และ Grand Total) ด้วยหน่วย Minor Satang (`bigint`) ทั้งหมด ปราศจาก Floating-point Discrepancy
   - รองรับ Add, Update Quantity, Remove, และ Clear Cart

4. **Checkout Domain (`backend/src/modules/checkout/`):**
   - พัฒนา [backend/src/modules/checkout/services/checkout-service.ts](file:///workspace/quiet-hopper/backend/src/modules/checkout/services/checkout-service.ts)
   - **Idempotency Guard:** ตรวจสอบ `idempotency_key` จากตาราง `checkout_groups` หากเป็นคำขอซ้ำ ระบบจะคืนค่าผลลัพธ์คำสั่งซื้อเดิม (Idempotent Replay) โดยไม่สร้างออเดอร์ซ้ำหรือตัดสต็อกซ้ำ
   - **Multi-shop Order Split:** แยกออเดอร์ในตะกร้าออกเป็น 1 `order` ต่อ 1 ร้านค้า (`shop_id`) ภายใต้ `checkout_group` เดียวกัน
   - **Atomic Inventory Reservation:** ดำเนินการตัดสต็อกสินค้าทุกชิ้นในคำสั่งซื้อภายใต้ Database Transaction เดียวกัน (`BEGIN ... COMMIT`) หากสินค้าชิ้นใดหมด ระบบจะ Rollback ทั้งหมด
   - **Fixed 30-Minute Reservation Window:** กำหนดระยะเวลาการจองสต็อกคงที่ 30 นาที (`payment_expires_at = NOW() + 30 min`) จากเวลาเซิร์ฟเวอร์อย่างเข้มงวด

---

## 2. ผลการทดสอบ (Quality Gate & Test Verification)

การทดสอบแบบ Automated ผ่านการรับรอง 100% (10/10 tests passed):

1. **`Commerce Core — Catalog Domain` (2 passed):**
   - ✔ สร้าง Category Tree ลำดับชั้น Parent-Child ถูกต้อง
   - ✔ ค้นหา แสดงรายการสินค้า และดึงรายละเอียด Product Detail สำเร็จ
2. **`Commerce Core — Inventory Domain` (3 passed):**
   - ✔ ตัดสต็อกสินค้าแบบ Atomic ด้วย Guarded Conditional Update
   - ✔ ปฏิเสธการสั่งซื้อเมื่อสต็อกไม่เพียงพอด้วย `ConflictError("INSUFFICIENT_STOCK")`
   - ✔ ปฏิเสธจำนวนสินค้าที่ไม่ถูกต้อง (<= 0 หรือ > 999)
3. **`Commerce Core — Cart Domain` (2 passed):**
   - ✔ จัดกลุ่มสินค้าแยกตามร้านค้า (`shop_id`) และคำนวณราคารวม Satang ถูกต้อง
   - ✔ ทดสอบการเพิ่ม ปรับปรุงจำนวน และลบสินค้าในตะกร้า
4. **`Commerce Core — Checkout Domain` (3 passed):**
   - ✔ แยกออเดอร์ตามร้านค้าหลายร้านภายใต้ Checkout Group เดียวกัน และจองสต็อกแบบ Atomic
   - ✔ ทดสอบ Idempotent Replay เมื่อส่ง Idempotency Key ซ้ำ ไม่มีการสร้างออเดอร์ซ้ำหรือจองสต็อกซ้ำ
   - ✔ สั่ง Rollback เมื่อสินค้าในตะกร้ามีสต็อกไม่เพียงพอ ไม่ให้มีออเดอร์ค้าง
5. **การทดสอบรวมทั้งหมดตั้งแต่ Milestone 1 ถึง 4:** ผ่าน 57/57 tests 100%
