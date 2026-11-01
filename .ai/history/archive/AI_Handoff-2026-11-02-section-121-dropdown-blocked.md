# §121. Dropdown repro BLOCKED (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom.

## §121. VelCenter dropdowns — browser phase BLOCKED, no code change (2026-11-02)

**SHA:** `70ac928` → this docs commit. Report:
[`.ai/history/2026-11-02-velcenter-dropdown-fix.md`](./history/2026-11-02-velcenter-dropdown-fix.md).

Reproduction was attempted and blocked: the deployed app redirects to `/auth` because it authenticates against
`velnox-api.onrender.com` (different origin); a page-set cookie cannot satisfy that, and bypassing auth is
forbidden. Nothing was measured, no root cause claimed, no fix applied. Static evidence stands from the
diagnostic: `UserMenu` + all menu primitives portal via Radix; only `LanguageSwitcher` is non-portal, which
does not explain a `(0,0)` symptom. **NOT TESTED:** every interactive/viewport case. Owner must run the
rect-measurement steps in the report on a device. **Follow-up:** installing the API session cookie in the
browser was attempted on both origins and is blocked by browser security (cross-origin cookie; the API origin's
`script-src 'self'` blocks `browser_eval`), so the repro remains owner-only.

---
