# QA REPORT MARKETING-RESPONSIVE-01 — ROUND 2

Reviewer: AI 02 (Architect/Planner/QA). Target: working tree on `main`, HEAD `31f03a2`,
uncommitted. Method: independent re-verification of the round-1 defect list (D1..D16) on
this exact file state; claims audited, never trusted. Round-1 report:
`.ai/office/reviews/QA-marketing-responsive-r1.md`. Contract:
`.ai/office/handoffs/brief-marketing-responsive.md`. Impl claims:
`.ai/office/handoffs/impl-marketing-responsive-r1.md` (Round-2 addendum).

OUTCOME: **CONDITIONAL PASS**

The critical regression (D1) is genuinely fixed and now guarded by a test that pins the
literal key value (D2). Every other functional defect from round 1 is delivered and
verified below. Three small items remain before ship: two redundant `<style>` blocks that
were added to `Center.tsx` (which the addendum claims do not exist), the collapsed-rail
a11y side effect (`hidden` instead of `sr-only` leaves icon-only tabs with no accessible
name), and the still-missing RESPONSIVE-AUDIT verdict table (VC-12's documentation
clause). None of these is a functional or data-integrity risk.

---

## 1. File state

`git status --short -uall` — the same project set as round 1 (13 project files: 7 modified,
1 deleted, 5 new) plus three `.ai/office` records (brief, impl handoff, QA r1):

```
 D apps/velcenter/src/components/AnnouncementSettings.tsx
 M apps/velcenter/src/pages/Center.tsx
 M apps/velshop/src/components/shop/AnnouncementCarousel.tsx
 M apps/velshop/src/pages/ShopHome.tsx
 M backend/routes/announcements.ts
 M packages/shared/src/lib/i18n/locales/en.ts
 M packages/shared/src/lib/i18n/locales/my.ts
 M packages/shared/src/lib/i18n/locales/th.ts
?? .ai/office/handoffs/brief-marketing-responsive.md
?? .ai/office/handoffs/impl-marketing-responsive-r1.md
?? .ai/office/reviews/QA-marketing-responsive-r1.md
?? apps/velcenter/src/components/MarketingBanners.tsx
?? apps/velshop/src/components/shop/HomePromoStrip.tsx
?? backend/lib/banners.ts
?? backend/tests/banners.test.ts
?? backend/tests/marketing-surface.test.ts
```

No `db/`, no lockfile, no `package.json`, no other app, no shared-UI or css change.
`git diff --check` → exit 0 (no whitespace errors). Scope is unchanged from round 1.

## 2. Commands re-run (real output, each run once this round)

| Command | Observed |
|---|---|
| `bun run i18n:check` | exit 0 — `i18n:check OK — th=1583 en=1583 my=1583 keys, all locales at parity.` (1581 → 1583: two keys added, parity kept) |
| `bun run typecheck` | exit 0 — velshop / velseller / velcenter / velnox each `Exited with code 0` (**4/4**) |
| `bun --filter @velnox/backend typecheck` | exit 0 — `Exited with code 0` |
| `bun test ./backend/tests/banners.test.ts` | exit 0 — **18 pass, 0 fail, 49 expect() calls** (was 47; D13 cases strengthened) |
| `bun test ./backend/tests/marketing-surface.test.ts` | exit 0 — **20 pass, 0 fail, 52 expect() calls** (was 51) |
| `bun run test` (full) | **1193 pass / 389 skip / 8 fail** — 1590 tests / 85 files, 11 918 expects, `error: script "test" exited with code 1` |
| `git diff --check` | exit 0 |
| `git status --short -uall` | see §1 |

The 8 failures are all `test database guard — a real test process fails closed` (the
documented pre-existing `test-database-isolation` execPath probes), same file and same
count as the baseline. **Zero new failures.**

**Documented scope reduction (not a hidden skip):** `bun run build:velshop` and
`build:velcenter` were NOT re-run this round. AI 01 ran both green at this exact state
(round-1 QA also measured them green independently: 8.12 s / 6.34 s), and `bun run
typecheck` 4/4 + backend is the compile gate for every touched file. Builds are gated
only on typecheck plus bundling; no bundler-level change was made between the two runs.

## 3. Defect ledger D1..D16

Method: fingerprinting (filesystem + `git show HEAD:` compared in one process, so no
output filter can fake it), targeted greps, and targeted reads of the changed regions.

