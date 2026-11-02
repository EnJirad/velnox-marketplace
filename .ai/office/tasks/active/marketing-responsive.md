# VelShop Marketing + VelCenter Responsive — task record

## Task ID
`marketing-responsive-01`

## Original user request
VelShop homepage banner system (image-only / text-only / image+text, all valid,
empty rejected, no fake placeholders), managed from a dedicated VelCenter
Marketing section (not Settings); VelCenter Settings responsive redesign
(no global horizontal scrollbar); VelCenter-wide responsive audit; smallest safe
architecture; preserve auth/ownership/API/R2.

## Task Brief
`.ai/office/handoffs/brief-marketing-responsive.md` — MARKETING-RESPONSIVE-01.
Key decisions: EXTEND the existing announcement system
(`platform_settings.shop_announcements` JSON contract v2) — NO schema change,
no new table; Marketing mirrors the endpoint's `settings.manage` gate at the UI
(no new permission code); the Settings overflow root cause is
`overflow-x: hidden` on html/body/#root turning wide children into clipped
content — fix the offending widths, never add a page-level scroller.

## Implementation status
Complete through correction round 3.
Report: `.ai/office/handoffs/impl-marketing-responsive-r1.md` (+ r2 addendum).

## Modified file list
New: `backend/lib/banners.ts` · `backend/tests/banners.test.ts` ·
`backend/tests/marketing-surface.test.ts` ·
`apps/velcenter/src/components/MarketingBanners.tsx` ·
`apps/velshop/src/components/shop/HomePromoStrip.tsx`
Modified: `backend/routes/announcements.ts` ·
`apps/velcenter/src/pages/Center.tsx` ·
`apps/velshop/src/components/shop/AnnouncementCarousel.tsx` ·
`apps/velshop/src/pages/ShopHome.tsx` ·
`packages/shared/src/lib/i18n/locales/{th,en,my}.ts`
Deleted: `apps/velcenter/src/components/AnnouncementSettings.tsx`

## RESPONSIVE-AUDIT TABLE (verdicts, per brief)

| # | Surface | Verdict |
|---|---|---|
| R1 | Global shell `overflow-x: hidden` (index.css:128-141) | keep — the fix eliminates the offending width; acceptance measures scrollWidth, never a scrollbar |
| R2 | Settings section nav (overflow-x-auto strip) | **fixed** — wrapping 2/3-col grid, min-h-11, no nowrap |
| R3 | Announcement editor mounted in Settings | **fixed** — moved to the Marketing tab |
| R4 | Collapsed rail labels painting across content | **fixed** — `.nav-label` spans, `sr-only` when collapsed (accessible name preserved), no `<style>` tag |
| R5 | Nav rows ~36px | **fixed** — `min-h-11` on every nav row |
| R5b | Mobile drawer w-72 | keep as-is (fits 360) |
| R6 | Dialogs/Selects (shared UI) | keep — already responsive (dialog max-w, popper selects) |
| R7 | PaymentIncidentTab 7-col table | **deferred** — Table self-wraps in overflow-x-auto; usable, not clipped; a mobile card list is a new pattern outside the smallest safe scope. Recorded as a known UX gap. |
| R8 | Chat header fixed-width SelectTriggers | **deferred** — cosmetic; wraps inside flex-wrap, no clip |
| R9 | Verification queue SelectTrigger w-[160px] | **deferred** — fits 360 (row is flex-col sm:flex-row) |
| R10 | Incidents filter min-w-[240px] | **deferred** — fits (flex-wrap) |

## Test results (local, real)
- `i18n:check` exit 0 — th=1583 en=1583 my=1583 parity
- `bun run typecheck` exit 0 (4/4) + backend typecheck exit 0
- `banners.test.ts` 18 pass / `marketing-surface.test.ts` 20 pass
- full suite: 1193 pass / 389 skip / 8 fail — the 8 byte-identical to the
  pre-existing test-database-isolation execPath baseline; zero new failures
- velshop + velcenter builds exit 0; `git diff --check` clean

## QA report
- Round 1: **FAIL** — 16 findings (D1 critical: SETTINGS_KEY literal
  "[redacted]" copied from redacted tool output — would orphan published
  banners; D2 weak test; D3 no real preview; D4 R4/R5 unimplemented; D5–D14
  medium/low UX + contract issues; D15 wrong count in report; D16 judgement).
  `reviews/QA-marketing-responsive-r1.md`
- Round 2: **CONDITIONAL PASS** — D1–D16 verified fixed; three ship conditions:
  remove leftover `<style>` tags, sr-only + accessible name, audit table.
  `reviews/QA-marketing-responsive-r2.md`
- Round 3: conditions closed (this round); final verification below.

## Correction round number
3 of max 5

## Final acceptance status
`ACCEPTED (QA PASS)` pending round-3 confirmation — ship conditional on CI.
