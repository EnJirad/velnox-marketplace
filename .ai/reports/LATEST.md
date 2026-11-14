# LATEST — 2026-11-11 · แจ้งเตือนกลางจอแบบเดียวกันทั้งระบบ

**Branch:** `main` · **Status:** DONE · commit `228c2ba` · ยืนยันด้วยตาในเบราว์เซอร์แล้ว

## 1. ปัญหา

ระบบมี **2 ช่องทางแจ้งเตือน** ที่หน้าตาไม่เหมือนกัน:

| งาน | เดิม |
|---|---|
| เพิ่มลงตะกร้า | flash กลางจอ (สวย ตรงตามที่ต้องการ) |
| เพิ่มรายการโปรด / บันทึกที่อยู่ / เขียนรีวิว / error ต่าง ๆ | toast มุมซ้ายบน (sonner) |

ผู้ใช้ต้องการให้ **ทุกอย่างเป็นแบบกลางจอเหมือนกันหมด**

## 2. วิธีแก้ — สลับ import บรรทัดเดียว ไม่แตะ call site

`packages/shared/src/lib/flash-toast.tsx` (ใหม่) export `toast` ที่มีชื่อเมธอด
เหมือน sonner เดิม (`success` / `error` / `warning` / `info` / `message`)
ดังนั้นในไฟล์ต่าง ๆ **เปลี่ยนแค่บรรทัด import**:

```diff
- import { toast } from "sonner";
+ import { toast } from "@velnox/shared/lib/flash-toast";
```

→ สลับ **47 ไฟล์** โดยไม่ต้องแก้ `toast.success(...)` แม้แต่จุดเดียว

### องค์ประกอบ

| ส่วน | หน้าที่ |
|---|---|
| `CenterFlashHost` | mount ครั้งเดียวต่อแอป, ผูก dispatcher กับ flash |
| `setFlashDispatcher` | ตัวเชื่อมระดับโมดูล (ใช้ในเทสต์ได้) |
| `toast.*` | shim เข้ากันได้กับ sonner |
| `CenterFlashTone` | ขยายเป็น `success / error / warning / info` (สีต่างกันชัด) |

### พฤติกรรมที่คงไว้
- **ทีละข้อความ** — เรียกซ้ำแทนที่ ไม่ซ้อน
- `pointer-events: none` — ไม่บล็อกการกด
- `role="status"` + `aria-live="polite"`
- เคารพ `prefers-reduced-motion`
- ถ้าไม่มี host → **no-op ปลอดภัย** ไม่ crash (shared component ใช้ในแอปที่ยังไม่รับได้)
- option ของ sonner (`position`, `className`) ถูกเมิน ไม่หลุดเข้า render
- ข้อความว่าง → ไม่แสดงกล่องเปล่า

## 3. ครอบคลุมทั้ง 3 แอป

| แอป | ไฟล์ที่สลับ | host |
|---|---|---|
| VelShop | 17 | `<CenterFlashHost />` |
| VelSeller | 11 (รวม shared seller components) | `<CenterFlashHost />` |
| VelCenter | 9 | `<CenterFlashHost />` |
| shared components | 10 (RequireRole, goals, reorder, seller uploaders) | — |

**ถอด `<Toaster />` ออกทั้ง 3 แอป** — ถ้าเก็บไว้จะเป็นช่องทางที่สองอีกครั้ง
และย้าย shared seller components มาด้วย เพื่อไม่ให้ toast ของ seller หายเงียบ ๆ

**รวม add-to-cart ให้ใช้ตัวกลางเดียวกัน**: ลบ `useCenterFlash` ที่ mount ในหน้า
`ShopProductDetail` และ `ProductSelectionSheet` ออก → เหลือช่องทางเดียวทั้งระบบ

## 4. ยืนยันด้วยตาในเบราว์เซอร์จริง

รัน dev server แล้วเรียก `toast.success()` จากหน้าเว็บจริง:

| ตรวจ | ผล |
|---|---|
| แสดงผล | ✅ `role="status"` ปรากฏ |
| กึ่งกลางแนวนอน | ✅ คลาดเคลื่อน < 4px |
| กึ่งกลางแนวตั้ง | ✅ คลาดเคลื่อน < 4px |
| `pointer-events` | ✅ `none` |
| เรียก 2 ครั้งติด | ✅ เหลือ **1** ข้อความ (อันใหม่ทับอันเก่า) |
| สีตาม tone | ✅ error = แดง (`oklch` ของ rose-600) |

## 5. ผลตรวจ (รันจริง)

| คำสั่ง | ผล |
|---|---|
| `bun run typecheck` | **4/4 ผ่าน** |
| `bun run i18n:check` | **OK — 2297 × 3** |
| build velShop / velSeller / velCenter | **3/3 ผ่าน** |
| `bun test backend/tests` | **1522 pass** / 431 skip / 2 fail (ของเดิม) |
| `git diff --check` | **clean** |

**เทสต์ใหม่ 15 เคส** (`backend/tests/center-flash-toast.test.ts`):
- shim ส่ง tone/message/description/duration ถูกต้อง
- option ของ sonner ถูกเมิน / ข้อความว่างไม่แสดง / ไม่มี host ก็ไม่ crash
- **ไม่มีไฟล์ไหนใน repo import sonner อีก** (ยกเว้นตัว Toaster component เอง)
- ทั้ง 3 แอป mount host และไม่ mount Toaster
- add-to-cart ไม่มี flash instance ซ้อน

## 6. Git

- commit `228c2ba` · push แล้ว · `HEAD = origin/main = 228c2ba` · working tree clean
