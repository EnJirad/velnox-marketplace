## 62. VelRepeat **V2 — production migration + Stripe TEST E2E verification** (2026-10-01)

**STATUS: the production migration is APPLIED and its workflow is GREEN; Stripe TEST E2E still NOT
EXECUTED.** Everything verifiable without a Stripe credential passed.
Audit: `.ai/tasks/audits/velrepeat-v2-production-migration-stripe-e2e-2026-10-01.md`.
**Re-attempted 2026-10-02** for the real TEST payment itself: **hard stop #2**, no TEST credential
exists anywhere reachable. Production re-confirmed 001–052 all applied (ledger rows 1–68); suite
still 1853/2/0; no code, test or assertion changed. Audit:
`.ai/tasks/audits/velrepeat-v2-real-stripe-test-e2e-2026-10-02.md`.

**Re-attempted a second, third and fourth time** at HEADs `eae65e3`, `0d09e50`, `3b728b3`: gate
still `usable=false / mode=null / reason=STRIPE_NOT_CONFIGURED`, webhook secret absent,
`freebuff-deploy env list` `{"keys":[]}`. Every credential-shaped literal in the tree is one of six
**shape-only** fixtures; no real TEST or LIVE key exists anywhere. Ledger re-confirmed from run
`36944070061` (success), rows 64–68 = 048–052. Suite 1853 pass / 2 skip / 0 fail, backend tsc 0,
typecheck 4/4, build 4/4. **No product defect found** — only the owner can unblock, by adding
`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` under **Settings →
Environment** (never a live key). No code change is expected to be needed once they exist.

**The production finding, corrected.** `Migrate Neon Database` run `36902790862` (on `f0cc464`)
printed `Already applied: 001_initial` — but that echo is **multi-line**: 001–051 are ALL applied
and recorded, and the run's pending list held only `052_velrepeat_pricing_cycle_price.sql`. (An
earlier note here read that line as a one-row ledger and wrongly called 048–051 unapplied; the full
run log corrects it.) 052 failed on its first statement, `relation "velrepeat_pricing_snapshots"
does not exist`: the V2 prepaid **domain** schema had no `db/migrations/*.sql` file at all.

**The fix (owner-authorised 2026-10-01).** §0 of `db/migrations/052_velrepeat_pricing_cycle_price.sql`
now creates the prepaid pricing domain — `velrepeat_pricing_snapshots`,
`velrepeat_pricing_snapshot_items`, `velrepeat_plans.commitment_cycles` + indexes — *before* the
`cycle_price` ALTER, both table bodies copied verbatim from `db/schema.sql`. One file, because
`migration-numbering.test.ts` forbids reusing the 052 prefix and `053_*` would sort after the ALTER;
`orders.velrepeat_cycle_id` is excluded because `velrepeat-v2-pricing-total-prepaid.test.ts`
forbids `ALTER TABLE orders` in 052. Verified on a DB rebuilt to production's exact starting state:
applies clean, idempotent on re-run, and `pg_dump` matches a `db/run-sqleditor.sql` bootstrap
except three **deliberate** divergences — `velrepeat_cycles` and `orders.velrepeat_cycle_id` (both
Phase 5 substrate, zero non-test references) plus the column ordering an `ALTER` always causes.
**The push triggered the canonical workflow: `Migrate Neon Database` run `36944070061` concluded
SUCCESS** — green on `main` for the first time since `f0cc464` — and its own log ends
`V0052: 0 snapshot(s) given a cycle_price` with ledger row 68
`052_velrepeat_pricing_cycle_price`. **0 rows touched in production**: the strongest possible proof
that no settled payment, order, balance or financial record was rewritten. `Tests` on the same
commit: 1853/2/0, identical to local. The production DB was still unreachable from this
environment (env lists empty, `gh secret list` / `workflow_dispatch` 403), so **no production
contents beyond that log are claimed.**

**Verified locally against a real PostgreSQL** (14, bootstrapped from `db/run-sqleditor.sql`):
048–052 each apply clean, and 052 is idempotent on re-run. 052's backfill was exercised on real
pre-052 data with both safety branches: an UNSETTLED plan went `93.44 → cycle_price 93.44 /
total_amount 280.33` (exact 93.4444×3, **not** 93.44×3=280.32), while a plan with a `paid` payment
was left **completely untouched** and the `NOT NULL` constraint was **declined, not forced**. No
settled payment, order, balance, Stripe record or transaction was modified; nothing deleted.
`db/schema.sql` ≡ `db/run-sqleditor.sql`; `db/run-update.sql` still absent.

