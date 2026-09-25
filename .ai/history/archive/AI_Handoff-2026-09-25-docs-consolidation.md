# Archived: Startup-sync rule + root AI files removed (2026-09-25)

Moved out of `.ai/AI_HANDOFF.md` §12 on 2026-09-25 to keep the live handoff small.
The rules it introduced are live in `.ai/AI_RULES.md` §0, `.ai/context/workflow.md`
§1, `.ai/README.md`, and `AGENTS.md` rule 0. The record below is kept verbatim as
history.

---

## 12. Startup-sync rule + root AI files removed (2026-09-25)

**Docs only — no code, no DB change.**

1. **`.ai/AI_RULES.md` §0 — "Startup Synchronization — GitHub Remote Is the Source
   of Truth"** is now the first section of the rulebook. It closes the
   stale-sandbox failure mode: `git remote -v` → `git fetch origin` → `git status`
   → `git branch --show-current` → `git rev-parse HEAD` vs
   `git rev-parse origin/<branch>`; behind → synchronize (`git pull --ff-only`)
   before editing, diverged → **STOP** (no force-push, do not discard local work,
   do not overwrite remote history), and the remote SHA must be confirmed before
   implementation. Inserted as §0 so every existing `§6` / `§14` / `§15`
   cross-reference stays valid.
2. **Root `AI_RULES.md` and `AI_Handoff.md` are removed.** A repo-wide search found
   no workflow, `package.json` script, config, or source file referencing them, so
   the compatibility pointers were deleted rather than kept. They held no rules and
   no state. **`AGENTS.md` stays at the root on purpose** — many AI tools discover
   it there — and it now forbids recreating root duplicates.
3. **Wired into the startup path:** `.ai/README.md` (step 1),
   `.ai/context/workflow.md` §1, and `AGENTS.md` (rule 0) all point at §0.
4. **Stale reference fixed:** `docs/DATABASE.md` named `AI_Handoff.md` → now
   `.ai/AI_HANDOFF.md`.

**Verification:** repo-wide search for `AI_RULES.md` / `AI_Handoff.md` / `docs/ai`
returns no bare root-file reference; `.ai/README.md`, `.ai/AI_RULES.md` and
`.ai/AI_HANDOFF.md` are the only workspace entry points; `git diff --check` clean.
