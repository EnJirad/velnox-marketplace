# AI Handoff — Stripe TEST-mode E2E, §16→§18 record (moved 2026-09-27)

Full record of handoff §18 ("Stripe TEST-mode E2E — independent re-verification",
TASK 007, 2026-09-26) plus its TASK 008 close-out re-gate, moved here on 2026-09-27 to
free edit headroom in `.ai/AI_HANDOFF.md` (which then exceeded ~54 KB against a ~40 KB
soft ceiling). Supersedes nothing: the BLOCKED statements it carries are mirrored into
`.ai/context/payment.md`, and the handoff keeps a stub pointer.

---

**Status unchanged where it matters: STRIPE E2E IS STILL BLOCKED.** This pass did
not (and could not) execute a Stripe API call. What it changed is the *evidence tier*
of everything that does not need Stripe, plus one new executed test.

**Startup sync.** The sandbox was **stale by 10 commits** (`b31e67b` → `origin/main`
`42f6ae3`): a prior session had already landed the payment foundation (§15), the
TASK 006 BLOCKED record (§16), and the CI guard fix (§17). `git pull --ff-only` →
HEAD == `origin/main` == `42f6ae3d0ca705993e3969db1bd2235fb0efab2e`, tree clean.
This section re-verifies that state from source rather than trusting it.

**Credential check (no secret read).** `freebuff-env list` → `{"files":{}}` — no
`STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_MODE`
/ `COD_*` / `TEST_DATABASE_URL` exists in this workspace → **BLOCKED — Stripe TEST
credentials unavailable**: no PaymentIntent, no PromptPay QR, no Stripe-hosted
webhook delivery, no Stripe refund. No mock, stub, or fake Stripe response was
substituted, and none may be reported as E2E.

**Executed here — the DB-gated half now RUNS (what §16 wrongly called impossible).**
Disposable local PostgreSQL 14 (`pg_ctlcluster 14 main start` — the sandbox stopped
the cluster once mid-session; restart it and re-run rather than reading
`ECONNREFUSED` as a test failure), database `velnox_test` bootstrapped from
`db/run-sqleditor.sql` (**59 tables**),
`TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/velnox_test?sslmode=disable`:

| Run | Result |
|---|---|
| `bun test backend/tests` **with** disposable DB | **560 pass / 2 skip / 0 fail** (562 tests, 24 files) |
| `backend/tests/payment-foundation.test.ts` **with** DB | **61 pass / 0 fail** (was 59 pass / 1 skip) |
| `bun test backend/tests` **no DB** (skip path intact) | **523 pass / 39 skip / 0 fail** |
| `bun test backend/tests/test-database-isolation.test.ts` | **39 pass / 0 fail** |
| backend `bunx tsc --noEmit` | exit 0 |
| `bun run typecheck` (4 apps) | 4/4 exit 0 |
| `bun run i18n:check` | **th=1295 en=1295 my=1295**, parity |
| `git diff --check` | clean |
| `db/schema.sql` vs `db/run-sqleditor.sql` | **identical** |
| `db/run-update.sql` | absent (stays absent) |

