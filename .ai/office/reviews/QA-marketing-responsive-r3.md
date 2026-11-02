# QA REPORT MARKETING-RESPONSIVE-01 — ROUND 3 (final)

Reviewer: AI 02 (Architect/Planner/QA). Target: working tree on `main`, HEAD `31f03a2`,
uncommitted. Scope of this round: verify **only** the three round-2 ship conditions
(`QA-marketing-responsive-r2.md` §6: R2-1, R2-2, R2-3) plus a no-regression sweep, then
issue the ship verdict. Method: read-only re-verification; claims audited, never trusted.
Round 2 report: `.ai/office/reviews/QA-marketing-responsive-r2.md`. Task record:
`.ai/office/tasks/active/marketing-responsive.md`.

OUTCOME: **PASS** — all three conditions closed, zero regression.
SHIP VERDICT: **SHIP** (pending CI).

---

## 1. Condition 1 — zero `<style>` tags in `Center.tsx`

`grep -c '<style' apps/velcenter/src/pages/Center.tsx` → **`0`** (grep exit 1 = no match).

Round 2 found two blocks (old `:1224` and `:1227`): one redundant re-implementation of the
label hiding via `#center-nav:not(:hover):not(:focus-within) … { display: none }`, one an
empty no-op block. Both are gone. The region `Center.tsx:1211-1299` contains no inline
CSS at all; the collapsing behaviour is expressed only as Tailwind arbitrary variants on
the `TabsList` `className`, and the R5/R4 rationale survives as a plain JSX comment
(`:1219-1223`). **R2-1 CLOSED.**

## 2. Condition 2 — collapsed rail keeps accessible names via `sr-only`

- Variant present: `apps/velcenter/src/pages/Center.tsx:1216`
  `"[&_[role=tab]]:justify-center [&_[role=tab]_.nav-label]:sr-only"` — applied on the
  `navCollapsed` branch of the `TabsList` className (`:1214-1218`). `sr-only` (not
  `hidden`/`display:none`) keeps the text in the accessibility tree, so every icon-only
  collapsed tab keeps its accessible name.
- Every nav trigger wraps its text in `<span className="nav-label">`:
  `grep -c 'className="nav-label"'` → **`12`** (≥ 10 required): overview `:1225`, chat
  `:1228`, orders `:1231`, intel `:1245`, products `:1253`, sellers `:1261`, categories
  `:1270`, staff `:1276`, audit `:1281`, incidents `:1286`, marketing `:1291`,
  settings `:1296`.
- No regression in the other trigger group: the nested people sub-tabs
  (`Center.tsx:2003`, `:2007`) carry plain text `พนักงาน` / `ลูกค้า`, not `.nav-label`
  spans, so the collapsed-rail variant cannot hide them; their parent `TabsList` has no
  `navCollapsed` branch.
- Badges (`orders`, `intel`, `products`, `sellers`) remain outside the `.nav-label`
  span and stay visible when collapsed — intentional and unchanged.
- `flag` note: `hidden` no longer appears; `grep -n 'sr-only'` finds exactly one
  occurrence, the variant above. **R2-2 CLOSED.**

## 3. Condition 3 — RESPONSIVE-AUDIT verdict table recorded

`.ai/office/tasks/active/marketing-responsive.md` now exists and contains the
`## RESPONSIVE-AUDIT TABLE (verdicts, per brief)` section (lines 38-52) with a per-row
verdict for **R1, R2, R3, R4, R5, R5b, R6, R7, R8, R9, R10**:

| Row | Recorded verdict (quoted) |
|---|---|
| R1 | keep — the fix eliminates the offending width; acceptance measures scrollWidth |
| R2 | **fixed** — wrapping 2/3-col grid, min-h-11, no nowrap |
| R3 | **fixed** — moved to the Marketing tab |
| R4 | **fixed** — `.nav-label` spans, `sr-only` when collapsed (accessible name preserved), no `<style>` tag |
| R5 | **fixed** — `min-h-11` on every nav row |
| R5b | keep as-is (fits 360) |
| R6 | keep — already responsive (dialog max-w, popper selects) |
| R7 | **deferred** — 7-col table self-wraps in `overflow-x-auto`; mobile card list is a new pattern outside the smallest safe scope; recorded as a known UX gap |
| R8 | **deferred** — cosmetic; wraps inside `flex-wrap`, no clip |
| R9 | **deferred** — fits 360 (row is `flex-col sm:flex-row`) |
| R10 | **deferred** — fits (`flex-wrap`) |

All four deferrals (R7-R10) state a reason, so VC-12's record clause is met. The record
also carries the task ID, original request, brief pointer, file list, test results and the
per-round QA ledger (round 3: "conditions closed (this round)"). **R2-3 CLOSED.**

## 4. No-regression sweep (each command run once this round, output quoted)

