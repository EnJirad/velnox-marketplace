# FINAL_VERIFICATION.md — the verification ledger (§45/§46)

> **Status:** Phase 0-3 (audit, research, design) complete, and **Phase 4 (DB
> invariants) is implemented and verified** — see §3.1 for the measured evidence.
> Phases 5-17 have not started, so their rows below are `PENDING`, not `PASS`.
> This file is updated at the end of every phase and re-read at the end of the work.
>
> **§2 is the floor measured BEFORE any change and is never overwritten.** Current
> measurements live in the phase sections, so a regression is visible as a
> difference between the two rather than hidden by an edit.
>
> **Status vocabulary — used strictly.**
> `PASS` = the command was run in this workspace and succeeded ·
> `FAIL` = it was run and failed ·
> `BLOCKED` = it cannot be run here, with the exact reason ·
> `SKIPPED` = deliberately not run, with the exact reason ·
> `PENDING` = not yet attempted.
> `PASS` is never written for a check that was not executed.

---

## 1. Environment facts that constrain verification

| Fact | Evidence | Consequence |
|---|---|---|
| No Stripe credentials | `freebuff-env list` → `{"files":{}}` | real Stripe TEST E2E, PromptPay QR, live webhook delivery and a real refund are **BLOCKED** |
| No browser / test account | workspace has no browser, no `velnox_session` cookie can be minted, Checkout is provider-hosted | browser E2E of the hosted checkout is **BLOCKED** |
| No `NEON_PRODUCTION_DATABASE_URL`; GitHub App token 403 on secrets/workflow dispatch | prior records + this session's `git`/`gh` behaviour | applying or reading the migration in production is **BLOCKED**; only a disposable local PostgreSQL can be used |
| Local PostgreSQL 14 flaps | `service postgresql restart` then a 12-14 s wait is the fix; `connection refused` = infra flake, not a code failure | DB-gated tests are run after a restart, and a connection-refused run is re-run rather than reported |
| `bun run lint` is `echo 'Lint not yet configured'` | `package.json` | lint is reported as **SKIPPED — not configured**, never as PASS |
| `backend/tsconfig.json` excludes `tests` | `.ai/AI_HANDOFF.md` §6 | a test file is only validated when `bun test` parses it |
| Files > ~55 KB cannot be edited in place | `.ai/AI_HANDOFF.md` §6 | `backend/routes/products.ts` (3.8k lines) needs the scripted-rewrite recipe if it must change |

---

## 2. Baseline (measured before any change) — the regression floor

| Check | Command | Result |
|---|---|---|
| GitHub state | `git fetch origin`; `git rev-parse HEAD`; `git rev-parse origin/main`; `git ls-remote origin main` | **PASS** — all three `c44785b35c641a9f496e3057c33053bd9cf3620f`, branch `main`, tree clean |
| backend suite | `bun test backend/tests` (freshly reconciled disposable DB) | **PASS** — 2011 pass / 2 skip / 0 fail *(recorded in §70; re-run as the floor for this work)* |
| schema reconciler | `bun run db:verify` | **PASS** — exit 0, 52 PASS, ALL SCENARIOS PASSED |
| typecheck | `bun run typecheck` + `bun --filter @velnox/backend typecheck` | **PASS** — exit 0 |
| build | `bun run build:apps` | **PASS** — exit 0 (4/4) |
| i18n parity | `bun run i18n:check` | **PASS** — th/en/my all 1496 |
| whitespace | `git diff --check` | **PASS** — clean |
| lint | `bun run lint` | **SKIPPED — lint is not configured in this repository** |

---

## 3. Implementation checks (filled per phase)

| # | Phase | Check | Status |
|---|---|---|---|
| 4 | DB invariants | fresh bootstrap + 3× rerun no-op | **PASS** — §3.1 A |
| 4 | DB invariants | legacy-shaped seed preserved, backfill correct | **PASS** — §3.1 B |
| 4 | DB invariants | `db/verify-reconciler.sh` updated counts | **PASS** — §3.1 C |
| 4 | DB invariants | migration 056 applies to a PRE-056 database and converges on the canonical schema | **PASS** — §3.1 D |
| 4 | DB invariants | the commerce-core invariants are enforced BY THE DATABASE (23 cases) | **PASS** — §3.1 E |
| 4 | DB invariants | the two canonical files stay in contract with each other | **PASS** — §3.1 F |
| 4 | DB invariants | migration 056 applied to the canonical PRODUCTION database | **BLOCKED** — §6 (2) |
| 5 | Checkout | no client amount/seller/price accepted | PENDING |
| 6 | Order | projection totality + transition legality | PENDING |
| 7 | Payment | attempt lifecycle + settlement writes ledger/outbox | PENDING |
| 8 | Inventory | last-unit concurrency; movement replay | PENDING |
| 9 | Seller orders | cross-shop leak test | PENDING |
| 10 | Fulfillment | over-ship refused; partial shipment | PENDING |
| 11 | Refund / cancel | duplicate refund; cancel-after-paid; return→refund | PENDING |
| 12 | Events / webhooks | duplicate / retry / out-of-order / concurrent / stale reclaim | PENDING |
| 13 | Reconciliation | planted inconsistency found, nothing repaired | PENDING |
| 14 | Frontend | typecheck + i18n parity + both storefront pages render derived state | PENDING |
| 15 | E2E | §35 matrix counts | PENDING |
| 16 | Legacy cleanup | dependency grep before each deletion; suite green after | PENDING |
| 17 | Production | migration applied to the canonical database | PENDING |

