# Archived handoff section — §71 (moved 2026-10-17, verbatim)

Moved out of `.ai/AI_HANDOFF.md` while adding §79 (edit-headroom housekeeping).

---

## §71. Production e-commerce full-system rebuild — phases 0-4 DONE, 5-17 not started (2026-10-06)

**PHASE 4 (DB invariants) IS DONE AND VERIFIED; phases 5-17 have not started.** The 13 required
design documents live in **`.ai/rebuild/`** — that directory is the authority for this
work, and `FINAL_VERIFICATION.md` is the ONLY record of what passed: its §2 is the untouched
pre-change floor and its §3.1 the Phase 4 evidence. Read `CURRENT_ARCHITECTURE.md` (evidence-backed
audit, findings A1-A19), `TARGET_ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `STATE_MACHINES.md` and
`MIGRATION_PLAN.md` (the 17-phase plan and its gates).

**Phase 4 shipped** `db/migrations/056_commerce_core_invariants.sql` — additive and rerunnable: the 9
new tables, both order axes, the SAME four counters on BOTH stock axes, the ledger append-only trigger
and the retry metadata. No `DROP CONSTRAINT` and no `DROP INDEX` anywhere in it. It is mirrored into
BOTH canonical files and **distributed into the reconciler's real passes**, never a late block — a late
block puts `ADD COLUMN` after the index pass and the contract tests refuse it.
`db/verify-reconciler.sh` expects `75|296|339|807` and derives scenario G's table count from `CANON`
instead of a literal. `commerce-core-invariants.test.ts` asserts the SQLSTATEs.

`orders_total_matches_parts_check` was written and DELIBERATELY REVERTED — §43's "a constraint would
reject valid data": a production-shaped order can hold a total with no line breakdown. Do not
reintroduce it; the reconcilers report the relationship instead.

**Blocker status unchanged — not PASS:** Stripe TEST E2E **BLOCKED** (no keys; `freebuff-env list` →
`{"files":{}}`); production migration **BLOCKED** (no `NEON_PRODUCTION_DATABASE_URL`). `bun run lint` is
**not configured**. §39's `db/run-update.sql` demand conflicts with `AGENTS.md` rule 4 — that file stays
absent; only `db/schema.sql`, `db/run-sqleditor.sql` and `db/migrations/056_*.sql` get written.

Next: **Phase 5 (Checkout)**, then 6-17 per `MIGRATION_PLAN.md` §3. Re-read §2 and §3.1 of
`FINAL_VERIFICATION.md` first: a regression is a difference from §2, never from the last edit.

---
