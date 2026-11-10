# LATEST — 2026-11-10 · Launch readiness รอบ 1: ปิดรูรั่วที่ฆ่าการขาย

**Branch:** `main` · **Commits:** `73058e3` (backend) + `76eada0` (velshop) · **Status:** DONE — verified

ที่มา: `.ai/tasks/active/launch-readiness-plan.md` (audit 2 ชุด + ตรวจซ้ำกับ production)

## 1. ตะกร้าของ guest หายเมื่อ refresh และหายเมื่อล็อกอิน (แก้แล้ว)

**อาการ:** `apps/velshop/src/lib/cart.tsx` เก็บตะกร้าของคนที่ไม่ล็อกอินไว้ใน React state อย่างเดียว
⇒ refresh = ว่าง และเมื่อล็อกอิน effect โหลด server cart มาทับ **ไม่ merge** ⇒ ลูกค้าเลือกของ →
กด checkout → `RequireAuth` พาไปล็อกอิน → กลับมา **ตะกร้าว่าง เงียบ ๆ** ไม่มีข้อความบอก

**แก้:**
- `packages/shared/src/lib/guest-cart.ts` (ใหม่) — storage แบบ pure ไม่พึ่ง React
  - validate ตอนอ่าน: entry ที่พังถูก **ทิ้ง ไม่ซ่อม**
  - `qty` ถูก clamp กับ stock ที่บันทึกไว้ ⇒ ของที่ค้างเก่าไม่สามารถขอเกินสต็อกที่เคยมี
  - ทน storage ที่ throw (Safari private mode / WebView ล็อก)
- `cart.tsx`
  - seed state จาก storage **ตอน render แรก** ไม่ใช่ใน effect (ถ้าทำใน effect จะมีจังหวะที่ `lines`
    เป็น `[]` แล้ว effect เขียนทับของที่เก็บไว้)
  - mirror การแก้ตะกร้าของ guest ลง storage (ข้ามเมื่อล็อกอิน — server เป็นเจ้าของ)
  - merge เข้า server cart **ครั้งเดียวต่อการล็อกอิน** — บรรทัดที่ server ปฏิเสธถูกเก็บไว้ลองใหม่
    บรรทัดที่สำเร็จถูกล้าง ⇒ ลองซ้ำไม่ทำให้จำนวนคูณสอง
  - `apiCartAdd` โยน error เมื่อ response ไม่ใช่ 2xx (เดิมกลืน ⇒ merge แยกไม่ออกว่าบรรทัดไหนถูกปฏิเสธ)

## 2. ปุ่มจ่ายกดได้ทั้งที่ไม่มีวิธีจ่าย (แก้แล้ว)

`ShopCheckout.tsx` — เพิ่มเงื่อนไข `(methodOptions !== null && enabledMethods.length === 0)` ให้
**ทั้ง desktop และ mobile CTA** เดิมปุ่มเปิดอยู่ ลูกค้ากรอกครบ กดจ่าย ได้ toast เดียว

## 3. ร้านที่ถูกระงับยังขายได้ (แก้แล้ว)

`backend/routes/products.ts` — catalog และ product detail เพิ่ม `AND sh.status = 'active'`
เดิมกรองแค่ `p.status = 'published'` ⇒ ระงับร้านแล้วสินค้ายังขายต่อและเข้าถึงได้ด้วย deep link
**ไม่แตะ** `WHERE p.shop_id = $1` (รายการสินค้าของ seller เอง ต้องยังเห็นของตัวเอง)

## 4. Test ที่ pin contract เก่า — อัปเดตตามพฤติกรรมจริง ไม่ได้ลบ

`product-lifecycle.test.ts` (2 จุด) และ `product-visibility.test.ts` (1 จุด) assert สตริง
`let where = "WHERE p.status = 'published'"` ตรง ๆ ⇒ อัปเดตเป็นเงื่อนไขใหม่ เพื่อให้ด่านนี้ยังกัน
regression ได้จริง `checkout-payment-flow.test.ts` assert ว่ามี CTA ที่ disable ด้วยเงื่อนไขเดิม
**2 จุด** ⇒ อัปเดต regex ตามเงื่อนไขใหม่ (และชี้ให้เห็นว่าเดิมมี CTA ที่สองหลุด)

## 5. ตรวจแล้ว

`git diff --check` clean · typecheck 4 apps exit 0 · backend typecheck exit 0 ·
`bun run test` **1432 pass / 0 fail** (เพิ่ม 12 เคส guest cart) · i18n th/en/my 2235 parity

## 6. ยังไม่ได้ทำ (รอบถัดไป)

- **ยังไม่ทดสอบบน production** — ต้อง deploy ก่อนแล้วลอง: เพิ่มของตอนไม่ล็อกอิน → refresh →
  ล็อกอิน → ของต้องยังอยู่ การทดสอบนี้ต้องมีบัญชีผู้ใช้จริง
- **Step 3 ของแผน** (บัตรถูกปฏิเสธแล้วจ่ายซ้ำ) ยังไม่แตะ — ต้องยิงบัตรทดสอบจริงก่อน
- **ไม่ได้กรอง sellers.status** — ทำเฉพาะ shops.status เพราะยังไม่มีหลักฐานว่าธุรกิจต้องการ
  ซ่อนสินค้าเมื่อผู้ขาย (ไม่ใช่ร้าน) ถูกระงับ ต้องให้ owner ตัดสิน
