# §116. VelCenter language switcher (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom.

## §116. VelCenter language switcher (2026-11-02)

**SHA:** `edecd68` → this commit. Report: [`.ai/history/2026-11-02-velcenter-language-switcher.md`](./history/2026-11-02-velcenter-language-switcher.md).

New shared `LanguageSwitcher` (TH/EN/MY) mounted in VelCenter's sticky header next to `UserMenu`; it uses the
shared `useLanguage()` only, so switching is immediate and persists. velcenter typecheck pass, build pass,
i18n 1282×3, diff clean. **Not done:** the sidebar/drawer application shell, the 10-file hardcoded-Thai sweep,
Velseller work, and browser/viewport verification (needs an authenticated session).

---
