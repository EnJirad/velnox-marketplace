# AI Handoff — archive

Verbatim archive of `.ai/AI_HANDOFF.md` §51, removed from the live handoff on 2026-10-01 to keep
that file inside its size budget (see `.ai/history/README.md`). Superseded by §52–§62 and by
`.ai/tasks/audits/velrepeat-v2-production-migration-stripe-e2e-2026-10-01.md`: every blocker
recorded below as open was closed by Phases 3–4 and the V0052 migration.

---

## 51. VelRepeat — Prepaid Repeat Commerce (2026-09-30) — CONTRACT COMPLETE, IMPLEMENTATION STOPPED

### Audit-finding index (current)

| Finding | State |
|---|---|
| HIGH #4 payment attempt identity | ✅ fixed (§46) |
| HIGH #5 late/unrecordable payment operator flow | ✅ fixed (§47) — `payment_incidents` (migration **049**) |
| MEDIUM #8 duplicated reservation-urgency contracts | ✅ fixed (§50) |
| MEDIUM #9 `orders.status` CHECK | ✅ fixed (§48) — migration **050** |
| LOW #12 dead `failed` order status | ✅ fixed (§49) |
| MEDIUM #10 VelRepeat commerce lifecycle | ⚠️ **audit DONE, fix BLOCKED** — see below |
| MEDIUM #11 · LOW #13 · LOW #14 · HIGH #4 residual | ⬜ open |

### What was done

1. **PHASE 0–2** — re-read every `.ai` doc and re-inspected the named source at `6f5a998`;
   full grep list run. **PHASE 25** — `.ai/context/velrepeat-contract.md` gained **Part II (§23–§38)**:
   a current-facts table for every business-model concept, the existing-tables-vs-required-concepts
   check, the prepaid-payment blocker, delivery cycles, package, price snapshot, schedule, commitment
   and tiering, the plan-vs-cycle inventory comparison, `sold_count` under prepaid, cancellation /
   pause / skip / modification, B2C/B2B, scheduler ownership, incidents and idempotency. Every row is
   tagged **[PROVEN]** / **[INTENT]** / **[DECISION]** / **[OWNER DECISION REQUIRED]** with `file:line`.
2. **One code change only** — the owner-approved PHASE 15 fix. `POST /api/subscriptions/process-due`
   (`backend/routes/seller-orders.ts`) selected due plans with **no user scope**, so any approved
   seller could force-run **any** customer's due plans. It is now scoped with the same ownership
   predicate the read path already uses (`EXISTS … velrepeat_items vi WHERE vi.plan_id = vp.id AND
   vi.seller_id = $1`). Tests: 3 structural + 3 DB-gated in `backend/tests/velrepeat-core.test.ts`.
3. **Housekeeping** — §37–§48 moved verbatim to
   `.ai/history/archive/AI_Handoff-2026-09-30-payments-and-audit-record.md` (this file 56.4 KB → 36.8 KB).

### Why the prepaid model is NOT implemented (STOP)

Three **structural** facts found in source, each of which alone blocks it:

- **`payments.order_id` is `NOT NULL`** (`db/run-sqleditor.sql:441`). There is no plan-level payment,
  and `POST /api/stripe/checkout` derives its amount from `orders.total_amount`. A charge for
  **N** cycles has **no canonical home**. The obvious "new VelRepeat payments table" is a **second
  payment authority** and is forbidden.
- **`commitOrderInventory` — the ONE `sold_count` authority — is reached only from the Stripe
  webhook** (`stripe.ts:559`), i.e. on payment settlement. Under prepaid, money settles **once at
  plan level, before any cycle order exists**, so the canonical authority becomes **unreachable**.
- **`velrepeat_runs` has no cycle identity** (`UNIQUE (plan_id, scheduled_for)` but no ordinal, no
  commitment, and one run creates **one order per shop**). "Cycle N ⇒ exactly one order" cannot be
  idempotently proven today.

Owner decisions resolved by the owner: **#1 Stripe is the VelRepeat rail and COD must respect
`COD_ENABLED`** (no VelRepeat bypass), **#7 the central scheduler owns global due-plan processing
and a seller may not trigger other customers' plans**. Note that #1 does **not** by itself wire
Stripe, and it does **not** enable COD.

**17 open owner decisions** — the owner's own PHASE 26 Q1–Q12 plus Q13 prepaid payment shape,
Q14 Stripe charge vs Stripe Subscriptions, Q15 the V1 `vrepeat_packages` table, Q16 plan timezone,
Q17 per-seller plan splitting — are listed in **contract §38**. Q1, Q2, Q3 and Q7 are the ones that
gate all financial/inventory code. **No financial, inventory, `sold_count`, payment-rail or schema
change was made.**

### Verification at this pass

`bun run test` **959 pass / 192 skip / 0 fail** (1151 tests, 52 files) · `cd backend && bunx tsc
--noEmit` 0 errors · `bun run typecheck` 4/4 · `bun run build:apps` 4/4 · `bun run i18n:check`
th=en=my=1416 · `git diff --check` clean. **DB-gated tests skip locally** — no PostgreSQL is
available; CI's `postgres:16` is the only real execution. **PRODUCTION = BLOCKED** (Neon quota;
migrations 048/049/050 still unapplied). `bun run lint` is `echo 'Lint not yet configured'` — no
lint script exists.

---