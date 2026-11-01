# §117. VelCenter sidebar layout (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom.

## §117. VelCenter responsive sidebar layout (2026-11-02)

**SHA:** `015407d` → this commit. Report: [`.ai/history/2026-11-02-velcenter-sidebar-layout.md`](./history/2026-11-02-velcenter-sidebar-layout.md).

The existing `<Tabs>` nav is now a two-column grid at `md+` with a sticky vertical rail and panels in column 2;
below `md` the original horizontal strip remains. No tab, permission, query, route, `LanguageSwitcher` or
`UserMenu` was moved or duplicated; velcenter typecheck + production build pass; diff clean.
**NOT DONE:** mobile slide-in drawer (overlay/Escape/outside-click), collapsible sidebar, page-title component,
and any browser viewport inspection.

---
