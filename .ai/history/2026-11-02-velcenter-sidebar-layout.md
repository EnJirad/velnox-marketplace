# VelCenter: responsive sidebar layout (2026-11-02)

**SHA:** `015407d` → this commit. **Scope:** layout of the EXISTING tab navigation; no business logic touched.

## What changed

`apps/velcenter/src/pages/Center.tsx` — the existing `<Tabs>` root becomes a two-column grid at `md+`
(`grid-cols-[15rem_minmax(0,1fr)]`) and the existing `<TabsList>` becomes a sticky vertical rail
(`md:flex-col`, `md:sticky md:top-20`, full-width left-aligned triggers). Tab panels are pinned to column 2 via
`md:[&>[role=tabpanel]]:col-start-2`. Below `md` the list keeps the original horizontal scroll strip.

Nothing else was edited: no tab, trigger, permission check (`canSee`/`holds`), query, mutation, route or
`LanguageSwitcher`/`UserMenu` was moved or duplicated. No new component, dependency or style system.

## Verification (executed)

- `apps/velcenter` typecheck → pass
- `bun --filter '@velnox/velcenter' build` → **success**
- `git diff --check` → clean

## NOT DONE

- **Mobile slide-in drawer with overlay/Escape/outside-click**: not implemented. Mobile keeps the existing
  horizontal tab strip (scrollable, no page overflow), so navigation still works but the drawer requirement
  is unmet.
- Collapsible desktop sidebar: not implemented.
- Page-title component: not added.
- Browser/viewport inspection (360–1920): **not performed** — requires an authenticated center session.
