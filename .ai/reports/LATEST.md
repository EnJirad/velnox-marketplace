# LATEST — 2026-11-11 · Product Gallery + Rich Description (VelShop ↔ VelSeller)

**Branch:** `main` · **HEAD:** `301a483` · **Status:** DONE — push แล้ว, CI เขียวทั้งสอง workflow, gallery ตรวจบน production จริง

## 1. สรุป

ทำระบบ gallery + rich description ให้ VelShop และ VelSeller ใช้ข้อมูลชุดเดียวกันจริง
ตั้งแต่ Seller → Backend → R2 → Neon → Public API → VelShop ไม่ใช่แค่ปรับ UI

## 2. Gallery ตาม reference

`packages/shared/src/components/shop/ProductGallery.tsx` (ใหม่ — ใช้ทั้ง 2 แอป)

```
[ MAIN ]  |  [ t1 ]        รูปหลักซ้าย · thumbnail คอลัมน์แนวตั้งขวา
          |  [ t2 ]        เส้นแบ่งแนวตั้งจริง กึ่งกลางช่องว่าง
          |  [ t3 ]        เลือกแล้วกรอบ accent
```

**วัดบน production จริง (velshop.vercel.app, viewport 415px):**

| องค์ประกอบ | ค่าที่วัดได้ |
|---|---|
| main image | x=16, width=282 |
| divider | x=308, width=1, height=312 (เต็มความสูง) |
| ระยะห่าง divider ↔ main | **10 px** |
| ระยะห่าง divider ↔ thumbnails | **10 px** |
| thumbnail column | x=319, width=80, เรียงแนวตั้ง |
| ขนาด thumbnail | 72 px ทุกใบ (uniform) |
| กรอบรูปที่เลือก | `rgb(16, 185, 129)` = brand |
| ตัวนับ | `1 / 4` |

**ทดสอบ interaction บน production:** คลิก thumbnail ใบที่ 2 → รูปหลักเปลี่ยน (cdfdab… → 109623…), ตัวนับ `2 / 4`, ใบที่ 2 ได้ `aria-selected`

มี: swipe · prev/next · ลูกศรซ้าย-ขวาบนเดสก์ท็อป · คลิกซูม · loading/error/empty · กล่อง 1:1 จองที่ไว้ (ไม่มี layout shift)
ไม่มีเส้นแบ่งเมื่อมีรูปเดียว (`hasMoreThanOne &&`)

## 3. การแยกภาพ 3 ประเภท — แก้บั๊กจริง

**เดิม:** `ShopProductDetail` push detail images เข้า carousel เป็น `group: 2`
→ รูปประกอบรายละเอียดไปโผล่ในแถบ thumbnail ของ gallery

**ตอนนี้:** gallery ใช้เฉพาะ `gallery` + variant ที่เลือก · detail images render ในแท็บรายละเอียด
ตาม `sort_order` — **วัดบน production: gallery 4 ใบ, detail 5 ใบแยกออกมาอยู่นอก gallery**

## 4. Seller editor

`packages/shared/src/components/seller/ProductFormDialog.tsx`

- **ลากสลับลำดับ** (HTML5 DnD) + ปุ่ม "ตั้งเป็นหลัก" = ย้ายไป index 0
  ซึ่งเป็น `sort_order 0` ที่ backend บันทึกอยู่แล้ว → ไม่มีแนวคิด "รูปหลัก" ที่สอง
- **preview สด** ใช้ `ProductGallery` ตัวเดียวกับหน้าร้าน (เห็นเส้นแบ่งเหมือนของจริง)
- ลบ / จำนวน 10 / สถานะ upload / อัปโหลดหลายรูป — ของเดิมที่มีอยู่แล้วคงไว้
- เปิดแก้ไขสินค้าเดิม → ได้ลำดับ + รูปหลัก + บล็อกเดิมครบ (`setBlocks` จาก `descriptionBlocks`)

## 5. Rich description

`backend/lib/description-blocks.ts` (validator กลาง) + `products.description_blocks` JSONB

| ชนิดบล็อก | ต้องมี |
|---|---|
| `heading` | text |
| `text` | text |
| `image` | imageUrl |
| `image_caption` | imageUrl + caption |
| `image_text` | imageUrl + text (side-by-side บนเดสก์ท็อป) |

- 40 บล็อก / 4,000 ตัวอักษรต่อบล็อก / เฉพาะ URL `http(s)` หรือ `//` / `id` ซ้ำ = 400
- ค่าว่าง = `[]` (ไม่ error) → สินค้าเดิมยังใช้ plain description ได้
- เขียนผ่าน 2 ทางเดิม (`PATCH /api/seller/products/:id`, `POST .../create-full`) โดยมี ownership check
- อ่านกลับทั้ง seller list และ public API (เรียงตามลำดับที่ผู้ขายจัด)
- รูปในบล็อกอัปโหลดเป็น **detail** image (`draftUpload(..., "details")`) → ไม่มีทางหลุดเข้า gallery

## 6. Database

| ไฟล์ | สิ่งที่เพิ่ม |
|---|---|
| `db/schema.sql` | `products.description_blocks JSONB NOT NULL DEFAULT '[]'::jsonb` |
| `db/run-sqleditor.sql` | CREATE TABLE + `ADD COLUMN IF NOT EXISTS` (reconciler) |
| `db/verify-reconciler.sh` | `CANON="67|256|285|717"` (วัดจาก CI จริง: +1 column) |

**ไม่มีการลบ/แก้ข้อมูลเดิม** — additive column ที่มี default

## 7. ผลทดสอบ (รันจริง)

| คำสั่ง | ผล |
|---|---|
| `bun run typecheck` (4 apps) | ✅ exit 0 |
| `bun --filter @velnox/backend typecheck` | ✅ exit 0 |
| `bun test ./backend/tests` | ✅ **1442 pass / 0 fail** / 425 skip (1889 tests, 104 ไฟล์) |
| ใหม่: `product-gallery-description.test.ts` | ✅ 22 pass — layout/เส้นแบ่ง/ลำดับ=รูปหลัก/แยก detail/validation/schema/ownership/i18n |
| `bun run i18n:check` | ✅ th=2256 en=2256 my=2256 parity |
| `bun run build:apps` | ✅ 4/4 |
| `git diff --check` | ✅ clean |
| CI `Tests` | ✅ success `301a483` |
| CI `Production DB Verify` | ✅ success `301a483` |
| production DOM (velshop) | ✅ divider + 4 thumbs + counter + click เปลี่ยนรูป |

**ยังไม่ได้ทดสอบ:** DB-gated end-to-end suites (425 skip ในเครื่องนี้ — ไม่มี PostgreSQL;
รันบน CI เท่านั้น) และ UI ของ VelSeller ด้วยผู้ใช้จริง (ต้อง login เป็น seller)

## 8. Git

- `dea50dc` feat(product): gallery + rich description
- `301a483` fix(db): CANON 717
- push → `origin/main` = `301a483` · working tree clean

## 9. ปัญหาที่ยังเหลือ

1. **production ยังไม่มีคอลัมน์ `description_blocks`** — ต้องรัน *Production DB Reconcile*
   (manual, เขียน DB จริง — รอ owner สั่ง) ระหว่างนี้อ่านปลอดภัย เขียน blocks จะ error
2. 425 DB-gated tests skip ในเครื่อง — ต้องดูผลบน CI
3. VelSeller ยังไม่ได้กดทดสอบด้วยบัญชี seller จริง (ต้อง login)
