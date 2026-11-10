# แผนงานระยะถัดไป — Launch Readiness

**วันที่:** 2026-11-10 · **HEAD:** `9cfdaac` · **สถานะ:** รอ owner อนุมัติ (ยังไม่แก้โค้ด)
**ที่มา:** audit 2 ชุด (frontend / backend) + ตรวจซ้ำเองกับ production และ Neon

---

## 1. สถานะจริงที่วัดได้ (ไม่ใช่จากเอกสาร)

| เรื่อง | ค่าที่วัดได้ | ที่มา |
|---|---|---|
| สินค้า published | **1** (HTC NE20 ฿599) | Neon `products` |
| หมวดที่มีสินค้า | **1 จาก 96** | Neon |
| ร้าน | 2 (`SUPER GADGET ZENE` active, `Velnox Support` active แต่เจ้าของบัญชีล็อกอินไม่ได้) | Neon |
| Stripe production | `configured: true` · `mode: test` · `webhookConfigured: true` · `shapeUsable: true` | `GET /api/stripe/configured` |
| API health | 200 | `GET /api/health` |
| CORS จาก `velseller.vercel.app` | 204 + ACAO ถูกต้อง | preflight จริง |
| CORS จาก `www.velnox.live` (R2) | **ขาด** → อัปโปรไฟล์ลูกค้าถูกบล็อก | Cloudflare R2 CORS |
| `TODO`/`FIXME` ในโค้ด | **0** | grep |
| DB-gated tests | 425 skip ในเครื่อง (CI รันครบ) | `bun run test` |
| CI | เขียว | `.ai/AI_HANDOFF.md` |

**ข้อสรุปสำคัญ:** ระบบไม่ได้พัง — แต่ **ยังขายไม่ได้จริง** เพราะ (ก) ของมีชิ้นเดียว (ข) มีรูรั่ว 3 จุดที่จะทำให้คนที่เข้ามาแล้วไม่จ่ายเงิน

---

## 2. หลักการจัดลำดับ

จัดตาม "เงินที่เสียไปถ้าไม่แก้" ไม่ใช่ตามความยาก:

1. **คนที่เข้ามาแล้วเสียไปฟรี** (guest cart) — แพงที่สุด เพราะกระทบ **ทุกคนที่ยังไม่ล็อกอิน** ซึ่งคือคนส่วนใหญ่
2. **คนที่จ่ายเงินแล้วระบบพัง** (payment retry / reconciliation) — แพงกว่าเดิม แต่เกิดน้อยครั้ง
3. **ความน่าเชื่อถือ** (สินค้าจากร้านที่ถูกระงับ) — เสี่ยง reputational/legal
4. **หนี้ทางเทคนิค** — ไม่กระทบรายได้ แต่ทำให้แก้ของข้างบนช้าลง

---

## 3. TRACK 1 — ปิดรูรั่วที่ฆาการขาย (ทำก่อน)

### Step 1 — Guest cart หายเมื่อ refresh และหายเมื่อล็อกอิน
**ปัญหา:** `apps/velshop/src/lib/cart.tsx:161-186` — `!isAuthenticated` → `setLines([])` และไม่มีการเก็บลง `localStorage` เลย. ตะกร้าของ guest อยู่ใน React state อย่างเดียว ⇒ refresh = ว่าง, และตอนล็อกอิน `:178` เอา server cart มาทับ ไม่ merge. ลูกค้าเลือกของ 5 ชิ้น → กด checkout → ถูกส่งไปล็อกอิน (`main.tsx:104-112` `RequireAuth`) → กลับมา **ตะกร้าว่าง** โดยไม่มีการแจ้ง

**แก้:** persist guest lines ลง `localStorage` (key `velnox.guestCart.v1`) + merge เข้า server cart หลังล็อกอินสำเร็จผ่าน `POST /api/customer/cart` ที่มีอยู่แล้ว แล้วล้าง localStorage
**ไฟล์:** `apps/velshop/src/lib/cart.tsx` (+ test ใหม่ใน `apps/velshop` หรือ `packages/shared`)
**พิสูจน์ว่าเสร็จ:** เพิ่มของตอนไม่ล็อกอิน → refresh → ของยังอยู่ → ล็อกอิน → ของถูกรวม ไม่หาย

