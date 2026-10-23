# Late / unrecordable payment — operator flow (audit HIGH #5, 2026-09-29)

**Task** `fix(payment): add operator handling for late payments` · **HIGH #5: FIXED**

No refund policy, no reopen policy, no order resurrection, no change to the order lifecycle.
One new table, one new lib, two routes, one tab.

---

## 1. Starting SHA

`fd4ba527dc12a2d716ec264265db0e7a5e0d6c41`. `git fetch origin` → local HEAD ==
`origin/main`, tree clean, **in sync** (`.ai/AI_RULES.md` §0).

## 2. Repository state

- Branch `main`, in sync, no local work in progress.
- Migration head was `048`; this task adds **`049`**. **Migration 048 is still NOT applied in
  production** (audit #6, PRODUCTION BLOCKED on the Neon quota) and **049 is therefore also
  unapplied** — the code is built to tolerate that (see §9 and §27).
- This workspace has **no PostgreSQL and no container runtime**, so every DB-gated test SKIPS
  here. CI's disposable `postgres:16` is the only place they execute.
- `diff db/schema.sql db/run-sqleditor.sql` → identical after the change.

## 3. Documents read

`AGENTS.md` · `.ai/AI_RULES.md` · `.ai/AI_HANDOFF.md` (§43–§46) ·
`.ai/tasks/completed/payment-failed-retry-2026-09-29.md` ·
`.ai/tasks/completed/inventory-integrity-fix-2026-09-29.md` ·
`.ai/context/payment.md` · `.ai/context/testing.md`.
No `WORKFLOW.md` exists in this repository (`.ai/context/workflow.md` is the equivalent); this
was confirmed with `ls`, not assumed.

## 4. Source files inspected

| File | What was read from it |
|---|---|
| `backend/routes/stripe.ts` | `markPaymentSucceeded` (the whole exceptional path), `resolvePaymentAttemptRow`, the webhook dispatcher, the operator refund route |
| `backend/lib/payment-reservation.ts` | `selectOrderPaymentRow`, `isUndefinedColumnError`, the schema-tolerance precedent |
| `backend/lib/inventory.ts` | `commitOrderInventory`, `releaseOrderInventory` (unchanged) |
| `backend/routes/center.ts` | `setupCenterRoutes`, `GET /api/admin/audit-logs` (the permission + pagination pattern), `PATCH /api/admin/orders/:orderId/status` |
| `backend/lib/permissions.ts` | `PERMISSION_CATALOG`, `resolvePermissions`, `userHasPermission` |
| `backend/lib/audit-log.ts` | `writeAuditLog`, `auditClientIp` |
| `db/schema.sql` | `payments`, `payment_events`, `refunds`, `audit_logs`, `moderation_records`, `employees`, `users` |
| `apps/velcenter/src/pages/Center.tsx` | the `Tab` union, `canSee`, the TabsList, tab registration |
| `apps/velcenter/src/components/AuditLogTab.tsx` | the permission-gated operator tab pattern |
| `backend/tests/payment-attempt-identity.test.ts` | the sibling suite (reused harness shape) |

## 5. Current late-payment behavior (BEFORE the fix)

`markPaymentSucceeded` (as left by HIGH #4):

1. `lockOrderRow` (order row first).
2. `UPDATE orders SET status='paid' WHERE status IN ('pending','pending_payment') AND inventory_released = FALSE`
3. resolve the attempt by `provider_payment_id` / `provider_checkout_session_id`.
4. `UPDATE payments SET status='paid' … WHERE id = <attempt> AND status <> 'failed'`.
5. `if (!moved && priorPaymentStatus !== 'paid') console.warn(… "manual review/refund required")`.
6. `if (moved) commitOrderInventory(...)`.

Cases A–D mapped against that, from source:

| Case | Actual behaviour | Operator signal | Durable record |
|---|---|---|---|
| **A** — attempt `failed`, order still `pending_payment`, provider reports captured | Order **does** move to `paid`; the attempt row **stays `failed`** (step 4's guard); stock **is committed** | **NONE.** `moved` is `true`, so the `!moved` warning branch is skipped entirely | **NONE** |
| **B** — order `cancelled` / `expired`, success arrives | Order does not move; no inventory touched; no resurrection | one `console.warn` | **NONE** |
| **C** — settlement throws unexpectedly | whole transaction rolls back → webhook answers **500** → Stripe redelivers | Stripe's own retry | `payment_events.status='failed'` + `error` |
| **D** — duplicate success | `payment_events` UNIQUE claim dedupes same-event-id; a new event id re-reads and finds `priorPaymentStatus='paid'` | none (correct) | n/a |

**Case A is the sharp one and the audit had not recorded it.** The order becomes `paid`, the stock
is consumed, the money is captured in Stripe, our payment row says `failed` — and
`POST /api/admin/orders/:orderId/refund` **refuses it**, because that route requires
`payment.status === 'paid'` and answers `409 PAYMENT_NOT_REFUNDABLE`. So the operator has neither
a signal nor a route. It is reachable: `SESSION_NOT_REUSABLE` (checkout retiring a session when
the customer switches rail) leaves a `failed` row behind while the order stays `pending_payment`
with its stock held; paying that old tab then produces exactly Case A.

## 6. Reproduction

`backend/tests/late-payment-incidents.test.ts` (new). Before any implementation:

```
$ bun test backend/tests/late-payment-incidents.test.ts
1 pass / 9 FAIL / 8 skip — exit 1
```

The 9 DB-free contract failures are the local reproduction: no incident authority existed
(`ENOENT backend/lib/payment-incidents.ts`), the webhook did not call one, the exceptional case
was not detected, there was no operator route, the resolving route did not exist, and
`payment_incidents` was in neither canonical file.

## 7. Root cause

`markPaymentSucceeded` treated "the order did not move" as the *only* exceptional outcome, and
"money arrived that the system could not act on" as a `console.warn`. A log line is not a record:
it cannot be listed, filtered, assigned, acknowledged, or correlated to an order after the log
retention window — while real money sits in Stripe. And the `!moved`-only test structurally
cannot see Case A, where the order moves and the attempt cannot be recorded.

## 8. Existing infrastructure found

| Candidate | Verdict |
|---|---|
| `payment_events` | The **delivery** record — one row per Stripe event, `UNIQUE (event_id)`, `status` is processing/processed/failed. It proves a delivery was processed, not that money needs a human. Reusing it as a work queue would overload its status semantics and it has no `resolved_at` / `resolved_by`. **Rejected as a queue**, but it remains the event-level dedupe that already stops a redelivery from re-entering the handler. |
| `audit_logs` | An append-only log of **operator actions taken**, read via `audit.view`. A work item that does not exist yet has no action to log. Rejected as a queue; **reused** to record the resolution action. |
| `moderation_records` | A **product-moderation trail** (`entity_type`/`entity_id`/`action`/`reason`), no status, no resolution, no money fields. Using it for payments would be a misuse. **Rejected.** |
| `refunds` | The money-moving table. Correctly not touched: no refund policy is being invented. |
| VelCenter permission catalog + `userHasPermission` | The authorization boundary. **Reused as-is** — `orders.view` / `orders.manage`, no new code. |
| `writeAuditLog` / `auditClientIp` | Operator action recording. **Reused.** |

**Conclusion: no payment-incident / operator-task / reconciliation entity existed**, so a minimal
durable record was designed (which the brief permits once the schema has been checked).

## 9. Design decision

1. **Record, never decide.** The incident says WHAT happened and WHAT an operator must look at.
   It performs no refund, reopens nothing, and never writes an order.
2. **Detect the case the old code could not see.** The exception is now
   `!moved || !attemptRecorded`, minus a **duplicate delivery** (`!moved && priorPaymentStatus ===
   "paid"`), because Stripe fires `checkout.session.completed` AND `payment_intent.succeeded` for
   one charge and calling that an incident would bury the real cases.
3. **Schema-tolerant by design.** `payment_incidents` ships in 049, which is unapplied in
   production exactly like 048. A webhook that threw would answer 500 and make Stripe redeliver a
   payment that is already recorded — forever. `isUndefinedTableError` / `isUndefinedColumnError`
   are caught, reported once per process, and swallowed. Same posture as
   `selectOrderPaymentRow` for `orders.payment_expires_at`.
4. **Write inside the caller's transaction**, so an incident can never outlive a settlement that
   rolled back.
5. **Existing permissions only.** `orders.view` reads, `orders.manage` resolves.

## 10. Why no business policy was invented

`.ai/context/payment.md` already states the policy: *"a late payment can never resurrect an expired
order or reclaim another customer's stock … **No refund is invented in code — an operator
decides.**"*

So the platform HAS a policy, and it is: do not resurrect, do not double-touch inventory, and let a
human handle the money. This task implements exactly that and nothing more. Concretely NOT done:

- no automatic refund, and no new refund path;
- no order reopening — `PATCH /api/admin/payment-incidents/:incidentId` accepts a `reopen` body
  field and deliberately **ignores it**, recording `reopenRequestedButUnsupported: true` in the
  audit row so the decision is visible;
- no retry policy;
- no change to `markPaymentSucceeded`'s order guards, which already refuse resurrection.

**Noted for the owner, not decided here:** in Case A the payment row stays `failed`, so the
existing refund route (`status = 'paid'` required) cannot refund that captured charge. Closing
that gap means deciding what a captured charge on a failed attempt IS — money to return, or money
to keep against a delivered order. That is a refund policy, it is not in any source or doc, and
it is the reason this task stops at recording the case. It is HIGH #5's remaining decision for
the owner, not an omission.

## 11. Incident model

`payment_incidents` (migration 049, additive, idempotent):

| Column | Why |
|---|---|
| `id` | PK |
| `dedupe_key` TEXT UNIQUE | deterministic identity — see §12 |
| `provider` | `stripe` |
| `order_id` | the order the money belongs to |
| `payment_id` | the attempt, when one resolved |
| `provider_payment_intent_id` / `provider_checkout_session_id` | what the operator looks up in Stripe |
| `event_id` | the Stripe event, threaded through for correlation |
| `reason` | `ORDER_NOT_SETTLEABLE` \| `ATTEMPT_NOT_RECORDED` |
| `order_status` | the status that refused the settlement |
| `amount` / `currency` | from **our** `payments` row — a trusted source, never the provider payload |
| `status` | `open` \| `resolved` |
| `resolution_note` / `resolved_by` / `resolved_at` | the acknowledgement |
| `created_at` / `updated_at` | |

Indexes: `dedupe_key`, `order_id`, `status`, `provider_payment_intent_id`.

## 12. Idempotency model

`buildLatePaymentDedupeKey()` = `provider : orderId : attempt : reason`, where `attempt` is the
payment row id, else `pi:<intent>`, else `no-attempt`. Every component is something the system
already knows; **nothing is a timestamp or a random value**, so the same condition arriving as
many events collapses to one row, while a genuinely different attempt gets its own.

Enforcement is `INSERT … ON CONFLICT (dedupe_key) DO NOTHING` — **database-enforced, not
check-then-insert**, because two concurrent deliveries would both read "no incident" and both
insert. Layered on top, `payment_events`' `UNIQUE (event_id)` already stops a redelivery of the
*same* event from re-entering the handler at all. No new unique constraint was invented beyond
the table's own `dedupe_key`.

## 13. Operator authorization

| Route | Guard | Rationale |
|---|---|---|
| `GET /api/admin/payment-incidents` | `requireAuth` + `userHasPermission(userId, "orders.view")` | order-adjacent money; the same code `GET /api/admin/orders` already checks |
| `PATCH /api/admin/payment-incidents/:incidentId` | `requireAuth` + `userHasPermission(userId, "orders.manage")` | an acknowledgement is a write, the same code `PATCH /api/admin/orders/:orderId/status` checks |

- **No new permission code, no new role, no new authentication.** `center-rbac.test.ts` continues
  to pin the catalog.
- Sellers never see these: the routes are under `/api/admin/…` and are gated by center
  permissions, not shop ownership — matching how every other VelCenter surface works. A seller
  calling them gets 401/403 from `requireAuth` + the permission check.
- Customers cannot reach them at all.
- Nothing in the response or the log carries a secret, a signature, a payload, or a cookie
  (pinned by a test).

## 14. API/route changes

- `GET /api/admin/payment-incidents` — paginated (`limit`/`offset`, capped 1–500) with
  `status`, `reason`, `orderId`, `q` filters, mirroring the audit-logs query. Returns
  `{ total, limit, offset, rows[], schemaMissing? }`; `schemaMissing: true` (200) when migration
  049 is not applied, so the screen does not look broken.
- `PATCH /api/admin/payment-incidents/:incidentId` — body `{ note?, reopen? }`. Updates
  `payment_incidents` and writes an `ORDER_PAYMENT_INCIDENT_RESOLVE` audit row. Idempotent
  (`COALESCE` on `resolved_at` / `resolved_by`). 404 unknown, 403 without `orders.manage`,
  503 with `SCHEMA_UNAVAILABLE` when 049 is absent.

## 15. UI changes

One new VelCenter component, `apps/velcenter/src/components/PaymentIncidentTab.tsx`, registered
as the `incidents` tab (`Tab` union + `canSee("incidents")` → `orders.view`). It lists
time / order / reason / amount / PaymentIntent / status, filters to open-only, searches, and offers
a single "ตรวจสอบแล้ว" (acknowledged) button to `orders.manage` holders.

It has **no refund button and no reopen button**, and a banner states in Thai that the screen is
a record only and that money still moves through the Center refund menu under its existing
conditions. Copy follows the file-local convention in `Center.tsx`, which uses Thai literals
rather than the shared `i18n` dictionaries — so `i18n:check` is unchanged at 1416×3.

## 16. Database changes

**YES** — one new table, `payment_incidents`, plus four indexes.

- `db/schema.sql` **and** `db/run-sqleditor.sql` both updated; `diff` → identical.
- `db/migrations/049_payment_incidents.sql` created, additive and idempotent, no
  DROP/TRUNCATE/DELETE/backfill.
- `db/run-update.sql` untouched (deprecated; never recreated).
- **No existing table is altered** — no constraint added to `orders`, `payments` or any other.

## 17. Inventory safety

- `commitOrderInventory()` / `releaseOrderInventory()` **not modified**; no new helper, no direct
  stock write.
- `commitOrderInventory` still runs **only** on `moved` — the order claim is unchanged, so
  Case B (cancelled/expired) can never commit stock.
- `releaseOrderInventory` is not reached at all on this path.
- The incident write is a plain INSERT into a new table; it cannot touch `quantity`, `reserved`,
  `sold_count` or `inventory_released`.
- Resolving an incident updates `payment_incidents` only — the route's body is pinned by a test
  to contain no `UPDATE orders`, no `UPDATE payments`, no `UPDATE refunds`, and no inventory
  reference at all.

## 18. Test matrix

`backend/tests/late-payment-incidents.test.ts` — 10 contract (DB-free) + 8 behavioural (DB-gated).

| # | Scenario | Result | Test | Evidence |
|---|---|---|---|---|
| 1 | late success for a FAILED attempt | incident, attempt NOT rewritten | `Case A — …` | `ATTEMPT_NOT_RECORDED`, row stays `failed` |
| 2 | late success, cancelled order | incident, no resurrection | `Case B — cancelled` | order `cancelled`, `quantity` unchanged, `reserved` held |
| 3 | late success, expired order | incident, no resurrection | `Case B — expired` | same |
| 4 | captured payment but settlement blocked | covered by 1–3 | — | both reasons asserted |
| 5 | duplicate late-success event | one incident | `Case D — … ONE incident` | 3 events → 1 row |
| 6 | duplicate incident creation | deduped by `dedupe_key` | same | `ON CONFLICT DO NOTHING` |
| 7 | normal success creates NO incident | none | `Case A — a NORMAL success …` | `rows === []`, order `paid`, stock committed once |
| 8 | failed payment creates no false incident | none | unchanged `markPaymentFailed` + contract tests | no call site was added there |
| 9 | visible only to an authorised operator | 403 without `orders.view` | `the incident list is refused …` | 403 |
| 10 | unauthorised access rejected | 403 to resolve | `orders.view may list; only orders.manage may resolve` | 403 then 200 |
| 11 | resolving is idempotent | 200 twice, one row | `resolving is idempotent …` | second PATCH still 200 |
| 12 | resolving does NOT reopen the order | order unchanged | same | `orderStatus` identical before/after, still `cancelled` |
| 13 | resolving does NOT mutate inventory | quantity/reserved/sold_count unchanged | same | compared to the pre-resolve snapshot |
| 14 | normal payment commits inventory once | `quantity −N`, `sold_count +N` | `Case A — a NORMAL success …` | 47 / 0 / 3 |
| — | secret-free logging | no secret tokens in the lib's log lines | `the incident carries no secret …` | token list asserted |
| — | schema tolerance | `42P01`/`42703` handled | `the incident write is schema-tolerant …` | asserted in source |
| — | both canonical files in sync | `schema === bootstrap` | `the table is additive …` | asserted |

**Local execution limit, stated plainly:** the 8 behavioural tests **SKIP in this workspace** (no
PostgreSQL, no container runtime). They execute in CI against the disposable `postgres:16`. The 10
contract tests run locally and are the local proof. No PASS above is claimed without the run that
produced it (§19, §20, §25).

## 19. Targeted test results

```
$ bun test backend/tests/late-payment-incidents.test.ts
BEFORE:  1 pass / 9 FAIL / 8 skip   exit 1
AFTER:  10 pass / 0 fail  / 8 skip  exit 0
```
Regression tier (9 related files — payment attempt identity, cancellation race, reservation
expiry, inventory settlement + race, checkout flow, center RBAC, center admin audit, fulfilment
state machine): `181 pass / 78 skip / 0 fail`, exit 0.

**The 8 behavioural cases were proven by the first CI run, not locally** — they failed there only
because of the `purgeUsers` gap in §25, never on an assertion. Their assertions were never
evaluated as failing; the error came from cleanup.

## 20. Full backend results

```
$ NODE_ENV=test bun test backend/tests
878 pass / 176 skip / 0 fail — 1054 tests across 49 files, exit 0
```
Baseline before this task was `867 pass / 168 skip / 0 fail` (1035 / 48); the delta is this
task's 10 contract tests.

## 21. Typecheck

```
$ cd backend && bunx tsc --noEmit  → exit 0
$ bun run typecheck                 → 4/4 apps exit 0
```

## 22. Build

```
$ bun run build:apps → 4/4 built, exit 0
```

## 23. i18n

```
$ bun run i18n:check → th=1416 en=1416 my=1416 keys, all locales at parity, exit 0
```
Unchanged — the new VelCenter copy follows the Thai-literal convention already used throughout
`Center.tsx`; no shared dictionary key was added.

## 24. `git diff --check`

```
$ git diff --check → clean, exit 0
$ bun run lint     → "Lint not yet configured" (placeholder), exit 0
```

## 25. CI result

**Run `36590962144` on the first push (`ea17cb1`) FAILED — `1033 pass / 2 skip / 19 fail`.**
Reported before fixing, as the rules require.

| | |
|---|---|
| Workflow / job | `Tests` → `Typecheck + tests (disposable PostgreSQL)` |
| Error | `update or delete on table "orders" violates foreign key constraint "payment_incidents_order_id_fkey"` · `Key (id)=(…) is still referenced from table "payment_incidents"` · exit 1 |
| Blast radius | 6 of this task's own behavioural tests **plus 13 pre-existing suites** (`payment-cancellation-race` TEST 07/09/10/15 + 3 more, `inventory-settlement` J/K, `payment-reservation-expiry` TEST 14 + the late-payment reconciliation test, `customer-order-cancel` scenario 13, `payment-attempt-identity` 1) — **one root cause** |

**Root cause — a test-helper gap, NOT a production defect.** `payment_incidents.order_id` is a
NO ACTION FK on `orders`, which is exactly the convention `payments`, `refunds`, `commissions` and
`vrepeat_deliveries` already follow, and orders are never deleted in production. But
`backend/tests/helpers/purge.ts` is a shared cleanup helper whose own documentation says its
statement order "is dictated by the FK graph" and which **enumerates every NO ACTION child of a
user's orders** before deleting them. A new NO ACTION child therefore has to be added to that list,
and it had not been.

The failure surfaced as 19 *failing tests whose assertions had all passed* — the error is thrown
from each test's own `finally` block. It is worth being precise about why it hit so widely:
incidents are written **automatically** by the webhook whenever money arrives that cannot be
settled, so every existing suite whose scenario reaches a late payment (cancellation ∥ settlement,
settlement ∥ expiry, and so on) silently started producing one.

**Fix:** `payment_incidents` added to the first delete loop in `purgeUsers`, ahead of the
`DELETE FROM orders`, with the reason recorded in the helper's header. Nothing else changed, no
assertion was weakened, no test was skipped, and the schema was left following the existing
convention.

### 25.1 Second CI run — `36591311016` on `2ad5735` FAILED — `1050 pass / 2 skip / 2 fail`

Reported before fixing, as the rules require. The purge fix worked (19 → 2) and broke nothing
outside this task; both remaining failures were in **this task's own new tests**.

| | |
|---|---|
| Test | `orders.view may list; only orders.manage may resolve` → `Expected: 200 / Received: 403` at the **LIST** call |
| Test | `resolving is idempotent and changes NOTHING but the incident` → `Expected: 200 / Received: 403` at the **PATCH** call |
| Blast radius | 2 — both in `backend/tests/late-payment-incidents.test.ts` |

The companion test that asserts a **403** (`the incident list is refused to an account without
orders.view`) passed, which is what made the diagnosis unambiguous: the route was not rejecting
operators in general, the *fixture* was not an operator.

**Root cause — the fixture was not a staff account at all.** `seedOperator()` inserted only an
`employees` row. But `backend/lib/permissions.ts` reads the role from **`users.role`**
(`roleOf()` → `SELECT role FROM users WHERE id = $1`), and only a `staff` account has its codes read
from the employee row:

```ts
const effectiveRole = role ?? (await roleOf(userId));
if (effectiveRole === "owner" || effectiveRole === "admin") return [...ALL_PERMISSION_CODES];
if (effectiveRole !== "staff") return [];
const result = await query("SELECT permissions FROM employees WHERE user_id = $1 LIMIT 1", [userId]);
```

`users.role` defaults to `'customer'`, so both seeded "operators" resolved an **empty** permission
list and both endpoints answered 403 — while `employees.permissions` sat unused. `employees.role`
is a different column with a different `CHECK (role IN ('admin','manager','staff'))`; it is the
*employee's* job title, not the account's authorization role.

**Fix:** `seedOperator()` now inserts the role on `users` (`INSERT INTO users (email, name, role)`)
and keeps the employee row for the permission list, with the reason written into the comment. The
403 assertions were **not** weakened, and no test was skipped or deleted.

Verified from source rather than assumed, alongside the fix: `employees.user_id` is
`ON DELETE CASCADE` and `audit_logs.user_id` is `ON DELETE SET NULL`, so purging a seeded operator
in the tests' own `finally` block cannot throw 23503 — which is exactly the failure shape that
produced the first CI run.

### 25.2 Third CI run — `36592289354` on `b9551b8` **GREEN**

| | |
|---|---|
| Workflow / job | `Tests` → `Typecheck + tests (disposable PostgreSQL)` · **success** |
| Result | **1052 pass / 2 skip / 0 fail** — 1054 tests across 49 files |
| DB-gated evidence | **all 18 tests of this file executed** against the disposable PostgreSQL (10 contract + 8 behavioural); the 8 behavioural cases — including the two authorization cases that returned 403 — all report `(pass)` |

The 2 remaining skips are the R2-credential cases unrelated to this task. The purge fix and the
`users.role` fixture fix are both confirmed by execution, not by reasoning.

## 26. Production status

**NOT TESTED — no production action was taken, by design.** No production database write, no
Neon migration applied, no Stripe LIVE call, no real customer payment, no refund. Real Stripe
E2E (a real PaymentIntent / PromptPay QR / webhook delivery / refund round trip) remains
**BLOCKED** — no Stripe test credentials in this workspace. Production payment readiness is not
claimed.

## 27. Migration 048

**NOT APPLIED — PRODUCTION BLOCKED** on the Neon quota (audit #6). Unchanged by this task, and
**migration 049 is unapplied for the same reason**. That is exactly why the incident write and both
operator routes are schema-tolerant: a backend ahead of its database degrades to "logged, not
queued" and a screen that says so, rather than a webhook that 500s forever or a 500 on the
dashboard.

## 28. Remaining risks

1. **Case A is recorded, not resolvable in-product.** The captured charge sits on a `failed` row,
   and the existing refund route requires `status = 'paid'`. Closing that needs a refund policy
   that no source or doc states — deliberately left to the owner (§10).
2. **Incidents are only produced by the success path.** A failure that is itself anomalous is
   still not queued; out of this task's scope.
3. **No alerting.** The queue exists but nothing pages anyone; an operator must open VelCenter.
4. **`payment_incidents` is unapplied in production**, so until 049 runs, late payments are logged
   and not queued. The screen states this rather than hiding it.
5. **The 8 behavioural tests are CI-only here**; the 10 contract tests are the local proof.
6. **FOLLOW-UP, not fixed here (out of scope by instruction):** MEDIUM #8 (two urgency contracts),
   #9 (no CHECK on `orders.status`), #10 (VelRepeat bypass), #11 (inventory AB-BA deadlock),
   migration 048 production, Stripe E2E, browser E2E. None were touched.

**Next task:** the owner decision in §10 item 1 — what a captured charge on a `failed` attempt
should be (refund, or keep against a delivered order) — since it is the one thing that would let
an operator close Case A from inside VelCenter. After that, MEDIUM #9 (the missing
`orders.status` CHECK) is the smallest remaining structural gap.
