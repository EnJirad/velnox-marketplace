# §114. VelCenter/VelSeller UI audit (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom.

## §114. VelCenter/VelSeller UI audit (Phase 1) — no code changed (2026-11-02)

**Report:** [`.ai/history/2026-11-02-velcenter-velseller-ui-audit.md`](./history/2026-11-02-velcenter-velseller-ui-audit.md).

Audit only (task requires audit before implementation). Headline defect: **neither `apps/velcenter` nor
`apps/velseller` mounts `LanguageProvider`** (only `RealtimeProvider`), while pages call `useLanguage()` — so
the language switcher cannot work or persist there. 10 center + 6 seller `.tsx` files carry hardcoded Thai;
VelCenter has no app shell (sections live inside `Center.tsx`), VelSeller already uses shared
`AppHeader` + `MobileTabBar`. Plan: shared `AppShell` + `LanguageSwitcher`, provider wiring in both apps,
`center.*`/`seller.*` i18n sweep, keep every route/permission/API untouched. Viewport sign-off needs an owner
browser session.

---
