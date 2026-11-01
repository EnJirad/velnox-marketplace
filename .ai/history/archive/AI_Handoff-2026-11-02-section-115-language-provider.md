# §115. LanguageProvider in VelCenter + VelSeller (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom.

## §115. LanguageProvider wired into VelCenter + VelSeller (2026-11-02)

**SHA:** `39f30e5` → `63f48ed`. Report: [`.ai/history/2026-11-02-language-provider-velcenter-velseller.md`](./history/2026-11-02-language-provider-velcenter-velseller.md).

Both entry points called `useLanguage()` without mounting `LanguageProvider`; both now wrap the router tree in
the shared provider exactly like VelShop, with the shared i18n package untouched (Thai default, stored
preference honoured). typecheck 4/4 · velcenter + velseller builds pass · i18n 1282×3 · diff clean.
**Not done:** visible switcher (no shared component), 16-file hardcoded-Thai sweep, VelCenter shell,
Velseller compaction, browser verification.

---
