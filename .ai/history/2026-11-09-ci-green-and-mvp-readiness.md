# 2026-11-09 — CI เขียว + MVP readiness (storefront polish)

**Session type:** T2 (ซ่อม CI + UI ค้างหลายไฟล์) · **Branch:** `main` · **ก่อนเริ่ม:** HEAD `73fff9c` = `origin/main`

## โจทย์

Owner ถามว่าโปรเจคควรเริ่มทำอะไรเพื่อให้ใช้งานได้ดีและเปิด MVP ได้เร็ว → ตรวจสถานะจริงแล้วเลือกทำ 3 ข้อ: (1) CI เขียว (2) ปิดงานค้าง Phase 2 UI (3) ประเมิน/เตรียมข้อมูลให้ storefront พร้อม

## สิ่งที่เจอ (วินิจฉัย ไม่ใช่เดา)

1. `Tests` workflow ตกที่ step *Typecheck apps and backend*. รันในเครื่องได้ error เดียวกัน: `TS2300 Duplicate identifier 'crypto'` (import ซ้ำที่บรรทัด 17 และ 52 ของ `backend/routes/auth.ts`) + `TS18046 'verifyData' is of type 'unknown'` (Turnstile response). CI จึง skip test suite ทั้งหมดตั้งแต่ step นั้น
2. `Production DB Verify` → job *Typecheck, build and database tests* ตกที่ `bash db/verify-reconciler.sh`. ดึง log จริงผ่าน `gh api .../jobs/<id>/logs` แล้วพบว่า **reconciler ผ่านทุกกรณี** ยกเว้น 4 assertion ที่เทียบกับค่าคงที่ `CANON="63|241|265|661"` โดย log แสดง `PASS counts unchanged between runs (67|255|285|716)` สองครั้ง → schema converge/idempotent จริง ค่าคงที่เท่านั้นที่ค้าง (schema โตหลัง 2026-10-31: wholesale_tiers, business_verifications, business_verification_history, shipping_quotes)
3. รัน `bun test ./backend/tests` ในเครื่อง: 7 fail + 1 unhandled error — แยกได้เป็น bug จริง 4 จุด และ test ค้าง 5 ไฟล์
4. ตรวจ production storefront ด้วย in-app browser: `velshop.vercel.app` แสดงสินค้า HTC NE20 (rail + grid) หลังโหลดเสร็จ; API `/api/products/catalog` คืน 1 รายการ (variants 4, stock รวม 78, รูป 9). **บทเรียน:** eval ครั้งแรกอ่าน `Loading…` แล้วสรุปผิดว่าไม่มีสินค้า — ต้องรอโหลดก่อนสรุป
5. นับข้อมูล production ผ่าน Neon MCP: sellers 2 (approved 2), shops 2, products 2 (published 1, suspended 1), categories 96, orders 8, users 4 → ตัวกั้น MVP ที่แท้จริงคือ "ของในร้านน้อย" ไม่ใช่โค้ด

## การแก้

**Bug จริง (แก้ที่โค้ด)**
- `apps/velseller/src/main.tsx`: `MobileTabBar until="md"` → `"lg"` (คอมเมนต์+`site-app--tabbar-lg` ระบุ lg; ช่วง 768–1023px ไม่มี nav เลย)
- `apps/velseller/src/pages/SellerOrders.tsx`: `window.location.href` → `<Link>` + `::after` overlay; counter `filter().length` → `reduce` (คง invariant "server กรอง")
- `packages/shared/src/lib/commerce.ts`: `formatBaht` — เศษสตางค์ 2 ตำแหน่งเสมอ (`฿419.30`), จำนวนเต็มคง `฿599`
- `apps/velshop/src/components/shop/ProductCard.tsx`: like/save/share เป็น `<span>` read-only แสดงเมื่อ > 0 (เดิม `<button>` ไม่มี handler โชว์ `0 0 0`)

**Test ค้าง → อัปเดตตาม behavior**
- `marketing-surface.test.ts`: `grid grid-cols-2` → `<ProductGrid>`
- `center-seller-state-sync.test.ts`: `payload` → `basePayload`
- `seller-order-ux.test.ts`: `hidden overflow-x-auto` → `/hidden[^"]*lg:block/` + guard ห้าม `window.location`
- `proxy-security.test.ts` / `proxy-write-mode.test.ts`: เลิกอ่าน secret ในเครื่องแบบไม่มี guard (เดิมทำให้ทั้งไฟล์พังที่ module scope ด้วย ENOENT ซึ่งอ่านเหมือน "พบช่องโหว่"); ตรวจ writer `mode: 0o600` + `chmodSync` เสมอ, ตรวจไฟล์จริงเมื่อมี, ใช้ `skipIf` กับ test ที่ต้องใช้ token จริง

**CI**
- `backend/routes/auth.ts`: ลบ import ซ้ำ, ประกาศ type ของ Turnstile response
- `db/verify-reconciler.sh`: `CANON="67|255|285|716"` + บันทึกที่มาของส่วนต่างและหลักการ "ต้องวัดใหม่ ห้ามเดา"

## ผลตรวจ (รันจริง)

`bun run typecheck` ✅ 4/4 · `bun --filter @velnox/backend typecheck` ✅ · `bun test ./backend/tests` ✅ 1415 pass / 0 fail / 425 skip · `bun run i18n:check` ✅ 2235×3 · `bun run build:apps` ✅ 4/4 · `git diff --check` ✅ · storefront production ✅

## ค้าง

- 425 DB-gated skips: รันได้เฉพาะ CI
- Seed ข้อมูล production: รอ owner สั่ง (จำนวน/หมวด/แหล่งรูป) — เป็นการเขียนข้อมูลจริง
- Stripe live: owner action
