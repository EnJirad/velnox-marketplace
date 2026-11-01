# §122. Local auth harness (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom.

## §122. VelCenter local authenticated harness + first measurement (2026-11-02)

**SHA:** `a8a8266` → this commit. Report:
[`.ai/history/2026-11-02-velcenter-local-auth-harness.md`](./history/2026-11-02-velcenter-local-auth-harness.md).

The login wall was solved without bypassing auth: build with `VITE_API_URL=http://localhost:8899`, a scratch
proxy (outside the repo) to the real API, `vite preview` on 5173, then set the owner's real session cookie on
`localhost` (same site) → authenticated Center. At 492 px (mobile layout, `#center-nav` = `position: fixed`):
LanguageSwitcher trigger `380,14` → panel `256,54 160x123`, `absolute`/`z-50`, no overflow — **it is anchored
correctly**, so the "top-left" symptom is not this component. Other menus and 360/390/430/768+ **NOT TESTED**
(WebView fixed at 492 px; DevTools MCP unavailable). No code changed. Background jobs 8/9 are the local harness; a continuation run could not finish — the preview answered with a
body-less document and the remaining menus stayed untested, so still no root cause and no code change.

---