### Step 2 — ปุ่มจ่ายเงินกดได้แม้ไม่มีวิธีจ่าย
**ปัญหา:** `apps/velshop/src/pages/ShopCheckout.tsx:1211` — `disabled` ไม่มีเงื่อนไข `enabledMethods.length === 0` ⇒ ลูกค้ากรอกครบ กดจ่าย แล้วได้ toast เดียว
**แก้:** เพิ่มเงื่อนไข + แสดงเหตุผลที่ปุ่มถูกปิด
**พิสูจน์:** ตั้งค่าให้ไม่มีวิธีจ่าย → ปุ่ม disabled พร้อมข้อความ

### Step 3 — ยืนยัน/แก้ การจ่ายซ้ำหลังบัตรถูกปฏิเสธ
**ปัญหา:** `backend/lib/order-fulfillment.ts:95` — `cancelled: []` (terminal) และ `stripe.ts:1498-1504` ตั้ง order เป็น `failed` เมื่อมี `payment_intent.payment_failed`. Stripe **ส่ง event นี้ตอนใบแรกถูกปฏิเสธด้วย** ทั้งที่ session ยังให้ลองใหม่ได้ ⇒ order ตายก่อนลูกค้าลองใบที่สอง
**สถานะ:** ยัง **NOT TESTED** — ต้องยิงบัตร declined (`4000 0000 0000 0002`) แล้วลองใบใหม่ใน session เดิม
**แก้ (ถ้าพังจริง):** อย่า mark failed จาก `payment_intent.payment_failed` เพียงอย่างเดียว — รอ `checkout.session.expired` หรือ `async_payment_failed` แทน
**พิสูจน์:** declined → ลองบัตรใหม่ → สำเร็จ → order เป็น paid

---

## 4. TRACK 2 — ความน่าเชื่อถือของแคตตาล็อก

### Step 4 — สินค้าจากร้านที่ถูกระงับยังขายอยู่
**ปัญหา:** `backend/routes/products.ts:2144` — `where = "WHERE p.status = 'published'"` ไม่เช็ก `shops.status` หรือสถานะผู้ขายเลย (ยืนยันด้วยการอ่าน query เต็มที่ `:2200-2206`)
**แก้:** เพิ่ม `AND sh.status = 'active'` (+ เงื่อนไขผู้ขายตามที่ธุรกิจต้องการ) ทั้งใน list และ detail
**พิสูจน์:** ระงับร้านทดสอบ 1 ร้าน → สินค้าหายจาก catalog และ detail คืน 404

### Step 5 — ร้าน `Velnox Support` เจ้าของเข้าไม่ได้
**ปัญหา:** seller email = `support@velnox.com` ซึ่งเป็นโดเมนที่ไม่ได้ถือ ⇒ ล็อกอินไม่ได้ ⇒ ร้านค้างอยู่ในระบบ
**แก้:** เปลี่ยนเป็นอีเมลจริงของผู้ใช้ที่มีตัวตน (ต้องให้ owner ระบุ) หรือปิดร้าน
**พิสูจน์:** ล็อกอินด้วยบัญชีนั้นได้ และเห็นร้าน

---

## 5. TRACK 3 — ก่อนรับเงินจริง (ยังไม่ต้องทำวันนี้ แต่ต้องทำก่อน live)

### Step 6 — `stripeMode: "test"` ฝังตายในโค้ด 7 จุด
**ตำแหน่ง:** `backend/routes/stripe.ts:876, 1013, 1068, 2362, 2472, 2509, 2549`
**ผลถ้าไม่แก้:** เปิด live แล้ว response ยังบอก `test` ⇒ แบนเนอร์ "โหมดทดสอบ" โชว์ให้ลูกค้าจ่ายจริงเห็น และ metadata ของ charge ผิดถาวร
**แก้:** อ่านจาก `payment-config` แทน literal
**พิสูจน์:** เปลี่ยน `STRIPE_MODE` แล้ว response เปลี่ยนตาม โดยไม่ต้องแก้โค้ด