---

## 3.1 Phase 4 evidence (DB invariants)

Every row below was executed in this workspace; the command and its observed
output are quoted. Nothing here is a projection.

| # | Check | Command | Observed |
|---|---|---|---|
| A | fresh bootstrap, three runs, no drift | `psql -v ON_ERROR_STOP=1 -f db/run-sqleditor.sql` ×3 | exit 0 each time; object counts `75\|296\|339\|807` identical after every run; final NOTICE names the nine tables, both order axes, both inventory axes, the fulfilled-quantity axis, the ledger trigger and the retry metadata |
| A2 | the reconciler proof | `bun run db:verify` | exit 0, **51 PASS / 0 FAIL**, `RECONCILER PROOF: ALL SCENARIOS PASSED` |
| B | a pre-existing row is never rewritten | `db:verify` scenario E | order rows byte-identical (`md5` unchanged), historic order number preserved verbatim, order count unchanged |
| C | the canonical counts are the ones recorded | `db:verify` scenarios A/C/D/G | expectations are enforced against `CANON="75\|296\|339\|807"`; scenario G derives its table count from `CANON` instead of a literal, so it cannot go stale on the next migration |
| D | the migration path and the bootstrap path agree | `git show 70c1596:db/run-sqleditor.sql` (the last PRE-056 revision — **not** `HEAD`, which is post-056 once this work is committed) → `db/migrations/056_…sql` → `db/run-sqleditor.sql` | `66\|244\|258\|653` → migration exit 0 → `75\|296\|339\|807` → rerun exit 0 → unchanged → reconciler over it exit 0 → unchanged |
| D2 | the two paths agree on the SHAPE, not only the count | the same two databases, compared field by field | **empty diff** across all 807 columns (`is_nullable`, `column_default`, `udt_name`), all 339 constraints (`pg_get_constraintdef`), all 296 indexes (`indexdef`) and both triggers (`pg_get_triggerdef`). A count can match while a nullability or a default silently differs — `orders.order_state` NOT NULL after one path and nullable after the other. This compares what the shapes **are**. |
| E | the invariants are enforced by the database | `bun test backend/tests/commerce-core-invariants.test.ts` | 23 pass / 0 fail / 47 expect calls. Each case executes the refused statement and asserts its SQLSTATE: `23514` CHECK, `23505` unique, `P0001` ledger trigger |
| F | the canonical files stay in contract | `bun test backend/tests/db-run-sqleditor-reconciler.test.ts` + the parity helper | 21 pass / 0 fail: every declared column has its `ADD COLUMN IF NOT EXISTS` pass, every index is created after the last column, no index sits in the table section, every `ADD CONSTRAINT` is guarded, the file stays additive, and PART 7b/PART 8 still assert rather than report |
| G | no regression in the existing suite | `bun test backend/tests` | **2035 pass / 2 skip / 0 fail**, 70 files, exit 0 (floor was 2011/2/0, 69 files) |
| H | typecheck, build, i18n, whitespace | `bun run typecheck`; `bun --filter @velnox/backend typecheck`; `bun run build:apps`; `bun run i18n:check`; `git diff --check` | all exit 0; build 4/4 `✓ built`; i18n `th=1496 en=1496 my=1496` |
| I | lint | `bun run lint` | **SKIPPED — lint is not configured in this repository** (`echo 'Lint not yet configured'`). Not a passing check |

Two defects were found by these checks and FIXED rather than accommodated:

1. the migration-056 structure had been appended to `db/run-sqleditor.sql` as a
   late `PART 9`, which put `ADD COLUMN` statements after the index pass and left
   the nine new tables with no column pass at all. It is now distributed into the
   passes the file is organised around (PART 1 tables, PART 2 columns, PART 3
   indexes, PART 5 constraints, PART 6 triggers), and the column pass for the nine
   new tables is generated from the snapshot.**No contract test was weakened.**
