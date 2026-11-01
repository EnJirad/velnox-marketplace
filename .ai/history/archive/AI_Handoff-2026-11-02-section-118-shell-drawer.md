# §118. VelCenter shell: drawer + collapse (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom.

## §118. VelCenter shell: collapse + mobile drawer (2026-11-02)

**SHA:** `b472b40` → this commit. Report: [`.ai/history/2026-11-02-velcenter-shell-drawer.md`](./history/2026-11-02-velcenter-shell-drawer.md).

One file (`apps/velcenter/src/pages/Center.tsx`): `navOpen`/`navCollapsed` state; the EXISTING `<TabsList>` becomes
a fixed off-canvas drawer below `md` (safe-area padding) with a backdrop button, Escape close and a body-scroll
lock, and closes on tab selection; a `PanelLeft` toggle narrows the desktop rail from 15rem to 4.5rem. Tab ids,
`?tab=`, RBAC, queries, dialogs, the settings sub-tabs, LanguageSwitcher and UserMenu are untouched.
velcenter typecheck + build pass · i18n 1282×3 · diff clean. **NOT VERIFIED:** browser viewports 360–1920
(no authenticated session).

---
