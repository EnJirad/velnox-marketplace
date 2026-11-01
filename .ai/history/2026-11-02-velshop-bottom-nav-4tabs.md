# 2026-11-02 — VelShop bottom tab bar aligned to the reference (4 tabs)

## Starting state

Repo synced: `HEAD == origin/main == a19a855`, working tree clean.

## What the repo actually had (correction to §140)

§140 recorded the reference's bottom nav as "none → add". That was wrong: VelShop already mounted a
**5-item** bar (`ShopTabBar` in `apps/velshop/src/main.tsx`, rendering the shared
`@velnox/shared/components/MobileTabBar`). So step 1 was **not** a new component — building one would
have duplicated an existing system. The real delta was the item set.

Existing shared bar already provided everything the reference asked for:

- `position: fixed` floating pill, 12 px gutters, `env(safe-area-inset-bottom)`
- active tab `text-[#10B981]` + `bg-[#ECFDF5]` icon pill → token `#10B981` (unchanged)
- hidden at the `md` breakpoint (`md:hidden`), desktop header nav takes over
- `.site-app` reserves `calc(4.75rem + env(safe-area-inset-bottom))` of bottom padding under 768 px
- returns `null` on `/auth`

## Change (one file, no logic/auth touched)

`apps/velshop/src/main.tsx`

| Before | After |
|---|---|
| หน้าแรก · สินค้า · ตะกร้า (badge) · ออเดอร์ · โปรไฟล์ | หน้าแรก · ออเดอร์ · การแจ้งเตือน · โปรไฟล์ |

- Dropped `/products` and `/cart`; added `/notifications` (`Bell`).
- Removed the now-unused `useCart` badge wiring and the `Package` / `ShoppingCart` imports.
- Routes, auth guards, cart state and header all untouched. `/products` stays reachable from the home
  "view all" link and the category rail (step 3); `/cart` stays reachable from the header cart icon
  (opens `CartDrawer`), which is step 2's badge surface.

i18n: every label already existed in the base dictionaries — `nav.home`, `nav.orders`,
`nav.notifications`, `nav.profile` in `th`/`en`/`my`. No new keys, nothing invented.

## Verification

- `bun --filter @velnox/velshop typecheck` → exit 0
- `bun --filter @velnox/velshop build` → exit 0 (`dist` built, 6.63 s)
- `bun packages/shared/scripts/i18n-check.ts` → `th=1304 en=1304 my=1304`, parity OK
- Live DOM at `http://localhost:5181` (Vite dev, mobile WebView width):
  - tab bar `class` kept `fixed … md:hidden`, computed `display: flex`
  - 4 links in order `/` `/orders` `/notifications` `/profile`, labels หน้าแรก / ออเดอร์ /
    การแจ้งเตือน / โปรไฟล์
  - `/` had `aria-current="page"` with computed `color: rgb(16, 185, 129)` = `#10B981`; the other
    three resolved to the slate-400 inactive colour
- Desktop hiding verified from the built stylesheet: `.md\:hidden{display:none}` sits inside
  `@media(min-width:48rem)` (768 px)
- **Visual check: NOT VERIFIED** — `browser_screenshot` returned "Browser preview is hidden or
  detached", the known harness instrumentation issue (§137). No pixel-level claim is made; the
  structure, active colour and breakpoint above were measured from the live DOM and the built CSS
  instead of guessed.

## Remaining

Steps 2–6 of `.ai/tasks/active/thaimart-reference-analysis.md` (header brand bar, category rail,
grid tightening, profile tokens, other screens) are untouched.
