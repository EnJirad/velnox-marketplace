# LanguageProvider wired into VelCenter + VelSeller (2026-11-02)

**SHA:** `39f30e5` → this commit. **Scope:** the Phase 2 defect from the UI audit only.

## Defect

Both `apps/velcenter/src/main.tsx` and `apps/velseller/src/main.tsx` mounted `RealtimeProvider` but **no
`LanguageProvider`**, while pages call `useLanguage()` from `@velnox/shared/lib/i18n`. Outside the provider
there is no language state to read or persist, so switching TH/EN/MY could not work in either application.

## Change

- `apps/velcenter/src/main.tsx` — wraps the router tree in `<LanguageProvider>` (imported from
  `@velnox/shared/lib/i18n`), exactly like VelShop's entry point.
- `apps/velseller/src/main.tsx` — same wrapper.
- No provider, key, locale file or VelShop behaviour was modified: the shared implementation
  (`packages/shared/src/lib/i18n`) is untouched, so Thai stays the default and a stored preference is honoured
  by the existing `readStoredLanguage()`.

## Verification

- `bun run typecheck` → **4/4** apps
- `bun --filter @velnox/velcenter build` → success · `bun --filter @velnox/velseller build` → success
- `bun run i18n:check` → OK, th/en/my = 1282 keys each
- `git diff --check` → clean

## NOT DONE (and why)

- **Visible language switcher in these two apps**: the shared package has no switcher component (VelShop's is
  app-local). Extracting one is a shared-component change; it needs its own review rather than a rushed copy.
- **Hardcoded Thai in 16 files** (10 center, 6 seller): key migration is a large per-file sweep with 3-locale
  parity; not attempted here.
- **VelCenter app shell (sidebar/drawer)** and **Velseller layout compaction**: unchanged.
- **Responsive/browser verification**: needs an authenticated admin/seller session; not performed.

## State of the task

Phase 2 (provider) is complete and verified. Phases 3–6 remain open and are described in the Phase 1 audit
(`2026-11-02-velcenter-velseller-ui-audit.md`).
