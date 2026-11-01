# VelShop profile: cookie-policy row (first slice of the ThaiMart pattern) — 2026-11-02

**Starting SHA:** `8d7a2e1` · **Final:** this commit.

## What shipped

- `apps/velshop/src/pages/ShopProfile.tsx` — one new data-driven row in the existing `ACCOUNT` array:
  `{ to: "/cookies", labelKey: "profile.cookies", descKey: "profile.cookiesDesc", icon: ShieldCheck }`.
  No JSX duplicated; routes, logout dialog and `useAuth` untouched.
- Base locales edited **directly** (the fix for the earlier `TS1117` patch-spread failure):
  `th.ts`, `en.ts`, `my.ts` each gained `profile.cookies` + `profile.cookiesDesc`.
  `i18n:check` → **1296 × 3** (was 1294 × 3, +2 per locale).

## Validation executed

- `apps/velshop` typecheck → **pass**
- `@velnox/velshop` build → **success**
- `bun run i18n:check` → OK, th=en=my=1296
- `git diff --check` → clean

## NOT implemented (spec items still open)

- **Order-status strip (4 tiles)** — needs the customer-orders query inside this page; not added, so no counts
  are shown (and none are faked).
- **Terms / privacy rows** — the destinations are external (`velnox-theta.vercel.app`), so they need an `<a>`
  variant of `ProfileRow`, which the current type (`to`, `labelKey`, …) does not support.
- **Contact e-mail / phone** — no real values from the owner; omitted rather than invented.
- **Promo banner** — no real campaign source; omitted.

## Not verified

Browser/viewport measurements (390/430/desktop) were **not** taken for this row.
