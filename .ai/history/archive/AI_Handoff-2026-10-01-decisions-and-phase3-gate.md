
---

# §56–58 — VelRepeat V2 decision sheets + Phase 3 gate (2026-09-30 → 2026-10-01)

Moved verbatim out of [`AI_HANDOFF.md`](../../AI_HANDOFF.md) on 2026-10-04 for edit-headroom
housekeeping. Superseded by §59–§65 of the current handoff.

## 56. VelRepeat **V2 — Remaining Owner Decisions Sheet** (2026-09-30)

**Docs only — no code, no schema, no migration 051, no production behavior change.** New audit
`.ai/tasks/audits/velrepeat-v2-owner-decisions-pending-2026-09-30.md` (20 sections, 17 decisions) is a
**human-answerable sheet**: every question carries ID, source evidence, why it matters, the exact
question, choices, the phase it blocks, and the source files affected after approval. §18 is the fill-in
answer form (`G1: B`, `Q2: A`, …) so the owner need not read the codebase.

**No answer was chosen for the owner.** Items: **G1** rule stacking/cap · **G2** rounding+currency
(incl. the per-cycle formula, remainder side, discount allocation) · **G3** package authoring · **Q2**
`sold_count` recognition moment · **B/C/D/F** refund · skip · pause · out-of-stock money · **MS**
multi-seller attribution (payout flagged as a separate architecture decision, not designed) · **PS** package↔seller ·
**LS/CS** plan + cycle status vocabularies · **RW** reservation window · **SE** seller eligibility ·
**CI** cycle identity approval · **PX** snapshot confirmation · **V1V2** compatibility.

**`PHASE 2 = BLOCKED`** on G1, G2, G3. Explicitly NOT defaulted: `total_amount / commitment_cycles`,
the current retry-forever out-of-stock behaviour, and the current silent pause deferral
(`velrepeat-plans.ts:520`). **One citation corrected:** `commissions.order_id` is at
`db/run-sqleditor.sql:522` (not `:521`). Next action = obtain the owner answers; **do not start Phase 2**.

---

## 57. VelRepeat **V2 — G1/G1.1/G2/G3 implemented** (2026-09-30)

**Pricing engine + seller-owned packages. No Phase 3–9 behaviour.** New `backend/lib/money.ts` (exact
`bigint` rational money, one half-up 2dp rounding at the final price, no float),
`backend/lib/velrepeat-pricing.ts` (G1 **B** sequential/multiplicative rules ordered by persisted
`priority` then `key`, G1.1 **30% effective-discount cap**, platform rule set from
`platform_settings.velrepeat_pricing_rules`, decision-E snapshot writer over the existing Phase 1
tables), `backend/routes/velrepeat-packages.ts` (G3 **B** seller-owned packages).

**G3:** `velrepeat_packages.seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE` +
`idx_velrepeat_packages_seller`, in both canonical files (byte-identical). Item ownership is derived
`products → shops → sellers`; every line must resolve to the package owner or the whole
transaction is rejected. Seller identity only ever from the session.

**BLOCKED — the 30% cap has no resolution policy.** A breach **fails closed**
(`PricingCapExceededError`): the engine does not trim the last rule, scale the rules, keep only the
top priority, or clamp to the 70% floor, because each is an undecided business policy.
`PRICING_CAP_POLICY` is the next owner decision.

**Also still blocked:** absolute-amount discount rules, rule scoping, per-cycle price + remainder,
refund/skip/pause/out-of-stock money, `sold_count` moment, reservation window, multi-seller
attribution, plan/cycle vocabularies, cycle identity, payment linkage, Stripe prepaid charge.
`insertPricingSnapshot()` is exported and tested but **not yet called** — Phase 4 wires it.

**Verification:** `bun run test` **1445 pass / 207 skip / 0 fail** (1652 tests, 56 files) · backend tsc 0 ·
typecheck 4/4 · build:apps 4/4 · `git diff --check` clean · schema files identical · no migration 051 ·
`db/run-update.sql` still absent. Audit: `.ai/tasks/audits/velrepeat-v2-g1-g3-implementation-2026-09-30.md`.
Docs + code only; **DB-gated tests SKIPPED locally (no PostgreSQL)** — CI postgres:16 is the only real
DB execution. **Production untouched: V2 tables still do not exist there** (048–050 unapplied).

## 58. VelRepeat **V2 Phase 3 — BLOCKED before implementation** (2026-09-30)

**Package → Repeat Plan purchase-time pricing snapshot was not started.** The brief's §4 inspection
found the phase hits its own §21 stop conditions; no code, schema, migration, or production behavior
changed. Audit: `.ai/tasks/audits/velrepeat-v2-phase3-pricing-snapshot-2026-09-30.md`.

**Blocker A — plan initial status [OWNER DECISION REQUIRED].** The owner's machine
`draft → pending_payment → active → paused → completed/cancelled` (owner-decision-closure §5.1) needs
`pending_payment`, absent from `velrepeat_plans.status` (`db/run-sqleditor.sql:827`); LS.1/LS.4
unanswered; the binding gate table already marks **Phase 3 Repeat Plan [BLOCKED] (shape + eligibility)**
(§10.2). Creating the plan `active` (DEFAULT; the only status any writer produces) hands it to the live
V1 engine — `processDuePlans` sweeps `status='active' AND next_run_at <= NOW()`
(`velrepeat-scheduler.ts:444-451`), then live re-price `:245`, orders `:270`, stock `:328`,
`reserveInventoryStock` `:341`, `sold_count` `:344`, COD pseudo-payment `:351` — every one forbidden by
Phase 3. `draft`/`pending_payment` are the unanswered shape, and adding either (or a `package_id`
marker) to `velrepeat_plans` needs migration 051 on a production table (forbidden). The snapshot cannot
decouple: `velrepeat_pricing_snapshots.plan_id NOT NULL REFERENCES velrepeat_plans(id)` (`:923`).

**Blocker B — seller eligibility for repeat commerce [OWNER DECISION REQUIRED]** (which sellers may
appear in a plan/package; G3=B made packages seller-scoped, removing the Phase-2 exemption — closure
§12 item 4 / §11.2 item 6).

**Also open (recorded, not the stopper):** the shared creation route is COD-only
(`velrepeat-plans.ts:223`, `:836`) so `payment_method` needs the Phase-4 rail decision; plan creation
has no canonical idempotency (`checkout_requests` is checkout/payment-scoped); `PRICING_CAP_POLICY`
stays inherited-open from Phase 2.

**Verified clean:** HEAD `356c640` == `origin/main`; tree clean before the docs record; no change to
payment / inventory / fulfillment / `sold_count` / COD / V1 / schema; `db/migrations` still ends at
`050`; `db/run-update.sql` still absent; V2 tables still absent in production (048–050 unapplied).
**Next:** owner answers Q-A/Q-B (audit §5) before Phase 3 (or Phase 4) starts.

