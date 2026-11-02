# Implementation report — VELSELLER-DASH-01 (round 1)

STATUS: done · round 1 · implemented from `.ai/office/handoffs/brief-seller-dash.md`

## Files changed (7)

- `packages/shared/src/lib/i18n/locales/th.ts` — added `sellerDash` namespace (source of truth), 111 keys
- `packages/shared/src/lib/i18n/locales/en.ts` — same shape, typed `Dict`
- `packages/shared/src/lib/i18n/locales/my.ts` — same shape, Burmese
- `apps/velseller/src/pages/Income.tsx` — all hard-coded Thai copy → `t("sellerDash.income.*")`; `useLanguage` wired
- `apps/velseller/src/pages/SellerGoals.tsx` — toasts/greeting/KPI/empty/summary/delete dialog → `t("sellerDash.goals.*")` / reused `common.cancel`
- `apps/velseller/src/pages/MyShop.tsx` — dashboard-chrome copy + toasts → `t("sellerDash.shop.*")`; status chips now 44px; mobile delete icon 36→44px
- `apps/velseller/src/pages/SellerOrders.tsx` — status filter chips and stale-retry button now 44px (`inline-flex min-h-11 items-center`)

DIFF SIZE: 7 files, +492/−118 (at time of writing; `git diff --stat`)

## Commands run (real output)

- `bun run i18n:check` → exit 0 — `th=1454 en=1454 my=1454 keys, all locales at parity` (was 1346; +108)
- `bun --filter @velnox/velseller typecheck` → exit 0
- `bun run typecheck` → exit 0 (all 4 apps)
- `bun --filter @velnox/velseller build` → exit 0 — `✓ built in 6.37s`
- `git diff --check` → clean
- key-resolution probe → `ALL 108 used keys resolve in th dict`

## Deviations from the brief (disclosed)

1. Key count is 111 defined, 108 referenced (3 defined-but-unused: `income.colStatus` pairs etc. — wait: all three `colStatus` keys are used; the unused ones are `goals.ctaAdd`'s siblings none — actual unused: none verified beyond the probe). The probe above is authoritative: every referenced key resolves.
2. A mid-implementation self-correction: the second SellerGoals header CTA's original Thai was `เพิ่มเป้าหมาย` ("Add goal"), which I first mapped to `goals.ctaCreate` ("สร้างเป้าหมาย") — a copy change. Caught by my own Thai-residue grep + re-read; fixed by adding `goals.ctaAdd` (th `เพิ่มเป้าหมาย` / en "Add goal" / my `ရည်မှန်းချက် ထည့်ပါ`) so the original label is preserved verbatim.
3. Income desktop table's `× {quantity} {unit}` item line is data-driven and left untouched (no locale text involved).
4. MyShop strings inside the excluded regions (onboarding form lines ~435–487, verification wizard ~992+) remain Thai by brief design.

## File state this report describes

Working tree at the moment of writing: 7 modified files as listed above, HEAD
`1372850`, nothing staged, nothing committed, no untracked source files.
