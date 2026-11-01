# VelShop profile: order-status tile card (ThaiMart pattern, first block) — 2026-11-02

**Starting SHA:** `ec77ac6` · **Final:** this commit.

## Implemented

`apps/velshop/src/pages/ShopProfile.tsx`
- New **four-tile order-status card** above the menu groups: one bordered card (`rounded-2xl`, 1 px border),
  `grid-cols-4` with `divide-x divide-slate-100`, each tile = icon (20 px, `strokeWidth 1.75`) + 11 px label,
  full tile clickable, `hover/active` feedback. Labels: ที่ต้องชำระ · ที่ต้องจัดส่ง · ที่ต้องได้รับ · สำเร็จ.
- Icons reused from the existing `lucide-react` import (`Wallet`, `Package`, `Truck`, `CircleCheck` — the last one
  added to the import list).

`packages/shared/src/lib/i18n/locales/{th,en,my}.ts`
- `profile.orderTiles.{pendingPayment,toBeShipped,toReceive,completed}` added **directly to the base profile
  objects** (no spread patch). i18n parity: **1300 × 3**.

## Honest gaps against the reference

- **No counts on the tiles.** `MyOrders` exposes no status-filter query, and no aggregate endpoint exists; adding
  one is out of scope. Tiles therefore link to `/orders` (the real list) rather than a per-status filter.
- **Header not rebuilt**: the reference's compact bar with back chevron + centred member number is not
  implemented — `useAuth()` does not expose a member reference, and inventing a format is forbidden.
- **Groups not re-titled/merged** (เกี่ยวกับฉัน / นโยบายและเงื่อนไข / ติดต่อเรา) — the existing grouped rows stay.
- **Terms / privacy rows** still absent (they are external URLs; `ProfileRow` is `<Link>`-only).
- **Contact e-mail/phone** absent — no real values supplied by the owner.
- **Promo banner** omitted — no real campaign source.
- Logout: unchanged (existing alert dialog + `useAuth` sign-out), still the last block.

## Verification (executed)

- `cd apps/velshop && bun run typecheck` → **pass**
- `bun run i18n:check` → **OK th=1300 en=1300 my=1300**
- `bun --filter '@velnox/velshop' build` → **success**
- `git diff --check` → clean

## Not verified / blocked

- Browser rendering and measurements at 360 / 390 / 430 / 492 / desktop: **not run** (harness processes had died
  earlier; restarting and re-authenticating was outside this step). No `getBoundingClientRect` values were
  collected, so none are reported.
- Impeccable was used only as *documented guidance* (`references/layout.md`, `references/polish.md`): the CLI
  binary is unavailable, so no Impeccable command was executed.
