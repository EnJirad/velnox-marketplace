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
2. Read `.ai/AI_RULES.md`
3. Read `.ai/AI_HANDOFF.md`
4. Identify the assigned task
5. Read that task's brief from `.ai/tasks/active/`
6. Read ONLY the context files listed by the task
7. Inspect the actual source files required by the task
8. Make the smallest safe change
9. Run the task-specific verification (`.ai/context/testing.md`)
10. Check stop conditions
11. Update `.ai/AI_HANDOFF.md`
12. Produce a concise task report
13. Commit only verified changes (`.ai/context/workflow.md`)

`AGENTS.md` at the repo root is the short entry point for tools that look for it; it points here.

---

## Context Loading Policy

**Always read**

- `.ai/AI_RULES.md`
- `.ai/AI_HANDOFF.md`
- the current task brief

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
- completed task reports
- unrelated source directories
- historical documentation (`.ai/history/`)
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
├── AI_RULES.md        canonical rulebook — mandatory
├── AI_HANDOFF.md      current state + remaining gaps — keep it small
├── README.md          this file
├── context/           load on demand (see tables above)
├── tasks/
│   ├── TEMPLATE.md    brief format
│   ├── active/        assigned work — read the current brief
│   └── completed/     finished reports — never auto-loaded
└── history/           reference only — never auto-loaded
    ├── AI_Handoff_Archive.md   dated index of superseded work
    └── archive/                verbatim long-form records
```

Related: `AGENTS.md` (root entry point), `INSTALLATION.md` (setup), `VELNOX_DESIGN_THEME.md` (design source of truth).
