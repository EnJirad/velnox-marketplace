# Velnox AI Handoff — Current State

**Last verified:** 2026-11-11 · **Branch:** `main` · **HEAD:** `301a483` — product gallery + rich description

## 1. Current Project State

**WORKING — CI เขียวครบทั้งสอง workflow** — 4/4 apps typecheck, backend typecheck, test suite บน CI = **1782 pass / 9 skip / 0 fail**, i18n parity 2235×3, `build:apps` 4/4, `git diff --check` clean. การซ่อมรอบ 2026-11-09 (รายละเอียด `.ai/reports/LATEST.md`):
- typecheck backend (`auth.ts` duplicate import + Turnstile typing) เคยทำให้ job *Tests* skip test suite ทั้งหมด
- **263 DB-gated tests: root cause เดียว** — `mock.module` leak จาก `order-read-schema-fallback.test.ts` (Bun ถอน mock ไม่ได้) → แก้ด้วย DI และ **ห้ามใช้ `mock.module` ใน repo นี้**
- proxy tests ต้องการ `apps/velseller/dist` → เพิ่ม step build ในทั้ง 2 workflow
- `CANON` ใน `db/verify-reconciler.sh` อัปเดตเป็น `67|255|285|716` (ค่าที่วัดได้จริงบน disposable PostgreSQL)


