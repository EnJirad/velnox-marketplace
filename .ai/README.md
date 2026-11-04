# .ai — Velnox AI Workspace

This directory controls how AI agents work on the Velnox repository.

## Core Principle

> **Read the smallest amount of context required to complete the current task correctly.**

Do NOT read the entire repository by default.
Do NOT treat every document as required context.

---

## Agent Startup

Every agent session follows:

1. **Synchronize with the GitHub remote** — establish local vs remote state before
   reading or editing anything (`.ai/AI_RULES.md` §0). The sandbox is temporary and
   may be stale; it is never the source of truth.
2. Read `.ai/office/QUICK_START.md` — single-page startup entry point (~500 tokens)
3. Receive the user's task
4. Classify the task (T1/T2/T3) — auto via task router
5. Start the correct workflow immediately
6. Retrieve additional context only when needed

**Do NOT read the full rulebook or handoff unless the task requires it.**

Detailed workflow:

- **T1 (Quick)**: AI 01 executes immediately, no AI 02
- **T2 (Standard)**: AI 02 plans → AI 01 implements → AI 02 QA
- **T3 (Critical)**: Full two-agent workflow with all safety checks

For T2/T3 tasks:
1. Identify the assigned task
2. Read that task's brief from `.ai/tasks/active/`
3. Read ONLY the context files listed by the task
4. Inspect the actual source files required by the task
5. Make the smallest safe change
6. Run the task-specific verification (`.ai/context/testing.md`)
7. Check stop conditions
8. Overwrite `.ai/reports/LATEST.md` with the Change Report — **mandatory for every session**, including investigations, failed fixes and BLOCKED work (`.ai/AI_RULES.md` §18/§19); read it back to confirm
9. Update `.ai/AI_HANDOFF.md` when project state moved
10. Produce a concise task report with the resulting git SHA
11. Commit only verified changes (`.ai/context/workflow.md`)

Never answer with only "done", and never report a check you did not run. Production Neon is never
connected to by an agent — hand the owner read-only SQL instead (`.ai/AI_RULES.md` §17).

`AGENTS.md` at the repo root is the short entry point for tools that look for it; it points here.

---

## Context Loading Policy

**Startup (always):**
- `.ai/office/QUICK_START.md` — single-page entry point (~500 tokens)

**Per-task (progressive):**
- Current task brief from `.ai/tasks/active/`
- Only the context files listed by the task brief
- Actual source files required by the task

**Read only when referenced by the task** — the named context set:

| File | Load when |
|------|-----------|
| `.ai/context/architecture.md` | Need system-level understanding |
| `.ai/context/database.md` | Any schema / migration / DB change |
| `.ai/context/backend.md` | API, middleware, authz, audit, jobs |
| `.ai/context/frontend.md` | UI, theme, responsive, i18n |
| `.ai/context/realtime.md` | WebSocket channels, live update behaviour |
| `.ai/context/security.md` | Login, session, OAuth, roles, secrets |

Subsystem reference docs follow the same rule — only when the task names that subsystem:

| File | Subsystem |
|------|-----------|
| `.ai/context/project-map.md` | Where anything lives (use to locate, not to learn) |
| `.ai/context/products.md` | Catalog, product CRUD, variants, search |
| `.ai/context/categories.md` | Category taxonomy, tree, validation |
| `.ai/context/seller.md` | Seller onboarding, shop, seller APIs |
| `.ai/context/customer.md` | Customer profile, cart, wishlist, addresses |
| `.ai/context/checkout.md` | Orders, payments, shipments |
| `.ai/context/payment.md` | Stripe (test mode only), COD flags, checkout/refund idempotency |
| `.ai/context/verification.md` | Seller/shop V verification, evidence security, self-approval guard |
| `.ai/context/media.md` | R2 uploads, images, media |
| `.ai/context/testing.md` | How to verify (commands that actually exist) |
| `.ai/context/workflow.md` | Git lifecycle, preview, deploy |
| `.ai/context/troubleshooting.md` | Real failure modes and fixes |

**Never load automatically**

- unrelated task briefs
- completed task reports or anything under `.ai/history/`
- `.ai/reports/LATEST.md` (open only when the current task depends on what was just done)
- unrelated source directories
- entire repository
- generated files (`*_generated/`, `dist/`)
- dependency directories (`node_modules/`)

Human-facing documentation lives separately in `docs/` (`API.md`, `ARCHITECTURE.md`, `SECURITY.md`, `VELNOX_DESIGN_THEME.md`, …). Load it only when a task references it.

---

## Task Scope

Every task brief (`.ai/tasks/active/`) must define:

- objective
- allowed scope
- relevant context
- relevant source files/directories
- verification
- stop conditions
- expected output

If the task does not define these clearly, **stop and clarify** before making broad changes. Format: `.ai/tasks/TEMPLATE.md`.

---

## Safety Principle

A smaller context is preferred **only when it remains sufficient to understand the actual implementation**.

Never omit a file merely to make the task faster if that file is required to verify correctness.

**Accuracy comes before speed.**

---

## Layout

```
.ai/
├── AI_RULES.md          canonical rulebook — full read only for T2/T3
├── AI_HANDOFF.md        current state + unresolved issues — keep it small
├── README.md            this file
├── reports/
│   └── LATEST.md        ONE canonical report, overwritten per task
├── context/             load on demand (see tables above)
├── office/
│   ├── QUICK_START.md        startup entry point
│   ├── ESSENTIAL_RULES.md    always-on safety rules (every level)
│   ├── ARCHITECTURE.md · RUNBOOK.md · DECISIONS.md
│   ├── agents/               developer.md (AI 01) · architect.md (AI 02)
│   ├── context-management/   task-router · context-budget · compaction · selector
│   └── report-manager.ts     single-report writer
├── tasks/
│   ├── TEMPLATE.md      brief format
│   ├── active/          assigned work — read the current brief
│   └── completed/       finished reports — never auto-loaded
└── history/             reference only — never auto-loaded
    ├── AI_Handoff_Archive.md   dated index of superseded work
    ├── YYYY-MM-DD-*.md         legacy session records (read-only)
    └── archive/                verbatim long-form records + reports-legacy/
```

Related: `AGENTS.md` (root entry point), `INSTALLATION.md` (setup), `VELNOX_DESIGN_THEME.md` (design source of truth).
