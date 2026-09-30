# VelRepeat V2 — Phase 3 (Package → Repeat Plan purchase-time pricing snapshot) — STOP REPORT

```
STATUS: BLOCKED — no implementation started
REPO:   EnJirad/velnox-marketplace · branch main
HEAD:   356c6405185491627eec9615d5b1ef07d5e4d03f (== origin/main at inspection time)
DATE:   2026-09-30
```

**Requested phase:** connect *Seller Package → Package Items → Pricing Engine → Repeat Plan creation
→ Pricing Snapshot* so that creating a V2 plan from a valid seller-owned package computes the price
with the canonical engine and stores an immutable pricing/composition snapshot — without payment,
inventory, fulfillment, cycle settlement, or `sold_count`.

**Result:** the inspection required by the brief (§4) was completed against source. The phase stops at
the brief's own §21 conditions **before any edit**. No code, schema, migration, test, or production
behavior was changed. The owner decision record already predicted this:
`.ai/tasks/audits/velrepeat-v2-owner-decision-closure-2026-09-30.md` §10.2 (gate table) —
**“3. Repeat Plan … [BLOCKED] (shape + eligibility)”**.

---

## 1. Dependency map — the brief's §4 questions, answered from source

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Where does a customer create a Repeat Plan? | `POST /api/velrepeat/plans` (`requireAuth`), one writer; a second creator exists for “repeat a past order”. Both insert `status = 'active'`. | `backend/routes/velrepeat-plans.ts:195` (handler) · `:255` (`nextRunAt`) · `:260` (`INSERT INTO velrepeat_plans … 'active'`) · repeat-now `:623` / `:686` |
| 2 | Do V2 and V1 share a route? | **Yes — one route, no V2 branch.** No `packageId` input, no package reference on the plan. `grep "INSERT INTO velrepeat_plans"` (production code) returns exactly `velrepeat-plans.ts:260` and `:686`. | `db/run-sqleditor.sql:824-847` — `velrepeat_plans` has **no `package_id`**; Phase 2 audit blocker #12 |
| 3 | Does the route still contain legacy COD behavior? | **Yes.** Any `paymentMethod !== "cod"` is rejected 400; the column itself is `NOT NULL DEFAULT 'cod'`. | `velrepeat-plans.ts:223-226` · `db/run-sqleditor.sql:836` |
| 4 | How are package IDs currently represented? | **Not on the plan.** Only the Phase 2 snapshot `metadata` JSONB records `{ seller_id, package_id, … }` — the sanctioned provenance channel chosen in Phase 2 instead of an invented column. | `backend/lib/velrepeat-pricing.ts:519-520` · Phase 2 audit §9 item 12 |
| 5 | Does plan creation already write a pricing snapshot? | **No.** No route writes `velrepeat_pricing_snapshots`. `insertPricingSnapshot()` exists, is exported and tested, and is **not called from any route**. | `backend/lib/velrepeat-pricing.ts:495` (defined, unwired) |
| 6 | Does plan creation snapshot package composition? | **No.** It inserts `velrepeat_items` rows with server-resolved prices only; nothing is snapshotted. | `velrepeat-plans.ts:271-277` |
| 7 | Does any code price independently of `computeCommitmentPricing()`? | **Yes — the live V1 path.** `resolvePlanItem()` uses `parseFloat` (`:95`, `:110`) and the scheduler re-prices live at run time. Phase 3 must not modify these, and any plan left `status='active'` is subject to them. | `velrepeat-plans.ts:95,110` · `backend/jobs/velrepeat-scheduler.ts:245` (`UPDATE velrepeat_items SET unit_price`) |

### The live V1 engine that owns every `active` plan

| Step | Evidence |
|---|---|
| Scheduler started unconditionally by the server | `backend/server.ts:523` `startVelRepeatScheduler()` |
| Due sweep: `status = 'active' AND next_run_at <= NOW()` | `backend/jobs/velrepeat-scheduler.ts:444-451` |
| Claim re-check under row lock | `:113-120` (`FOR UPDATE`) |
| **Live re-price** | `:245` |
| **Creates orders** (`INSERT INTO orders`) | `:270` |
| **Decrements variant stock** (`stock = stock - $1`) | `:328` |
| **Reserves inventory** (`reserveInventoryStock`) | `:341` (via `backend/lib/inventory.ts:54`) |
| **Increments `sold_count`** | `:344` |
| **Inserts a COD pseudo-payment row** | `:351-352` |

---

## 2. Where the canonical flow stops

The brief's §5 flow is: authenticated customer → load package → verify active → verify ownership →
load items → verify eligibility → purchase-time composition → base price → platform rules →
`computeCommitmentPricing()` → 30 % cap → final THB price → **create Repeat Plan** → create pricing
snapshot → create snapshot items → commit atomically.