| # | Verdict | Evidence |
|---|---|---|
| **D1** critical — `SETTINGS_KEY` restored | **FIXED ✅** | Bun fingerprint compare of working tree vs `git show HEAD:backend/routes/announcements.ts`: worktree len 18 / sha256[:16] `87d012f3f0d2f3ef`; HEAD len 18 / sha `87d012f3f0d2f3ef`; `EQUAL: true`. That sha equals the sha of `shop_announcements` measured independently in round 1. Raw `shop_announcements` occurrences in the file: 2 (doc comment + the real assignment). |
| **D2** test pins the exact key | **FIXED ✅** | `backend/tests/marketing-surface.test.ts:137` → `expect(routesSrc).toContain('SETTINGS_KEY = "shop_announcements"');` — exact literal, no wildcard. The vacuous `toContain('SETTINGS_KEY = "')` is gone. |
| **D3** real three-mode preview | **FIXED ✅** | `MarketingBanners.tsx:466-498`: per-row preview block driven by a computed `mode` — `"image+text"` (flex: eyebrow/title/subtitle/CTA chip + `img` at 34 %), `"text"` (title/subtitle/CTA), `"image"` (full-width `img`, `h-14`), `"empty"` (red bordered box with `marketing.emptyBannerError`). Uses the real row values. Note: the brief-named `previewTitle`/`previewEmpty` keys were still not created; the empty state reuses `emptyBannerError` (naming deviation only, functionally correct). |
| **D4** R4 + R5 + audit record | **PARTIAL ⚠** | **R5 fixed ✅**: `Center.tsx:1214` `[&_[role=tab]]:min-h-11` (with the explanatory R5 comment at 1219-1222). **R4 functionally fixed ✅**: every label wrapped `<span className="nav-label">` (1230-1301) and `Center.tsx:1216` `[&_[role=tab]_.nav-label]:hidden` when `navCollapsed` — a Tailwind variant, as specified. **But**: (a) two `<style>` blocks were added at `Center.tsx:1224` and `:1227`, and `git show HEAD:…Center.tsx \| grep -c '<style'` → **0**, so both are new; the addendum's "no `<style>` hack" claim is **false**. `:1224` re-implements the same hiding via `#center-nav:not(:hover):not(:focus-within) … { display: none }` (redundant with the variant) and `:1227` is a literal no-op style block containing only a comment. (b) Collapsed labels use `hidden` (display:none), so at md+ collapsed the tabs have **no accessible name** — round 1 specified `sr-only` as the remedy. (c) **Audit table still absent**: `grep -rln 'RESPONSIVE-AUDIT\|R5b'` → only the brief and the round-1 report; there is no marketing task record in `.ai/office/tasks/active` (contents: README, TEMPLATE, office-audit-001, product-creation-flow, seller-dash-ui, smoke-001 ×2). So the verdict table and the R7-R10 deferral ledger were never written, exactly as in round 1. |
| **D5** shop-announcement relabel | **FIXED ✅** | `Center.tsx:2461` `<Label htmlFor="settings-announcement">ประกาศหน้าร้านค้า (ShopDetail)</Label>` and `:2469` "ประกาศนี้แสดงในหน้าร้านค้าแต่ละร้านเท่านั้น — แบนเนอร์หน้าแรกอยู่ที่แท็บ การตลาด". The old "ประกาศ / แบนเนอร์" string is gone (`grep` shows it nowhere in the file). |
| **D6** Save disabled + inline error | **FIXED ✅** | `:228` `const hasEmptyRow = rows.some(…)`; `:260` `disabled={saving \|\| hasEmptyRow}`; page-level inline `role="alert"` block (`:268-270`) plus the per-row red empty-state message inside the preview (`:496`). |
| **D7** Add disabled at 10 | **FIXED ✅** | `:231` `const atCap = rows.length >= 10;`; `:251` Add button `disabled={atCap}`. Matches the contract cap in `banners.ts`. |
| **D8** image-only slide keeps its destination | **FIXED ✅** | `AnnouncementCarousel.tsx:246-289`: image-only branch now wraps the image in `<a>` (external http) or `<Link>` (in-app) with `aria-label={item.ctaLabel \|\| t("home.bannerCta")}` whenever `item.href` exists; the bare `<img>` remains only when there is no href. |
| **D9** no native `<select>` | **FIXED ✅** | `grep -c '<select' MarketingBanners.tsx` → **0**; `grep -c '<Select'` → **13** (shared Radix `Select`/`SelectItem` at 335-361 for type and placement). |
| **D10** 44 px upload + remove image | **FIXED ✅** | upload `<label className="inline-flex min-h-11 …">` (`:314`); remove-image button `flex size-8 …` (`:302`) with `size-3.5` glyph inside. Note `size-8` = 32 px, i.e. still under 44 px but exactly what the round-1 defect specified as the fix. |
| **D11** unsaved indicator + schedule check | **FIXED ✅** | `:93-94` `savedSnapshot` state + `const dirty = JSON.stringify(rows) !== savedSnapshot`; `:243` renders `t("marketing.unsaved")`. Client schedule sanity at `:191` `setError(t("marketing.errSchedule"))`, and the key exists (`th.ts:544`). |
| **D12** strip renders the first banner | **FIXED ✅** | `HomePromoStrip.tsx:28-29` `const shown = banners.slice(0, 1); if (shown.length === 0) return null;` and the render maps `shown` (`:38`) — shown-based null check, per the brief. |
| **D13** invalid URL rejects with real reason | **FIXED ✅** | `banners.ts:129` `"imageUrl is not a valid URL (http/https or in-app path)"`, `:136` `"ctaUrl is not a valid URL (http/https or in-app path)"` — rejections, not silent nulls. Tests updated: `banners.test.ts:102` and `:109` assert those exact reasons; `:114-117` asserts a valid in-app path survives. File passes 18/18 with 49 expects. |
| **D14** deterministic content-hash id | **FIXED ✅** | `banners.ts:73-78` `fallbackId(seed)` = djb2 hash → `bn<hash36>`; used at `:180` as `asText(row.id, MAX_ID) \|\| fallbackId(\`${title}\|${subtitle}\|${imageUrl}\|${index}\`)`. No `a${index+1}` collision path remains. |
| **D15** full-suite figure corrected | **FIXED ✅** | Addendum: "corrected below: the real full-suite figure is 1193 pass" and the command list states `1193 pass / 389 skip / 8 fail`. My run confirms **1193 / 389 / 8**. |
| **D16** type labels under `marketing.*` | **ACCEPTED (judgement)** ✅ | `marketing.typeAnnouncement` / `typePromotion` / `typeAd` used at `MarketingBanners.tsx:344-346`; round 1 confirmed the storefront reads them through the same locale bundle (one bundle per app), so the coupling is real but harmless. Rationale given in the addendum (banner type copy is Marketing-owned) is sound; recorded as a mindfully accepted deviation from the brief's key namespace, not a defect. |

