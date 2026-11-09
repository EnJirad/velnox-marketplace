# LATEST — 2026-11-09 · CI เขียว + MVP readiness (storefront polish)

**Branch:** `main` · **Status:** DONE — CI gates ซ่อมแล้ว, test suite เขียวในเครื่อง, storefront ตรวจบน production จริง

## Summary

ทำงาน 3 ข้อตามแผน MVP: (1) ทำให้ CI เขียว (2) ปิดงานค้าง Phase 2 UI (3) ตรวจ storefront บน production จริงเพื่อประเมินความพร้อมเปิด MVP

### 1. CI แดงสองจุด — หาสาเหตุจริงและแก้แล้ว

| จุดที่แดง | สาเหตุจริง | การแก้ |
|---|---|---|
| `Tests` → *Typecheck apps and backend* | [auth.ts](../../backend/routes/auth.ts) มี `import crypto from "crypto"` ซ้ำ 2 บรรทัด (17, 52) → `TS2300 Duplicate identifier` และ `verifyData` เป็น `unknown` (397-398, 493-494) | ลบบรรทัดซ้ำ + ประกาศ type ของ response Turnstile |
| `Production DB Verify` → *cases A–I* | reconciler ทำงานถูกทุกกรณี แต่ค่า `CANON` hardcode เป็นเลขเก่า `63|241|265|661` ขณะที่ schema จริงคือ `67|255|285|716` | อัปเดต `CANON` ใน [db/verify-reconciler.sh](../../db/verify-reconciler.sh) พร้อมบันทึกที่มาของส่วนต่าง |

หลักฐาน: CI log ของ run `42609288618` → job `Typecheck, build and database tests` แสดง `PASS counts unchanged between runs (67|255|285|716)` ทุกครั้ง (idempotent จริง) และ `FAIL object counts match the canonical schema: expected [63|241|265|661]` — ล้มเพราะค่าคงที่เก่า ไม่ใช่เพราะ schema เสีย

### 2. Phase 2 UI — test ที่ค้าง + bug จริงที่เจอระหว่างทาง

ไม่ได้แก้ test ให้ผ่านแบบกลบเกลื่อน — แยกเป็น "test ค้าง" กับ "โค้ดเสีย":

**โค้ดเสีย (แก้ที่โค้ด):**
- [apps/velseller/src/main.tsx](../../apps/velseller/src/main.tsx) — `MobileTabBar until="md"` ทั้งที่คอมเมนต์ข้างบนเขียนว่า "hides at lg, not md" และ `site-app--tabbar-lg` จองพื้นที่ถึง lg → แท็บเล็ต 768–1023px ไม่มี navigation เลย และพื้นที่ถูกจองให้แถบที่ไม่มีอยู่ → แก้เป็น `until="lg"`
- [apps/velseller/src/pages/SellerOrders.tsx](../../apps/velseller/src/pages/SellerOrders.tsx) — แถวตาราง desktop ใช้ `window.location.href` = full page reload ทำให้ paging/filter หลุด → เปลี่ยนเป็น `<Link>` + `::after` overlay ให้คลิกได้ทั้งแถว (keyboard/middle-click ใช้ได้); ตัวนับ "active" เปลี่ยน `filter().length` → `reduce` เพื่อคง invariant ว่า server เป็นเจ้าของการกรอง
- [packages/shared/src/lib/commerce.ts](../../packages/shared/src/lib/commerce.ts) — `formatBaht` แสดง `฿419.3` (ขาดหลักสุดท้าย) → เศษสตางค์แสดง 2 ตำแหน่งเสมอ, จำนวนเต็มคงรูป `฿599`
- [apps/velshop/src/components/shop/ProductCard.tsx](../../apps/velshop/src/components/shop/ProductCard.tsx) — ปุ่ม like/save/share ไม่มี handler แต่แสดง `0 0 0` ทุกการ์ด (ปุ่มตายที่ดูคลิกได้) → เปลี่ยนเป็น read-only และแสดงเฉพาะเมื่อมีตัวเลข > 0

**test ค้าง (อัปเดต test — behavior เดิม):**
- `marketing-surface.test.ts` — ยืนยัน `grid grid-cols-2` ของ grid เดิม; ตอนนี้ home ใช้ shared `ProductGrid` → ยืนยัน `<ProductGrid`
- `center-seller-state-sync.test.ts` — ยืนยัน `payload`; โค้ดใช้ `basePayload` (แยกเพราะสาขา icon upload)
- `seller-order-ux.test.ts` — ยืนยัน `hidden overflow-x-auto`; wrapper จริงคือ `hidden … lg:block` → ยืนยันเจตนา (desktop ที่ lg, การ์ดที่ต่ำกว่า) + เพิ่ม guard ห้าม `window.location`
- `proxy-security.test.ts` / `proxy-write-mode.test.ts` — อ่าน secret จริง `.ai/secrets/browser-cookies.json` แบบไม่มี guard → ใน CI/เครื่องใหม่ไฟล์ไม่มี ทำให้**ทั้งไฟล์พังที่ module scope** (unhandled ENOENT) ไม่ใช่รายงานช่องโหว่ → ตรวจ writer (`mode: 0o600` + `chmodSync`) เสมอ, ตรวจไฟล์จริงเมื่อมี, test ที่ต้องใช้ token จริงใช้ `skipIf` (เหมือน DB-gated suite)

### 3. ตรวจ storefront บน production (ไม่ใช่แค่ typecheck)

