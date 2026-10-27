# AI_HANDOFF archived sections — §76, §78 and §79 (moved 2026-10-27)

Verbatim text moved out of [`.ai/AI_HANDOFF.md`](../AI_HANDOFF.md) on 2026-10-27 to stay
under the ~55 KB edit-tool ceiling. Nothing was edited or deleted; index rows live in
[`.ai/history/AI_Handoff_Archive.md`](../AI_Handoff_Archive.md).

- **§76** — VelRepeat removal + repository cleanup + SQL consolidation (2026-10-23): superseded as
  *current state* by the later audits (§77, §78) but kept here as the record of what was removed and
  how the two canonical SQL files were produced.
- **§78** — Production Neon READ-ONLY audit + the permanent change-audit rules (2026-10-25): the
  rules themselves live in `.ai/AI_RULES.md` §17/§18; the full query set and report remain at
  [`.ai/history/2026-10-25-production-neon-audit.md`](../2026-10-25-production-neon-audit.md).
- **§79** — Phase 1 UI/UX + Realtime Professional Audit (2026-10-26): audit-only; its findings drove
  Phase 2A (§80) and Phase 2B (§81), and the full report remains at
  [`.ai/history/2026-10-26-ui-realtime-professional-audit.md`](../2026-10-26-ui-realtime-professional-audit.md).

---

## §76. VelRepeat REMOVED + repository cleanup + SQL consolidation to two canonical files (2026-10-23)

**Base SHA:** `af9841b0daa0b2b29feba890a7c36dfdd229e8d2` (= `origin/main` at task start; local HEAD
== remote at fetch time, working tree changes only, no branch divergence).
**Resulting commit SHA:** `cc3e9eacff063585d35b22428cf81723c795ad86` (the cleanup commit — this
file cannot carry its own commit hash, so the SHA is recorded here in the follow-up `docs(ai)` commit
that touches only this line).

**What went — VelRepeat at every layer:** the 6 backend route modules + both schedulers +
`lib/velrepeat-{cycles,pricing}.ts`; velShop `VelRepeatPage` / `VelRepeatV2Page` /
`VelRepeatPlanDialog` / `SubscriptionDialog` and every nav/menu/help/checkout entry point; the
`VELREPEAT_ENABLED` switches (only `CUSTOMER_MEMORY_ENABLED` remains in the two `features.ts`);
VelRepeat i18n keys, `api-routes.ts` entries and tests; `.ai/context/velrepeat-contract.md` + the
VelRepeat audit/task briefs; and from the schema: **12 tables** (`velrepeat_*`, `vrepeat_*`,
`subscriptions`), **12 columns** (nine `vrepeat_*` on `products`, `velrepeat_run_id`/`velrepeat_cycle_id`
on `orders`, `plan_id` on `payments` and `payment_incidents`), **62 indexes**, **78 constraints**.
Shared payment, order, shipment, inventory, refund and billing logic and ALL Stripe infrastructure
were preserved — only VelRepeat-specific behavior was removed.

**SQL consolidation.** Exactly **two `.sql` files** remain: `db/schema.sql` (canonical snapshot for
a fresh DB) and `db/run-sqleditor.sql` (rerunnable additive reconciler for an existing DB), plus
`db/verify-reconciler.sh`. `db/migrations/` deleted; `db:migrate`, both production workflows,
`INSTALLATION.md`, `README.md`, `docs/*`, `.ai/context/*` and `.ai/AI_RULES.md §6` re-pointed at the
two files (the old `migrate-neon.yml` / `NEON_DATABASE_URL` instructions are gone).
`db/verify-reconciler.sh` `CANON` re-measured on a real fresh PG14: **`63|234|261|653`**.
Schema-integrity restorations this pass: `payments_single_domain_check` kept as a plan-free
invariant (order XOR group) with a guarded reconciler pass; `payment_incidents_order_parent_check`
(data-guarded) replaces the legacy order-XOR-plan check; the stale `idx_payments_plan` /
`idx_payments_one_active_stripe_plan` / `idx_payment_incidents_plan` CREATE INDEX statements were
removed from the reconciler (they referenced a column no table declares — a fresh bootstrap would
have failed).

**New guard:** `backend/tests/sql-reference-coverage.test.ts` — every table, index and function the
backend's SQL names must be declared by `db/schema.sql`, and every declared function must be used.

**Verification (executed this pass, real output):**

