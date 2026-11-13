# LATEST — 2026-11-11 · Add-to-cart UX + dead header bar

**Branch:** `main` · **Status:** DONE — typecheck 4/4, build velshop ผ่าน, test ใหม่ 12/12

## 1. สรุป

owner แจ้ง 2 ปัญหาบนหน้าสินค้า:

1. มี **เส้นสีเทาขีดคั่น** เหนือเนื้อหา — ถามว่า "มันคืออะไร เอาให้หน่อย"
2. กด **"เพิ่มลงตะกร้า"** แล้วไม่ปิดตัวเลือก และไม่มีข้อความยืนยันกลางจอ

## 2. ต้นเหตุและวิธีแก้

### 2.1 เส้นสีเทา

`apps/velshop/src/components/shop/ShopHeader.tsx` มี **แถบเมนูที่สอง** ติดใต้ header:

```
sticky top-[3.5rem] md:top-[4rem] z-30 border-b border-slate-200 bg-white
```

ลิงก์ข้างในใช้ `navItem()` ซึ่งออกแบบมาสำหรับพื้นสีเขียว (`text-white/80`, `bg-white/20`)
บนพื้น `bg-white` จึง **มองไม่เห็นทั้งหมด** เหลือเพียง `border-slate-200` = เส้นเทาที่เห็น

**แก้:** ลบทั้งบล็อก (ไม่กระทบ desktop nav ที่มีลิงก์เดียวกันอยู่แล้ว)

### 2.2 ปุ่มเพิ่มลงตะกร้า

`handleSheetConfirm` (โหมด direct ใน `ShopProductDetail`) มีบั๊ก:
- เพิ่มลงตะกร้าแล้ว **ไม่เรียก `setVariantSheetOpen(false)`** → sheet ค้างเปิด
- toast `position: "top-center"` ถูก sheet บัง

**แก้:**
- ปิด sheet ก่อน (`setVariantSheetOpen(false)` + `setPendingAction(null)`)
- แสดงข้อความ **"เพิ่มลงตะกร้าสำเร็จ"** กลางจอ แล้วเฟดหาย

## 3. ของใหม่

| ไฟล์ | สิ่งที่ทำ |
|---|---|
| `packages/shared/src/components/ui/center-flash.tsx` | ใหม่ — `useCenterFlash()` คืน `{ flash, node }` แสดงข้อความกลางจอ เฟดเข้า–ค้าง–เฟดออก |
| `packages/shared/src/index.css` | เพิ่ม `@keyframes velnox-center-flash` |
| `apps/velshop/src/pages/ShopProductDetail.tsx` | ปิด sheet + ใช้ `flashCenter` ทั้ง 2 เส้นทาง (multi-mode และ direct-mode) |
| `apps/velshop/src/components/shop/ProductSelectionSheet.tsx` | ใช้ `flashCenter` แทน toast, mount node นอก `<Sheet>` |
| `apps/velshop/src/components/shop/ShopHeader.tsx` | ลบแถบเมนูที่สอง (เส้นเทา) |
| i18n en/th/my | `productDetail.addedFlash` + `addedFlashDesc` |
| `backend/tests/product-add-to-cart-ux.test.ts` | ใหม่ — guard test 12 เคส |

### คุณสมบัติของ CenterFlash
- ทีละข้อความ (เรียกซ้ำ = แทนที่ ไม่ซ้อน)
- `pointer-events-none` ทั้ง overlay → ไม่บล็อกการกด
- `role="status"` + `aria-live="polite"` → screen reader อ่าน
- เฟดด้วย CSS keyframes, JS แค่ unmount
- `prefers-reduced-motion: reduce` → แสดงข้อความแต่ไม่ animate

## 4. ผลตรวจ (รันจริง)

| ตรวจ | ผล |
|---|---|
| `bun run typecheck` (4 แอป) | ผ่าน 4/4 |
| `bun --filter @velnox/velshop build` | ผ่าน (17.67s) |
| `bun test backend/tests/product-add-to-cart-ux.test.ts` | 12 pass / 0 fail |
| `bun test backend/tests` (ทั้งชุด) | 1389 pass · 431 skip · 5 fail (**ของเดิม** — ยืนยันด้วย stash บน HEAD สะอาด) |
| `bun run i18n:check` | FAIL เฉพาะ 2 จุดเดิม (my ขาด 16 key ของ auth, `addedToast` interpolation) |
| `git diff --check` | clean |

## 5. สถานะ Git

- branch `main` · commit `42c449c` · push แล้ว · `HEAD = origin/main = 42c449c` · working tree clean

## 6. หมายเหตุ

ไม่ได้ตรวจด้วยตาในเบราว์เซอร์จริง (ไม่มี `.env`/DB ในเครื่อง) — พฤติกรรมยืนยันจาก source + guard test
