# Archived: Agent workspace moved to `.ai/` (2026-09-23)

Moved out of `.ai/AI_HANDOFF.md` §8 on 2026-09-25 to keep the live handoff small.
The layout it describes **is** the current state and is documented live in
`AGENTS.md` and `.ai/README.md`; the record below is kept verbatim as history.

---

## 8. Agent workspace moved to `.ai/` (2026-09-23)

The agent documentation layer moved from the repo root plus `docs/ai/` into one
canonical workspace, **`.ai/`**. Nothing was discarded and no second copy was left
behind.

### Layout

| New | Was | Role |
|-----|-----|------|
| `.ai/AI_RULES.md` | `AI_RULES.md` | canonical rulebook |
| `.ai/AI_HANDOFF.md` | `AI_Handoff.md` | this file |
| `.ai/README.md` | `docs/ai/README.md` | startup protocol + context-loading policy |
| `.ai/context/*.md` | `docs/ai/*.md` | 16 context docs (renames below) |
| `.ai/history/AI_Handoff_Archive.md` | `AI_Handoff_Archive.md` | dated history index — kept as-is |
| `.ai/history/README.md` | `docs/ai/history/README.md` | the three-layer history policy |
| `.ai/history/archive/*.md` | `docs/ai/history/archive/*.md` | verbatim long-form records |
| `.ai/tasks/` | *new* | `TEMPLATE.md` + `active/` + `completed/` |

### The six named context entries

| New | Was |
|-----|-----|
| `context/architecture.md` | `ARCHITECTURE.md` |
| `context/database.md` | `DATABASE.md` |
| `context/backend.md` | **new** — API, middleware order, authz, audit, jobs, derived from backend source |
| `context/frontend.md` | `DESIGN.md` (+ where frontend code lives) |
| `context/realtime.md` | `REALTIME.md` |
| `context/security.md` | `AUTH.md` |

Subsystem docs kept their names, lowercased: `products.md`, `categories.md`,
`seller.md`, `customer.md`, `checkout.md`, `media.md`, `project-map.md`,
`testing.md`, `workflow.md`, `troubleshooting.md`.

### Pointers, not duplicates

That pass left root `AI_RULES.md` and `AI_Handoff.md` as short pointer files; they
were **removed on 2026-09-25 (§12)** after a repo-wide search confirmed no tooling,
workflow, or code depends on them. `AGENTS.md` and root `README.md` point into
`.ai/` and forbid recreating them; `docs/` keeps the human-facing docs (`API.md`,
`ARCHITECTURE.md`, `SECURITY.md`, `DEPLOYMENT.md`, and the rest).

### Reconciled with `6187bcd`

`main` advanced 12 commits while this move was in flight, including a handoff
split (current state here, dated index in `AI_Handoff_Archive.md`, verbatim
records in `docs/ai/history/archive/`). Those commits are the base: their
structure was carried over unchanged into `.ai/history/`, together with the
handoff-size policy in `AI_RULES.md` §15 and `context/workflow.md` §8, the
upload-size / object-existence enforcement, the atomic inventory release, the
seller-verification pagination and self-approval guard, and the `/api/_diag`
guard beneath them. No force push; `main` was not rewritten.

### Root cause

The rulebook, handoff, and context docs were reached through three competing
schemes (repo-root files, `docs/ai/*.md`, and the `AGENTS.md` tables) with no
single entry point and no defined task scope. The workspace now has one canonical
location, a startup protocol, a context-loading policy, and a task-brief format
that carries a stop-and-clarify rule.

### Validation

| Check | Result |
|-------|--------|
| link integrity — every `.ai/` and `docs/` path referenced across the workspace | resolves; the only non-resolving paths are deliberate or descriptive: `db/run-update.sql` (must never exist), the old `docs/ai/*` paths quoted as the source of this move, `db/index.ts` (relative to `backend/` in the project map), and one dated historical note about a deleted `backend/lib/product-status.ts` |
| `git diff --check` | CLEAN |
| git rename detection | the doc moves are recorded as renames — history preserved |
| backend `tsc --noEmit` | pass |
| velShop / velSeller / velCenter / velNox typecheck | pass |
| backend tests | 415 pass / 37 skip / 0 fail (452 across 22 files) |
| DB | unchanged — `db/schema.sql` · `db/run-sqleditor.sql` untouched, still synchronized |
| code | unchanged by this pass — documentation only |

### Files changed (this pass)

`.ai/**` (workspace) · `AGENTS.md` · `README.md` · `AI_RULES.md` (pointer) ·
`AI_Handoff.md` (pointer) · `docs/ai/**` (moved into `.ai/`) ·
`AI_Handoff_Archive.md` (moved into `.ai/history/`).