| Check | Result |
|---|---|
| `bun run typecheck` (velshop · velseller · velcenter · velnox) | exit 0 |
| `bun --filter @velnox/backend typecheck` | exit 0 |
| `bun run i18n:check` | th=1249 en=1249 my=1249 — parity (was 1496; the delta is the removed VelRepeat keys) |
| `bun test backend/tests` (no DB) | 987 pass / 303 skip / 0 fail |
| `bun test backend/tests` + local PostgreSQL 14 (`TEST_DATABASE_URL`) | **1284 pass / 2 skip / 0 fail**, exit 0 |
| fresh `psql -v ON_ERROR_STOP=1 -f db/run-sqleditor.sql` on empty PG14, then again | exit 0 · exit 0 (idempotent) |
| `bash db/verify-reconciler.sh` | **52 PASS — ALL SCENARIOS PASSED**, exit 0 |
| `bun run build:apps` | 4/4 exit 0 |
| `git diff --check` | clean |
| `.sql` files in repo | exactly 2 |
| final tracked-file velrepeat sweep | only dated records (`.ai/history/`, `.ai/audit/`, `.ai/rebuild/`, `.ai/tasks/completed/`), the §75/§76 pointers in this file, the active brief's supersession note, `docs/VELREPEAT_REMOVAL_PLAN.md`, and two explanatory comments (one in `db/run-sqleditor.sql`, one in `db/verify-reconciler.sh`) — **zero executable VelRepeat code, routes, jobs, tests or SQL objects** |

**Legacy database objects were NOT touched** — the cleanup never connected to any database.
Reviewable plan for an existing database (inventory → archive → constraint swap → drop columns →
drop tables → verify): **`docs/VELREPEAT_REMOVAL_PLAN.md`**. The reconciler itself carries no
VelRepeat statement, so running it after that plan stays a no-op.

**Remaining gaps / blockers (unchanged unless noted):** production reconcile + verify **BLOCKED**
(no `NEON_PRODUCTION_DATABASE_URL` reachable from this workspace) · real Stripe TEST E2E **BLOCKED**
(no keys, no browser) · `bun run lint` not configured · the legacy plan above is owner-
executed later · ~30 explanatory comments in `backend/**` and the dated records still name old
migration numbers as historical anchors (they reference no file and are documented exceptions).

---

## §78. Production Neon READ-ONLY audit + permanent change-audit-trail rules (2026-10-25)

**Base SHA:** `964156db6241704d61954a52799485d345c6d013` (`main` == `origin/main`, 0/0, clean).
**Resulting commit:** `9d3a6418c27cb385c1b8912328cceb8bebc68613` (pushed; 7 files, `.ai/*.md` only).
**Report:** [`.ai/history/2026-10-25-production-neon-audit.md`](../2026-10-25-production-neon-audit.md).
**Nothing was connected to, executed against, or changed in any database. No code, schema or SQL
file was modified — this pass wrote only `.ai/` Markdown.**

**Repo-side audit (executed): PASS.** `velrepeat`/`vrepeat` = 0 files in `apps/`, `backend/`,
`packages/`; `CREATE TABLE … velrepeat` = 0 in both SQL files; `run-update` = 0 in executable
files; both `db/*.sql` declare **63** tables and every table the audit checklist names
(`users` stands in for customers — `users.role='customer'`, there is no `customers` table);
`git ls-files '*.sql'` = 2; `bun test backend/tests/sql-reference-coverage.test.ts` = **5 pass /
0 fail**. Remaining `velrepeat` strings: 2 comments (`db/run-sqleditor.sql:3757-3758`), 38 files
under `.ai/` (dated records) and `docs/VELREPEAT_REMOVAL_PLAN.md`.

**Production Neon: NOT RUN / BLOCKED.** No `NEON_PRODUCTION_DATABASE_URL` exists in this
workspace (`freebuff-env list` is empty) **and** rule §17 forbids an AI from connecting to the
production database in the owner's place. Real production state is **UNKNOWN** until the owner
runs the read-only query set in the report (§11). Do not report it as PASS.

**WARNING — the sanctioned verifier does not answer the checklist.**
`.github/workflows/production-db-verify.yml` is genuinely read-only and owner-runnable, but it
probes only `checkout_groups`, the two `checkout_group_id` columns, provider idempotency columns,
the FK delete rules, the group indexes, the payments CHECKs and `schema_migrations`. It does **not**
probe the 19 required Marketplace tables, VelRepeat leftovers, or the `run-update` ledger. Treat a
green run as partial evidence only; the report's query set covers the gap. (Not fixed on purpose:
this pass was audit-only.)

