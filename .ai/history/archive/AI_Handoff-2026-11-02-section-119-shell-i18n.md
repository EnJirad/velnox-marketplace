# §119. VelCenter shell copy i18n (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom.

## §119. VelCenter shell copy in TH/EN/MY (2026-11-02)

**SHA:** `7ab2978` → this commit. Report: [`.ai/history/2026-11-02-velcenter-ui-polish-i18n.md`](./history/2026-11-02-velcenter-ui-polish-i18n.md).

Shell strings now use keys (`center.nav.*`, `center.title`, `center.subtitle`, `center.realtime.reconnecting`,
`center.queue.loadFailed`) in all three locales — parity **1294 × 3**. Tab ids, `?tab=`, RBAC, queries and
handlers untouched; VelCenter typecheck + build pass, diff clean. **Still Thai-only:** the panels themselves
(KPIs, verification, employees, incidents, chat, settings, audit). Browser viewports 360–1920 **NOT VERIFIED**.

---
