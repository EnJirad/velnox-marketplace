# §123. Drawer root cause (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom.

## §123. Root cause of the "top-left strip" identified from the owner's screenshot (2026-11-02)

**SHA:** `084a303` → this commit (docs only). Report: §13 of
[`2026-11-02-velcenter-local-auth-harness.md`](./history/2026-11-02-velcenter-local-auth-harness.md).

The mobile drawer markup (`max-md:fixed … -translate-x-full` on `<TabsList>`, §118) is **not applied on the
device** — the nav renders in normal flow as a white bar at the top-left, which is the "menus piled top-left"
the owner reports (not a dropdown bug; LanguageSwitcher measured correct at §11). An attempted wrapper fix
(`fixed`/`hidden md:block` on a plain div) passed `tsc` and `vite build` but the preview rendered blank, so it
was **reverted** — tree clean, `tsc` pass. Next: wrap and verify with `browser_get_logs` + computed styles, or
move the wrapper outside `<Tabs>` if Radix rejects it.

---
