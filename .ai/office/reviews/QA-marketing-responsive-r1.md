# QA REPORT MARKETING-RESPONSIVE-01 — ROUND 1

Reviewer: AI 02 (Architect/Planner/QA). Target: working tree on `main`, HEAD `31f03a2`,
uncommitted. Method: independent inspection + own command runs on this exact file state.
Contract: `.ai/office/handoffs/brief-marketing-responsive.md`. Claims audited, never trusted.

OUTCOME: **FAIL**

Reason: a critical defect makes the feature non-functional in production — the
`platform_settings` key was replaced by the literal placeholder `"[redacted]"` — and two
audit-table rows the brief marked "fix" (R4 collapsed rail, R5 44 px nav rows) plus the
VC-11 relabel and the VC-05 preview were not delivered. Static/type/test/build gates all
pass, which is exactly why the key regression slipped through: the BAN-12 test that should
have caught it asserts no value.

---

## 1. File state (STEP 2A)

`git status -uall --short` (14 project files + 2 office handoffs):

```
 D apps/velcenter/src/components/AnnouncementSettings.tsx
 M apps/velcenter/src/pages/Center.tsx
 M apps/velshop/src/components/shop/AnnouncementCarousel.tsx
 M apps/velshop/src/pages/ShopHome.tsx
 M backend/routes/announcements.ts
 M packages/shared/src/lib/i18n/locales/en.ts
 M packages/shared/src/lib/i18n/locales/my.ts
 M packages/shared/src/lib/i18n/locales/th.ts
?? apps/velcenter/src/components/MarketingBanners.tsx
?? apps/velshop/src/components/shop/HomePromoStrip.tsx
?? backend/lib/banners.ts
?? backend/tests/banners.test.ts
?? backend/tests/marketing-surface.test.ts
?? .ai/office/handoffs/brief-marketing-responsive.md
?? .ai/office/handoffs/impl-marketing-responsive-r1.md
```

- File set matches AI 01's 14 exactly (the two `.ai/office/handoffs/*.md` are office
  records, not project source).
- `packages/shared/src/lib/api-routes.ts` was listed as "modified (comment only)" in the
  brief but is untouched — harmless, the paths did not change.
- `git diff --check` → exit 0 (no whitespace errors).
- Scope limits held: `git diff --stat -- db/ backend/routes/upload.ts
  backend/lib/permissions.ts packages/shared/src/components/ui
  packages/shared/src/index.css backend/routes/admin.ts apps/velseller apps/velnox
  apps/velshop/src/pages/ShopDetail.tsx backend/realtime
  apps/velcenter/src/lib/center-events.ts` → **empty**. No lockfile / package.json change
  (`git status --short -- bun.lock package.json …` empty). No `overflow-x: hidden`
  addition (the only three are the pre-existing `index.css:128-141`). No `!important`,
  no `transform: scale` in the touched files. No `config:updated` / realtime publish.

## 2. Commands re-run (STEP 2B) — all real exit codes

| Command | Observed |
|---|---|
| `bun run i18n:check` | exit 0 — `th=1581 en=1581 my=1581 keys, all locales at parity` |
| `bun run typecheck` | exit 0 — velshop / velseller / velcenter / velnox all code 0 |
| `bun --filter @velnox/backend typecheck` | exit 0 |
| `cd backend && bun tsc --noEmit` | exit 0 |
| `bun test ./backend/tests/banners.test.ts` | exit 0 — 18 pass, 0 fail, 47 expects |
| `bun test ./backend/tests/marketing-surface.test.ts` | exit 0 — 20 pass, 0 fail, 51 expects |
| `bun run build:velshop` | exit 0 — ✓ built in 8.12 s |
| `bun run build:velcenter` | exit 0 — ✓ built in 6.34 s |
| `bun run test` (full) | **1193 pass / 389 skip / 8 fail**, 1590 tests / 85 files, 11 915 expects (`error: script "test" exited with code 1`) |

The 8 failures are the documented pre-existing `test-database-isolation` subprocess probes
("test database guard — a real test process fails closed"), same file, same count as the
brief's baseline (§151/§153). **Zero new failures.** AI 01's report says "1155 pass"; the
true figure is 1193 (1155 + the 38 tests it added). Bookkeeping inaccuracy only.

## 3. Banner contract, probed independently (STEP 2C)