Every step up to and including the pricing computation is buildable with existing Phase 2 primitives.
The flow **cannot pass “create Repeat Plan”**, and therefore cannot reach the snapshot:

- `velrepeat_pricing_snapshots.plan_id UUID NOT NULL REFERENCES velrepeat_plans(id)`
  (`db/run-sqleditor.sql:923`) — **a snapshot cannot exist without a plan row.**
- A plan row cannot be created without choosing its **initial lifecycle status** — the exact shape the
  owner has not decided (below).

---

## 3. Stop conditions reached (brief §21)

### 3.1 Blocker A — the plan's initial status is an unresolved owner decision [shape]

The owner's own conceptual machine (binding record §5.1):

```
draft → pending_payment → active → paused → completed / cancelled
```

| Fact | Evidence |
|---|---|
| `pending_payment` is **absent** from the `velrepeat_plans.status` CHECK (10 values), and the record explicitly says the change is *“documented, NOT implemented”* — **[OWNER DECISION REQUIRED] (shape)**. | `db/run-sqleditor.sql:827` · owner-decision-closure §5.1 (`:443`, `:448`, `:461`) |
| The open questions **LS.1** (“Is `pending_payment` required?”) and **LS.4** (“Is `draft` required; should the DEFAULT stay `'active'`?”) are **unanswered** — the answer form is blank. | `.ai/tasks/audits/velrepeat-v2-owner-decisions-pending-2026-09-30.md:1111-1119` and `:1711-1716` |
| The binding gate table already marks this phase **[BLOCKED] (shape + eligibility)**. | owner-decision-closure §10.2 (`:961`) |

**Why no available status is safe (fail-closed analysis):**

| Candidate status | Result |
|---|---|
| `active` (the DEFAULT; the only status any current writer produces) | **Forbidden.** The plan is swept by the live V1 engine (table above): it re-prices, creates fulfillment orders, decrements stock, reserves inventory, increments `sold_count`, and writes a COD pseudo-payment. The brief forbids every one of these (§3, §8, §14, §15; §21 items 5/6/7). |
| `draft` | Exists in the vocabulary but has **no writer and no decided V2 meaning** — that is exactly what LS.4 asks. Choosing it = guessing the shape (§21 item 10). |
| `pending_payment` | Not in the CHECK. Adding it alters a **production table** (`velrepeat_plans` is live: migrations `034`, `035`, `044`, `050` all touch it) ⇒ requires a new migration ⇒ **migration 051 is forbidden** (§16; §21 item 9). It is also a payment-lifecycle state owned by Phase 4 (§14). |
| New V2 marker (`package_id` / `source`) on the plan | Same production-table + migration-051 problem; Phase 2 already decided provenance lives in snapshot `metadata`, not an invented column (Phase 2 audit §9 item 12). |

**No in-code workaround exists:** the sweep filters on `status` + `next_run_at` only; there is no
marker that could separate a V2 plan from a V1 plan without a schema change.

### 3.2 Blocker B — seller eligibility for repeat commerce is an open Phase 3 gate

Which sellers may appear in a plan/package at all is **[OWNER DECISION REQUIRED]** and is recorded as a
Phase 3 gate: *“unless packages turn out to be seller-scoped”*. Phase 2's G3 = **B** made packages
seller-scoped (`velrepeat_packages.seller_id NOT NULL`), so the Phase-2 exemption no longer applies.

Evidence: owner-decision-closure §12 item 4 (`:416`) and §11.2 item 6 (`:996`) — “NOT BLOCKING for
Phase 2 … unless packages turn out to be seller-scoped”; gate table `:961` lists
“shape + **eligibility**”.

### 3.3 Blocker C (same boundary) — the shared route can only express the legacy payment rail

Creating a plan through the current architecture necessarily writes a payment method, and the only
value the route accepts is `cod` (`velrepeat-plans.ts:223`); the column additionally defaults to
`'cod'` (`:836`). The V2 model is prepaid Stripe (Q14: one charge per plan; contract §60.1 2A/5A) and
this phase may not assign any rail (§14; §21 item 6). This is the same class of conflict the brief
says to stop on rather than patch.

### 3.4 Secondary, recorded but not the stopper

- **No canonical plan-creation idempotency.** `checkout_requests` is scoped `'checkout'`
  (`backend/routes/cart.ts:882`) / `'payment'` (`backend/routes/stripe.ts:1172`); plan creation has no
  request-idempotency mechanism. Since this phase creates no charge or reservation, duplicate plans
  have no irreversible effect — but the prepaid charge phase must resolve charge idempotency, so it is
  recorded here as an open dependency (brief §12).
- **`PRICING_CAP_POLICY`** remains open from Phase 2 (breach *resolution* beyond fail-closed). This
  brief's **G1.1** restates reject / fail-closed / no trim / no scale / no clamp — which is exactly
  what the engine already implements — so it is **not** the Phase 3 stopper; it stays inherited-open.

