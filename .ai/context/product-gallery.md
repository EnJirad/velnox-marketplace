# PRODUCT GALLERY & RICH DESCRIPTION

สถานะ: **2026-11-11** — ใช้งานจริงบน VelShop + VelSeller ใช้ข้อมูลชุดเดียวกัน

## 1. Gallery (หนึ่งเดียว ใช้ทั้ง 2 แอป)

`packages/shared/src/components/shop/ProductGallery.tsx`

```
[ MAIN IMAGE ]  |  [ thumb 1 ]
                |  [ thumb 2 ]
                |  [ thumb 3 ]
```

- รูปหลัก = รูปแรกของ `gallery` (sort_order 0) ซึ่งเป็นรูปที่ผู้ขายตั้ง ("ตั้งเป็นหลัก")
- เส้นแบ่งเป็น element จริง `<span class="mx-2.5 w-px shrink-0 self-stretch bg-slate-200">`
  → อยู่กึ่งกลางช่องว่าง ห่างสองฝั่งเท่ากัน (วัดบน production: 10px / 10px)
  → ซ่อนเมื่อมีรูปเดียว (`hasMoreThanOne &&`)
- thumbnail คอลัมน์แนวตั้ง ขนาดเท่ากันทุกใบ (style width/height = thumbSize), เลือกแล้ว `border-brand`
- คลิกเปลี่ยนรูป · prev/next · ปัดนิ้ว · ลูกศรซ้าย/ขวา (เดสก์ท็อป) · ตัวนับ `1 / 4` · คลิกซูม (lightbox เดิม)
- กล่อง main ใช้ `aspectRatio 1/1` จองที่ตั้งแต่เฟรมแรก → ไม่มี layout shift
- มี loading / error / empty state ครบ

**ทำไมต้อง shared:** เดิม VelShop มี layout ในหน้า และ VelSeller แก้รูปแยกกัน → ของที่ผู้ขายเห็น
ไม่ใช่ของที่ลูกค้าเห็น ตอนนี้ทั้งคู่เรียก component เดียวกัน (seller ใช้เป็น preview สด)

## 2. การแยกประเภทภาพ (บังคับ)

| image_type | ใช้ที่ไหน | ใครอ่าน |
|---|---|---|
| `gallery` | แถบ thumbnail ด้านบน | gallery query (`WHERE image_type='gallery'`) |
| `detail` | รูปประกอบในรายละเอียดสินค้า + รูปใน description block | แท็บรายละเอียด |
| `variant` | รูปของตัวเลือกสินค้า | variant sheet / gallery ตาม variant ที่เลือก |

**บั๊กที่แก้:** `ShopProductDetail` เดิม push detail images เข้า carousel เป็น `group: 2`
ทำให้รูปประกอบรายละเอียด 5 ใบไปโผล่ในแถบ thumbnail ตอนนี้ gallery ใช้เฉพาะ gallery+variant
และ detail images ถูก render ในแท็บรายละเอียดตาม `sort_order`

## 3. Rich description blocks

เก็บที่ `products.description_blocks` (JSONB, `[]` = ไม่มี) — additive ล้วน

| type | ต้องมี |
|---|---|
| `heading` | text |
| `text` | text |
| `image` | imageUrl |
| `image_caption` | imageUrl + text (caption) |
| `image_text` | imageUrl + text (side-by-side บนเดสก์ท็อป, ซ้อนบนมือถือ) |

- validator กลาง: `backend/lib/description-blocks.ts`
  - สูงสุด 40 บล็อก, ข้อความ 4,000 ตัวอักษร/บล็อก
  - รับเฉพาะ URL `http(s)://` หรือ `//` (ปฏิเสธ `javascript:` / `data:`)
  - `id` ซ้ำ = 400 · type ไม่รู้จัก = 400 · ค่าว่าง/ไม่มี = `[]` (ไม่ error)
- เขียนได้ 2 ทาง: `PATCH /api/seller/products/:productId` และ `POST /api/seller/products/create-full`
  (ทั้งคู่มี ownership check เดิม) · อ่านกลับทั้ง seller list และ public product API
- UI: `ProductDescriptionEditor` (เพิ่ม/ลบ/เลื่อน/แก้/เลือกรูป) + `ProductDescriptionContent` (render ตามลำดับ)

**รูปในบล็อกคือ `detail` image** — อัปโหลดผ่าน `draftUpload(draftId, file, "details")`
จึงไม่มีทางหลุดเข้า gallery

## 4. จุดที่ยังต้องทำ (owner action)

`products.description_blocks` **ยังไม่มีใน production Neon** — ไฟล์ SQL พร้อมแล้ว
ต้องรัน workflow **Production DB Reconcile** (manual, เขียน DB จริง) ระหว่างนี้:
- อ่าน: ปลอดภัย (`SELECT p.*` ไม่มีคอลัมน์ → `[]` → หน้าเว็บใช้ plain description)
- เขียน: PATCH ที่ส่ง `descriptionBlocks` จะ error จนกว่าจะ reconcile
