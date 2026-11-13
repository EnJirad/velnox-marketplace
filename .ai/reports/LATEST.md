# LATEST — 2026-11-11 · Market filters, search, V removal, i18n raw key

**Branch:** `main` · **Status:** DONE — typecheck 4/4, build:apps 4/4, 1401 pass

## 1. สรุป

owner แจ้ง 4 เรื่อง รวมเป็นงานเดียว:

1. ข้อความใต้ "เพิ่มลงตะกร้าสำเร็จ" ขึ้นเป็น `productDetail.addedFlashDesc` (raw key)
2. เอาตัวกรอง V "ร้านค้าที่ได้รับการยืนยันเท่านั้น" ออกจากหน้าตลาด และเอา V ออกให้หมด
3. ปรับตัวกรองหน้าตลาดให้ดีขึ้น (มาตรฐานเดียวกับ marketplace อื่น)
4. ทำให้ search แม่นยำ ถูกต้อง

## 2. ต้นเหตุของ raw key

`t()` ใน `packages/shared/src/lib/i18n/index.tsx` มี `resolvePath()` ที่คืนค่าเฉพาะ
`typeof node === "string"` — แต่ `addedFlashDesc` / `addedToastDesc` ถูกเขียนเป็น
**ฟังก์ชัน** `(p) => ...` จึงไม่ถูก resolve แล้วตกไปที่ "คืนชื่อ key"

**แก้:** เปลี่ยนเป็น string ตาม convention ของระบบ (`"มี {qty} รายการในตะกร้า"`)
+ แก้ `addedToast` ของ my ที่มี `{qty}` เกิน (ล้าง i18n error เดิม)
+ `t()` เตือนใน dev ว่า key นี้ resolve เป็น type อะไร (ไม่ใช่แค่ missing)

## 3. ลบ V (thorough removal)

| จุด | การเปลี่ยนแปลง |
|---|---|
| `ShopProducts.tsx` | ลบ filter block `V …velshopVerifiedFilter`, state `verifiedOnly`, param `verified`, prop ที่ส่งให้ grid |
| `ProductGrid.tsx` | ลบ prop/param `verifiedOnly` |
| `ShopCategories.tsx` | ลบการ์ด "VelShop Verified" (มี `V` + ลิงก์ 2 จุด) |
| `ShopHome.tsx` | ลบ announcement ที่นับ `isVerifiedProduct` และลิงก์ `?verified=true` |
| `ShopPromoCarousel.tsx` | `/shops?verified=true` → `/shops` |
| `backend/routes/products.ts` | ลบ filter `req.query.verified` + คอมเมนต์ endpoint ที่ไม่มีจริง |
| `api-routes.ts` | ลบ `params.set("verified", …)` |
| i18n | ลบ `verification.velshopVerified`, `velshopVerifiedDesc`, `velshopVerifiedFilter` (30 บรรทัด) |

**ไม่แตะ:** seller identity verification ใน VelCenter (คิวรีวิว/อนุมัติ) — ยังทำงานเหมือนเดิม

## 4. Search ใหม่

เดิม: `(p.name ILIKE %q% OR p.description ILIKE %q%)` — ค้นทั้งประโยคเป็นก้อนเดียว
ไม่จัดอันดับ ไม่ค้นชื่อร้าน/หมวด/แบรนด์

ใหม่:

1. **Tokenize** — ตัดคำตาม whitespace สูงสุด 6 คำ
2. **Strict pass (AND)** — ทุกคำต้องเจอใน `name` / `short_description` / `description` / `supplier` / `sh.name` / `c.name` (ทุกฟิลด์ NULL-safe)
3. **Fallback (OR)** — ใช้เฉพาะเมื่อ strict pass ไม่ได้ผลเลย และมีมากกว่า 1 คำ (ดีกว่าหน้าว่าง)
4. **Relevance** — `CASE` ให้คะแนน: ชื่อตรงเป๊ะ 100 > ขึ้นต้นด้วย 60 > มีคำอยู่ในชื่อ 40 > ชื่อร้าน 25 > แบรนด์ 15 > อื่น ๆ 1 แล้วเรียงตามคะแนน + sold_count + created_at
5. **Sort ที่ผู้ใช้เลือกยังชนะ** relevance (price_asc, price_desc, rating, discount, best_selling)

## 5. ตัวกรองใหม่ (มาตรฐาน marketplace)

- **หมวด** (เดิม) · **ร้าน** (เดิม)
- **ช่วงราคา** เป็นปุ่มสำเร็จรูป: ต่ำกว่า ฿200 · ฿200–500 · ฿500–1,000 · ฿1,000–3,000 · มากกว่า ฿3,000 + กรอกเองได้
- **คะแนนรีวิว**: 4★ ขึ้นไป · 3★ ขึ้นไป
- **เฉพาะลดราคา** (compare_at_price > price) · **เฉพาะมีสินค้า**
- **sort**: ใหม่ · ขายดี · คะแนนสูงสุด · ราคา ต่ำ→สูง · ราคา สูง→ต่ำ · ลดมากที่สุด
- **active filter chips** เหนือรายการสินค้า กดลบทีละตัวได้ + "ล้างทั้งหมด" → เห็นทันทีว่าทำไมผลลัพธ์สั้น

## 6. บั๊กที่เจอเพิ่ม

`ProductGrid` ส่ง `sort` แต่ `catalogProductsAction` อ่าน `a?.sortBy` → **ตัวเลือก sort ไม่เคยถูกส่งไป backend เลย**
(ทุก grid ได้ "newest" ตลอด) แก้ให้รับทั้ง `sortBy` และ `sort`

## 7. ไฟล์ที่แก้

`apps/velshop/src/pages/ShopProducts.tsx` · `ShopCategories.tsx` · `ShopHome.tsx` ·
`components/shop/ShopPromoCarousel.tsx` · `packages/shared/src/components/shop/ProductGrid.tsx` ·
`packages/shared/src/lib/api-routes.ts` · `packages/shared/src/lib/i18n/index.tsx` ·
i18n locales (th/en/my + index) · `backend/routes/products.ts` · tests

## 8. ผลตรวจ (รันจริง)

| ตรวจ | ผล |
|---|---|
| `bun run typecheck` (4 แอป) | ผ่าน 4/4 |
| `bun run build:apps` | ผ่าน 4/4 |
| `bun test backend/tests` | 1401 pass · 431 skip · 2 fail (ของเดิม: chat transport, verification exports) |
| test ใหม่ `catalog-search-filters.test.ts` | 11 pass |
| `bun run i18n:check` | เหลือเฉพาะ 16 key ของ auth ที่ my ขาด (ของเดิม) |
| `git diff --check` | clean |

## 9. สถานะ Git

branch `main` · commit `47c4657` · push แล้ว · `HEAD = origin/main = 47c4657` · working tree clean
