# LATEST — 2026-11-11 · ตะกร้า: ไม่ต้องรีโหลดทุกครั้งที่กด +/- จำนวน

**Branch:** `main` · **Status:** DONE · commit `bf1a0d6`

## 1. อาการ

กดเพิ่ม/ลดจำนวนสินค้าในตะกร้า → ตะกร้า "รีโหลดใหม่" ทุกครั้ง (รายการหายไปแวบ
แล้วขึ้นใหม่ทั้งหมด) โดยเฉพาะตอนกดรัว ๆ

## 2. Root Cause — response ของ API ถูกอ่านผิดรูป

ทุก endpoint ของตะกร้าตอบกลับเป็น envelope:

```json
{ "success": true, "data": { "items": [ … ] } }
```

| Route | บรรทัดใน `backend/routes/cart.ts` |
|---|---|
| `GET    /api/customer/cart` | 415 |
| `POST   /api/customer/cart/add` | 572 |
| `PUT    /api/customer/cart/item/:id` | 676 |
| `DELETE /api/customer/cart/item/:id` | 699 |

แต่ `apps/velshop/src/lib/cart.tsx` เขียนไว้แบบนี้:

```ts
const applyServer = useCallback((items: unknown[]) => {
  setLines(items.map(toLine));   // items จริงคือ { items: [...] }
}, []);
```

→ `items.map` **throw TypeError** ทุกครั้ง → ไปตกที่ `.catch(() => reload())`
→ `reload()` เพิ่ม `version` → effect โหลดตะกร้าใหม่ + `setSyncing(true)`
→ หน้า `ShopCart` เห็น `syncing` แล้ว **สลับทั้งรายการเป็น skeleton**

นี่คือ "การรีโหลด" ที่ผู้ใช้เห็น

## 3. การแก้

| ไฟล์ | การแก้ |
|---|---|
| `apps/velshop/src/lib/cart-response.ts` (ใหม่) | `cartItemsFromResponse()` — pure, รับได้ทั้ง `{ items }` และ array, คืน `null` เมื่อไม่มีข้อมูล (ไม่ throw) |
| `apps/velshop/src/lib/cart.tsx` | `applyServer` ใช้ตัว unwrap นี้ + ถ้าไม่มี cart ในคำตอบ **คง optimistic state** ไม่ refetch |
| `apps/velshop/src/lib/cart.tsx` | เพิ่ม `lineRequestSeq` — จองลำดับต่อบรรทัด **ก่อน** ยิง request → กดรัว ๆ แล้ว response เก่าที่มาช้าไม่สามารถย้อนค่าที่ใหม่กว่าได้ |
| `apps/velshop/src/lib/cart.tsx` | `apiCartItemUpdate` / `apiCartItemRemove` **throw เมื่อ response ไม่ ok** (เดิมกลืน 400 เช่น เกินสต็อก ทำให้เลขบนจอไม่ตรงกับ server) |

> หมายเหตุ: การ throw นี้สำคัญ เพราะ refetch ที่เคยเกิด "โดยบังเอิญ" จากบั๊ก
> เป็นตัวกลบข้อผิดพลาดจริงอยู่ → ตอนนี้แยกชัด: สำเร็จ = apply, ล้มเหลว = reload

## 4. เทสต์ใหม่ 8 เคส (`backend/tests/cart-response-shape.test.ts`)

- unwrap `{ items }` และ array ได้ / คืน `null` สำหรับรูปอื่น (ไม่ throw)
- ทั้ง 4 route ของ backend ตอบ envelope จริง
- `applyServer` **ไม่มี** `reload()` อยู่ข้างใน
- mutation ทั้งหมด `.then(apply…)` และ reload อยู่บน error path เท่านั้น
- มี sequence guard กัน response เก่าย้อนค่า

## 5. ผลตรวจ (รันจริง)

| คำสั่ง | ผล |
|---|---|
| `bun run typecheck` | **4/4 ผ่าน** |
| `bun run i18n:check` | **OK — 2297 × 3** |
| `bun run build:velshop` | **ผ่าน** |
| `bun test backend/tests` | **1507 pass** / 431 skip / 2 fail (ของเดิม) |
| `git diff --check` | **clean** |

## 6. ข้อจำกัด

- ยังไม่ได้ทดสอบด้วยการกดจริงบนตะกร้าในเบราว์เซอร์ (ต้องล็อกอิน + มีสินค้าใน Neon)
  — ตรวจด้วย typecheck / unit test ของ logic + การอ่านโค้ดเส้นทาง response
- ตะกร้าของ **guest** ไม่กระทบ (ไม่เรียก API)

## 7. Git

- commit `bf1a0d6` · push แล้ว · `HEAD = origin/main = bf1a0d6` · working tree clean