---

## 4. What is already in place (so the next pass starts fast)

| Capability | State | Evidence |
|---|---|---|
| Canonical pricing engine (G1 sequential, G1.1 30 % cap, G2 THB/1-rounding) | Complete, tested | `backend/lib/money.ts` · `backend/lib/velrepeat-pricing.ts:219` (`computeCommitmentPricing`) |
| Purchase-time composition pricing | Exported, **unwired** | `velrepeat-pricing.ts:440` (`computeCommitmentPricingWithLines`) |
| Snapshot writer for the existing Phase 1 tables | Exported, **unwired** | `velrepeat-pricing.ts:495` / `:503` (`INSERT INTO velrepeat_pricing_snapshots`) |
| Snapshot can preserve **package + seller identity without new fields** | Via existing `metadata` JSONB `{ seller_id, package_id, applied_rules, base_price, final_price_exact, effective_discount, max_effective_discount, cap_enforced }` | `velrepeat-pricing.ts:519-521` |
| Snapshot can preserve composition / qty / unit price / line total / currency / commitment / discount / rule key+version | Existing Phase 1 columns | `db/run-sqleditor.sql:921-936` (snapshot) · `:937-949` (items) |
| Seller-side package authorization primitives | Complete (G3) | `backend/routes/velrepeat-packages.ts` (`authorizePackageComposition`, `resolveApprovedSeller`, `getOwnedPackage`) |
| **Customer-facing package read path** | **Missing** — all package routes are `/api/seller/velrepeat/packages…` only | `velrepeat-packages.ts:451,469,492,532` |
| Canonical transaction helper | `withTransaction()` in use | `backend/db/index.ts` |

**Snapshot representability verdict:** the Phase 1 schema **can** represent the purchase-time data
brief §6 requires **without new fields or new business decisions** — the blocker is the plan row's
lifecycle, not the snapshot.

---

## 5. Owner decision required

| ID | Question | Why it gates Phase 3 |
|---|---|---|
| **Q-A** | **Plan lifecycle shape** — answer LS.1/LS.4: what statuses exist for a V2 plan, and what status a plan created from a package is born in (`draft`? `pending_payment`?), and what keeps a V2 plan out of the V1 `active` sweep. | Without it there is no status the plan can legally and safely be created in. |
| **Q-B** | **Seller eligibility for repeat commerce** — may every approved seller appear in a plan/package, or only a defined subset? | Recorded Phase 3 gate (“shape + eligibility”). |
| **Q-C** | **Sequencing** — may V2 plan creation ship before the prepaid charge (Phase 4), i.e. is “plan exists awaiting payment” an allowed state, and which rail does it record? | The shared route can currently express only `cod`. |

Once Q-A/Q-B are answered, Phase 3 can be implemented exactly as the brief's §5 flow over the existing,
tested engine and snapshot writer — in one `withTransaction()`, with the snapshot as the immutable
purchase-time record.

---

## 6. Safety confirmation — what was NOT done

| Area | State |
|---|---|
| Code | **Unchanged** — every VelRepeat file is byte-identical to `356c640`. |
| Schema | **Unchanged** — `db/schema.sql` and `db/run-sqleditor.sql` untouched (byte-identical). |
| `db/migrations/` | Untouched; still ends at `050_orders_status_check.sql`. **No `051`.** `db/run-update.sql` still absent. |
| Payment | Untouched — no Stripe, no `payments` rows, no COD change. |
| Inventory | Untouched — no reserve/commit/release, no stock writes. |
| Fulfillment | Untouched — no orders, no fulfillment code. |
| `sold_count` | Untouched. |
| V1 | Untouched — no rewrite, no conversion, no shared-helper change. |
| Production | Unchanged — V2 tables still absent there; migrations 048–050 still unapplied. |
| Workaround | **None created** (brief §21). |

---

## 7. This pass's verification

| Check | Result |
|---|---|
| `git fetch origin`; HEAD vs remote | `356c6405185491627eec9615d5b1ef07d5e4d03f` == `origin/main` |
| Working tree before the docs record | clean (no tracked modifications) |
| `git diff --check` (docs-only diff) | clean |
| Tests / typecheck / build | **not run and not applicable — zero code changed.** The base commit was verified green by CI run `36757282706` (1650 pass / 2 skip / 0 fail) and local runs (1445 pass / 207 skip / 0 fail). |
| Files added by this record | this audit + `.ai/AI_HANDOFF.md` §58 only |

---

## 8. Production readiness

**Nothing here is live and nothing changed.** Phase 3 remains gated; Phase 4 (prepaid payment), Phase 5
(cycles), Phase 6 (inventory), Phase 9 (lifecycle money) also remain blocked on their own recorded
decisions. Do not start Phase 4 from this record.
