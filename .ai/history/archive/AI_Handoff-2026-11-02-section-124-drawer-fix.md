# §124. VelCenter drawer fixed (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom.

## §124. VelCenter mobile drawer fixed (2026-11-02)

**SHA:** `950adff` → this commit. Report: [`.ai/history/2026-11-02-velcenter-drawer-fix.md`](./history/2026-11-02-velcenter-drawer-fix.md).

The `max-md:*` arbitrary-value classes on `<TabsList>` were not applied on device, so the navigation rendered in
normal flow at the top-left (the owner's screenshot). The list now sits in a plain wrapper with ordinary classes
(`fixed inset-y-0 left-0 z-50 …` when open, `hidden md:block` when closed) and stays the grid's first child.
Measured at 492 px with the real API: closed → `display:none`; opened → overlay + all sections; selecting a
section returns `?tab=…` and closes it; no horizontal overflow. velcenter typecheck + build pass. **NOT TESTED:**
other viewports/menus and the 4-app i18n sweep.

---
