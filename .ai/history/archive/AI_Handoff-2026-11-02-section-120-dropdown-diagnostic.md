# §120. VelCenter dropdown diagnostic (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom.

## §120. VelCenter dropdown diagnostic — no confirmed defect, browser repro needed (2026-11-02)

**SHA:** `5d7996c`. Report:
[`.ai/history/2026-11-02-velcenter-dropdown-diagnostic.md`](./history/2026-11-02-velcenter-dropdown-diagnostic.md).

Every menu in VelCenter comes from the shared Radix primitives, and each of those portals to `document.body`
(`dropdown-menu.tsx:38`, `select.tsx:59`, `popover.tsx:27`); no hand-rolled menu exists in
`apps/velcenter/src`. So a "menu at the top-left" symptom has no static cause in this code. The only
non-portal floating UI is our `LanguageSwitcher` panel (`absolute` inside the sticky, blurred header), which
sits in the header's `z-40` stacking context and can be covered by the drawer/backdrop `z-40/50`.
**No code changed** — the task forbids fixing speculative issues. Next: reproduce at 360/390/430 with rect
measurements; if the switcher is the culprit, migrate it to the existing Radix popover (shared, benefits
VelSeller too).

---