### Active Tasks
- **Gallery thumbnail rail — rounded edge (2026-11-11)** — ✅ DONE — owner ขอให้แถบ thumbnail แนวตั้งด้านขวาของหน้ารายละเอียดสินค้า (แถบที่เลื่อนขึ้นลงได้) มีขอบมนเท่ากรอบรูปหลัก. แก้ที่ `packages/shared/src/components/shop/ProductGallery.tsx`: rail เปลี่ยนเป็น `rounded-2xl` (radius เดียวกับกล่องรูปหลัก) + ตัว scroll list เพิ่ม `p-1` และ `items-center` ให้ thumbnail ย่อเข้าไป 4px สองข้างเท่ากับที่ rail เผื่อ width ไว้ (`thumbSize + 8`) → ขอบบน/ล่างที่ถูก clip ตอนเลื่อนเป็นมุมมน ไม่ใช่ตัดคม. ไม่แตะขนาด/ตรรกะ/เส้นแบ่ง. test `backend/tests/product-gallery-description.test.ts` ปรับ assertion ที่ค้างของ markup เดิม (`flex shrink-0 flex-col gap-2` ไม่มีในโค้ดจริงแล้ว → เป็น `relative shrink-0 self-stretch overflow-hidden`) + เพิ่มเทสต์ pin ว่า rail ใช้ `rounded-2xl` เท่ากรอบหลัก. ผล: 23 pass / 0 fail, typecheck velshop+velseller ผ่าน, `build:velshop` ผ่าน. **ยังไม่ตรวจด้วยตา** (ไม่มี `.env`/DB ในเครื่อง จึงรัน backend+หน้าร้านจริงไม่ได้)
- **Product Gallery + Rich Description (2026-11-11)** — ✅ DONE, verified on production — `ProductGallery` ตัวเดียวใช้ทั้ง VelShop และ VelSeller (preview): รูปหลักซ้าย + thumbnail คอลัมน์ขวา + เส้นแบ่งแนวตั้งจริง (วัดบน production: ห่างสองฝั่ง 10px/10px, thumb 72px uniform, counter 1/4, click เปลี่ยนรูปได้). แก้บั๊กเดิมที่ detail images ถูก push เข้า carousel (`group: 2`) → ตอนนี้แยกจริง (gallery 4 ใบ / detail 5 ใบ). Seller: ลากสลับลำดับ + "ตั้งเป็นหลัก" = index 0 = sort_order 0. Rich description: `products.description_blocks` JSONB + `backend/lib/description-blocks.ts` (5 ชนิดบล็อก, validate 40 บล็อก, เฉพาะ http(s)). **production ยังไม่มีคอลัมน์ — ต้องรัน Production DB Reconcile (owner).** รายละเอียด: `.ai/context/product-gallery.md` + `.ai/reports/LATEST.md`
- **UI Simplification Phase A+B (2026-11-10)** — ✅ DONE, verified — ตามแผน `.ai/tasks/active/ui-simplification-plan.md` (owner เลือกแนวทาง 2 "เรียบขึ้นจริง"). **Phase A:** รวม token 859 จุด/94 ไฟล์ — `rounded-[10/12/8px]`→`md/lg/sm` (262) · `#10B981`→`*-brand` (302) · `text-[11px]`→`text-2xs` (295); เพิ่ม `--brand` + `--text-2xs` ใน `index.css`. **ไม่เปลี่ยนพิกเซล** — พิสูจน์ด้วย CSS ที่ build จริง (`.text-2xs{font-size:.6875rem}`, `.rounded-md{border-radius:calc(var(--radius) - 2px)}`, `--brand:#10b981`) และครบ 8 คลาสทั้ง 4 แอป. **Phase B:** แก้ `VELNOX_DESIGN_THEME.md` เป็น v2.1 — ตาราง type scale เดิมผิดทั้งหมด (บอก xs=11px แต่ Tailwind จริง 12px ซึ่งเป็นต้นเหตุของ `text-[11px]` 295 ครั้ง) · §7 radius เปลี่ยนจาก `rounded-[10px]` เป็นชื่อ token + ตารางค่าจริงที่วัดจาก CSS (เจอว่า `rounded-xl` กับ `rounded-2xl` = 16px เท่ากัน) · เพิ่มกฎห้าม arbitrary value + checklist 3 ข้อ. test 1432 pass / 0 fail · build:apps 4/4. **ยังไม่ทำ:** Phase C (`<button>` ดิบ 204 → `<Button>`) และ Phase D (ลดความหนาแน่น 4 จอใหญ่)
- **Launch readiness รอบ 1 (2026-11-10)** — ✅ DONE, verified — ตามแผน `.ai/tasks/active/launch-readiness-plan.md`. ปิดรู 3 จุด: (ก) ตะกร้า guest หายเมื่อ refresh/ล็อกอิน → เพิ่ม `packages/shared/src/lib/guest-cart.ts` (pure storage + validate + clamp qty กับ stock) และ merge เข้า server cart ครั้งเดียวต่อการล็อกอิน แบบไม่คูณสอง (ข) ปุ่มจ่ายเปิดทั้งที่ไม่มีวิธีจ่าย → disable ทั้ง desktop + mobile CTA (ค) ร้านที่ถูกระงับยังขาย → catalog + detail เพิ่ม `sh.status = 'active'`. Test ที่ pin contract เก่า 3 ไฟล์อัปเดตตามพฤติกรรมใหม่ ไม่ได้ลบ. รายละเอียด `.ai/reports/LATEST.md`. **ยังไม่ทดสอบบน production** — ต้อง deploy แล้วลอง flow จริง
- **Unified Domain Migration (2026-11-10)** — 🔶 **PARKED by owner** — task file: `.ai/tasks/active/unified-domain-migration.md`, record: `.ai/history/2026-11-10-unified-domain-migration.md`. เจ้าของเลือกใช้ URL เดิมต่อก่อน แล้วค่อยสลับเมื่อแก้เรื่อง DNS ได้. **ไม่มีอะไรค้างครึ่งทาง:** Vercel domain 3 ตัวที่เพิ่มไว้ยังไม่ resolve, ไม่ได้แตะ DNS/env/R2/Stripe เลย, และ code ที่แก้เป็น behaviour-neutral ⇒ production เหมือนเดิมทุกอย่าง ยกเว้น mailto ที่ตายอยู่แล้ว 2 จุด. แกนโดเมนเปลี่ยนจาก `velnox.com` (RDAP พิสูจน์ว่าไม่ใช่ของเจ้าของ) เป็น **`velnox.live`**. **ตัวกันเดียวที่เหลือ:** Cloudflare MCP เป็น read-only (`POST /zones` → 403 ยืนยันซ้ำ 2 ครั้ง) ⇒ ต้องเลือกทาง A (สร้าง zone + import BIND + เปลี่ยน NS) หรือทาง B (ชี้ NS ไป Vercel DNS แล้ว AI 01 สร้าง record เองได้ทั้งหมด). ข้อเท็จจริงที่ได้เพิ่ม: **Convex ไม่มีในระบบนี้เลย** (realtime = WebSocket ใน backend) และ **R2 CORS ขาด `velnox.live`/`www.velnox.live`** ⇒ อัปโหลดจากหน้าร้านจริงถูกบล็อก (bug ที่มีอยู่ก่อน)
- **CI เขียว + MVP storefront polish (2026-11-09)** — ✅ DONE, verified, commit+pushed. ซ่อม CI 2 จุดที่ต้นเหตุ (auth.ts typing, CANON ใน verify-reconciler.sh) + ปิดงานค้าง Phase 2: tablet nav ของ velseller กลับมา (`until="lg"`), แถวตาราง seller orders เลิก full reload, `formatBaht` แสดงเศษสตางค์ครบ 2 หลัก, การ์ดสินค้าเลิกแสดงปุ่มตาย `0 0 0`. Test ค้าง 5 ไฟล์อัปเดตตาม behavior จริง (ไม่ใช่กลบ). รายละเอียด: `.ai/reports/LATEST.md`
- **Automatic Neon Database Migration System (2026-11-09)** — ⚠️ **ไม่พบไฟล์ในรีโป ปัจจุบัน** — handoff/LATEST ของ session ก่อนอ้างว่า `backend/scripts/migrate.ts` + `backend/tests/migrate-runner.test.ts` ถูกสร้างแล้ว แต่ตรวจ tree จริง (`ls backend/scripts`, `git ls-files`, `find -name "migrate*.ts"`) ไม่พบทั้งสองไฟล์ และ `backend/package.json` ไม่มี script `migrate` (`package.json` root มีแค่ `db:migrate` ที่เป็น echo) — บันทึกของ session นั้น (`2026-11-09-automatic-migration-system.md`) ยัง untracked และ**ไม่ถูก commit** จนกว่าจะตรวจกับ session นั้นได้ ของจริงที่ยืนยันได้คือ: production schema 67 tables == canonical 67 และ ledger `schema_migrations` มี row ของ tracking (ตรวจผ่าน Neon MCP)
- **Multi-carrier tracking (integrated)** — committed + pushed. New `backend/lib/tracking/` (adapter contract + J&T/Flash/SPX/TNT adapters + normalizer + safe-fetch + repo + service with cache/dedup/cooldown), `backend/routes/tracking.ts`, additive DB columns on `shipments` + `tracking_events` (schema.sql + run-sqleditor.sql in sync, 67-tables match verified 2026-11-09), frontends extended (ShopTracking refresh UI, seller ship dialog carrier select + refresh, VelCenter Tracking tab), i18n th/en/my at parity. Carrier status: J&T BLOCKED (captcha), Flash BLOCKED (anti-bot), SPX UNSUPPORTED (internal portal API), TNT PARTIAL (public API verified working). Docs: `.ai/context/tracking.md`.
- **Logo/favicon rollout (2026-11-09)** — ✅ committed + pushed:
  - `41fe884` — use new Velnox V-mark (`public/logo.svg`, #0F172A) as favicon across velshop/velseller/velcenter/velnox + shared asset; `Logo.tsx` LogoMark now white box + dark V-mark (design B); fixed manifest icon refs that pointed at missing `logo.png` → `/logo.svg`.
  - `b5819df` — fixed velnox `public/public/` double-nesting: files moved up one level so the favicon actually serves at `/logo.svg` (index.html already referenced it). All 4 apps build cleanly; `dist/logo.svg` at root of each build.
  - `d823417` (2026-11-11) — **brand-green headers + white logo.** Owner supplied the white mark (`velnox-mark-white.svg` → `public/logo.svg`) and asked for it in-page with no background plate. A white mark is invisible on the 9 light surfaces, so owner chose: **every app header becomes a solid brand-green bar with the white lockup.** `Logo.tsx` renders the mark with no plate and takes `tone` (`light` = white / `dark` = `text-slate-900` via `currentColor`, no raw hex — respects the Phase A token pass); `ShopHeader` desktop bar, `AppHeader` (velseller), velcenter `Center`, velnox `CorporateLayout` are `bg-brand` with white nav/buttons/icons; `LanguageSwitcher`, `NotificationBell`, `SellerNotificationBell`, `UserMenu` gained `tone="brand"`; wordmark on brand is all-white (mint `nox` measured 1.98:1 — invisible). Favicon is now brand green `#10B981` + white mark so it survives light browser tabs. Light surfaces (footers, auth, 404, cart drawer) keep the ink tone. Contrast: white on `--brand` = 2.54:1 (same as the system-wide `bg-brand text-white` buttons); `--brand-strong` = 3.77:1, `--brand-deep` = 5.47:1 are one-class upgrades. typecheck 4/4 + build 4/4.
- **Phase 2 UI/UX Overhaul** — **Group 1 complete** ✅; **Group 2 complete (2026-11-09)** ✅
  - Group 2: shared `ProductGrid` (server-paginated) ใช้ทั้ง `ShopProducts.tsx` และ `ShopHome.tsx`, `GalleryLightbox` ใช้ใน `ShopProductDetail.tsx`, home rails ใช้ `HorizontalRail`/`RailCard` — ตรวจบน production จริงแล้ว (velshop.vercel.app แสดงสินค้า/ส่วนลด/รีวิวครบ)
  - ของค้างที่เจอระหว่างตรวจ (แก้แล้วรอบนี้): tablet nav หาย 768–1023px, seller order row ทำ full reload, ราคา `฿419.3`, ปุ่ม like/save/share ตายบนการ์ดสินค้า
- **Icon library + category details (2026-11-08)** ✅ — full offline Iconify library wired into VelCenter (lucide/mdi/tabler/ph/fa6-solid) via `packages/shared/src/lib/icons/`; CategoryIcon resolves `prefix:name` lazily; category details panel (Sheet) with product count/status/dates/breadcrumb. Icon picker is a responsive Radix Dialog modal (search, collection chips, grid, confirm-only). Committed & pushed (`7d06455`, `5a8359a`, `6ab1ddc`).
- Seller roadmap Part 2 (Orders / Order Detail re-verification) — **not started**.
- Shipping P0 (fee + quote) — **implemented and committed**; production schema reconciled 2026-11-05.
- **35.00 THB flat default per shop** is the owner-approved placeholder until a carrier API exists (`PLATFORM_DEFAULT_FLAT_FEE`); per-shop `shops.shipping_fee` still wins. Checkout E2E + 15 DB-gated shipping tests BLOCKED (no disposable PostgreSQL).

### Important Unresolved Issues
1. **No local PostgreSQL** — `initdb` hangs on Android, so every `TEST_DATABASE_URL`-gated suite skips here (425 skips). Escape hatch: GitHub Actions `test.yml` runs them on CI (push to origin = server-side verification).
2. **Responsive verification BLOCKED** — CDP cannot install on android/arm64; storefront ตรวจด้วย in-app browser แทน (`velshop.vercel.app`).
3. **Production DB access is indirect** — no `psql` connection string; agents READ production via Neon MCP (`wandering-glitter-94857012`), WRITE only through manual `production-db-migrate.yml` reconcile workflow.
4. **Stripe live payments are NOT enabled** — sandbox/test keys only. Real money needs live keys + `STRIPE_MODE=live` + `STRIPE_ALLOW_LIVE=true` in Render (see `.ai/context/payment.md`). **Owner deferred live-card testing until device can test it — do not test until owner asks.**
5. **Impeccable engine BLOCKED** — `impeccable --version` fails (`unexpected e_type: 2`); UI review falls back to `VELNOX_DESIGN_THEME.md` + craft-floor.
6. **ข้อมูล production บางมาก (ตัวกั้น MVP ที่แท้จริง)** — 2026-11-09: `sellers` 2 (approved 2), `shops` 2, `products` 2 (published 1 · suspended 1), `categories` 96, `orders` 8, `users` 4. หน้าแรกจึงมีสินค้าเดียว. การ seed production เป็นการเขียนข้อมูลจริง — รอ owner สั่ง (จำนวน/หมวด/แหล่งรูป)
7. **CI แดงจาก DB suite — แก้แล้ว (2026-11-09, CI เขียว)** — root cause เดียว: **`mock.module` leak** (`order-read-schema-fallback.test.ts` ลง mock ของ `../db/index.js` แบบ process-global, Bun 1.4.4 ถอนไม่ได้) ทำให้ทุกไฟล์ที่รันตามหลังได้ `withTransaction` ที่ส่ง `{}` ⇒ `client.query is not a function` + HTTP 400/422/500/403 พรวด (263 เคส). แก้เป็น DI (`run` param) + แก้ expectation ที่ค้าง (total รวมค่าส่ง, clock skew 3s, ลำดับ guard ของ quote, group total). เพิ่ม build `velseller` ก่อน test ใน 2 workflow. **ห้ามใช้ `mock.module`** — ถ้าต้องจำลอง I/O ให้ inject. วิธีรัน DB suite ในเครื่อง (Neon branch ชั่วคราว + tunnel 127.0.0.1 + `--timeout 90000`, แล้วลบ branch) อยู่ใน `.ai/reports/LATEST.md`
8. **`.ai-office/`** — workspace ของ AI Office 2.0 (commit `6bdd203`) มี `.gitignore` ของตัวเองและ track อยู่ครบ **ไม่ใช่ไฟล์หลง** — บันทึกก่อนหน้าสรุปผิด ห้ามลบ

### Important Recent Decisions
- **Stripe live mode is an explicit opt-in (2026-11-05).** Production runs Stripe **test mode**; real cards / real PromptPay cannot complete. Live key used only with `STRIPE_ALLOW_LIVE=true` **and** `STRIPE_MODE=live` plus webhook secret (`backend/lib/payment-config.ts`). Owner decision (2026-11-09): do not run live-card tests until owner says the device can test.
- **Shipping is server-priced (2026-11-05).** One flat fee per shop shipment; quotes in `shipping_quotes` (15 min TTL, single use). Checkout refuses every client money field.
- **One canonical report:** `.ai/reports/LATEST.md`, overwritten per task. Dated records in `.ai/history/`, archive index in `.ai/history/AI_Handoff_Archive.md`.
- **Compact handoff** (this file). Pre-compaction 105 KB handoff preserved at `.ai/history/archive/AI_HANDOFF_2026-11-02_FULL.md`.

---

## 2. Quick Pointers

| Need | Location |
|------|----------|
| Startup (read first) | `.ai/office/QUICK_START.md` |
| Always-on safety rules | `.ai/office/ESSENTIAL_RULES.md` |
| Full rulebook | `.ai/AI_RULES.md` |
| Latest task report | `.ai/reports/LATEST.md` |
| History index | `.ai/history/AI_Handoff_Archive.md` |
| Verbatim archive | `.ai/history/archive/` |
| Subsystem docs | `.ai/context/<topic>.md` |
| AI Office architecture | `.ai/office/ARCHITECTURE.md` |
| Agent roles | `.ai/office/agents/developer.md` · `architect.md` |

---

## 3. Runtime limits (must be stated honestly)

- The Android Harness **request builder is not in this repository.** `.ai/office/context-management/` is a real, tested library, but whether the live session calls it is controlled by Harness settings, not by this workspace. Do not claim the runtime uses it without evidence.
- AI 01 selects the routing level and acts on it by following `.ai/office/agents/developer.md`. The router constrains the *decision and its context payload*, not the platform's tool dispatch.
- `bun test` needs the `./` prefix on this host (bun 1.4.4).

---

## 4. Environment Notes

- `TEST_DATABASE_URL` is the only database a test may write to; DB tests **skip** when unset.
- `DATABASE_URL` points at production Neon — never write to it from a test.
- `bun run lint` runs real ESLint (`eslint .`) and `bun run format` runs `prettier --check .` (wired 2026-11-09, commit `6a2543e`). Both report the repo's pre-existing style debt (1061 eslint problems, many prettier-formattable files) — they are tools, not a clean bill of health.

---

## 5. Next Agent Should

1. `git fetch origin`; compare `HEAD` with `origin/main`. Behind → `git pull --ff-only`. Diverged → STOP.
2. Read `.ai/office/QUICK_START.md`, then only the subsystem doc the task touches.
3. Classify T1/T2/T3 and follow the matching workflow — do not read the full history.
4. Update `.ai/reports/LATEST.md` (overwrite) and this handoff when state changes.
