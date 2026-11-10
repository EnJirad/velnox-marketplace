# 2026-11-11 — Brand-green headers + white Velnox logo

## สรุป
- Owner ให้ใช้โลโก้ขาว (`velnox-mark-white.svg`) และไม่ต้องมีพื้นหลัง/กล่องของโลโก้ในหน้าเว็บ
- ตรวจพบว่าโลโก้ขาวจะมองไม่เห็นบน 9/10 จุด (พื้นขาว) → owner เลือก
  **เปลี่ยน header ทุกแอปเป็นพื้นเขียวแบรนด์ + โลโก้ขาว**
- แก้ `Logo.tsx`: มาร์คไม่มีกล่องพื้นหลังแล้ว, เพิ่ม `tone` = `light` (ขาว) / `dark` (ink)
- Header ทั้ง 4 แอปเป็น `bg-brand` + โลโก้ขาว + เมนู/ปุ่ม/ไอคอนขาว
- คอมโพเนนต์ใน header รองรับ `tone="brand"`: LanguageSwitcher (shared + velshop),
  NotificationBell, SellerNotificationBell, UserMenu
- favicon = พื้นเขียว `#10B981` + มาร์คขาว (มองเห็นบนแท็บสว่าง), ใช้ทั้ง 4 แอป + shared asset

## การตัดสินใจ
- โลโก้บนพื้นสว่าง (footer, auth, 404, cart drawer) คงโทน ink ไม่ใช่ขาว
- wordmark บนพื้นเขียวเป็นขาวล้วน (มินต์ "nox" ให้ contrast 1.98:1 = มองไม่เห็น)
- คง `bg-brand` ตามที่ owner ระบุ และตรงกับ pattern `bg-brand text-white` เดิมของระบบ
  (contrast 2.54:1) — ทางเลือกยกระดับ AA: `bg-brand-strong` 3.77:1 หรือ `bg-brand-deep` 5.47:1

## ไฟล์
- `packages/shared/src/components/Logo.tsx` (tone + ไม่มีกล่อง)
- `apps/velshop/src/components/shop/ShopHeader.tsx`, `NotificationBell.tsx`
- `packages/shared/src/components/AppHeader.tsx`, `LanguageSwitcher.tsx`,
  `SellerNotificationBell.tsx`, `UserMenu.tsx`
- `apps/velcenter/src/pages/Center.tsx`
- `apps/velnox/src/pages/corporate/CorporateLayout.tsx`
- favicon: `apps/{velshop,velseller,velcenter,velnox}/public/logo.svg`,
  `packages/shared/src/assets/logo.svg`, `public/logo.svg` (source ขาว)

## ตรวจสอบ
- typecheck 4/4 แอปผ่าน, build 4/4 ผ่าน (dist/logo.svg อยู่ root ทุกแอป)
- วัด contrast ด้วย canvas/สูตร WCAG ตามตัวเลขที่บันทึกด้านบน

## Commit
- `d823417` feat(ui): header ทุกแอปเป็นพื้นเขียวแบรนด์ + โลโก้ Velnox สีขาว
