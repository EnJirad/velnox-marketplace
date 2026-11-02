# Seller Dashboard UI audit + improvements

## Task ID
`seller-dash-ui`

## Original user request
"Audit and improve the Seller Dashboard UI." — via the AI Office two-agent
workflow: AI 02 plans, AI 01 implements, AI 02 independently QA-verifies, fix
loop until PASS, then commit and push.

## Task Brief
`.ai/office/handoffs/brief-seller-dash.md` — VELSELLER-DASH-01: i18n coverage of
the seller dashboard pages (Income, SellerGoals, MyShop chrome) and 44px touch
targets on the daily-use controls (SellerOrders chips/retry, MyShop
chips/delete/verification link), preserving API contracts, auth, responsive
behavior and formatting helpers.

## Implementation status
Complete (round 1) + 2 corrections (round 2). Reports:
`.ai/office/handoffs/impl-seller-dash-r1.md`.

## Modified file list
- `packages/shared/src/lib/i18n/locales/th.ts` · `en.ts` · `my.ts` — new
  `sellerDash` namespace, 108 keys, purely additive
- `apps/velseller/src/pages/Income.tsx` — full i18n migration
- `apps/velseller/src/pages/SellerGoals.tsx` — full i18n migration
- `apps/velseller/src/pages/MyShop.tsx` — dashboard-chrome i18n + 44px chips +
  delete icon + verification link + `aria-pressed`
- `apps/velseller/src/pages/SellerOrders.tsx` — 44px chips + retry button

## Test results
- `bun run i18n:check` → exit 0, `th=1454 en=1454 my=1454 keys, all locales at parity`
- `bun --filter @velnox/velseller typecheck` → exit 0
- `bun run typecheck` (4 apps) → exit 0
- `bun --filter @velnox/velseller build` → exit 0, `✓ built in 6.36s`
- `git diff --check` → clean
- QA probe: `sellerDash defined: th=108 en=108 my=108`, key sets identical,
  108 used by pages, 0 missing

## QA report
- Round 1: **FAIL** — D1 (medium) MyShop verification link missing 44px
  treatment; D2 (medium) MyShop chips missing `aria-pressed`.
  `.ai/office/reviews/QA-seller-dash-r1.md`
- Round 2: **PASS** — both defects verified fixed in code; no regressions;
  all 8 acceptance criteria verified with independently re-run commands.
  `.ai/office/reviews/QA-seller-dash-r2.md`

## Correction round number
2 of max 5

## Final acceptance status
`ACCEPTED (QA PASS)` — cleared for commit and push.