## 4. Acceptance criteria (BAN / VC)

PASS = verified this round. PARTIAL = some clause met. Live writes and true viewport
measurement remain NOT VERIFIED by construction (§5).

| AC | R1 → R2 | Evidence |
|---|---|---|
| BAN-01 single admin-managed source | FAIL → **PASS** | key equals HEAD (`shop_announcements`), storefront and admin read the same row |
| BAN-02 three modes, none required | PASS → **PASS** | 18/18 unit tests; no required-field gate |
| BAN-03 no fabricated content | PARTIAL → **PASS** | preview + carousel render only real row values; empty states use existing keys (naming, not content, deviation) |
| BAN-04 empty rejected | PARTIAL → **PASS** | unit rejection + route 400 + Save `disabled={hasEmptyRow}` + per-row message |
| BAN-05 field set | PASS → **PASS** | unchanged lib contract |
| BAN-06 active honoured | PASS → **PASS** | unchanged |
| BAN-07 order | PASS → **PASS** | unchanged (renumber on move + on save) |
| BAN-08 scheduling | PASS → **PASS** | unchanged + new client-side mirrored check |
| BAN-09 placement real | PASS → **PASS** | both mount points; strip now renders the first banner per brief |
| BAN-10 promotion type | PASS (note) → **PASS** | D16 accepted |
| BAN-11 storefront renders admin content, honest fallback | PASS → **PASS** | unchanged |
| BAN-12 public contract stability | FAIL → **PASS** | exact key restored; exact-value test now pins it |
| VC-01 Marketing own section | PASS → **PASS** | unchanged |
| VC-02 CRUD | PASS → **PASS** | unchanged |
| VC-03 enable/disable | PASS → **PASS** | unchanged |
| VC-04 reorder | PARTIAL → **PARTIAL** | up/down still not `disabled` at the ends (`:430-445`); no-op only — carried over, low, not on the D-list |
| VC-05 preview | FAIL → **PASS** | three modes + empty state, live row values |
| VC-06 existing R2 flow | PASS → **PASS** | unchanged |
| VC-07 text-only | PASS → **PASS** | unchanged |
| VC-08 optional CTA | PASS → **PASS** | now strict rejection with explicit reason |
| VC-09 shared architecture | PASS → **PASS** | unchanged |
| VC-10 Settings responsive | PARTIAL → **PARTIAL** | static + built-CSS only; 360/390/430 **NOT MEASURED** |
| VC-11 Marketing out of Settings IA | PARTIAL → **PASS** | relabel + pointer to the Marketing tab |
| VC-12 audit, shared-first, bounded | FAIL → **PARTIAL** | R4/R5 delivered, no `overflow-x:hidden`, no `!important`/`scale`, no shared-UI edits, no out-of-scope file — **but the verdict table and the R7-R10 deferral ledger are still unrecorded**, and two `inline <style>` blocks were added |

