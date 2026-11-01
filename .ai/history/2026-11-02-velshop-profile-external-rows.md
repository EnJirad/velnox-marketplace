# VelShop profile: external terms/privacy rows (2026-11-02)

**Starting SHA:** `f31e4fa` · **Final:** this commit.

## Implemented

- `ProfileRow` gained an optional `external?: boolean`. `renderRow` now builds the row markup **once** and wraps it
  in either the router `<Link>` or a real `<a target="_blank" rel="noreferrer">` — no duplicated JSX.
- Two rows added to the existing `ACCOUNT` array with the destinations already used by the auth screen:
  `https://velnox-theta.vercel.app/terms` and `…/privacy`.
- Keys `profile.terms|termsDesc|privacy|privacyDesc` written **directly** into the `profile` object of
  `th.ts` / `en.ts` / `my.ts`.

## Verification (executed)

- `apps/velshop` typecheck → **pass**
- `bun run i18n:check` → **OK th=1304 en=1304 my=1304**
- `@velnox/velshop` build → **success**
- `git diff --check` → clean

## Still open

- Order-tile counts (no aggregate/status-filter API), header member reference (not exposed), section renaming
  (เกี่ยวกับฉัน / นโยบายและเงื่อนไข / ติดต่อเรา), contact e-mail/phone (no real values), promo banner (no source).
- Browser measurements at 360/390/430/492/desktop: **not run** in this step.
