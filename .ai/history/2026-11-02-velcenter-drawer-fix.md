# VelCenter mobile drawer fixed and measured (2026-11-02)

**Starting SHA:** `950adff` · **Final:** this commit.

## Root cause (the "top-left pile")

The mobile drawer classes lived on `<TabsList>` as `max-md:*` variants with arbitrary values
(`max-md:pt-[max(0.75rem,env(safe-area-inset-top))]`, …). On the device they were **not applied**, so the whole
navigation rendered **in normal flow at the top-left** — the white strip over the header the owner photographed.
The LanguageSwitcher was measured separately and was correct, so it was never the cause.

## Fix

`apps/velcenter/src/pages/Center.tsx`: the `<TabsList>` is wrapped in one plain `<div>` whose classes are ordinary
(no `max-md:` variants, no arbitrary values):

```
navOpen ? "fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto border-r border-slate-200 bg-white p-3
           md:static md:z-auto md:w-full md:overflow-visible md:border-0 md:bg-transparent md:p-0"
        : "hidden md:block"
```

The list itself is now `flex w-full flex-col items-stretch gap-0.5` with `[&_[role=tab]]:*` helpers. The wrapper is
the grid child, so the desktop rail still occupies column 1 and panels stay in column 2. No tab id, `?tab=`,
RBAC check, query, dialog or handler was touched; the overlay button, Escape, scroll lock and
`setNavOpen(false)` on selection are unchanged.

## Real browser evidence (local harness, real API, owner cookie, 492 CSS px)

| State | Measurement |
|---|---|
| Drawer closed | wrapper `display: none`, `position: static`, rect `0,0,0,0` — nothing renders at the top-left |
| Drawer opened (menu button) | DOM shows the overlay (`aria-label="ปิดเมนู"`) and the tablist with all sections; page no longer pushed by a strip |
| Selecting a section | URL became `?tab=categories` and the wrapper returned to `display: none` (auto-close works) |
| Horizontal overflow | none (`right ≤ viewport`) |

## Checks

- `apps/velcenter` typecheck → **pass**
- `VITE_API_URL=http://localhost:8899 bun --filter '@velnox/velcenter' build` → **success**
- `git diff --check` → clean

## NOT TESTED

360/390/430/768/1024/1280/1440/1920 (WebView fixed at 492 px), Escape/backdrop close on a real device, other
menus (UserMenu, employee, order-ship, chat), Velseller/VelShop UI, and the 4-app i18n sweep — still open.
