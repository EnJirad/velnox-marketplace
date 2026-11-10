# LATEST — 2026-11-10 · Unified domain migration: audit, plan, prep (PARKED)

**Branch:** `main` · **HEAD:** `96882b2` · **Status:** PARKED by owner — safe work done, infra blocked

## 1. แกนของงานเปลี่ยน: `velnox.com` → `velnox.live`

โจทย์สั่งย้ายทั้งระบบไป `velnox.com` แต่ RDAP (Verisign) พิสูจน์ว่าโดเมนนั้นไม่ใช่ของโปรเจกต์:
ลงทะเบียนที่ GoDaddy 2018-03-07 หมดอายุ 2032-03-07 nameserver `NS1/NS2.RENEWYOURNAME.NET` (parking)
ตอบ `REFUSED` — ไม่มี DNS ใช้งาน. เจ้าของยืนยันว่าซื้อแค่ **`velnox.live`** ⇒ งานทั้งหมดถูก rebase ไปที่
`velnox.live` และทุก phase ใน `.ai/tasks/active/unified-domain-migration.md` เขียนกับโดเมนนั้น

## 2. ข้อเท็จจริง infra ที่วัดได้ (ไม่ใช่สมมติ)

- **Convex ไม่มีอยู่ในระบบนี้เลย** — 0 reference, 0 dependency, ไม่มี `convex/`; realtime คือ WebSocket
  ใน process เดียวกับ Express บน Render ⇒ phase Convex ของโจทย์ = N/A
- **Cloudflare MCP เป็น read-only** — `POST /zones` → 403 (`com.cloudflare.api.account.zone.create`),
  `PUT .../r2/buckets/.../cors` → 403, `GET /user/tokens` → 403 (ยืนยันซ้ำหลัง owner สั่งให้เดินหน้า)
- **Render MCP ไม่มี custom-domain tool และอ่าน env ไม่ได้** ⇒ `api.velnox.live` ต้องเพิ่มที่ dashboard
- **R2 CORS ขาด `velnox.live` / `www.velnox.live` / `velnox-theta.vercel.app`** — หน้าร้านจริงคือ
  `www.velnox.live` (apex 308 → www, ตรวจด้วย HTTP) ⇒ อัปโหลดจากหน้าร้านถูกบล็อก (bug ที่มีอยู่ก่อน)
- `velnox.live` zone มีแค่ A `@`, CNAME `www`, TXT `_dmarc` — ไม่มี MX/SPF/DKIM ⇒ ย้าย zone ไม่ทำเมลหาย

## 3. AI 02 ตีกลับแผนแรก — ถูก

Verdict **REJECT** พร้อม R1–R8. ตรวจซ้ำเองแล้วว่า R2 ถูกที่สุด: `stripeWebhookSecret()` อ่าน secret
ตัวเดียว (`payment-config.ts:177,254` → `stripe.ts:2605,2657`) ⇒ เพิ่ม Stripe endpoint ที่สองจะ verify
signature ไม่ผ่าน ต้อง **แก้ URL ของ endpoint เดิม** แทน. ทุกข้อถูกใส่ในแผนแล้ว

## 4. สิ่งที่ทำจริง

- เพิ่ม Vercel custom domain 3 ตัว คืน `verified: true`: `shop.` → velshop, `seller.` → velseller,
  `center.` → velcenter (**apex ยังไม่สลับ** — `velnox.live` ยังเป็นหน้าร้านที่ใช้งานจริง)
- อ่าน DNS target จาก Vercel `get_domain_config`: CNAME `b04e1ed0b385c8f3.vercel-dns-017.com`,
  A `216.198.79.1` / `64.29.17.1` — ไม่ได้เดาค่า
- แก้ hardcoded legacy host 3 จุดให้ใช้ `SITE_URLS` (`SellerProfile.tsx:287`, `ShopProfile.tsx:93-94`)
- แก้ `@velnox.com` (โดเมนที่ไม่ได้ถือ) → `@velnox.live` ทั้ง 6 จุดผู้ใช้เห็น + placeholder
  และ comment ที่อ้าง canonical domain ผิด ⇒ `velnox.com` ไม่เหลือใน source แล้ว
- เตรียม BIND zone file (APPENDIX) ให้ import เข้า Cloudflare ได้ครั้งเดียว

## 5. ตรวจแล้ว

`git diff --check` clean · `bun run typecheck` 4/4 exit 0 · `bun run i18n:check` th/en/my 2235 parity ·
`bun run test` **1420 pass / 425 skip / 0 fail** (1845 tests, 101 ไฟล์)

## 6. สถานะ production — ไม่ถูกกระทบ

ไม่ได้แตะ env, DNS record, R2 rule, Stripe, Neon หรือ deployment ใด ๆ. Vercel domain ที่เพิ่มยังไม่
resolve. Code change เป็น behaviour-neutral (ค่า default ของ `SITE_URLS` เท่ากับสตริงที่ลบออก)
⇒ production เหมือนเดิม ยกเว้น mailto ที่ตายอยู่แล้ว 2 จุด

**Caveat ที่ต้องจำ:** `velnox.live` ยังไม่มี MX ⇒ เมลไป `@velnox.live` ยังไม่ถึงเช่นกัน (เดิมก็ไม่ถึง)

## 7. Resume ต้องมีอะไร

ทาง A: สร้าง zone `velnox.live` ใน Cloudflare + import BIND + เปลี่ยน NS ที่ GoDaddy
ทาง B: เปลี่ยน NS ที่ GoDaddy ไป `ns1/ns2.vercel-dns.com` แล้ว AI 01 สร้าง record ทั้ง 6 เองได้ผ่าน MCP
ก่อน PHASE 5 ต้องให้ owner snapshot env ไว้ก่อน (MCP อ่าน Render env ไม่ได้ ⇒ ชั้นนั้น rollback ไม่ได้)
