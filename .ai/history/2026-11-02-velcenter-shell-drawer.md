# VelCenter shell: desktop rail collapse + mobile drawer (2026-11-02)

**SHA:** `b472b40` → this commit. Single file touched: `apps/velcenter/src/pages/Center.tsx`.

## What changed

| Piece | Implementation |
|---|---|
| State | `navOpen` (drawer) + `navCollapsed` (rail) added next to the existing `?tab=` state; nothing else reads or writes them |
| Mobile drawer | The SAME `<TabsList>` becomes a fixed left panel below `md` (`max-md:fixed inset-y-0 left-0 w-72`, `flex-col`, safe-area padding, `overflow-y-auto`), translated off-canvas unless `navOpen`. No second navigation definition |
| Backdrop | A `<button aria-label="ปิดเมนู">` overlay at `z-40` rendered only while open; the header is `z-40`, the drawer `z-50` |
| Close paths | Tab selection (`onValueChange` → `setTab` + `setNavOpen(false)`), backdrop click, Escape |
| Scroll lock | `useEffect` sets `document.body.style.overflow = "hidden"` while open and restores the previous value on close/unmount |
| Desktop collapse | Header toggle (`PanelLeft`, `md:` only) switches the grid between `15rem` and `4.5rem`; triggers centre their icons in the narrow rail |
| Header | Logo unchanged; menu trigger `md:hidden`; collapse trigger `hidden md:flex`; `LanguageSwitcher` and `UserMenu` untouched and still last |

Preserved verbatim: tab ids, `?tab=` synchronisation, `canSee`/`holds` RBAC, every query/mutation, dialogs, forms,
the settings sub-tabs (their own `<TabsList>` was not touched), language persistence and logout.

## Verification (executed)

- `apps/velcenter` typecheck → **pass**
- `bun --filter '@velnox/velcenter' build` → **success**
- `bun run i18n:check` → **OK th/en/my = 1282**
- `git diff --check` → clean

## NOT VERIFIED

- Browser/viewport inspection at 360–1920: **not performed** (no authenticated center session in this
  environment). Manual steps: log in → 360/390/430/768 (drawer opens, backdrop closes, Escape closes, page does
  not scroll behind), 1024/1280/1440/1920 (rail, collapse toggle, content reflow, no horizontal overflow),
  language switch, open a dialog while the drawer is closed.
