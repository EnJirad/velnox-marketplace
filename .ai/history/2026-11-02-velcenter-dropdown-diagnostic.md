# VelCenter dropdown / popover diagnostic (2026-11-02)

**HEAD:** `5d7996c` (`origin/main`), working tree clean. Previous known SHA `7ab2978` is an ancestor; the two
commits after it are `5d7996c` (VelCenter shell copy i18n) only — no menu, dialog or portal code changed.

## Inventory — what VelCenter actually uses

| Component | Definition | Portal? | Used in |
|---|---|---|---|
| `DropdownMenu` (Radix) | `packages/shared/src/components/ui/dropdown-menu.tsx` | **Yes** — `DropdownMenuContent` wraps `Primitive.Portal` (line 38) | `EmployeeManager`, `OrderShipDialog`, `ChatManagement` |
| `Select` (Radix) | `…/ui/select.tsx` | **Yes** — `SelectPrimitive.Portal` (line 59) | forms across center panels |
| `Popover` (Radix) | `…/ui/popover.tsx` | **Yes** — `PopoverPrimitive.Portal` (line 27) | shared consumers |
| `ContextMenu`, `Menubar`, `Command`, `Tooltip` | same `ui/` folder | Radix portals | available, not all used |
| `LanguageSwitcher` (ours) | `packages/shared/src/components/LanguageSwitcher.tsx` | **No** — `absolute right-0` panel inside a `relative` wrapper | VelCenter header (and VelSeller) |
| Custom hand-rolled menus | — | **none found** | `grep` for `absolute` in `apps/velcenter/src` returns only search-field icons, avatar badges and a zoom close button |

Every *menu* VelCenter renders therefore goes through Radix and is portalled to `document.body`, so a
"clustered at the top-left corner" symptom cannot come from an unpositioned in-flow element in this code.
No component state named `menuOpen`/`showMenu`/`dropdown` exists in `apps/velcenter/src`.

## What was NOT verified (no browser session)

The bug is reported as *observed on a device*; I could not reproduce it here — there is no authenticated
VelCenter session, and the WebView cannot be driven for this app. **No root cause is claimed.**

Candidate causes that remain **unconfirmed** and must be checked in a real browser:

1. **Non-portal `LanguageSwitcher` panel** — the only floating UI VelCenter renders without a portal. It is
   `absolute` inside the header's `relative` wrapper; the header is `sticky` + `backdrop-blur`. If the panel is
   ever opened while the mobile drawer (`fixed`, `z-50`) is open, the header's `z-40` stacking context puts the
   panel **below** the drawer/backdrop — it would look "clipped" or "unusable", not top-left.
2. **Drawer transform + scroll container** — the mobile drawer is `max-md:fixed … max-md:transition-transform`
   with `overflow-y-auto`. Radix portals are unaffected, but any *future* non-portal floating element inside it
   will be clipped by that overflow.
3. **Body scroll lock** — while the drawer is open the page sets `body { overflow: hidden }`. Radix measures with
   `scrollbar` compensation; a locked body is supported, but this must be confirmed on a real device.
4. **Viewport / safe-area** — the drawer uses `env(safe-area-inset-*)`; menus opened from the header on an
   iOS home-indicator screen were never measured.

## Recommended fix (only after step 1 below confirms)

- Convert `LanguageSwitcher`'s panel to a Radix `DropdownMenu`/`Popover` (already in the design system) so it
  portals and collision-detects like every other menu — one shared component, benefits VelCenter and VelSeller.
- Do not touch Radix primitives: they already portal correctly.
- No z-index escalation, no global CSS.

## Test plan

1. Reproduce in the deployed app at 360/390/430: open every menu (employee role menu, order ship dialog
   dropdown, chat conversation actions, language switcher, table filters) and record the menu's
   `getBoundingClientRect()` vs its trigger's.
2. Repeat at 768/1024/1280/1440/1920, plus: menu near the bottom edge, inside the order-ship dialog, inside the
   mobile drawer, and while the page is scrolled.
3. Confirm close paths: select, tap outside, Escape; keyboard: arrow keys + Enter.
4. Capture console errors/warnings during each step.

Until step 1 is run, applying a "fix" would be guesswork, which this task explicitly forbids.

## Status

- Diagnostic: **complete for static evidence**, browser repro **NOT TESTED**.
- Code changes: **none** (no confirmed defect).