- `https://velshop.vercel.app` โหลดได้, การ์ดสินค้า HTC NE20 แสดงใน rail "สินค้ากำลังมาแรง" และ grid "สินค้าทั้งหมด" พร้อมราคา/ส่วนลด/รีวิว/ยอดขาย
- `/api/products/catalog?status=published&limit=100` ตอบ 200 และคืนสินค้า 1 รายการ (variants 4, สต็อกรวม 78, รูป 9)
- หน้าร้านเสียเวลาที่เห็นครั้งแรกเพราะ eval ตอนหน้ายัง "Loading…" เท่านั้น — **ไม่ใช่บั๊ก**; ตรวจซ้ำหลังโหลดเสร็จแล้วข้อมูลมาครบ

## Files changed

- `backend/routes/auth.ts` — duplicate import + Turnstile typing
- `db/verify-reconciler.sh` — canonical counts + เหตุผลของส่วนต่าง
- `apps/velseller/src/main.tsx` — tablet nav breakpoint
- `apps/velseller/src/pages/SellerOrders.tsx` — router link แทน full reload, counter เป็น reduce
- `apps/velshop/src/components/shop/ProductCard.tsx` — ตัดปุ่มตาย, แสดง stat เมื่อมีค่า
- `packages/shared/src/lib/commerce.ts` — `formatBaht`
- `backend/tests/{marketing-surface,center-seller-state-sync,seller-order-ux,proxy-security,proxy-write-mode}.test.ts`

## Verification (รันจริงทั้งหมด)

| ขั้น | ผล |
|---|---|
| `bun run typecheck` (4 apps) | ✅ exit 0 |
| `bun --filter @velnox/backend typecheck` | ✅ exit 0 (ก่อนแก้: 6 errors) |
| `bun test ./backend/tests` | ✅ **1415 pass / 0 fail / 425 skip** (ก่อนแก้: 7 fail + 1 unhandled error) |
| `bun run i18n:check` | ✅ th=2235 en=2235 my=2235 parity |
| `bun run build:apps` | ✅ 4/4 built (velshop, velseller, velcenter, velnox) |
| `git diff --check` | ✅ clean |
| storefront production | ✅ สินค้าจริงแสดงผล |

## ยังไม่ได้ทำ / ต้องตัดสินใจ

- **263 DB-gated tests ตกบน CI — มีมาก่อนแล้ว ถูกซ่อนอยู่หลัง typecheck ที่ตก** หลักฐาน: run `42631233940` (`6bdd203`) และ `42555549049` (`73fff9c`) ตกที่ step *Typecheck apps and backend* → step test ถูก `skipped` ทั้งหมด; หลังซ่อม typecheck รอบ `42632216207` (`8c695d0`) จึงรันเทสต์จริงและพบ 263 เคสตก
- **สถานะแวดล้อมที่กันการซ่อมในเครื่อง (พิสูจน์แล้วทั้งสองทาง)**
  1. **Neon branch ใช้เป็น TEST_DATABASE_URL ไม่ได้** — ทดลองจริง 2026-11-09: สร้าง branch `test-disposable-20261109`, สร้าง role `ci_runner`, สร้าง database `velnox_test` ที่ว่าง และ bootstrap `db/run-sqleditor.sql` สำเร็จ (67 tables) แต่ `backend/tests/setup.ts` → `assertTestDatabaseIsSafe()` **ปฏิเสธ host `*.neon.tech` โดยเจตนา** (`TestDatabaseRefusedError: REFUSING TEST AGAINST PRODUCTION DATABASE`) → ลบ branch + role + credential ท้องถิ่นทิ้งแล้ว ไม่มีอะไรค้างบน Neon
  2. **PostgreSQL ท้องถิ่นยังรันไม่ได้** — ติดตั้ง `postgresql` 18.6 จาก repo สำเร็จ แต่ `initdb` ล้มด้วย `library "libicui18n.so.79" not found` ขณะที่ prefix มี ICU 78.3 และ `pkg_install libicu` ตอบ "already installed" โดยไม่ซ่อมไฟล์ (metadata เพี้ยน) → ต้องแก้ ICU ก่อนหรือรอ upstream
- ด้วยเหตุนี้ **การซ่อม 263 เคสต้องวนผ่าน CI** (รอบละ ~2-3 นาที) ต้องจัดเป็นงานแยกเป็นชุดตาม subsystem ไม่ใช่งานรอบเดียว
- **Seed ข้อมูล demo** — production มีสินค้าจริงเพียง 1 ชิ้น (published) + 1 ชิ้น suspended, ร้าน 2, หมวด 96 → ต้องตัดสินใจว่าจะ seed เข้า production หรือไม่ (เป็นการเขียนข้อมูล production)
- **Stripe live** — ยัง test mode; ต้องใช้ live keys + `STRIPE_MODE=live` + `STRIPE_ALLOW_LIVE=true` (owner action)

## Next

1. ตรวจกับ session ก่อนเรื่อง "migration runner" — ไฟล์ `backend/scripts/migrate.ts` **ไม่มีในรีโป** (ดู `.ai/AI_HANDOFF.md` §Active Tasks)
2. ตัดสินใจว่าจะซ่อม 263 DB-gated tests แบบเป็นชุดผ่าน CI หรือพักไว้ — แนะนำเรียงตามความเสี่ยง: payment/checkout → shipment/inventory → auth/seller/admin → chat
3. Owner ตัดสินใจเรื่อง seed ข้อมูล (จำนวน/หมวด/แหล่งรูป)
4. Owner เปิด Stripe live เมื่อพร้อมทดสอบการ์ดจริง
