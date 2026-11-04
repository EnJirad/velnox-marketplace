# Velnox AI Handoff — Current State (Compact)

**Last updated:** 2026-11-02 · **Branch:** `main` · **Latest verified commit:** `7f6b1b4` (Product upload guards + lifecycle verification)

## 1. Current Project State

**WORKING** — All core systems operational. 4/4 apps typecheck, i18n parity (1339×3), builds pass.

### Active Tasks
- None currently assigned

### Important Unresolved Issues
1. **Responsive verification BLOCKED** — CDP cannot install on android/arm64; 360/390/430/768/1024/1280/1440 breakpoints NOT VERIFIED
2. **Production DB Verify BLOCKED** — Missing `NEON_PRODUCTION_DATABASE_URL` 
3. **8 test-database-isolation probes fail** — Android/Termux env limitation (`process.execPath` = linker), not code defects

### Important Recent Decisions
- Announcement carousel lazy-loading fixed (active slide now `eager`)
- Payment rail switching recovered; Stripe PromptPay E2E works with test keys
- VelCenter mobile nav offset fixed; drawer root cause resolved
- Velseller product editor image lifecycle verified with real R2 uploads

---

## 2. Quick Pointers

| Need | Location |
|------|----------|
| Full history index | `.ai/history/AI_Handoff_Archive.md` |
| Verbatim archive | `.ai/history/archive/` |
| Verification system | `.ai/context/verification.md` |
| Subsystem docs | `.ai/context/<topic>.md` |
| Architecture | `.ai/office/ARCHITECTURE.md` |
| Agent roles | `.ai/office/agents/` |

---

## 3. Current Git State

```
Local HEAD:  7f6b1b44fc0344335124091679cbf74a692c6a2b
Remote main: 7f6b1b44fc0344335124091679cbf74a692c6a2b
Status:      IN SYNC
```

---

## 4. Environment Notes

- `TEST_DATABASE_URL` required for DB tests (skips when unset)
- Production Neon = `DATABASE_URL` — never write to it from tests
- `bun test` needs `./` prefix on this host (bun 1.4.4)
- `bun run lint` / `format` are placeholders
- 8 known environmental test failures (not code defects)

---

## 5. Next Agent Should

1. `git fetch origin` and verify sync before any editing
2. Read this handoff + relevant subsystem doc + source code
3. Do NOT load full history — use archive pointers when needed
4. Follow task routing: T1→immediate, T2→plan→implement→QA, T3→full workflow

---

*For detailed session records, see `.ai/history/2026-11-02-*.md` and the archive index.*
