# VelCenter dropdowns — browser phase BLOCKED, no code change (2026-11-02)

**Starting SHA:** `70ac928` (`HEAD == origin/main`, tree clean). **Final SHA:** this docs commit.

## 1. Original mobile issue

Reported: tapping a dropdown in VelCenter on a phone opens it in the wrong place ("clustered at the top-left"),
or the menu cannot be used.

## 2. Browser reproduction attempt (Phase 2) — BLOCKED

What was actually done:

1. Opened `https://velcenter.vercel.app/` in the in-app browser → landed on `/auth`.
2. Read the page state with `browser_eval`: `path=/auth`, login copy rendered, `document.cookie` had no
   `velnox_session`.
3. Set the authorized test session cookie on the page's own origin (`document.cookie = "velnox_session=…;
   path=/; SameSite=Lax"` — value supplied by the owner earlier), reloaded → **still redirected to
   `/auth?returnTo=%2F`**.

Cause of the block: VelCenter authenticates against `https://velnox-api.onrender.com`, a **different origin**;
the session cookie the API sets for its own domain cannot be created from JavaScript on `velcenter.vercel.app`,
and I will not forge or bypass authentication (explicitly forbidden). No authenticated center session exists in
this environment.

**Consequence:** no menu was reproduced, nothing was measured, and no root cause is claimed. A `getBoundingClientRect`
comparison of trigger vs menu content was not possible.

## 3. Static evidence gathered (SUSPECTED only, not confirmed)

| Component | Implementation | Portal |
|---|---|---|
| `UserMenu` (`packages/shared/src/components/UserMenu.tsx`) | Radix `DropdownMenu` (`align="end"`, line 75) | **yes** (Radix portal) |
| Employee / order-ship / chat menus | shared `DropdownMenu` (`ui/dropdown-menu.tsx:38`) | **yes** |
| Form selects | shared `Select` (`ui/select.tsx:59`) | **yes** |
| `LanguageSwitcher` | hand-rolled `absolute right-0` panel inside a `relative` wrapper | **no** |

`LanguageSwitcher` is the **only** floating UI VelCenter renders without a portal. It lives inside the sticky,
`backdrop-blur`, `z-40` header. Structurally it is the best remaining suspect, but the reported symptom
("top-left, unusable") is not explained by this markup: an absolutely-positioned panel inside a `relative`
parent cannot land at `(0,0)`.

## 4. Fix applied

**None.** The task forbids fixing an unproven cause, and the only static suspect does not match the symptom.
No CSS override, no z-index bump, no component swap.

## 5. Automated checks (executed on the unchanged tree)

- `apps/velcenter` typecheck → **PASS**
- `bun --filter '@velnox/velcenter' build` → **PASS** (last run on `5d7996c`, unchanged since)
- `git diff --check` → **PASS**
- Dropdown behaviour tests → **NOT TESTED** (no component-test infrastructure for menus)
- Lint → **NOT TESTED** (repo has no real lint script)

## 6. Viewport results

360 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1920 → **NOT TESTED** (browser blocked, see §2).

## 7. Console errors

**NOT TESTED** — no page reached beyond `/auth`.

## 8. Manual verification steps (for the owner)

1. Log into `https://velcenter.vercel.app` with a center-capable account **on the device**.
2. At 360 / 390 / 430 px open each menu and record, in DevTools console:
   `const m=[...document.querySelectorAll('[role="menu"],[role="listbox"]')]; m.map(e=>[e.getBoundingClientRect(), getComputedStyle(e).position, getComputedStyle(e).zIndex])`
   and compare with the triggering button's rect.
3. Repeat: header `UserMenu`, `LanguageSwitcher`, employee role menu, order-ship dialog select, chat actions,
   a form `Select`, a menu opened while the drawer is open, and a menu near the bottom edge.
4. Note any rect with `x==0 && y==0` (the reported symptom) and send that element's `outerHTML`.
5. Test close paths: select, tap outside, Escape; then reopen.

With that evidence, the fix is either (a) migrate `LanguageSwitcher` to the existing Radix `Popover` (shared,
also benefits VelSeller), or (b) address whatever the measurements show for the Radix menus — but only then.

## 9. Unverified

Everything interactive: open by touch/mouse/keyboard, positioning, clipping, z-order, dismissal, dialog/drawer
interaction, console output, and all eight viewport widths.

## 10. Protected scope

No application, backend, schema, auth, payment or VelShop/VelSeller file was touched. Diff = `.ai/` only.
