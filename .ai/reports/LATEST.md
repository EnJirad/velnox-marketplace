# LATEST — 2026-11-11 · Squircle Shape Language (Design System v2.2)

**Branch:** `main` · **Status:** DONE — implementation + docs + guard test, typecheck 4/4, build 4/4

## 1. สรุป

owner ขอให้ "สี่เหลี่ยมขอบมน จะกลมก็ไม่กลม จะเหลี่ยมก็ไม่เหลี่ยม" เป็น**ธีมรูปร่างประจำตัว**
ของเว็บ ไม่ใช่แค่ปรับปุ่มเดียว รอบนี้จึงยกระดับจาก "แก้ class ทีละจุด" เป็น**ระบบ shape
อย่างเป็นทางการ** ใน design system:

- เพิ่ม radius token 4 ขั้นใน `packages/shared/src/index.css` (`@theme inline`)
- เปลี่ยน primitive ที่ทุกหน้าใช้ร่วมกัน (Button / Badge / Input / Card / SegmentedOption)
- เปลี่ยน surface ที่เป็น "หน้าตา" ของร้าน (header, category chips, product card,
  product detail, gallery, lightbox)
- เขียนกฎลง `VELNOX_DESIGN_THEME.md` เป็น §7.1 + checklist + changelog v2.2
- เพิ่ม guard test กันไม่ให้ radius drift กลับ

## 2. Scale ที่ประกาศ (วัดจาก CSS ที่ build จริง)

| Token | ค่า | ใช้กับ |
|---|---|---|
| `rounded-squircle-xs` | 7px | `Badge`, chip เล็ก, ตัวนับ |
| `rounded-squircle-sm` | 10px | ปุ่ม `size="sm"`, search, filter chip, ปุ่มไอคอน `size-8` |
| `rounded-squircle` | 14px | ปุ่มมาตรฐาน `h-11`, `Input`, ปุ่มไอคอน `size-10/11`, lightbox toolbar |
| `rounded-squircle-lg` | 18px | ปุ่ม `size="lg"`, `Card`, กรอบรูปสินค้า + แถบ thumbnail |

หลักคิด: radius ≈ 30% ของด้านสั้น → badge 22px ได้ 7px, ปุ่ม 44px ได้ 14px
ถ้าใช้เลขเดียวทุกขนาด ป้ายเล็กจะกลายเป็นวงกลม

**ยืนยันว่า token ทำงานจริง** — grep จาก `apps/velshop/dist/assets/*.css`:

```
rounded-squircle{border-radius:.875rem}
rounded-squircle-lg{border-radius:1.125rem}
rounded-squircle-sm{border-radius:.625rem}
rounded-squircle-xs{border-radius:.4375rem}
```

## 3. กฎที่เขียนไว้ (§7.1)

1. control ที่ไม่ใช่วงกลมจริง = squircle (ห้าม `rounded-md/lg/xl` กับ control ใหม่)
2. `rounded-full` สงวนให้ของที่เป็นวงกลมจริง: avatar, status dot, spinner, progress, switch thumb
3. เลือก step ตามขนาด ไม่ใช่ตามความชอบ
4. ปุ่มไอคอนต้องมี `flex items-center justify-center` (ต้นเหตุไอคอนลอยใน lightbox)
5. ห้าม radius ดิบ `rounded-[14px]`

## 4. ไฟล์ที่แก้

| ไฟล์ | สิ่งที่ทำ |
|---|---|
| `packages/shared/src/index.css` | +4 squircle tokens พร้อมคอมเมนต์กฎ |
| `packages/shared/src/components/ui/button.tsx` | base 14px · sm 10px · lg 18px (icon inherits) |
| `packages/shared/src/components/ui/badge.tsx` | pill → squircle-xs |
| `packages/shared/src/components/ui/input.tsx` | rounded-md → squircle |
| `packages/shared/src/components/ui/card.tsx` | rounded-xl → squircle-lg |
| `packages/shared/src/components/ui/segmented.tsx` | 3 recipes → squircle |
| `packages/shared/src/components/shop/ProductGallery.tsx` | กรอบหลัก + แถบ thumbnail ใช้ squircle-lg ตัวเดียวกัน |
| `packages/shared/src/components/shop/GalleryLightbox.tsx` | toolbar plate squircle + ไอคอนกลางกรอบ |
| `apps/velshop/src/components/shop/ShopHeader.tsx` | search + ปุ่มไอคอน |
| `apps/velshop/src/components/shop/CategoryStrip.tsx` | chips + ลูกศรเลื่อน |
| `apps/velshop/src/components/shop/ProductCard.tsx` | ปุ่มหัวใจ |
| `apps/velshop/src/components/shop/ProductActionBar.tsx` | like/save/share/comment |
| `apps/velshop/src/pages/ShopProductDetail.tsx` | badge, ปุ่มเลื่อนรูป, ตัวนับรีวิว |
| `VELNOX_DESIGN_THEME.md` | v2.2 + §7.1 + checklist + changelog |
| `.ai/context/frontend.md` | ชี้ v2.2 + กฎ squircle |
| `backend/tests/design-squircle.test.ts` | ใหม่ — guard test 17 เคส |
| `backend/tests/product-gallery-description.test.ts` | อัปเดต assertion ของกรอบ gallery |

## 5. ผลตรวจ (รันจริง)

| ตรวจ | ผล |
|---|---|
| `bun run typecheck` (4 แอป) | ผ่าน 4/4 (exit 0) |
| `bun run build:apps` | ผ่าน 4/4 (velshop 12.8s · velseller 9.6s · velcenter 7.4s · velnox 8.2s) |
| `bun test backend/tests/design-squircle.test.ts` + gallery test | 36 pass / 0 fail |
| `bun test backend/tests` (ทั้งชุด) | 1370 pass · 431 skip · 3 fail (**มีอยู่ก่อนแล้ว** — ยืนยันด้วย stash บน HEAD สะอาด) |
| `bun run i18n:check` | FAIL — **มีอยู่ก่อนแล้ว** (my locale ขาด 16 key, `productDetail.addedToast` interpolation) |
| `git diff --check` | clean |
| compiled CSS | squircle utilities ออกครบ 4 ค่า |

**ยังไม่ได้ตรวจด้วยตาในเบราว์เซอร์จริง** — เครื่องนี้ไม่มี `.env`/DB จึงรัน backend + หน้าร้านไม่ได้
ใช้ mockup `.harness/preview/squircle-theme.html` เทียบขนาดจริงแทน

## 6. ที่ยังเหลือ (staged rollout)

Dialog/Sheet/Popover surface, Select, Textarea, Tabs, ตาราง VelCenter,
หน้า checkout/orders ของ VelShop, หน้า seller — ทำเมื่อแตะหน้านั้นอยู่แล้ว
(เขียนไว้ใน §7.1 "สถานะการ migrate" แล้ว)
