# LATEST — 2026-11-11 · Brand-green headers + white Velnox logo

**Branch:** `main` · **HEAD:** `d823417` (pushed)

## 1. สรุปงาน (Thai)

เจ้าของให้ใช้โลโก้สีขาว (`velnox-mark-white.svg`) ในเว็บ และไม่ต้องมีพื้นหลัง/กล่อง
ของโลโก้ในหน้าอีก เพราะใช้โลโก้ขาวแล้ว

ตรวจก่อนแก้พบว่า **โลโก้ขาวจะมองไม่เห็นใน 9 จาก 10 จุด** เพราะพื้นหลังเป็นสีขาว/สว่าง
(desktop header, velseller, velcenter, corporate header/footer, cart drawer, auth, 404)
เหลือแค่ mobile header ของ velshop ที่เป็น `bg-brand` ซึ่งขาวจะเห็นชัด

เจ้าของเลือกแนวทาง: **เปลี่ยน header ทุกแอปเป็นพื้นสีเขียวแบรนด์ + โลโก้ขาว (ไม่มีกล่อง)**

## 2. สิ่งที่แก้

- **`Logo.tsx`** — มาร์คไม่มีกล่องพื้นหลังแล้ว · เพิ่ม `tone`: `light` (ขาว) / `dark`
  (`text-slate-900`) ผ่าน `currentColor` (ไม่ใช้ hex ดิบ — เคารพงาน tokenise Phase A)
- **header ทั้ง 4 แอปเป็น `bg-brand` + โลโก้ขาว**
  - velshop `ShopHeader` (desktop bar + mobile mark)
  - velseller `AppHeader`
  - velcenter `Center`
  - velnox `CorporateLayout` (รวมเมนูมือถือ)
  - nav / ปุ่ม / ไอคอน / badge ปรับเป็นโทนขาวทั้งหมด
- **คอมโพเนนต์ใน header รองรับ `tone="brand"`** — `LanguageSwitcher` (shared),
  `NotificationBell`, `SellerNotificationBell`, `UserMenu`
- **favicon** — พื้นเขียว `#10B981` + มาร์คขาว ใช้ทั้ง 4 แอป + `packages/shared/src/assets/logo.svg`
  (โลโก้ขาวล้วนบนแท็บสว่างจะมองไม่เห็น จึงต้องมีพื้นเขียว)
- โลโก้บนพื้นสว่าง (footer, auth, 404, cart drawer) คงโทน ink ตามเดิม

## 3. การตัดสินใจ

- wordmark บนพื้นเขียวเป็น **ขาวล้วน** — วัดได้ว่ามินต์ `#A7F3D0` บน `#10B981`
  ให้ contrast แค่ 1.98:1 (มองไม่เห็น)
- คง `bg-brand` (#10b981) ตามที่เจ้าของระบุ และตรงกับ pattern `bg-brand text-white`
  ที่มีอยู่ทั่วระบบ — บันทึกค่าที่วัดได้: ขาวบน brand = **2.54:1**,
  `--brand-strong` (#059669) = **3.77:1**, `--brand-deep` (#0f766e) = **5.47:1**
  (ถ้าต้องการ AA เปลี่ยนคลาส `bg-brand` → `bg-brand-deep` ที่ header)

## 4. ไฟล์ที่เปลี่ยน

`packages/shared/src/components/{Logo,AppHeader,LanguageSwitcher,SellerNotificationBell,UserMenu}.tsx`
· `apps/velshop/src/components/shop/{ShopHeader,NotificationBell}.tsx`
· `apps/velcenter/src/pages/Center.tsx` · `apps/velnox/src/pages/corporate/CorporateLayout.tsx`
· favicon: `apps/{velshop,velseller,velcenter,velnox}/public/logo.svg`,
  `packages/shared/src/assets/logo.svg`, `public/logo.svg`

## 5. ผลการทดสอบ

- `bun run typecheck` → **4/4 apps ผ่าน** ✅
- build → **4/4 apps ผ่าน** (`dist/logo.svg` อยู่ root ทุกแอป) ✅
- render favicon ลง canvas วัดสี: เขียว 90.7% / ขาว 5.8% / โปร่งใส 3.0% ✅
- `git diff --check` → สะอาด ✅
- **ยังไม่ได้ตรวจด้วยตาในเบราว์เซอร์จริง** — browser preview ถูกซ่อน (screenshot ไม่ได้)
  ควรเปิดดูหลัง deploy 1 รอบ

## 6. หมายเหตุ

- repo มี commit refactor UI จาก session อื่นคั่นระหว่างงาน (tokenise hex → token)
  งานนี้จึงใช้ `text-brand` / `currentColor` ไม่ใช่ hex ดิบ
- Stripe live ยังระงับตามคำสั่งเจ้าของ
