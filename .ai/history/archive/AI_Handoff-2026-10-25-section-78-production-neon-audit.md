# Handoff §78 — Production Neon READ-ONLY audit + permanent change-audit-trail rules (2026-10-25)

> Moved **verbatim** from `.ai/AI_HANDOFF.md` on 2026-10-30 (edit-headroom housekeeping while
> appending §85 / Phase 2F). Nothing discarded. Its still-live conclusions are restated in the
> current-state pointer; the full audit stays at
> [`../2026-10-25-production-neon-audit.md`](../2026-10-25-production-neon-audit.md).

---

## §78. Production Neon READ-ONLY audit + permanent change-audit-trail rules (2026-10-25)

**Repo-side audit: PASS** — 0 `velrepeat`/`vrepeat` files in `apps/`, `backend/`, `packages/`; both
`db/*.sql` declare 63 tables and every table the checklist names (`users` stands in for customers —
there is no `customers` table); `git ls-files '*.sql'` = 2; `sql-reference-coverage.test.ts` = 5 pass.
Remaining `velrepeat` strings are comments (2), dated `.ai/` records and `docs/VELREPEAT_REMOVAL_PLAN.md`.

**Production Neon: NOT RUN / BLOCKED** — no production URL in this workspace **and** rule §17
forbids an agent from connecting on the owner's behalf. Real production state is UNKNOWN until the
owner runs the read-only query set in the report; do not report it as PASS. WARNING: the sanctioned
workflow `.github/workflows/production-db-verify.yml` probes only the checkout-group invariants, not
the 19 required Marketplace tables — a green run is partial evidence only.

Rules are permanent: `.ai/AI_RULES.md` **§17** (production DB read-only for agents) and **§18**
(every repo-changing task leaves a Change Report in `.ai/history/` and never claims an unrun check).
Report: [`.ai/history/2026-10-25-production-neon-audit.md`](history/2026-10-25-production-neon-audit.md).