### Step 7 — ไม่มี job กระทบยอด (reconciliation)
**ปัญหา:** `backend/jobs/` มีแค่ reservation sweep. ถ้า webhook secret ผิดหรือ event หลุด เงินถูกจับแต่ order ค้าง `pending_payment` ตลอดไป **โดยไม่มี incident** เพราะ incident ถูกสร้างจากใน webhook เท่านั้น (`payment-incidents.ts`)
**แก้:** job เทียบ Stripe Session ที่จบแล้วกับตาราง `payments` แล้วสร้าง incident เมื่อไม่ตรง
**พิสูจน์:** จำลอง webhook ล้ม (ปิด endpoint) → job ตรวจเจอและสร้าง incident ภายในรอบถัดไป

### Step 8 — เปิด live mode
**ต้องมี:** `STRIPE_SECRET_KEY=sk_live_…` + `STRIPE_MODE=live` + `STRIPE_ALLOW_LIVE=true` + live `STRIPE_WEBHOOK_SECRET` (ต้องทำ Step 6–7 ก่อน)
**ห้ามทำก่อน:** เจ้าของยังไม่พร้อมทดสอบบัตรจริง (decision 2026-11-09)

---

## 6. TRACK 4 — หนี้ทางเทคนิค (ทำแทรกได้ ไม่บล็อกใคร)

### Step 9 — R2 CORS ของหน้าร้าน
เพิ่ม `https://velnox.live`, `https://www.velnox.live` ใน bucket `velnox-storage` — ต้องให้ owner แก้ token หรือเข้า dashboard (ตอนนี้ MCP เป็น read-only)
**พิสูจน์:** อัปโปรไฟล์จาก `www.velnox.live` สำเร็จ

### Step 10 — 425 DB tests ที่รันในเครื่องไม่ได้
`TEST_DATABASE_URL` ไม่ถูกตั้ง ⇒ suite ข้าม. วิธีที่บันทึกไว้คือสร้าง Neon branch ชั่วคราว + tunnel (อยู่ใน `.ai/reports/LATEST.md`) แต่ยังไม่เป็นสคริปต์
**แก้:** ทำสคริปต์ `scripts/test-db.sh` ที่สร้าง/ลบ branch ให้อัตโนมัติ
**พิสูจน์:** `bun run test` รันครบโดยไม่ต้องตั้งค่ามือ

### Step 11 — `.ai-office/` ซ้ำอำนาจกับ `.ai/`
`AGENTS.md` ห้ามมีสองแหล่งกฎ แต่ยังมี 10 ไฟล์ tracked ใน `.ai-office/`
**แก้:** ย้ายเข้า `.ai/history/` หรือลบ แล้วอัปเดต `.ai/AI_HANDOFF.md` ข้อ 8

---

## 7. สิ่งที่ **ไม่ควร** ทำตอนนี้

- **อย่าเติมสินค้าแทนเจ้าของ** — ไม่มีรูปจริงและข้อมูลจริง จะกลายเป็น fake data
- **อย่าเปิด Stripe live** ก่อน Step 6–7
- **อย่าทำ domain migration ต่อ** — park ไว้แล้ว รอ DNS write path
- **อย่า refactor** `products.ts` (3.8k บรรทัด) — เสี่ยงโดยไม่จำเป็น
- **อย่าแตะ** Neon schema / `db/schema.sql` ในงานชุดนี้

---

## 8. ลำดับที่เสนอ

| รอบ | งาน | เหตุผล |
|---|---|---|
| **รอบ 1** | Step 1 + 2 + 4 | ปิดรูที่กระทบลูกค้าทุกคน ทำงานในโค้ดล้วน ไม่ต้องรอใคร |
| **รอบ 2** | Step 3 (ทดสอบก่อน) → แก้ตามผล | ต้องยิงบัตรทดสอบจริง |
| **รอบ 3** | Step 5 + 9 | ต้องให้ owner ระบุอีเมล / แก้ token |
| **รอบ 4** | Step 6 + 7 | เตรียม live mode |
| แทรกได้ | Step 10 + 11 | ไม่บล็อกใคร |

**คำแนะนำ:** เริ่มรอบ 1 เพราะเป็นงานโค้ดล้วน ไม่ต้องรอ owner และ unlock การขายจริงได้ทันทีเมื่อแคตตาล็อกพร้อม
