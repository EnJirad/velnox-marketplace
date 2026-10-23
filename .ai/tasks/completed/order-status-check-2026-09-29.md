# MEDIUM #9 — `orders.status` CHECK constraint (2026-09-29)

## 1. Task

Audit MEDIUM #9 exactly as recorded in `.ai/AI_HANDOFF.md` §42.2:

> `orders.status` has no CHECK constraint

Make PostgreSQL refuse a value that is not a state the order domain actually knows — **without**
changing the state machine, the payment architecture, the fulfilment architecture, or any business
policy.

## 2. Starting SHA

`08e72e1062f5972813341ab6049ec8d3da0ecbc8` — local HEAD == `origin/main`, tree clean
(`git rev-list --left-right --count HEAD...origin/main` → `0  0`).

## 3. Ending SHA

`61d7b509bd607226066b8c4d211f3539f9fb7122` (the CI-green head). Implementation commit
`619747f32b56ba722e13be6b0882a8bae515cf50`, test-fix commit `61d7b50…`.

## 4. Branch

`main` (default branch). No feature branch was created — the repository convention pushes
repository-changing tasks straight to `main`.

## 5. Repository state

In sync with the remote, clean tree, no local work to preserve. The previous task (audit HIGH #5,
late-payment operator flow) was committed and green, so this task started from a verified base.

## 6. Documents read

