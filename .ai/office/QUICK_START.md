# AI Office Quick Start — Velnox Marketplace

> **One-page entry point for every session. Read this first, then load only what you need.**

## Agent Identity & Responsibilities

| Agent | Role | Model |
|-------|------|-------|
| **AI 01** (you) | Main Developer — implements, verifies, commits, pushes | `ag/claude-opus-5-5` |
| **AI 02** | Architect/Planner + Independent QA — plans, reviews, does NOT write feature code | `cx/gpt-6-astra` |

## Task Routing (Auto-classified)

```
T1 — QUICK          → AI 01 handles immediately, no AI 02
   Examples: typo, translation, color, spacing, small isolated fix
   
T2 — STANDARD       → AI 02 plans → AI 01 implements → AI 02 QA
   Examples: new feature, multi-file change, subsystem improvement
   
T3 — CRITICAL       → Full two-agent workflow with all safety checks
   Examples: auth, payment, database schema, financial logic, security
```

**AI 01 selects the level automatically.** Do not ask the user.

## Essential Safety Rules (Always Apply)

These are loaded for **every** task level, including T1. Full text: `.ai/office/ESSENTIAL_RULES.md`.

1. **GitHub remote is truth** — `git fetch origin` and compare SHAs before editing (§0 AI_RULES)
2. **Neon → Backend API → Frontend** — Frontend never touches DB or holds secrets
3. **Schema changes are double-booked** — update both `db/schema.sql` AND `db/run-sqleditor.sql`
4. **No fake data, no mock APIs, no duplicates** — reuse existing systems
5. **Verify before claiming** — run actual commands, quote exit codes
6. **No secrets in output** — never print tokens, keys, connection strings

## Context Loading Policy (Progressive)

| Phase | Load |
|-------|------|
| **Startup** | This file only |
| **Every task** | `.ai/office/ESSENTIAL_RULES.md` (always) |
| **T1** | Essential rules + affected source files. No full rulebook, no AI 02. |
| **T2** | + `.ai/AI_RULES.md`, architecture, agent roles, inferred subsystem doc |
| **T3** | + full rulebook + handoff + all inferred subsystem docs |
| **QA** | Test commands + acceptance criteria + changed files |

**Never auto-load:** entire `.ai/` tree, full history, completed tasks, unrelated agent instructions, archive files, past reports.

## Handoff and Reports

- `.ai/AI_HANDOFF.md` — current state only (active tasks, unresolved issues, decisions, pointers). Never history.
- `.ai/reports/LATEST.md` — **one** canonical report, overwritten on each completed task. There is no dated report archive; git history covers code changes. Only read it when it is relevant to the current task.

## Quick Reference

```
Repo:     bun workspaces (velshop, velseller, velcenter, velnox, backend, packages/shared)
Branch:   main
Install:  bun install
Dev:      bun run dev:velshop + bun run api:dev
Typecheck:bun run typecheck
Test:     bun run test (needs TEST_DATABASE_URL)
I18n:     bun run i18n:check
DB:       run db/run-sqleditor.sql once in Neon SQL Editor
```

## When You Need More

| Need | Read |
|------|------|
| Browser / localhost session cookie | `.ai/secrets/browser-cookies.json` + §11 of `ESSENTIAL_RULES.md` |
| Always-on safety rules | `.ai/office/ESSENTIAL_RULES.md` |
| Full rules | `.ai/AI_RULES.md` |
| Current state | `.ai/AI_HANDOFF.md` |
| Latest task report | `.ai/reports/LATEST.md` |
| File locations | `.ai/context/project-map.md` |
| Subsystem docs | `.ai/context/<topic>.md` (see table below) |
| Architecture | `.ai/office/ARCHITECTURE.md` |
| Agent roles | `.ai/office/agents/developer.md` / `architect.md` |
| Runbook | `.ai/office/RUNBOOK.md` |

### Subsystem Context Map

| Task touches | Read |
|--------------|------|
| Product / catalog | `.ai/context/products.md` |
| Category tree | `.ai/context/categories.md` + `.ai/context/seller.md` |
| Login / session | `.ai/context/security.md` |
| Image upload / R2 | `.ai/context/media.md` |
| Checkout / orders | `.ai/context/checkout.md` |
| Payment / Stripe / COD | `.ai/context/payment.md` |
| Seller verification | `.ai/context/verification.md` |
| Database / schema | `.ai/context/database.md` |
| API / backend / authz | `.ai/context/backend.md` |
| Realtime / WebSocket | `.ai/context/realtime.md` |
| Tracking / multi-carrier shipment | `.ai/context/tracking.md` + `.ai/context/checkout.md` |
| Styling / theme / mobile | `.ai/context/frontend.md` |

## Completion Checklist

Every repo-changing task ends with ALL:

```
☐ Implementation complete
☐ Validation passed (typecheck / tests / i18n / diff --check)
☐ Independent AI 02 QA PASS (T2/T3 only)
☐ Commit created
☐ Push to origin/<branch> verified (local SHA == remote SHA)
☐ .ai/reports/LATEST.md overwritten with this task's report
☐ .ai/AI_HANDOFF.md updated if project state changed
☐ Working tree clean
```

---

**Remember:** Load the smallest context that remains sufficient. Accuracy before speed.
