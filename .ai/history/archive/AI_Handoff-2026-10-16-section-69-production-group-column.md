# Handoff §69 — production `payments.checkout_group_id` (archived 2026-10-16)

Moved **verbatim** out of `.ai/AI_HANDOFF.md` while adding §78 (store accounts + gated
wholesale). Its status is unchanged and still the owner's to clear: **BLOCKED**.

---

## §69. Production `payments.checkout_group_id` — the gap is real, applying it is **BLOCKED** (2026-10-05)

**Second, independent incident on the same missing column.** Order
`2aa736e9-0010-43c2-8f0e-19142b25189b` / `017911658804352200`, PromptPay, group
`c86fb8fe-758d-4907-aedf-3e8f6bde8de2`. Production logged `[checkout-group] payments.checkout_group_id is
missing — apply db/run-sqleditor.sql (migration 054).` with `code: 42703`, `failure_stage:
group_column_missing`, `stripe_session_id: null`. **That log line is the §68 guard working** — production ran the
fixed build, the probe saw the column absent, and it refused with 503 *before* Stripe. The build is current; the
**database** is not.

**Root cause confirmed: production Neon never received migration 054 §3.**

**Source of truth for `payments.checkout_group_id`** — from `db/migrations/054_…sql` §3, `db/schema.sql:460` and
`db/run-sqleditor.sql:461,1378,3416-3421,4035-4036`: `UUID`, **nullable** (no `NOT NULL`), FK
`payments_checkout_group_id_fkey` → `checkout_groups(id) ON DELETE SET NULL`; indexes `idx_payments_checkout_group`
(partial) and the unique partial `idx_payments_one_active_stripe_group`; it participates in
`payments_at_least_one_parent_check` + `payments_single_domain_check`; and `payments.order_id` becomes NULLABLE.
§3 also drops `payments_exactly_one_parent_check`. **Nothing was changed** — the repository was already consistent,
and no datatype, constraint or index was invented.

**Repository side: COMPLETE.** `db/schema.sql` ↔ `db/run-sqleditor.sql` declaration parity passes
(`backend/tests/helpers/canonical-schema.ts`), `db/run-update.sql` does not exist, and `db/verify-reconciler.sh`
**scenario H reproduces this exact production shape** — a populated `payments` with real Stripe rows and the column
dropped — then proves the statement 42703s before, runs clean after, leaves the payment row, its provider ids and its
`paid` settlement state untouched, never re-points it at the group, and is idempotent on a second run. `bun run
db:verify` → `RECONCILER PROOF: ALL SCENARIOS PASSED` (52 PASS / 0 FAIL).

**New regressions (4, `backend/tests/checkout-group-session-open.test.ts`, 14 → 18).** The single-shop rail was
**uncovered**, which is the risk 054 §3 itself creates — it makes `order_id` nullable and swaps the parent CHECK:
**(1)** one order still opens a session and records `order_id` with `checkout_group_id IS NULL`, the session id, and a
row satisfying `payments_at_least_one_parent_check` (old constraint gone); **(2)** a retry with a FRESH idempotency key
reuses that session — one `sessions.create`, one active attempt; **(3)** the reported order's exact state (group +
orders, **no** payment row) reads **not paid** on `GET /api/orders/:orderId`; its retry opens exactly one attempt with
the session recorded and `paid_at` null, a second retry reuses it, and no order is ever `paid`; **(4)** static — the
open path between the two `app.post` registrations contains **no** `paid` write at all, so a missing column can never be
"fixed" by paying an order Stripe never charged. Suite: **1992 pass / 2 skip / 0 fail**, typecheck 4/4 + backend 0,
build 4/4, `db:verify` 52/0, `git diff --check` clean.

**PRODUCTION: NOT APPLIED — BLOCKED, and it must be reported as such.** `NEON_PRODUCTION_DATABASE_URL` is absent:
`freebuff-env list` returns no keys, the GitHub App token gets **403** on both `secrets` and `workflow_dispatch`, and
CI run **37249675032** of `Production DB Verify` fails with `##[error]BLOCKED: NEON_PRODUCTION_DATABASE_URL is not
configured.` — the identical pre-change baseline. The repository therefore **cannot prove** the migration reaches the
same Neon Render serves, and no Stripe TEST E2E was executed. **The payment architecture was not changed**: no
multi-shop removal, no single-shop fallback, no bypassed column, no session-before-payment-row, no disabled schema
validation, no 42703 catch-and-pass, no frontend "paid", no blind retry, no sleep, no disabled idempotency.

**Owner action — unchanged, and still the whole remaining gap.** Create the `NEON_PRODUCTION_DATABASE_URL` secret
pointing at the SAME Neon project/branch Render's `DATABASE_URL` uses, confirm the printed identity against the
backend's boot `[db]` line, then run `db/run-sqleditor.sql` (or `db/migrations/054_*.sql`) via
`production-db-migrate.yml`; `Production DB Verify` must then go BLOCKED → PASS on all 11 objects. Only then can a
real PromptPay TEST round trip be attempted. **STATUS: BLOCKED — never PASS.**

**Verified on a real database reconciled by `db/run-sqleditor.sql`** (disposable, dropped after): the incident's exact
statement — `SELECT id FROM payments WHERE checkout_group_id = $1 AND provider = $2 ORDER BY created_at DESC LIMIT 1`
(verbatim `backend/routes/stripe.ts:844-851`) — answers `ERROR: column "checkout_group_id" does not exist` when the
column is absent and returns the attempt id when it is present, so it is a real detector, not a tautology. All of
054 §3 lands: column `uuid`/nullable, both `ON DELETE SET NULL` FKs, the group indexes, both payment CHECKs,
`payments.order_id` nullable.

**One hazard found while proving it (NOT a production blocker).** `db/run-sqleditor.sql:4038` adds
`payments_at_least_one_parent_check` under `ON_ERROR_STOP`, guarded only by a name check: if any `payments` row has
`order_id`, `plan_id` and `checkout_group_id` **all** NULL the reconciler aborts mid-file and the rest — including the
PART 8 self-assertion — never runs. Production cannot reach that state (`payments_exactly_one_parent_check`, migration
051, has always required exactly one of `order_id`/`plan_id`, and a parentless INSERT is rejected on a reconciled
database). Only a database that stored a group payment and then lost the column can hit it.