- `AGENTS.md`
- `.ai/AI_RULES.md` (sections enumerated; §0 sync, §6 database rules, §13 verification, §14 git)
- `.ai/AI_HANDOFF.md` (§42.2 finding index, §47 HIGH #5)
- `.ai/context/workflow.md` (the completion lifecycle)
- `.ai/context/payment.md` and `.ai/context/testing.md` were consulted for the payment-lifecycle and
  test-isolation rules that bound this change
- `.ai/tasks/completed/payment-failed-retry-2026-09-29.md` (HIGH #4)
- `.ai/tasks/completed/late-payment-operator-2026-09-29.md` (HIGH #5)

## 7. Actual allowed statuses — derived from the writers, not chosen here

Twelve values, the union of the two lifecycles `orders.status` deliberately carries.

### Fulfilment (7) — `backend/lib/order-fulfillment.ts` `FULFILLMENT_STATUSES`

| status | written by |
|---|---|
| `pending` | `routes/cart.ts` INSERT (checkout), `jobs/velrepeat-scheduler.ts` INSERT |
| `confirmed` | `routes/seller-orders.ts:617`, `routes/center.ts:517` (`status = $1`) |
| `packing` | same two parameterized transition routes |
| `shipped` | same two parameterized transition routes |
| `delivered` | same two parameterized transition routes |
| `completed` | same two parameterized transition routes |
| `cancelled` | `routes/cart.ts:1369` (customer cancel), `routes/stripe.ts:657`, the expiry sweep, seller/center transitions |

The two parameterized writers are **not** an open door: both call `canTransitionFulfillment()` in the
same transaction before the `UPDATE`, and that function returns `false` for any `from`/`to` outside
`FULFILLMENT_STATUSES`. Neither can produce a value outside this list.

### Payment lifecycle (5)

| status | written by |
|---|---|
| `pending_payment` | `routes/stripe.ts:1394` (Checkout Session created) |
| `paid` | `routes/stripe.ts:431` (payment_intent.succeeded) |
| `payment_failed` | `routes/stripe.ts:610` (payment_intent.payment_failed) |
| `refunded` | `routes/stripe.ts:764` (full refund) |
| `expired` | `jobs/payment-reservation-scheduler.ts:149` via `PAYMENT_RESERVATION_EXPIRED_STATUS` |

`expired` is an **orders.status** value, not a payments.status one: the sweep claims the order row
with a guarded `UPDATE orders SET status = $2` and writes this column.

## 8. Every status writer inspected

| file | line | writes | inside the allowed set |
|---|---|---|---|
| `backend/routes/cart.ts` | 88 | INSERT `'pending'` | ✅ |
| `backend/routes/cart.ts` | 1369 | `'cancelled'` (customer cancel, guarded) | ✅ |
| `backend/routes/stripe.ts` | 431 | `'paid'` (guarded `WHERE status IN (...)`) | ✅ |
| `backend/routes/stripe.ts` | 610 | `'payment_failed'` | ✅ |
| `backend/routes/stripe.ts` | 657 | `'cancelled'` (abandoned session) | ✅ |
| `backend/routes/stripe.ts` | 764 | `'refunded'` | ✅ |
| `backend/routes/stripe.ts` | 1394 | `'pending_payment'` | ✅ |
| `backend/routes/seller-orders.ts` | 617 | `$1` — gated by `canTransitionFulfillment()` | ✅ |
| `backend/routes/center.ts` | 517 | `$1` — gated by `canTransitionFulfillment()` | ✅ |
| `backend/jobs/payment-reservation-scheduler.ts` | 149 | `$2` = `'expired'` | ✅ |
| `backend/jobs/velrepeat-scheduler.ts` | 270 | INSERT `'pending'` | ✅ |

Two `UPDATE orders` statements that look like status writers were checked and **do not touch
`status`**: `backend/lib/inventory.ts:206` writes only `inventory_released`, and
`backend/lib/payment-reservation.ts:139` writes only `payment_expires_at` / `reservation_policy`.

No writer exists in `apps/*` — the frontends go through the API, and the API never forwards a
client-supplied status value.

## 9. Legacy statuses found

**One, and it is not written to `orders.status`: `failed`.** It appears only in
`RELEASABLE_STATUSES` (`backend/lib/inventory.ts:164`), a **read-side** guard listing statuses whose
reserved stock may still be released. No writer anywhere produces it — this is audit **LOW #12**
("`failed` is dead in `RELEASABLE_STATUSES`"). Adding it to the CHECK would bless dead code into the
schema, so it was deliberately **excluded** and a test pins that exclusion.

No other legacy value was found. Nothing is written from documentation, an old test, or a comment
only.

### A history that must be recorded

`orders.status` **did** once have a CHECK:

- **V0003** (`db/migrations/003_customer.sql:42`) declared
  `CHECK (status IN ('pending','confirmed','processing','shipped','delivered','cancelled'))`.
- That list never included `packing`, `completed`, or any payment-lifecycle value, so the real
  writers began failing.
- **V0016** (`db/migrations/016_sync_schema_discrepancies.sql:26`) therefore ran
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;` — with the comment
  *"The backend uses status values not in V0003's CHECK list"*.

So this task is a **re-add with a correct list**, not a new invention. The old list is also why
`processing` (a VelRepeat/payments value) must not come back. Both facts are pinned by a test.

## 10. State-machine source of truth

`backend/lib/order-fulfillment.ts` — declared as *"the ONE authority"*. It owns
`FULFILLMENT_STATUSES`, `FULFILLMENT_TRANSITIONS`, `TERMINAL_FULFILLMENT_STATUSES`,
`normalizeOrderStatusToFulfillment()`, `canTransitionFulfillment()`, and the payment / shipment /
cancellation gates. `packages/shared/src/lib/commerce.ts` mirrors it for the UI
(`NEXT_ORDER_STATUSES`, `ORDER_STATUS_META`).

**Nothing in either file was modified by this task.**

## 11. Root cause of MEDIUM #9

`orders.status` was declared `status TEXT NOT NULL DEFAULT 'pending'` with **no** CHECK, while every
other status column in the same schema has one (`sellers.status`, `verification_status`,
`velrepeat_plans.status`, `velrepeat_runs.status`). Free text means a typo, a retired code path, or a
hand-edited row can store a value no state machine, query, or UI knows — and
`normalizeOrderStatusToFulfillment()` answers `"pending"` for anything unrecognised, so the row looks
*un-actioned* rather than *broken*. Nothing surfaces the defect: the order simply sits where nothing
can move it. The absence was a leftover of the V0016 drop (§9), never a deliberate design.

## 12. Constraint design

Minimal, in the repository's existing style (`<table>_<column>_check`, as used by
`sellers_status_check` and `velrepeat_plans_status_check`):

```sql
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'confirmed', 'packing', 'shipped', 'delivered',
                    'completed', 'cancelled', 'pending_payment', 'paid',
                    'payment_failed', 'refunded', 'expired'));
```

- **No trigger, no enum type, no state table, no application-level replacement** — a test asserts
  the migration's executable SQL contains exactly two statements and none of those constructs.
- **No transition encoding.** A test proves the point against a real database: `completed → pending`
  is a move with no edge in `FULFILLMENT_TRANSITIONS`, and the constraint **accepts** it, because
  deciding transitions is `canTransitionFulfillment()`'s job under a `FOR UPDATE` lock. The CHECK only
  decides whether a value exists in the domain.
- **Idempotent** — `DROP … IF EXISTS` then `ADD`, matching V0044's repair style.

## 13. Schema changes

- `db/schema.sql`: the `orders` table now declares the CHECK **inline** (matching how
  `sellers` / `velrepeat_plans` do it), **and** the idempotent `ALTER` pair was appended to the
  existing *"Constraint repairs (idempotent, safe to re-run)"* section, so a bootstrap also
  self-heals a database created before the constraint existed — `CREATE TABLE IF NOT EXISTS` never
  alters an existing table.
- `db/run-sqleditor.sql`: the identical two edits.
- `db/run-update.sql`: **not touched** (deprecated; never created, edited, or referenced). A test
  still asserts no non-test backend file depends on it.

## 14. Migration

`db/migrations/050_orders_status_check.sql` — **V0050**. The number was read from the repository, not
assumed: `ls db/migrations/ | tail` showed `049_payment_incidents.sql` as the highest, so the next
free number is 050. Migrations 048 and 049 were **not** modified, and none was applied to production.

The header documents the derivation, the deliberate exclusions (`failed`, `payments.status` values),
and the data-safety rule: unlike V0044 this **narrows** the set, so if any historical row carries an
out-of-set value the statement **fails loudly** rather than silently rewriting an order's business
state, and the header gives the exact diagnostic `SELECT` to run first.

## 15. schema.sql parity

`diff db/schema.sql db/run-sqleditor.sql` → **no output** (byte-identical). Verified after the edits
and again before the commit.

## 16. Test design

New file `backend/tests/order-status-check-constraint.test.ts`, 26 tests in two halves, following the
suite's established split (DB-free contract block that always runs; DB-gated block behind
`hasTestDatabase()`).

**Contract half (17, runs everywhere):**
1. the allowed set is built from `FULFILLMENT_STATUSES` plus the payment writers, never hard-coded;
2. every status `stripe.ts` writes as a SQL literal is in the set — re-derived by scraping the file,
   with a guard that a refactor of the SQL shape fails loudly instead of matching nothing;
3. both order-creating `INSERT`s write allowed values;
4. `expired` is confirmed as a real orders.status value with its writer;
5. every payment status in the set has a real writer in the code;
6. `payments`-only statuses (`processing`, `requires_action`, `partially_refunded`, `succeeded`) and
   the dead `failed` are **not** in the set;
7. no duplicates, no stray whitespace;
8. both canonical files are byte-identical and declare exactly the derived set;
9. a fresh `CREATE TABLE` carries it inline;
10. the migration exists, is idempotent, declares the set, contains **no** `UPDATE orders`, and is the
    **only** migration that `ADD`s the constraint;
11. V0050 is the highest number, used once, and no new collision was introduced (the four legacy
    duplicates 029/030/034/035 are asserted as historical, not as a new defect);
12. the V0003/V0016 history is pinned;
13. it is a plain CHECK — executable SQL only, exactly two statements, no trigger/enum/table;
14. the state machine authority is untouched (`canTransitionFulfillment`, terminal set, both gates,
    `lockOrderRow`, and the `payment_failed` writer all still present).

**DB-gated half (9, requires `TEST_DATABASE_URL`):**
1. `pg_constraint` really holds `orders_status_check`, with the derived value set;
2. **every** allowed status `INSERT`s and reads back;
3. **every** allowed status `UPDATE`s onto an existing row;
4. `status = '__INVALID_ORDER_STATUS__'` on INSERT → **23514**, `constraint = orders_status_check`,
   `severity = ERROR`, and zero rows written;
5. the same on UPDATE → **23514**, and the row still reads its previous status;
6. near-misses (`PAID`, `Pending`, `" pending"`, `"pending "`, `""`, `ship`, `deliverd`, `payed`) are
   all refused — the set is exact, not a prefix match;
7. a legal status reached by an **illegal transition** (`completed → pending`) is still **accepted**
   — the CHECK is not the transition table;
8. the guarded shapes the shipped flows use (customer/seller cancel `WHERE status IN (…)`, the expiry
   sweep's guarded claim) still write successfully;
9. `DEFAULT 'pending'` still applies and `NOT NULL` still rejects `NULL` (23502).

## 17. Invalid-value DB test

Cases 4–6 in §16. They assert the **real PostgreSQL error** — `err.code === "23514"`,
`err.constraint === "orders_status_check"`, `err.severity === "ERROR"` — not a string match against
the schema file, which is explicitly what the task required.

## 18. Application compatibility

`bun test backend/tests`: **896 pass / 185 skip / 0 fail** (1081 tests / 50 files).

One pre-existing test failed and was **not** skipped, weakened, or deleted:

> `database > orders.status stays free text, so 'packing' needs no migration`
> — `backend/tests/order-fulfillment-state-machine.test.ts`

It asserted the **absence** of a CHECK, which is precisely what MEDIUM #9 changes. It was rewritten
to the new truth while keeping every original concern — that `packing` must be storable (the reason
the test was written) and that no non-test backend file depends on `run-update.sql` — with a comment
explaining that the constraint makes a schema change necessary *for the first time*, and that
migration V0050 is that change. Its assertions were **strengthened**: it now requires `CHECK (status`
to be present and every `FULFILLMENT_STATUSES` value to appear in the table block.

The docstring in `backend/tests/order-status-contract.test.ts` that described the column as free text
was corrected too; its defensive-rendering assertions are unchanged.

No writer wrote an invalid status, so no application code changed at all.

## 19. Local test result

`NODE_ENV=test bun test backend/tests` → **896 pass / 185 skip / 0 fail**, 1081 tests / 50 files.
Targeted: `bun test backend/tests/order-status-check-constraint.test.ts` → **17 pass / 0 fail /
9 skip**.

The 9 DB-gated tests **SKIPPED locally** — this workspace has no PostgreSQL and no container runtime.
They are the CI evidence, not a local claim.

## 20. Backend tsc

`cd backend && bunx tsc --noEmit` → **exit 0**, no output.

## 21. Typecheck

`bun run typecheck` → **exit 0**, all four apps:
`@velnox/velshop 0 · @velnox/velseller 0 · @velnox/velcenter 0 · @velnox/velnox 0`.

## 22. Build

`bun run build:apps` → **exit 0**, all four apps built (`velnox` bundle: 305.55 kB / gzip 94.80 kB).

## 23. i18n

`bun run i18n:check` → **OK — th=1416 en=1416 my=1416 keys, all locales at parity.** No user-facing
string changed; no translation was added.

## 24. diff check

`git diff --check` → **exit 0**, no whitespace errors.

## 25. CI run ID and result

### 25.1 First run — `36596404247` (Tests) / `36596404197` (Migrate Neon) on `619747f` — FAILED

Reported before fixing, as the rules require. **Two independent jobs failed, with two different
causes, and only one of them was mine.**

| job | result | cause |
|---|---|---|
| `Migrate Neon Database` | failure | **The known Neon quota blocker — NOT this task.** It dies on the workflow's *first* step (`CREATE TABLE IF NOT EXISTS schema_migrations`): `ERROR: Your account or project has exceeded the quota`. It never reached migration 050, let alone 048/049. This is audit finding #6 / §22, an owner action that was already open before this task. |
| `Tests` | failure — `1078 pass / 2 skip / 1 fail` | **A bug in my own new test.** `the default and NOT NULL still hold`. |

The `Tests` log proves the schema change itself is sound: **8 of the 9 DB-gated tests passed against
the disposable PostgreSQL**, including `PostgreSQL holds the constraint, with the derived allowed
set`, both `23514 / orders_status_check` rejections, every allowed value on INSERT *and* UPDATE,
the near-misses, and the legal-value/illegal-transition case.

**Root cause of the one failure — a defective test, not a defective constraint.** The test seeded its
row with `INSERT … RETURNING status`, then asserted that `UPDATE … SET status = NULL` was refused —
but it addressed that row with `rows[0].id`, which that statement never returned. The parameter went
to PostgreSQL as `NULL`, `WHERE id = NULL` matched **zero rows**, no error was raised, and
`expect(caught).not.toBeNull()` failed. The NOT NULL assertion was *vacuous*, not wrong.

**Fix:** the INSERT now returns `id, status`, the UPDATE asserts `rowCount === 1` **before** the
refusal check (so the statement can never again be a silent no-op), and the row's status is read back
afterwards. The assertion was strengthened, not weakened — no test was skipped or deleted.

### 25.2 Second run — `36597070677` on `61d7b50` — **GREEN**

| | |
|---|---|
| Workflow / job | `Tests` → `Typecheck + tests (disposable PostgreSQL)` · **success** |
| Result | **1079 pass / 2 skip / 0 fail** — 1081 tests across 50 files |
| DB-gated evidence | **all 9** of this task's PostgreSQL tests report `(pass)`: the constraint exists with the derived set, every allowed value inserts *and* updates, invalid insert **and** update are refused with `23514`, near-misses are refused, the guarded cancel/expiry shapes still write, `DEFAULT`/`NOT NULL` hold, and a legal value reached by an illegal transition is still accepted |

The two skips are the unrelated R2-credential cases. The `Migrate Neon Database` workflow triggers
only when a file under `db/migrations/` changes, so it did not re-run for this test-only commit; its
failure in §25.1 was the pre-existing Neon quota blocker and remains an owner action.

## 26. Production status

**NOT VERIFIED.** No production database was touched. No migration was applied to Neon. The
production guard was not bypassed: the DB-gated tests run only against `TEST_DATABASE_URL`, and the
`bunfig.toml` preload + `assertTestDatabaseIsSafe()` still abort a run that points at production.

**The single production risk of this task** is stated plainly: migrations **048 and 049 remain
unapplied** on the Neon quota, so 050 will not have run either, and `orders.status` in production is
still unconstrained. When 050 eventually runs it will **narrow** the set, and if any historical
production row already carries an out-of-set value the migration **fails loudly** by design. The
diagnostic query is in the migration header. That is a deliberate trade: coercing a live order's
status would be a business decision this task must not make.

## 27. Remaining risks

1. **Legacy rows in production** (above) — the only way this migration can fail.
2. **`expired` is not covered by any existing order-status UI test** as a *writable* value; it is now
   proven writable only by this task's tests. Worth watching if the sweep ever changes its target.
3. **A future backend status now requires a migration.** That is the intended cost of the constraint,
   and the contract test in §16.2 will fail first if a writer adds one — which is the desired order:
   a failing test, not a 500 at runtime.
4. **`failed` stays dead in `RELEASABLE_STATUSES`** — still LOW #12, untouched here by scope.
5. The 9 DB-gated tests are CI-only evidence in this environment.

## 28. HIGH #5 owner decision — untouched

**Not touched.** No refund policy was added, no refund route changed, no order is reopened, and
`backend/lib/payment-incidents.ts`, `payment_incidents` and the VelCenter incident tab are untouched.
What a captured charge on a `failed` attempt **is** (refund, or kept against a delivered order)
remains an **OWNER DECISION**.

One deliberate overlap was checked and found harmless: the HIGH #5 behavioural tests seed an order as
`cancelled` / `expired` / `failed`-attempt — all inside the new allowed set. The CHECK did not require
a change to any HIGH #5 code or test.

## 29. Files changed

| file | change |
|---|---|
| `db/schema.sql` | inline CHECK on `orders.status` + idempotent `ALTER` in the constraint-repair section |
| `db/run-sqleditor.sql` | the identical two edits (byte-parity verified) |
| `db/migrations/050_orders_status_check.sql` | **new** — the migration |
| `backend/tests/order-status-check-constraint.test.ts` | **new** — 26 tests |
| `backend/tests/order-fulfillment-state-machine.test.ts` | one test rewritten (it asserted the absence of a CHECK) |
| `backend/tests/order-status-contract.test.ts` | stale docstring corrected; assertions unchanged |
| `.ai/AI_HANDOFF.md` | new §48 for MEDIUM #9 |
| `.ai/tasks/completed/order-status-check-2026-09-29.md` | **new** — this record |

**No application source file was modified.** No state machine, no route, no component, no payment
code.

## 30. Next recommended task

**MEDIUM #8** — collapse the two overlapping reservation-urgency contracts in
`packages/shared/src/lib/commerce.ts` (the 3-minute value vs the GREEN/YELLOW/RED model). Same class
of finding, same constraint: derive the single authority from source first.