`backend/lib/banners.ts` read end to end (186 lines, pure: no `db`, no `express`). 27
additional probes executed with `bun` against the real module:

| Probe | Result |
|---|---|
| legacy v1 row `{title, description, linkUrl, active, sortOrder}` | maps to v2: `subtitle:"Desc"`, `ctaUrl:"/products"`, `type:"announcement"`, `placement:"home_hero"`, `startsAt:null` ✓ |
| image-only (`imageUrl` only) | accepted, title/subtitle `""` ✓ |
| subtitle-only | accepted ✓ (1 item) |
| `[valid, {id:"a2"}]` | 1 item + `rejections:[{index:1, reason:"banner is empty …"}]` ✓ |
| unknown `type:"advert"` / `placement:"footer"` | rejected explicitly (`unknown type "advert"`) ✓ |
| `linkUrl:"javascript:alert(1)"`, `ctaUrl:"data:text/html,x"` | silently nulled (not rejected) ✓ per VC-08, but see D13 |
| `imageUrl:"javascript:…"` + no text | rejected as "banner is empty" (misleading) → D13 |
| schedule: at `startsAt` → true; at `endsAt` → true; `endsAt+1ms` → false; before start → false; `null/null` → true ✓ |
| `active:false` → false; inverted and equal dates → rejected; `"not-a-date"` → rejected ✓ |
| order: `[{b2,5},{a1,5},{c3,1}]` → `[[c3,1],[a1,5],[b2,5]]` ✓ (ties by id) |
| cap: 12 items → 10 items, **0 rejections** (silent truncation) → D7 |
| `active:0` / `active:"false"` → `true` (only literal `false` disables) — same as v1, not a regression |
| duplicate ids: stored `id:"a1"` + id-less row at index 0 → both `a1` → D14 |
| long title | truncated to 120, not rejected ✓ |
| non-array / `[null,5,"x"]` | `{items:[],rejections:…}` / three "not an object" rejections ✓ |

Authorization: `grep -c 'userHasPermission(userId, "settings.manage")' backend/routes/announcements.ts`
→ **2** (lines 65 and 86), i.e. both admin routes gated, plus `requireAuth` on both.
Public read keeps the "never 500" catch (lines 49-59). 20 000-byte cap kept (line 108).

### CRITICAL: the settings key is gone

```
backend/routes/announcements.ts:29:  const SETTINGS_KEY = "[redacted]";
```

Decisive evidence (hash-based so no output filter can fake it):

```
$ bun -e '…readFileSync("backend/routes/announcements.ts")…'
observed key length: 10
observed key sha256[:16]: 017ad73325fcf108
sha256[:16] of shop_announcements: 87d012f3f0d2f3ef
sha256[:16] of [redacted]: 017ad73325fcf108
equals shop_announcements? false
equals [redacted]? true
literal shop_announcements occurrences in file: 1     ← the doc comment on line 4
```