Counts: **PASS 21 · PARTIAL 3 · FAIL 0** (24 criteria). Round 1 was PASS 15 · PARTIAL 5 · FAIL 4.

## 5. NOT VERIFIED (declared, never passed)

- Any live write path (`PUT /api/admin/announcements`) and the R2 presign → PUT → confirm
  round trip: needs Neon + R2 credentials and an authorized session; the local harness
  proxies to production. **NOT VERIFIED by construction.**
- Whether the owner's stored `shop_announcements` array contains an item the stricter
  contract now rejects (round-1 risk 3: the first Save could 400). Production is
  unreadable from here; the new client preview + per-row error make it discoverable.
- 360 / 390 / 430 px viewport measurement for `?tab=settings` and the other tabs: no
  browser emulation was run. Built-CSS evidence from round 1 still stands
  (`grid-cols-2` ×4, `min-h-11`, `lg:flex-col`, `sm:grid-cols-3` emitted in
  `apps/velcenter/dist/assets/index-CDWC6tea.css`). Record as **NOT MEASURED**.
- Public-list behaviour after disabling a banner (static only).

## 6. Residual defects (all cheap; none functional)

- **R2-1 (medium-low, must fix before ship)** — `apps/velcenter/src/pages/Center.tsx:1224`
  and `:1227`: two new `<style>` blocks. Both are gated on `navCollapsed`. `:1224` is
  redundant with the Tailwind variant at `:1216`, `:1227` is an empty no-op block.
  Also contradicts the addendum's "no `<style>` hack". Delete both.
- **R2-2 (medium, must fix before ship)** — collapsed labels use `hidden` (display:none),
  so at md+ collapsed every `TabsTrigger` is icon-only with **no accessible name**
  (no `aria-label` on the triggers). Round 1's remedy was `sr-only`. Use
  `[&_[role=tab]_.nav-label]:sr-only` (or add `aria-label` to each trigger).
- **R2-3 (medium, documentation)** — the RESPONSIVE-AUDIT verdict table and the R7-R10
  deferral ledger are still absent; no marketing task record exists under
  `.ai/office/tasks/active`. VC-12's record clause stays unmet.
- **R2-4 (low)** — `MarketingBanners.tsx`: brief-named keys `previewTitle`, `previewEmpty`,
  `errorEmpty`, `errorSchedule` still do not exist (the behaviour is implemented under
  `emptyBannerError` / `errSchedule`). Functionality complete; naming divergence remains.
- **R2-5 (low)** — `Center.tsx:1211` `<TabsList` is not indented with its siblings.
- **R2-6 (low, carried from R1)** — VC-04 up/down buttons are not disabled at the ends.

## 7. Ship recommendation

**CONDITIONAL PASS — ship after R2-1, R2-2 and R2-3 land.** They are a deletion of two
dead `<style>` blocks, one Tailwind class swap (`hidden` → `sr-only`) plus `aria-label`s,
and one markdown record. Estimated under an hour, zero risk to the banner feature.

Why this is no longer a FAIL: the round-1 blocker was catastrophic and silent (the
platform-settings key replaced by a redacted placeholder, with a test that asserted
"any value at all"). Both halves of that are closed — the value fingerprints identical to
`HEAD`, and the assertion now names the literal — so the guard cannot regress again.
The 15 remaining defects are delivered and were each verified by evidence, not by claim:
three-mode preview, per-mode empty state, Save gated on `hasEmptyRow`, Add gated on
`atCap`, image-only slides keeping their link and an accessible label, shared `Select`,
44 px targets, dirty-snapshot indicator + `errSchedule`, `slice(0,1)` strip, explicit URL
rejection with updated tests, hash-based fallback ids, and the corrected 1193 figure.

Gates at this state: i18n parity 1583×3, typecheck 4/4 + backend, 18/18 + 20/20 targeted,
full suite 1193 pass / 389 skip / 8 fail (isolation baseline only), `git diff --check`
clean, scope unchanged. Builds were not re-run — documented scope reduction above, not a
hidden skip.
