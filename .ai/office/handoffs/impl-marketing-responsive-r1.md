# Implementation report — MARKETING-RESPONSIVE-01 (round 1)

STATUS: done · implemented from `.ai/office/handoffs/brief-marketing-responsive.md`

## Files changed (14)

New:
- `backend/lib/banners.ts` — banner contract v2: pure normalise/validate rules
  (three content modes, explicit enum rejection, URL safety, scheduling,
  ordering, cap 10, legacy v1 row mapping, `isBannerVisible`)
- `backend/tests/banners.test.ts` — 18 unit tests over the contract
- `backend/tests/marketing-surface.test.ts` — 20 static surface contracts
- `apps/velcenter/src/components/MarketingBanners.tsx` — Marketing editor
  (type, placement, optional title/subtitle/image/CTA/schedule, reorder,
  enable, delete, per-mode preview line, client-side empty-banner guard,
  existing R2 presign→PUT→confirm flow with `purpose: "announcement"`)
- `apps/velshop/src/components/shop/HomePromoStrip.tsx` — `home_strip`
  placement renderer; returns null when empty

Modified:
- `backend/routes/announcements.ts` — delegates to lib/banners; GET admin added;
  PUT now 400s with `banner N: reason` instead of silently dropping invalid
  items; public GET filters active + schedule
- `apps/velcenter/src/pages/Center.tsx` — dedicated `marketing` tab (Megaphone,
  same permission gate as settings, rendered BEFORE settings); AnnouncementSettings
  removed from Settings; Settings section nav rewritten: `overflow-x-auto` +
  `whitespace-nowrap` strip → wrapping 2/3-col grid with `min-h-11` (44px) buttons
- `apps/velshop/src/components/shop/AnnouncementCarousel.tsx` — three render
  modes: image-only fills the slide (no empty text column), text-only clean,
  combined; CTA label from banner with storefront fallback
- `apps/velshop/src/pages/ShopHome.tsx` — v2 mapping (subtitle/ctaUrl/type/
  placement), empty banners never render, eyebrow omitted for image-only,
  strip slot after category rail
- `packages/shared/src/lib/i18n/locales/{th,en,my}.ts` — `announceAdmin` renamed
  → extended `marketing` namespace (36 keys), 1581×3 parity

Deleted:
- `apps/velcenter/src/components/AnnouncementSettings.tsx` — superseded by
  MarketingBanners (moved out of Settings per VC-06/07)

## Commands run (real results)

- `bun run i18n:check` → exit 0, 1581×3 parity
- `bun run typecheck` → exit 0 (4/4 apps); backend typecheck → exit 0
- `bun test ./backend/tests/banners.test.ts` → 18 pass 0 fail
- `bun test ./backend/tests/marketing-surface.test.ts` → 20 pass 0 fail
- `bun run test` (full) → 1155 pass / 389 skip / **8 fail — all 8 the
  pre-existing test-database-isolation execPath baseline; zero new failures**
- `bun --filter @velnox/velshop build` → exit 0; `@velnox/velcenter build` → exit 0

## Self-caught defects during implementation (fixed before QA)

- asIsoDate treated an absent schedule field as invalid → image-only banners
  were rejected; fixed (absent = unbounded, only malformed strings are invalid)
- a stray velshop-only import accidentally added to Center.tsx → velcenter
  typecheck failure; fixed by removal
- three over-specific test assertions fixed to match the real source shapes

## File state this report describes

HEAD `31f03a2`, nothing staged/committed. 14 changed files as listed.
No schema change, no new dependency, no other app touched.

---

# Round-2 addendum (QA r1 corrections D1–D16)

- **D1 (critical)** — `SETTINGS_KEY` restored to the real `shop_announcements`
  key. Root cause: the harness redacts secret-shaped values in tool output; I
  copied the redacted literal from the Phase-A read into the rewritten file.
  Verified against HEAD by fingerprinting the original value.
- **D2** — marketing-surface test now pins the exact key value.
- **D3** — real three-mode preview (image+text / text / image / empty states)
  rendered inside each editor row.
- **D4** — R4: collapsed rail hides `.nav-label` spans (labels wrapped in
  spans, Tailwind variants on TabsList — no `<style>` hack); R5: nav rows
  `min-h-11`. Audit table reproduced with verdicts in the task record.
- **D5** — Settings shop-announcement label now says it is the per-shop page
  announcement (ShopDetail) and points home banners to the Marketing tab.
- **D6** — Save disabled while any row is empty; inline error stays.
- **D7** — Add disabled at 10 rows (the contract cap).
- **D8** — image-only slide with a CTA is now fully clickable (anchor/Link
  wraps the image, `aria-label` from ctaLabel).
- **D9** — native selects replaced with the shared Radix Select.
- **D10** — upload label `min-h-11`; remove-image button `size-8`.
- **D11** — unsaved-changes indicator (snapshot diff) + client schedule
  sanity (`errSchedule`), mirroring banners.ts.
- **D12** — strip renders the FIRST strip banner per the brief (`slice(0,1)`).
- **D13** — invalid URLs now reject the banner with an explicit reason
  ("imageUrl/ctaUrl is not a valid URL") instead of degrading into a
  misleading "empty" rejection; unit tests updated to the stricter contract.
- **D14** — deterministic content-hash fallback ids (no `a1` collisions).
- **D15** — corrected below: the real full-suite figure is 1193 pass.
- **D16** — type labels intentionally live under `marketing.*` (banner types
  are Marketing-owned copy, not storefront announcements); QA judgement noted.

Commands re-run (real): i18n:check 1583×3 exit 0 · typecheck 4/4 + backend
exit 0 · banners.test 18 pass · marketing-surface 20 pass · full suite
1193 pass / 389 skip / 8 fail (isolation baseline only) · velshop + velcenter
builds exit 0.
