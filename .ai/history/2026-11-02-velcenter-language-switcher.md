# VelCenter: shared language switcher wired (2026-11-02)

**SHA:** `edecd68` → this commit. **Scope:** the visible language selector only (the shell is NOT built).

## What changed

- New `packages/shared/src/components/LanguageSwitcher.tsx` — one selector for TH/EN/MY built on the shared
  `useLanguage()`; it owns no state and no storage of its own, so switching is immediate and the stored
  preference survives reloads. Native language names are used as labels (nothing to translate); closes on
  outside click and Escape; 36 px trigger, 40 px rows.
- `apps/velcenter/src/pages/Center.tsx` — the switcher sits in the existing sticky header next to
  `<UserMenu />`. No route, permission, query or layout logic was touched.

## Verification (executed)

- `apps/velcenter` typecheck → pass
- `bun --filter '@velnox/velcenter' build` → **success**
- `bun run i18n:check` → **OK th/en/my = 1282**
- `git diff --check` → clean

## NOT DONE

- **Application shell** (desktop sidebar, mobile drawer, page-header component): VelCenter still renders its
  sections inside `pages/Center.tsx`; not attempted in this session.
- **Hardcoded-Thai sweep** (10 center files → `center.*` keys, 3 locales): not attempted.
- **Velseller**: untouched, as scoped.
- **Browser/viewport verification**: needs an authenticated center session; not performed.