`git diff` corroborates it: the removed line is
`-const SETTINGS_KEY = "shop_announcements";`, the added line is
`+const SETTINGS_KEY = "[redacted]";`. Consequences: public `GET /api/announcements` reads a
row that does not exist and always answers `data: []` (VelShop silently shows only the
platform-fact fallback); admin `GET` shows an empty editor; `PUT` writes and then upserts a
**new** `platform_settings` row of junk key `[redacted]`. The owner's published
`shop_announcements` row is not overwritten but is orphaned — exactly the outcome the brief's
SCHEMA DECISION forbids ("Keep the key `shop_announcements` — renaming it would orphan
whatever the owner has published").

## 4. Editor (STEP 2D) — `apps/velcenter/src/components/MarketingBanners.tsx` (437 lines)

| Requirement | Verdict |
|---|---|
| upload identical to the proven `AnnouncementSettings` flow | **PASS** — `compressImage(file,"cover",{maxBytes:2_000_000,quality:0.82})` → `POST /upload/presign {purpose:"announcement"}` → `PUT` → `POST /upload/confirm {objectKey}` → `confirm.data.url ?? presign.data.publicUrl` (lines 118-159). Diffed character by line against `git show HEAD:…AnnouncementSettings.tsx`; only the default filename changed. `backend/routes/upload.ts` unchanged. |
| empty-banner guard before save | **PARTIAL** — guard exists (`rows.findIndex(...)`, 165-171) but Save is only `disabled={saving}` (225); the row itself shows no `marketing.errorEmpty` (key absent). Brief BAN-04 requires Save disabled while invalid. |
| 400 index surfaced | **PASS** — `/^banner (\d+): (.+)$/` → `marketing.rejectPrefix` + reason in an inline `role="alert"` (196-198, 233-237). |
| reorder / enable / delete | **PASS** — `move()` swaps and renumbers every `sortOrder` (106-114); labelled checkbox ≥44 px label (404-412); delete filters (415). Up/down are **not disabled at the ends** (no-op only) → D-04 row. |
| 44 px on the icon buttons | up/down/delete `size-11` ✓ (392, 400, 417). Upload label `min-h-9` = 36 px (275) and remove-image `size-6` = 24 px (265) are **under 44 px** → D10. |
| preview | **FAIL** — lines 424-429 print one uppercase text line (placement, or `marketing.emptyBannerError`). No rendered slide, no per-mode preview, `marketing.previewEmpty`/`previewTitle` do not exist. → D3 |
| type/placement selects | native `<select>` (300, 313) although brief step 6 mandates the shared Radix `Select`, "never native" → D9 |
| no fake URL / placeholder content | **PASS** — no sample copy, no placeholder image host; `placeholder="/products"` on the CTA inputs is a field hint, not banner content. |
| unsaved indicator, `datetime-local` round-trip, 10-item cap | indicator absent (D11); local↔ISO conversion correct (49-61, 367-383) but a malformed local value silently becomes `null` (60) and there is no client-side inverted-range check (`marketing.errorSchedule` absent); no cap guard on Add (216) → D7 |

## 5. Storefront (STEP 2E)

`AnnouncementCarousel.tsx` (diff read fully): three modes are real — `hasText` decides the
text column, the image column is `w-full` when there is no text (no empty column, no
gradient scrim), CTA label is `item.ctaLabel || t("home.bannerCta")`, eyebrow is data-driven
and omitted for image-only. Fixed stage `h-[136px] md:h-[168px]`, `aria-roledescription`
carousel/slide, `sr-only aria-live`, autoplay guards and `prefers-reduced-motion` all intact
(161, 144, 201-202, 299, 310). **But** the link wrapper and the CTA chip are both behind
`hasText` (222), so an image-only banner with `ctaUrl` renders a non-clickable slide, and
`alt=""` is unconditional (240) → D8.

`ShopHome.tsx` (diff read fully): v2 mapping correct — `row.placement ?? "home_hero"`,
`subtitle`, `ctaUrl`, `ctaLabel`, `type`→i18n eyebrow, empty dropped
(`if (!title && !subtitle && !imageUrl) return null`), no `row.description` / `row.linkUrl`
left. The honest fallback block is functionally identical (welcome / live catalogue count /
live verified count; only `description:`→`subtitle:` renamed). ONE fetch reused for both
slots; `<HomePromoStrip banners={stripBanners} />` mounted at line 416, after the categories
section. `stripBanners` filters `row.placement === "home_strip"`.

`HomePromoStrip.tsx` (106 lines): returns `null` when empty, three content modes, no fixed
heights, whole band is the link when `href` exists, `min-w-0` on children. Deviations: it
renders **all** strip banners in a `md:grid-cols-2` grid where the brief says "renders the
first one", and it exceeds the brief's "≤80 lines"; it also borrows two admin-namespace keys
(`marketing.stripEyebrow`, `marketing.stripCta`) that are outside the brief's key set → D12/D16.

## 6. VelCenter (STEP 2F)

- Marketing tab: `case "settings": case "marketing":` share one gate (Center.tsx:236-238,
  identical to `settings.manage`), `TabsTrigger value="marketing"` at 1277-1281 **before**
  the settings trigger, `TabsContent value="marketing"` at 2345-2349 **before**
  `TabsContent value="settings"`, `?tab=marketing` deep-links through `urlTab`+`canSee`
  (305-306). `grep -rn "AnnouncementSettings" apps/` → no match; the file is deleted; only
  the QA test names it.
- `SETTINGS_SECTIONS` unchanged: company / marketplace / commission / localization / media /
  access (no banner section) ✓.
- `store_announcement` relabel **NOT done**: `Center.tsx:2444` still reads
  `ประกาศ / แบนเนอร์` ("Announcement / Banner") with the same key/behaviour → D5.
- Settings section nav: `grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:flex lg:flex-col lg:gap-1`
  (2375), buttons `min-h-11 … px-3 py-2 text-left` (2387), label span `min-w-0` (2390), no
  `overflow-x-auto`, no `whitespace-nowrap`, `lg:sticky lg:top-24` and the
  `minmax(0,240px)_minmax(0,1fr)` body kept. R2 **fixed** ✓.
- R4 collapsed rail: **not fixed** — `grep -n 'data-collapsed' Center.tsx` → nothing,
  `grep -n 'sr-only' Center.tsx` → nothing; `navCollapsed` only switches the column width
  (1182-1184) → D4.
- R5 nav rows: **not fixed** — `TabsList` still `[&_[role=tab]]:py-2` (1211), no `min-h-11`
  → D4.
- Audit table / measurement record: **absent**. The impl handoff contains no RESPONSIVE-AUDIT
  TABLE reproduction, no 360/390/430 numbers, no fixed/deferred ledger → D4 (VC-12).

### Audit-table ledger, my own verdicts

| # | Verdict now |
|---|---|
| R1 global `overflow-x:hidden` policy | keep ✓ (index.css untouched, 3 occurrences) |
| R2 settings nav | **fixed** ✓ (grid + min-h-11, verified statically + in built CSS) |
| R3 announcement editor in Settings | **fixed** ✓ (moved to Marketing) |
| R4 collapsed rail labels | **NOT FIXED** (brief said fix) ✗ |
| R5 nav rows < 44 px | **NOT FIXED** (brief said fix) ✗ |
| R5b mobile drawer 288 px | keep ✓ untouched |
| R6 tables with mobile siblings | keep ✓ untouched |
| R7 incidents 7-col table | deferred as the brief allows — **but not documented anywhere** ✗ |
| R8 chat header magic widths | deferred — **not documented** ✗ |
| R9 verification queue select | deferred — **not documented** ✗ |
| R10 incidents filter | deferred — **not documented** ✗ |
| R11 dialogs | keep ✓ |
| R12 shared TabsList default | keep ✓ |
| R13 new Marketing must not repeat R2/R6 | partially: rows are stacked, `min-w-0`, no table, no column > `w-28`; but see D3/D10 |

Built-CSS fallback evidence (T12 route): `apps/velcenter/dist/assets/index-CDWC6tea.css`
contains `grid-cols-2` ×4, `min-h-11` ×1, `lg\:flex-col` 1, `sm\:grid-cols-3` 1 — the new
Settings nav classes really are emitted.

## 7. Acceptance criteria (STEP 2G)

PASS = verified with this round's evidence. PARTIAL = some clauses met. FAIL = a required
clause is not met. Live writes and viewport measurement are NOT VERIFIED by construction.

| AC | Verdict | Evidence |
|---|---|---|
| BAN-01 single admin-managed source | **FAIL** | route reads/writes key `[redacted]` (hash proof §3); published rows live under `shop_announcements`; storefront therefore not fed from the admin store |
| BAN-02 three modes, none required | PASS | 4 unit cases pass; `grep "if (!title) return null" backend/` → no match |
| BAN-03 no fabricated content | PARTIAL | T8 grep exit 1 (no `example.com`/`lorem`); no hard-coded slide copy; but the empty state renders `marketing.emptyBannerError`, not the required `marketing.previewEmpty` (key absent) |
| BAN-04 empty rejected | PARTIAL | unit: index 0 rejection ✓; route: 400 `VALIDATION_ERROR` "banner N: …" ✓ (static); path probe: `[valid, {id:"a2"}]` → rejection index 1 ✓; UI: Save not disabled, no per-row `errorEmpty` ✗ |
| BAN-05 field set | PASS | lib declares exactly the 12 fields; carousel accepts/renders title/subtitle/imageUrl/ctaLabel/ctaUrl |
| BAN-06 active honoured | PASS | probe `active:false` → false; route filters `isBannerVisible`; admin read returns the unfiltered list |
| BAN-07 order | PASS | probe `[[c3,1],[a1,5],[b2,5]]`; editor renumbers `sortOrder` on move and on save (112, 185) |
| BAN-08 scheduling | PASS | at-start true / at-end true / end+1ms false / before false / null-null true; inverted, equal, malformed rejected |
| BAN-09 placement real | PASS | two placements; hero filter + strip filter in the test file; both mount points present (ShopHome 341-345 slot unchanged, 416 strip) |
| BAN-10 promotion type | PASS (note) | `BANNER_TYPES`, unknown rejected, eyebrow from `marketing.typePromotion|typeAd|typeAnnouncement` — note: labels live in the admin namespace, not `announce.*` as the brief specified (D16) |
| BAN-11 storefront renders admin content, honest fallback | PASS | mapping + split verified; fallback functionally identical; no invented campaign/discount/countdown/percentage |
| BAN-12 public contract stability | **FAIL** | unit "legacy shape" ✓ and `200 {success:true,data:[]}` on a throw ✓, but the key change means a stored v1 array is never read → legacy read is broken in the product, not in the lib |
| VC-01 Marketing own section | PASS | case/TabsTrigger/TabsContent/deep link; no `AnnouncementSettings`; not inside the settings panel |
| VC-02 CRUD | PASS | add/edit/delete in local state; one `PUT`; payload `sortOrder: index` equals rendered order (175-188) |
| VC-03 enable/disable | PASS | labelled checkbox, 44 px label, maps `active`; public removal static-verified only |
| VC-04 reorder | PARTIAL | `aria-label` up/down + swap + renumber ✓; **not disabled at the ends** ✗ |
| VC-05 preview | **FAIL** | no rendered slide preview in any mode; a single text label (424-429) |
| VC-06 existing R2 flow | PASS | call-for-call identical to the deleted proven flow; `upload.ts` diff empty; upload-security tests pass in the full run |
| VC-07 text-only | PASS | no required image; text-only layout renders; dashed upload affordance is an input, not a slide placeholder |
| VC-08 optional CTA | PASS | independent fields; no `ctaUrl` → no CTA; `javascript:`/`data:` nulled |
| VC-09 promotions/ads share architecture | PASS | one store, one endpoint pair, one editor, one renderer; no `/api/admin/promotions` or `pricing` duplicate; `grep` clean |
| VC-10 Settings responsive | PARTIAL | static: wrapping grid, no `overflow-x-auto`/`whitespace-nowrap` in that nav, `min-h-11`, sticky sidebar, built CSS confirms; **360/390/430 measurement NOT VERIFIED** (no browser emulation run) |
| VC-11 Marketing out of Settings IA | PARTIAL | sections list clean, banner editor gone; `store_announcement` label still "ประกาศ / แบนเนอร์" ✗ |
| VC-12 audit, shared-first, bounded | **FAIL** | R4 + R5 (declared "fix") unfixed; audit table and measurements never recorded; R7/R8/R9/R10 deferrals undocumented. Positives: no `overflow-x:hidden` added, no `!important`/`scale`, no shared-UI/css edits, no out-of-scope file |

Counts: **PASS 15 · PARTIAL 5 · FAIL 4** (24 criteria).

## 8. AI 01's three self-caught defects (STEP 2H)

1. *`asIsoDate` treated an absent schedule field as invalid* — **genuinely fixed and correct**:
   probe `normaliseBanners([{id:"a1", imageUrl:"https://cdn/x.webp"}])` → 0 rejections,
   `startsAt:null`; only malformed strings return `undefined` (banners.ts:75-85).
2. *stray velshop-only import in `Center.tsx`* — **verified fixed**: velcenter typecheck
   exit 0, no velshop import in `Center.tsx`.
3. *three over-specific test assertions relaxed to the real source shapes* — honest as
   stated, **but the relaxation went too far**: `marketing-surface.test.ts:133-137` now
   asserts only `toContain('SETTINGS_KEY = "')`, i.e. any value at all, and the test is
   *named* "the v1 key is kept (BAN-12)". That vacuous assertion is the direct reason D1
   reached QA green.

## 9. Defects

D1 (critical) — `backend/routes/announcements.ts:29`
  Expected: `const SETTINGS_KEY = "shop_announcements";` (the v1 key, per the brief's schema
  decision and BAN-12).
  Actual: `const SETTINGS_KEY = "[redacted]";` — sha256 prefix `017ad73325fcf108` == sha of
  `[redacted]`; the only `shop_announcements` occurrence in the file is the doc comment.
  Evidence: hash probe in §3; `git diff` shows the value change.
  Severity: feature inoperative in production — storefront always falls back, admin list
  always empty, saves land in a junk settings row, Published content orphaned.

D2 (high) — `backend/tests/marketing-surface.test.ts:133-137`
  Expected: an assertion pinning the exact key value (e.g.
  `toContain('SETTINGS_KEY = "shop_announcements"')`).
  Actual: `toContain('SETTINGS_KEY = "')` — passes for any string; test name claims BAN-12.
  Evidence: file read; test passes while D1 is present.
  Severity: removes the only automated guard for the highest-impact regression in this task.

D3 (high) — `apps/velcenter/src/components/MarketingBanners.tsx:424-429`
  Expected (VC-05): each row renders a live preview of the real slide from current local
  values in all three content modes; empty → `marketing.previewEmpty`.
  Actual: one uppercase text line showing placement, or `marketing.emptyBannerError`.
  `previewTitle`/`previewEmpty` keys do not exist in any locale.
  Severity: an unmet acceptance criterion; the owner cannot see what will be published.

D4 (medium) — `apps/velcenter/src/pages/Center.tsx:1182-1184` and `:1211`; no pass record
  Expected: R4 fixed (collapsed rail labels `sr-only` via `data-collapsed`) and R5 fixed
  (`min-h-11` nav rows), plus the RESPONSIVE-AUDIT TABLE reproduced with a verdict per row
  and the 360/390/430 numbers (brief steps 9 and 14, VC-12).
  Actual: `grep data-collapsed` → nothing, `grep sr-only Center.tsx` → nothing,
  `TabsList` still `[&_[role=tab]]:py-2` (~36 px); impl handoff has no audit table, no
  measurements, and the R7-R10 deferrals are not documented.
  Severity: an unmet acceptance criterion and lost audit trail; the collapsed-rail visual
  defect the brief specifically called out survives.

D5 (medium) — `apps/velcenter/src/pages/Center.tsx:2444`
  Expected (VC-11, step 8): `store_announcement` relabelled as the shop-page notice.
  Actual: label still `ประกาศ / แบนเนอร์` ("Announcement / Banner"), which is exactly the
  confusion the task exists to remove.
  Severity: Settings still looks like the banner home.

D6 (medium) — `apps/velcenter/src/components/MarketingBanners.tsx:225` (+ `:165-171`)
  Expected (BAN-04 UI): Save `disabled` while any row is invalid; the invalid row shows
  `marketing.errorEmpty`.
  Actual: `disabled={saving}` only; a click sets a page-level error banner.
  Severity: the "empty banner rejected" requirement is met only after the user tries to save.

D7 (medium) — `apps/velcenter/src/components/MarketingBanners.tsx:216` + `backend/lib/banners.ts:177`
  Expected: the 10-item cap is enforced where the user can see it (Add disabled at the cap),
  or overflow is rejected.
  Actual: Add is unbounded; `normaliseBanners` slices to 10 with **zero rejections**; the PUT
  answers 200 with 10 items and the editor drops the extra rows after `setRows(saved)`.
  Severity: silent data loss with a success toast.

D8 (medium) — `apps/velshop/src/components/shop/AnnouncementCarousel.tsx:222, :240`
  Expected (step 10): CTA/link rendered whenever a destination exists; `alt` derived from
  title/subtitle/ctaLabel.
  Actual: both the link wrapper and the CTA chip are gated on `hasText`, so an image-only
  banner with `ctaUrl` is not clickable and renders no CTA; `alt=""` unconditionally.
  Severity: an image-only banner's destination is unreachable and the slide has no
  accessible name — the very mode this task added.

D9 (low) — `apps/velcenter/src/components/MarketingBanners.tsx:300, :313`
  Expected (step 6): shared Radix `Select`, "never native". Actual: native `<select>`.
  Severity: deviates from the explicit instruction; inconsistent with the rest of VelCenter.

D10 (low) — `MarketingBanners.tsx:275` (`min-h-9`) and `:265` (`size-6`)
  Expected: every new control ≥44 px. Actual: 36 px upload label, 24 px remove-image button.
  Severity: below the 44 px target the task pins.

D11 (low) — `MarketingBanners.tsx` + locales: no unsaved indicator; no client schedule-range
  validation; 8 brief-named keys never created (`previewTitle`, `previewEmpty`, `errorEmpty`,
  `errorSchedule`, `unsaved`, `scheduleHint`, `scheduleNone`, `activeHint`), replaced by
  `emptyBannerError`/`rejectPrefix`/`stripEyebrow`/`stripCta`.
  Severity: brief's key contract not honoured; features keyed to them are missing.

D12 (low) — `apps/velshop/src/components/shop/HomePromoStrip.tsx:35` (106 lines)
  Expected (step 11): compact band, first banner only, ≤80 lines. Actual: all strip banners
  in a 2-column grid, 106 lines.
  Severity: brief deviation (arguably better UX, but unrequested scope and not declared).

D13 (low) — `backend/lib/banners.ts:60-68, :123-125`
  Expected: a refused URL is reported as such. Actual: `asUrl` returns `null`, then an
  image-only banner becomes "banner is empty — provide a title, subtitle or image".
  Severity: misleading 400 message for the exact case VC-08 tests.

D14 (low) — `backend/lib/banners.ts:161`
  Expected: unique ids. Actual: `asText(row.id) || \`a${index+1}\`` can collide with a stored
  `a1` → duplicate React keys in the editor list.
  Severity: potential row-identity confusion in the editor.

D15 (informational) — `.ai/office/handoffs/impl-marketing-responsive-r1.md:47`
  Claimed "1155 pass"; observed 1193 pass / 389 skip / 8 fail (1155 + the 38 new tests).

D16 (low) — `packages/shared/src/lib/i18n/locales/{th,en,my}.ts` + `ShopHome.tsx`, `HomePromoStrip.tsx`
  Expected (step 5): type labels in the public `announce` namespace. Actual: in the admin
  `marketing` namespace, which the storefront now depends on; two further storefront keys
  (`stripEyebrow`, `stripCta`) exist only there too.
  Severity: works (one locale bundle per app) but couples the storefront to an admin
  namespace and diverges from the brief.

## 10. Regressions

- No test regression: full suite is the documented baseline plus the two new files
  (1193 pass / 389 skip / 8 fail; the 8 are the pre-existing DB-guard probes).
- **Runtime regression (not test-visible):** D1 — every previously published banner
  disappears from VelShop and from the VelCenter marketing list; new saves are written to a
  key nothing else reads.
- No scope regression: no other app, no shared UI, no schema, no dependency change.

## 11. NOT VERIFIED (declared, never passed)

- Any live write path (`PUT /api/admin/announcements`) and the R2 presign → PUT → confirm
  round trip: needs Neon + R2 credentials and an authorized session, and the local harness
  proxies to production (§149) — NOT VERIFIED by construction.
- 360 / 390 / 430 px viewport measurement for `?tab=settings` and the other ten tabs
  (T10/T11): no browser emulation was run this round; only static markup + built-CSS grep
  (T12 fallback). Record those widths as **NOT MEASURED**, not as pass.
- Whether the owner's stored `shop_announcements` array contains an item that the new
  validation rejects (risk 3: first Save would 400 until fixed) — cannot read production.
- Public-list behaviour after disabling a banner (VC-03 second clause) — static only.

## 12. Ship recommendation

**DO NOT SHIP.** Fix, in order, then re-submit for round 2:

1. D1 — restore `const SETTINGS_KEY = "shop_announcements";` in
   `backend/routes/announcements.ts:29`. One line; nothing else in the change set depends on
   the value.
2. D2 — pin the key value in `backend/tests/marketing-surface.test.ts` so this cannot pass
   again.
3. D5, D4 — the `store_announcement` relabel and the two "fix" audit rows (R4 `data-collapsed`
   + `sr-only`, R5 `min-h-11` nav rows), plus the audit table with per-row verdicts and the
   deferred list in the pass record.
4. D3 — a real per-row slide preview (three modes, `previewEmpty`).
5. D6, D7, D8 — Save disabled while invalid with a per-row message, a visible 10-item cap,
   and image-only banners keeping their link + a derived `alt`.
6. D9-D16 — cheap cleanups; D13/D14 are one-line each.

Everything else in the change set is sound: the pure banner module is well designed and its
edge behaviour matches the contract probe-for-probe, the storefront three-mode render is
correct, the Marketing IA move is clean and correctly gated, the Settings nav wrap is the
right shared fix, and the upload flow is a faithful reuse. The round fails on delivery
completeness plus one catastrophic one-line regression, not on architecture.