**Rules are now permanent (again docs-only):** `.ai/AI_RULES.md` **§17** (production DB is
read-only for agents; never connect on the owner's behalf; report `NOT RUN`/`BLOCKED`) and
**§18** (every repo-changing task must leave a Change Report in `.ai/history/` with the 20
required fields, update this handoff, and never claim an unrun check passed). `.ai/README.md`
points at both.

**Open / next:** owner runs the read-only queries and confirms the production identity ·
production reconcile + verify **BLOCKED** · real Stripe TEST E2E **BLOCKED** (no keys/browser) ·
`bun run lint` not configured · legacy VelRepeat objects in a real database are still removed only
by the owner via `docs/VELREPEAT_REMOVAL_PLAN.md` (backup + approval first).

---

## §79. Phase 1 — UI/UX + Realtime Professional Audit (2026-10-26) — **AUDIT ONLY**

**Base SHA:** `f71dcfd2fe26c7c92d94eb2ef7d7418f1c82d4d1` (`main` == `origin/main`, 0/0, clean).
**Resulting commit:** `903501f4594e4d30d3918e579fe39b65c540ef9a` (the audit commit; its SHA is recorded here in the follow-up `docs(ai)` commit).
**Report:** [`.ai/history/2026-10-26-ui-realtime-professional-audit.md`](../2026-10-26-ui-realtime-professional-audit.md).
**Nothing was modified except `.ai/` Markdown.** SOURCE CODE MODIFIED: **NO** · DATABASE MODIFIED: **NO** ·
SQL MODIFIED: **NO** · PRODUCTION DB CONNECTED: **NO**.

**Verdict:** the systems exist and the payment/order core is sound, but production-grade interaction
quality is not reached. 1 P0, 18 P1, 14 P2, 4 P3. VelShop is the most mature surface; VelSeller
mobile navigation and VelCenter realtime are broken; support is a shop account, not a support desk.

**Highest-impact findings (full evidence in the report):**
- **P0** VelSeller mobile has **no chat entry**: `SELLER_TABS` has no chat item and the header nav is
  `lg:` only. A chat notification can route to the thread, but a phone-only seller has no reliable way
  to open the inbox.
- **P1** VelCenter's socket connects to `ws(s)://<origin>` with **no `/ws`**; the server accepts only
  `/ws`, so every “live” queue badge is manual-refresh. Reproduced locally: 400 / close 1006.
- **P1** `ShopChat` / `SellerChat` call `disconnectChatSocket()` on unmount, killing the shared
  header-bell socket with no reconnect — notifications stop until a reload.
- **P1** `order:updated` has **no customer or seller consumer**, `shipment:updated` has **no consumer**,
  and no order/payment/shipment **notification rows** are ever inserted.
- **P1** errors render as **empty states** (MyOrders, notifications, seller orders, cart) or an infinite
  spinner (Income); order history is truncated at 50/50/100 with no pagination.
- **P1** Buy Now ignores `buyNowQty` (charges the cart quantity) and cart quantity PUTs race.
- **P1** support staff cannot use VelCenter (`CENTER_ROLES` excludes `support`) and seller→support has
  no UI. A real staffed desk needs a **SCHEMA CHANGE** (`chat_messages.sender_role`, assignment/priority).

**Realtime:** transport is hardened (cookie auth, 30 s revocation sweep, per-user channel, frame and
send-rate limits) but its **browser lifecycle** is not; there is no heartbeat and no resync after
reconnect; `notification:created` is a public channel carrying employee events.

**Responsive:** **static analysis only** — no browser/screenshot capability here. The 320/375/430
notification panel is clipped off-screen, VelSeller loses all page navigation at 768–1023 px, and the
chat `min-h` floors push the composer below the keyboard on short screens. The visual matrix is
**NOT RUN**, not passed.

**Chat:** customer↔seller and customer↔support exist; seller↔support is missing; support↔VelCenter is
missing. Full relationship/authorization/UX matrix in report §6.

**Checks run:** git in sync + clean · `bun run i18n:check` **PASS** (`th=1249 en=1249 my=1249`) · local
`ws` path probe **CONFIRMED** · source sweeps · docs-only diff check. No app test/build was run because
no code changed.

**Open / next:** implementation order in report §8 — stability → broken UX → realtime correctness →
chat fundamentals → responsive → polish. The support model decision gates Phase D. Do **not** add a
second socket, chat API, conversation table or notification system.