The 2 remaining skips are the R2-credential upload cases, not payment. Provisioning
the DI cluster needed one local-only step: this sandbox cluster uses SCRAM auth, so
`ALTER USER postgres PASSWORD 'postgres'` was set on the **throwaway** cluster (the
same convention as CI's `postgres:16`; no repository secret involved or read).

**New executed test (+59 lines, `backend/tests/payment-foundation.test.ts`).**
`a refused COD attempt writes nothing (DB-gated)` closes the one gap §16 could only
mark CODE: the brief requires proof of **no order/payment/shipment/settlement
write**, which an HTTP status alone cannot show. It fires `method=COD` at BOTH
checkout endpoints with fresh UUIDs, expects **403 `PAYMENT_METHOD_DISABLED`**
(rather than 404 `NOT_FOUND` / 403 `ADDRESS_NOT_FOUND`, which is what an order or
address lookup would answer — so the refusal provably precedes the first DB read),
then reads the rows back: `orders`, `payments`, `shipments`, `settlements`, and
`checkout_requests` are all **0** for that caller, order id, and request key.
**Non-vacuity control:** the identical count expression returns **1** when a matching
order is inserted, and 0 after cleanup — so the zero is real, not a broken query.
COD safety is therefore **TEST VERIFIED**, not merely code-read.

**Idempotency — what is actually proven.** Webhook event idempotency is **TEST
VERIFIED**: a duplicated `event.id` is claimed once (`payment_events` = 1 row,
`status = processed`) and the second delivery answers `{duplicate: true}` — executed
against the real DB locally and in CI. The **checkout request-key replay** and the
`idx_payments_one_active_stripe` single-active-session race are **CODE VERIFIED
only**: both sit behind `getStripe()`, which answers 503 without a credential, so no
automated test can drive them here. **BLOCKED for E2E.**

**CI — not concluded from local tests.** GitHub Actions on `42f6ae3`: `Tests`
**success** (run `36177228483`, 1m15s); the step *Typecheck + tests (disposable
PostgreSQL)* logged `[test-db] integration tests will use localhost/velnox_test`,
executed the payment suites (stripe configuration, webhook signature accept **and**
reject, COD bypass 403, webhook idempotency) and finished **559 pass / 2 skip / 0
fail**. The two runs before the §17 fix (`68197ab`, `b6d8e5e`) had **failed**, which
is why "CI is green" must be checked per commit rather than assumed.

**Security audit (read-only).** `sk_live_` / `pk_live_` / `rk_live_` appear only as
zero-filled placeholders in `payment-foundation.test.ts` (they prove live keys are
*refused*) and as the classifier regex in `payment-config.ts`. No credential
identifier is logged in the payment code. Only `.env.example` is tracked; no `.env`.
This task changed **0 lines** of `backend/routes/stripe.ts`,
`backend/lib/payment-config.ts`, or `db/migrations/` — the only code delta is the
new test.

**Tier summary — do not read BLOCKED as PASS.**

| Area | Tier |
|---|---|
| Stripe test-mode E2E (Card, PromptPay, refund, webhook delivery) | **BLOCKED** — no credential |
| Live-key refusal, mode/key ordering, fail-closed COD flags | TEST VERIFIED (executed) |
| Webhook signature: forged rejected **and** valid accepted | TEST VERIFIED (local HMAC) |
| Webhook duplicate delivery / `payment_events` claim | **TEST VERIFIED** (real DB, local + CI) |
| COD disabled + direct-API bypass → 403, **no writes** | **PASS** (executed, DB-backed, with control) |
| Checkout request-key replay · single-active-session race · method switching | **CODE VERIFIED only → BLOCKED** |
| Charge derived from `orders.total_amount` (tamper resistance) | TEST VERIFIED (6 cases) |
| Refund arithmetic + over-refund rejection + duplicate replay | TEST VERIFIED (pure/replay) · provider-side **BLOCKED** |
| Inventory/stock transitions, order↔payment sync | **BLOCKED** — needs a configured Stripe session |
| Production payment readiness | **NOT CLAIMED** |

**Docs moved in this pass.** §2 (verification system) was mirrored into the new
[`.ai/context/verification.md`](../../context/verification.md) and the handoff now carries
a stub → file down from ~54 KB to ~47 KB. A new
[`.ai/context/payment.md`](../../context/payment.md) records the payment subsystem, its
non-negotiables, and the exact unblock steps. `AGENTS.md`, `.ai/README.md`, and
`.ai/context/project-map.md` gained pointer rows for both.

**Unblock (owner action, unchanged from §16).** Add test-mode `STRIPE_SECRET_KEY`,
`STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (optionally `STRIPE_MODE=test`) in
Settings → Environment, plus `TEST_DATABASE_URL` for a disposable PostgreSQL. Note
`.env.example` still does **not** list `STRIPE_*` / `COD_*` / `TEST_DATABASE_URL`;
agent tooling cannot edit that file, so add them by hand while you are there.

**Re-gate (2026-09-26, TASK 008 — close-out attempt).** Re-verified at `0712c70`
(= `origin/main`, tree clean): the credential gate is **unchanged** —
`freebuff-env list` is still empty, and the app's own `stripeStatus()` still reports
`{"usable":false,"mode":null,"reason":"STRIPE_NOT_CONFIGURED"}` with COD off. So
**Stripe TEST E2E stays BLOCKED** and flows 1–7 were not run. Phases 2/3/6 were
re-executed: production-looking `DATABASE_URL` refused (disposable target accepted),
isolation suite 39 pass, full suite **560 pass / 2 skip / 0 fail**, payment file
**61 pass / 0 fail**, schema-drift + migration-numbering **57 pass**, backend `tsc`
exit 0, 4/4 apps exit 0, i18n 1295/1295/1295, schema sync intact, `diff --check`
clean. All eight required payment properties were located in source with file:line
citations (nothing needed changing → nothing changed).
Full flow-by-flow evidence report:
[`.ai/tasks/completed/stripe-test-mode-e2e-gate.md`](../../tasks/completed/stripe-test-mode-e2e-gate.md).

**Not claimed.** Stripe E2E remains **BLOCKED**; production payment readiness is
**NOT claimed**. No live key, no real card, no real money, and no production database
was touched — the only database used was the disposable local one above.
