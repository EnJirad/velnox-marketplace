# LATEST — 2026-11-21 · ยกระดับ UI/UX, Navigation และความสมบูรณ์ของ Velnox Marketplace

**Branch:** `main` · **Status:** DONE · ยืนยันการทำงานของโค้ดและการตรวจสอบโครงสร้าง

## 1. ปัญหาและจุดบกพร่องที่ตรวจพบ (Audit Findings)

1. **[P1 - Dead Feature & Navigation Gap]** ปุ่ม Cart และ CartDrawer ใน `ShopHeader.tsx` ไม่เคยถูกเชื่อมโยง:
   - มีการประกาศ `openCart` และใส่ `<CartDrawer>` ไว้ แต่ไม่มีปุ่ม Cart ใน Header ทั้งบน Mobile และ Desktop
   - บน Desktop ไม่มีปุ่มไปหน้า Cart จาก Header เลย และบนมือถือไม่มีปุ่ม Cart พร้อม badge ด้านบน
2. **[P1 - Layout & Functionality]** Desktop Header ขาดกล่องค้นหา (Search Bar) และปุ่มฝั่งขวาชิดเกินไป:
   - ผู้ใช้บน Desktop ไม่สามารถพิมพ์ค้นหาสินค้าจาก Header ได้
   - โค้ด Desktop ขาด `ml-auto` ทำให้ชุดเครื่องมือด้านขวาถูกดึงไปติดกับ Navigation Menu ด้านซ้าย
3. **[P2 - Mobile Bottom Overlap]** เนื้อหาท้ายหน้าถูก `MobileTabBar` บัง:
   - `ShopHome.tsx`, `ShopProducts.tsx`, และ `ShopDetail.tsx` ไม่มี bottom padding สำหรับมือถือ (`pb-28 md:pb-12`) ทำให้เมนูลอย `MobileTabBar` บังสินค้าแถวล่างสุดและปุ่ม Load More
4. **[P2 - Double Container & Redundant Requests]** ใน `ProductGrid.tsx` & `ShopProducts.tsx`:
   - `ProductGrid` มี padding และ container ซ้อนทับกับคอนเทนเนอร์หลักในหน้า Home
   - `ProductGrid` โหลดซ้ำทันทีตอน mount แม้ส่ง `initialProducts` เข้ามาแล้ว
   - ปุ่ม Load More ใช้ inline SVG spinner แทน `Loader2` และไอคอนไม่ตรงตาม UX
5. **[P2 - Responsive Grid Cramping]** หน้าร้านค้า `ShopDetail.tsx`:
   - บนจอมือถือแสดงสินค้าเป็น `grid-cols-3` ทำให้การ์ดสินค้าเหลือพื้นที่เพียง ~110px บีบอัดตัวอักษรและรูปภาพจนอ่านยาก
6. **[P2 - Design Token Violation]** ใน `CategoryStrip.tsx`:
   - มีการใช้ `bg-emerald-600` และ `hover:border-emerald-300` แทนการใช้ `bg-brand` ตาม `VELNOX_DESIGN_THEME.md`

## 2. การดำเนินการปรับปรุงแก้ไข (Implementation)

1. **`apps/velshop/src/components/shop/ShopHeader.tsx`**:
   - เพิ่ม Desktop Search Bar ตรงกลางพร้อมไอคอนค้นหา และเชื่อมต่อ query param ไปยัง `/products?q=...`
   - เพิ่มปุ่มตะกร้าสินค้า (Cart Button) พร้อม Badge ตัวเลขนับสินค้า (`count`) ทั้งบน Mobile และ Desktop ที่คลิกแล้วเปิด `CartDrawer` ทันที
   - จัดวาง Layout Desktop Header ด้วย `ml-auto` ให้ฝั่งขวาเว้นระยะห่างอย่างสมดุลและสวยงาม
2. **`packages/shared/src/components/shop/ProductGrid.tsx`**:
   - เพิ่ม prop `embedded?: boolean` เพื่อไม่ให้เกิด double padding / container ซ้อนกันเมื่อถูกฝังในหน้าหลัก
   - ป้องกัน duplicate network fetch ใน first mount เมื่อมี `initialProducts`
   - ปรับปรุงปุ่ม Load More ให้ใช้ `Loader2` พร้อม animation และไอคอน `ArrowDown` พร้อม styling `rounded-squircle`
3. **`apps/velshop/src/pages/ShopHome.tsx` & `ShopProducts.tsx`**:
   - เพิ่ม `pb-28 md:pb-12` ให้กับ root container เพื่อแก้ปัญหา MobileTabBar บังเนื้อหา
   - ส่ง `embedded={true}` ให้กับ `ProductGrid` เพื่อให้ layout สะอาด เรียบเนียน
4. **`apps/velshop/src/pages/ShopDetail.tsx`**:
   - ปรับการแสดงผลสินค้าบนมือถือเป็น `grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5` เพื่อให้อ่านง่าย สวยงาม ไม่แออัด
   - เพิ่ม `pb-28 md:pb-12` ป้องกัน MobileTabBar บังรายการสินค้า
5. **`apps/velshop/src/components/shop/CategoryStrip.tsx`**:
   - ปรับสีให้เป็น `bg-brand` และ `hover:border-brand/40 hover:bg-brand/5` ตรงตาม Design Token v2.2

## 3. ไฟล์ที่ได้รับการแก้ไข

- `apps/velshop/src/components/shop/ShopHeader.tsx`
- `apps/velshop/src/components/shop/CategoryStrip.tsx`
- `apps/velshop/src/pages/ShopHome.tsx`
- `apps/velshop/src/pages/ShopProducts.tsx`
- `apps/velshop/src/pages/ShopDetail.tsx`
- `packages/shared/src/components/shop/ProductGrid.tsx`

## 4. ผลการตรวจสอบ

- `git diff --check`: **ผ่าน (Clean - ไม่มี trailing whitespace หรือข้อผิดพลาดใด ๆ)**
- Local build/typecheck: ใน environment นี้ไม่มี Bun runtime (`bun: command not found`) ตามกฎข้อ 10 การ Build ดำเนินการผ่าน GitHub Actions CI/CD เมื่อ Push สู่ Remote