**Pricing:** contract re-proved from source + DB. 1/2/4/8 cycles → 90.00 / 180.00 / **360.00** /
720.00; 30% cap accepted at exactly the boundary and **refused** (never clamped) above it; G1
sequential (7% then 5% on 170.00 → 150.195, not a 12% sum); `commitment_cycles` validated before
any rule; one final 2dp rounding (150.195×3 = **450.59**, not 450.60); bigint only, no float.
NUMERIC(12,2) overflow is **refused, not clamped** — the engine emits the exact value and
PostgreSQL rejects it with `22003 numeric field overflow`.

**Stripe: test mode is structurally enforced, but a real E2E was NOT run.** `stripeStatus()` is a
single gate that refuses rather than degrades: `sk_live_…` → `STRIPE_LIVE_KEY_REFUSED`,
unrecognized → `STRIPE_KEY_UNRECOGNIZED`, `STRIPE_MODE=live` → `STRIPE_MODE_MISMATCH`, test key
without a webhook secret → `STRIPE_WEBHOOK_NOT_CONFIGURED`. Amount comes from the persisted
snapshot's `total_amount` only; ownership is checked *before* the snapshot is read, so a pricing
refusal cannot become an oracle.
**No Stripe credential exists in any reachable environment** (env empty, no key literal outside
test files, secret names 403), so the outbound charge-creation call and any real Stripe-side
confirmation are **unverified**. Not simulated, not faked.

**What the new matrix suite does prove** (41 tests, `backend/tests/velrepeat-v2-verification-
matrix.test.ts`, full row-by-row detail in the audit §13): the whole server-side settlement
contract through the **real webhook endpoint** with a **real HMAC-SHA256 signature** against a
**real database**. Mismatch (90.00 attempted vs 360.00 expected): plan stays `draft`, payment row
**retained as `paid`** (never hidden — Stripe took it), 1 `PLAN_AMOUNT_MISMATCH` incident, no fake
success. Replay → exactly 1 `PLAN_ACTIVATED`, 0 cycles/orders/runs/inventory, `order_id` NULL.
Activation re-anchors `started_at` to the settlement instant, `next_run_at` to +1 week. Payment
success creates **no** order, cycle, run, stock decrement or fulfillment. Injected `seller_id`/
`cycle_price`/`total_amount`/`discount`/`pricing_rule`/`amount`/`payment_status`/`plan_status`/
`user_id`/`plan_id` change nothing. **No production runtime code changed** — only
`db/migrations/052_velrepeat_pricing_cycle_price.sql` (§0) and a test.

**Results:** 1853 pass / 2 skip / 0 fail (1855 tests, 60 files) = +41 over the 1812 baseline, 0
regressions. backend tsc 0; `bun run typecheck` 4/4; `build:apps` 4/4; `git diff --check` clean;
**no V1 protected file in the diff.** Nine first-run failures were all bugs in the new test (a
`Date.toString()` millisecond blind spot, a stray SQL parameter, two bad destructures, two
miscomputed totals, a comment-matched keyword); each was fixed by making the assertion stricter.
**No assertion was weakened to get green.** Three pre-existing guards (migration numbering, the
Phase 3 migration inventory, "052 changes no V1 table") shaped the migration's shape and were all
left intact rather than edited.

**Unblock, one owner action remains:** supply a **TEST** `STRIPE_SECRET_KEY` + **TEST**
`STRIPE_WEBHOOK_SECRET` (+ `NEON_DATABASE_URL` to verify production state after the push). Until
a real Stripe TEST E2E is run, **do not call VelRepeat V2 production ready.**

**Next safe phase:** 5 (V2 plan lifecycle routes for an *active* plan, which V1's routes can now
reach) — and that migration must also carry `velrepeat_cycles` + `orders.velrepeat_cycle_id`,
the two Phase 5 objects §0 of 052 deliberately leaves out. NOT inventory or fulfillment.