| Command | Result |
|---|---|
| `bun run i18n:check` | exit 0 — `i18n:check OK — th=1583 en=1583 my=1583 keys, all locales at parity.` |
| `bun --filter @velnox/velcenter typecheck` | exit 0 — `@velnox/velcenter typecheck: Exited with code 0` |
| `bun test ./backend/tests/marketing-surface.test.ts` | exit 0 — `20 pass / 0 fail / 52 expect() calls`, `Ran 20 tests across 1 file` |
| `bun run test` (full) | **1193 pass / 389 skip / 8 fail**, 11918 expect() calls, 1590 tests / 85 files, `error: script "test" exited with code 1` |
| `git diff --check` | exit 0 (no output) |
| `git status --short -uall` | see below |

The 8 failures are, verbatim, the pre-existing `test database guard — a real test process
fails closed` suite (8 named cases: production DATABASE_URL → non-zero exit, pool factory
refusal, `RENDER=true` refusal, disposable DB allowed, no DB → skip, CI-shaped env
accepted, Neon branch + opt-in accepted, Neon branch without opt-in refused) — i.e. the
documented `test-database-isolation` execPath probes. Same file, same count, byte-identical
to the round-2 baseline **1193 / 389 / 8**. **Zero new failures, zero changed counts.**

### Scope

`git status --short -uall` — identical 13 project files to round 2 (7 modified, 1 deleted,
5 new) plus `.ai/office` records only:

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
?? .ai/office/reviews/QA-marketing-responsive-r2.md
?? .ai/office/tasks/active/marketing-responsive.md
?? apps/velcenter/src/components/MarketingBanners.tsx
?? apps/velshop/src/components/shop/HomePromoStrip.tsx
?? backend/lib/banners.ts
?? backend/tests/banners.test.ts
?? backend/tests/marketing-surface.test.ts
```

No `db/`, no lockfile, no `package.json`, no other app, no shared-UI or CSS change, no
new dependency. The five `.ai/office` entries are the brief, the impl handoff, the QA r1
and r2 reports and this task record — documentation only.

## 5. Residual (non-blocking, carried forward — NOT ship conditions)

- **R2-4 (low)** — `MarketingBanners.tsx` uses `emptyBannerError` / `errSchedule` where
  the brief named `previewTitle` / `previewEmpty` / `errorEmpty` / `errorSchedule`. Naming
  divergence only; behaviour verified in round 2. Not a ship condition then or now.
- **R2-5 (low)** — `Center.tsx:1211` `<TabsList` is still flush-left against its siblings.
  Whitespace only, no rendering effect. Cosmetic lint-level nit.
- **R2-6 (low, from round 1)** — VC-04 up/down buttons are not `disabled` at the list ends
  (`Center.tsx:430-445`); the click is a no-op, no data risk.

None of these is a functional, a11y or data-integrity risk, and none was ever listed as a
ship condition.

## 6. NOT VERIFIED (declared, never passed)

Unchanged from round 2 and out of this round's scope:

- Any live write path (`PUT /api/admin/announcements`) and the R2 presign → PUT → confirm
  round trip: needs Neon + R2 credentials and an authorized session. **NOT VERIFIED by
  construction.**
- Whether the owner's stored `shop_announcements` array contains an item the stricter
  contract now rejects (first Save could 400). Production is unreadable from here; the
  client preview + per-row error make it discoverable at runtime.
- 360 / 390 / 430 px viewport measurement: no browser emulation run. Static + built-CSS
  evidence only. **NOT MEASURED.**
- Builds (`build:velshop`, `build:velcenter`): not re-run this round. Typecheck (velcenter
  + backend gate) is green and no bundler-level change was made since the green builds;
  documented scope reduction, not a hidden skip.

## 7. Verdict

| Round-2 ship condition | Round 3 |
|---|---|
| R2-1 remove the two `<style>` blocks from `Center.tsx` | **CLOSED** — `grep -c '<style'` = 0 |
| R2-2 collapsed rail: `sr-only` + accessible names | **CLOSED** — `[&_[role=tab]_.nav-label]:sr-only` at `:1216`, 12/12 nav labels wrapped |
| R2-3 RESPONSIVE-AUDIT verdict table + R7-R10 deferral ledger | **CLOSED** — table at `tasks/active/marketing-responsive.md:38-52` |

Gates at this state: i18n parity 1583×3, velcenter typecheck exit 0, marketing-surface
20/20, full suite 1193 / 389 / 8 (isolation baseline only, identical to round 2),
`git diff --check` clean, scope unchanged (13 project files).

**OUTCOME: PASS. SHIP.**
Merge on CI green. The three round-2 conditions are closed with evidence, no gate moved,
and no new defect was introduced. Ship-window follow-ups (non-blocking): the R2-4 key
naming, R2-5 indentation, R2-6 end-of-list button state, and the unmeasured 360/390/430
viewport pass — all cosmetic or verification-only, none touching the banner feature.
