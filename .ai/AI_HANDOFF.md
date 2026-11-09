# Velnox AI Handoff — Current State

**Last verified:** 2026-11-09 · **Branch:** `main` · **HEAD:** `73fff9c` + CI/MVP-readiness work (session 2026-11-09, ดู `.ai/reports/LATEST.md`)

## 1. Current Project State

**WORKING — test suite เขียวแล้ว** — 4/4 apps typecheck, backend typecheck, `bun test ./backend/tests` = 1415 pass / 0 fail / 425 skip, i18n parity 2235×3, `build:apps` 4/4, `git diff --check` clean. CI สองจุดที่เคยแดงถูกซ่อมที่ต้นเหตุ: (1) `backend/routes/auth.ts` duplicate `import crypto` + Turnstile typing ทำให้ job *Tests* ตกที่ typecheck, (2) `db/verify-reconciler.sh` ค่า `CANON` ค้างที่ `63|241|265|661` ทั้งที่ schema จริง `67|255|285|716` ทำให้ job *Production DB Verify* red. Storage/lifecycle tests ไม่ผูกกับ secret ในเครื่องแล้ว (skip เมื่อไม่มี store). DB-gated suites ยัง skip ในเครื่อง (ไม่มี disposable PostgreSQL) — รันจริงบน CI เท่านั้น.

### Active Tasks
- **CI เขียว + MVP storefront polish (2026-11-09)** — ✅ DONE, verified, commit+pushed. ซ่อม CI 2 จุดที่ต้นเหตุ (auth.ts typing, CANON ใน verify-reconciler.sh) + ปิดงานค้าง Phase 2: tablet nav ของ velseller กลับมา (`until="lg"`), แถวตาราง seller orders เลิก full reload, `formatBaht` แสดงเศษสตางค์ครบ 2 หลัก, การ์ดสินค้าเลิกแสดงปุ่มตาย `0 0 0`. Test ค้าง 5 ไฟล์อัปเดตตาม behavior จริง (ไม่ใช่กลบ). รายละเอียด: `.ai/reports/LATEST.md`
- **Automatic Neon Database Migration System (2026-11-09)** — ⚠️ **ไม่พบไฟล์ในรีโป ปัจจุบัน** — handoff/LATEST ของ session ก่อนอ้างว่า `backend/scripts/migrate.ts` + `backend/tests/migrate-runner.test.ts` ถูกสร้างแล้ว แต่ตรวจ tree จริง (`ls backend/scripts`, `git ls-files`, `find -name "migrate*.ts"`) ไม่พบทั้งสองไฟล์ และ `backend/package.json` ไม่มี script `migrate` (`package.json` root มีแค่ `db:migrate` ที่เป็น echo) — บันทึกของ session นั้น (`2026-11-09-automatic-migration-system.md`) ยัง untracked และ**ไม่ถูก commit** จนกว่าจะตรวจกับ session นั้นได้ ของจริงที่ยืนยันได้คือ: production schema 67 tables == canonical 67 และ ledger `schema_migrations` มี row ของ tracking (ตรวจผ่าน Neon MCP)
- **Multi-carrier tracking (integrated)** — committed + pushed. New `backend/lib/tracking/` (adapter contract + J&T/Flash/SPX/TNT adapters + normalizer + safe-fetch + repo + service with cache/dedup/cooldown), `backend/routes/tracking.ts`, additive DB columns on `shipments` + `tracking_events` (schema.sql + run-sqleditor.sql in sync, 67-tables match verified 2026-11-09), frontends extended (ShopTracking refresh UI, seller ship dialog carrier select + refresh, VelCenter Tracking tab), i18n th/en/my at parity. Carrier status: J&T BLOCKED (captcha), Flash BLOCKED (anti-bot), SPX UNSUPPORTED (internal portal API), TNT PARTIAL (public API verified working). Docs: `.ai/context/tracking.md`.
- **Logo/favicon rollout (2026-11-09)** — ✅ committed + pushed:
  - `41fe884` — use new Velnox V-mark (`public/logo.svg`, #0F172A) as favicon across velshop/velseller/velcenter/velnox + shared asset; `Logo.tsx` LogoMark now white box + dark V-mark (design B); fixed manifest icon refs that pointed at missing `logo.png` → `/logo.svg`.
  - `b5819df` — fixed velnox `public/public/` double-nesting: files moved up one level so the favicon actually serves at `/logo.svg` (index.html already referenced it). All 4 apps build cleanly; `dist/logo.svg` at root of each build.
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
7. **263 DB-gated tests ตกบน CI** — มีมาก่อนหน้า (ถูกซ่อนเพราะ typecheck ตกและ step test ถูก skip) ต้องซ่อมเป็นชุดผ่าน CI เท่านั้น เพราะ:
   - Neon branch ใช้ไม่ได้: `assertTestDatabaseIsSafe()` ปฏิเสธ host `*.neon.tech` โดยเจตนา (ทดลองจริง 2026-11-09 แล้ว, branch ถูกลบทิ้งแล้ว)
   - PostgreSQL ท้องถิ่นใช้ไม่ได้: `initdb` ต้องการ `libicui18n.so.79` แต่ prefix มี 78.3 และ `pkg_install libicu` ไม่ซ่อมไฟล์
8. **`.ai-office/DISCOVERY.md`** — ไฟล์หลงจาก session ก่อน (นอก `.ai/`) ยังไม่ commit ไม่ได้ลบ; ควรย้ายเข้า `.ai/history/` หรือลบ

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