2. `orders_total_matches_parts_check` was written and then deliberately reverted:
   a production-shaped order can hold a total with no line breakdown, so the CHECK
   would have refused a row the application itself can produce — §43's "a
   constraint would reject valid data" condition. The relationship is reported by
   the reconcilers instead. It is absent from the migration and from both canonical
   files; `CANON` reflects the revert.

---

## 4. The §35 payment test matrix (20 cases)

**Every cell below is an EXPECTED outcome, not an observed one.** Phases 5-13
implement what these cases exercise; until then no cell in this table has been
run, and none of them may be quoted as a result.

| # | Case | Expected in this workspace |
|---|---|---|
| 1 successful card | DB/contract simulation **PASS**; real Stripe **BLOCKED — no keys** |
| 2 failed card | DB/contract **PASS** |
| 3 payment pending | **PASS** |
| 4 PromptPay (delayed notification) | unit + DB **PASS**; real QR **BLOCKED** |
| 5 webhook duplicate | **PASS** |
| 6 webhook retry | **PASS** |
| 7 webhook out-of-order | **PASS** |
| 8 redirect without webhook | **PASS** |
| 9 webhook without redirect | **PASS** |
| 10 payment expiration | **PASS** |
| 11 cancellation before payment | **PASS** |
| 12 cancellation after payment | **PASS** |
| 13 refund | DB/contract **PASS**; real provider refund **BLOCKED** |
| 14 partial refund | DB/contract **PASS**; real **BLOCKED** |
| 15 duplicate refund request | **PASS** |
| 16 duplicate checkout request | **PASS** |
| 17 concurrent checkout | **PASS** (two real connections) |
| 18 inventory race | **PASS** (two real connections) |
| 19 multi-seller purchase | **PASS** |
| 20 payment with multiple seller orders | **PASS** |

---

## 5. §36 failure simulations

| Simulation | Mechanism | Expected |
|---|---|---|
| database timeout | statement timeout injected / transaction aborted mid-way | nothing written; retry with the same key yields one result |
| provider timeout | spied provider client that stalls/fails | attempt `failed` + retry budget + reconciler finding |
| webhook timeout / duplicate / double delivery / late arrival | direct route invocations with a valid signature | duplicate = 200 no-op; late = incident, never a resurrection |
| frontend closes / browser refresh | no client state is authoritative | state unchanged and still correct |
| network disconnect after a successful charge | settlement only from the webhook | order settles when the webhook lands, not before |
| payment succeeds, frontend never returns | same as above | settled by the webhook; the success page converges on refetch |
| payment fails after redirect | failure webhook | `payment_failed`, stock released exactly once |
| inventory changes during checkout | concurrent seller edit | guarded reserve refuses/recomputes; no oversell |
| two customers buy the final unit | two connections | exactly one success; the other `409 INVENTORY_UNAVAILABLE` |

---

## 6. Remaining BLOCKED — the real reasons

1. **Real Stripe TEST-mode E2E** (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
   `STRIPE_WEBHOOK_SECRET` absent; provider-hosted Checkout needs a browser and a
   test account). Unblocks when the owner adds the three keys to the backend
   environment and registers the endpoint `POST /api/payments/stripe/webhook`.
2. **Production migration + verification** (`NEON_PRODUCTION_DATABASE_URL` absent;
   GitHub App token 403 on secrets and workflow dispatch). Unblocks when the
   canonical production database URL is available to the migration workflow, or
   when the owner pastes the migration into the Neon SQL Editor.
3. **Carrier API integration** — not implemented and not faked: booking with a
   carrier is an operator action in this rebuild.
4. **Rate limiting / CSRF token layer** — no such layer exists in the repository
   today; the rebuild does not claim one. Recorded as an open security gap.
5. **Stripe Connect / marketplace payout** — deliberately not built; the rebuild
   implements the internal ledger + payable + settlement the brief asks for.

---

## 7. Production readiness verdict

**NOT READY** — the verdict is one word only, and it is unchanged by Phase 4.
Phase 4 makes the SCHEMA ready; it does not make the SYSTEM ready. It holds until
all of the following are true:

1. migration 056 applied to the canonical production database and the reconciler
   counts asserted there (currently **BLOCKED**);
2. at least one real Stripe TEST round trip executed (checkout → webhook →
   settlement → refund) (currently **BLOCKED**);
3. the full backend suite + typecheck + build green on the frozen tree;
4. the six reconcilers run once against real data with the findings reviewed.

Until then the honest verdict is **NOT READY**, with the two BLOCKED items above
named as the reasons — not "ready with caveats".
