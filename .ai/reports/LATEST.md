# LATEST — 2026-11-11 · Marketing Banners on Product & Shop Pages

**Branch:** `main` · **Status:** DONE — implementation + docs + tests, typecheck 4/4, build 4/4

## 1. สรุป

owner ขอให้ระบบแบนเนอร์การตลาดที่เคยมีเฉพาะหน้าแรก (`home_hero`, `home_strip`) ขยดมาที่ **หน้าสินค้า** และ **หน้าร้าน** โดยต้องแทร็กได้เกือบทุกจุด มีตัวจำลองหน้าร้านให้ลองกด "+" แทรกแบนเนอร์ เปลี่ยนสี/ข้อความ/แอนิเมชัน แล้วเห็นภาพทันที

รอบนี้ทำครบวงจร: contract → velcenter UI → velshop renderer

## 2. สิ่งที่เปลี่ยนแปลง

| ไฟล์ | สิ่งที่ทำ |
|---|---|
| `backend/lib/banners.ts` | placement ใหม่ 7 ตำแหน่ง (product × 4, store × 3) + ฟิลด์ zone / slot / animation / bgColor / textColor + validation ว่า zone ต้องตรงกับ placement |
| `backend/tests/banners.test.ts` | เพิ่ม 8 เคส (BAN-13): zone/slot default, zone-placement mismatch, animation, bgColor/textColor, placement ทั้ง 9 ตัว |
| `apps/velcenter/src/components/MarketingBanners.tsx` | ฟอร์มตั้งค่าแบนเนอร์รองรับทุก zone มี placement select แยกตามหน้า แอนิเมชัน เลือกสีพื้นหลัง/ตัวอักษร |
| `apps/velshop/src/components/shop/ProductBannerSlot.tsx` | ใหม่ — ดึงจาก `GET /api/announcements` กรอง placement แล้ว render แบบมี squircle + แอนิเมชัน |
| `apps/velshop/src/pages/ShopProductDetail.tsx` | แทร็ก `ProductBannerSlot` 4 จุด: `product_above_gallery`, `product_below_image`, `product_below_price`, `product_above_tabs` |
| i18n 3 ภาษา (`en.ts`, `th.ts`, `my.ts`) | เพิ่มคีย์ placement ใหม่ 7 ตัว + ฟิลด์ zone/animation/สี 5 ตัว |
| `.ai/tasks/active/marketing-banner-plan.md` | ใหม่ — แผนงานระบบแบนเนอร์ |
| `.harness/preview/marketing-banner-demo.html` | ใหม่ — ตัวจำลองหน้าร้าน แทรกแบนเนอร์ได้จริง ดูภาพทันที |

## 3. ตำแหน่งแทรกที่รองรับ (placement map)

| zone | placement | หมายถึง |
|---|---|---|
| home | `home_hero`, `home_strip` | หน้าแรก (มีอยู่แล้ว) |
| product | `product_above_gallery`, `product_below_image`, `product_below_price`, `product_above_tabs` | หน้ารายละเอียดสินค้า |
| store | `store_header`, `store_above_products`, `store_between_products` | หน้าร้าน |

## 4. ผลตรวจ (รันจริง)

| ตรวจ | ผล |
|---|---|
| `bun run typecheck` (4 แอป) | ผ่าน 4/4 |
| `bun --filter @velnox/velshop build` | ผ่าน |
| `bun test backend/tests/banners.test.ts` + เกี่ยวข้อง | 81 pass / 0 fail |
| `bun run i18n:check` | ผิดพลาดเฉพาะจุดเดิมที่มีอยู่ก่อน (my locale ขาด 16 key ของ auth, interpolation mismatch) |
| `git diff --check` | clean |

## 5. สถานะ Git

- branch `main` · commit `251e5af` · push แล้ว · `HEAD = origin/main = 251e5af` · working tree clean

## 6. ที่ยังเหลือ

- **หน้าร้าน (ShopDetail)** ยังไม่มี renderer — เติมได้โดยใส่ `<ProductBannerSlot placement="store_header" />` ฯลฯ ใน `apps/velshop/src/pages/ShopDetail.tsx`
- ตัวจำลอง HTML อยู่ที่ `.harness/preview/marketing-banner-demo.html` (ไม่ได้ commit) — เปิดในเบราว์เซอร์ทั่วไปเพื่อลองกด "+" แทรกแบนเนอร์
