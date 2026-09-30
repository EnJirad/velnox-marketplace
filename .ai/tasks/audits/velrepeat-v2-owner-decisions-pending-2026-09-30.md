# VelRepeat V2 — Remaining Owner Decisions (Answer Sheet)

```
STATUS: OWNER DECISIONS REQUIRED

BLOCKS PHASE 2      → G1, G2, G3
BLOCKS PHASE 6      → Q2 sold_count recognition
BLOCKS PHASE 7/9    → Multi-seller attribution
BLOCKS PHASE 4/5/9  → Relevant plan/cycle/inventory/refund decisions
```

**Repository:** `EnJirad/velnox-marketplace` · branch `main` · base commit `3d798b9fc3767ab8c6a033d6b5061cdeaf3dc810`
**Prepared:** 2026-09-30 · **Docs only — no code, no schema, no migration, no production behavior change**
**Predecessor:** `.ai/tasks/audits/velrepeat-v2-owner-decision-closure-2026-09-30.md` (the binding decision record)

---

## How to use this sheet

1. **You do not need to read the codebase.** Every question below is self-contained.
2. Jump to **§18 — Owner Answer Form** and fill in one line per ID (`G1: B`, `Q2: A`, …).
3. Each section states: the current repository evidence, why it matters, the exact question, concrete
   choices, the phase it blocks, and the source files that would change **after** you approve.
4. **No answer has been chosen for you.** Where this document offers choices (A/B/C/D), those are
   options, not defaults. Where it says `OWNER FORMULA REQUIRED`, it means the repository contains
   **no** value, column, or rule from which the answer can be derived — only you can supply it.

**Phases referenced** (from `.ai/context/velrepeat-contract.md` §62 roadmap):

| Phase | Scope |
|---|---|
| 1 | Domain + additive schema — **DONE** (`ea79277`, `8c96a9e`) |
| 2 | Pricing engine / snapshot writer — **BLOCKED** by G1, G2, G3 |
| 3 | Plan lifecycle + checkout surface |
| 4 | Plan payment (one prepaid charge) |
| 5 | Cycle generation + scheduling |
| 6 | Per-cycle inventory reserve / commit / release |
| 7 | Seller surfaces + eligibility |
| 8 | Cycle → Order creation + fulfillment |
| 9 | Refund / skip / pause / out-of-stock money |
| 10 | Rollout, migration, deprecation |

---

## Tag legend

Every claim in this document is tagged.

| Tag | Meaning |
|---|---|
| `[PROVEN]` | Verified directly in source at the cited `file:line` in this pass |
| `[IMPLEMENTED]` | Already exists in code/schema |
| `[OWNER DECISION]` | Already answered by the owner in the closure pass — binding |
| `[OWNER DECISION REQUIRED]` | Cannot be derived from source; only the owner can answer |
| `[OWNER FORMULA REQUIRED]` | A money/arithmetic value that does not exist anywhere in the repository |
| `[BLOCKED]` | Cannot proceed until an external condition is met |
| `[CITATION CORRECTION]` | A line number in a prior audit that was wrong and is corrected here |

---

## Decision index

| ID | Question | Type | Blocks |
|---|---|---|---|
| **G1** | How do multiple pricing rules combine? | decision | **Phase 2** |
| **G2** | Rounding and currency policy | decision + formula | **Phase 2** |
| **G3** | Who may author a package? | decision | **Phase 2** |
| **Q2** | When does one VelRepeat unit count as sold? | decision | **Phase 6** |
| **B** | Refund formula for future unfulfilled cycles | **formula** | **Phase 9** |
| **C** | Skip → end of commitment or consumed cycle? | decision + formula | **Phase 9** |
| **D** | Pause → extend horizon or consume cycles? | decision + formula | **Phase 9** |
| **F** | Out-of-stock cycle money + escalation | decision + formula | **Phase 9** |
| **MS** | Multi-seller money attribution | decision (+ architecture) | **Phase 7 / 9** |
| **PS** | Package ↔ seller relationship | decision | **Phase 2 / 7** |
| **LS** | Plan status vocabulary | decision (shape) | **Phase 3 / 4** |
| **CS** | Cycle status vocabulary | decision (shape) | **Phase 5** |
| **RW** | Inventory reservation window | decision | **Phase 4 / 6** |
| **SE** | Seller eligibility | decision | **Phase 7** |
| **CI** | Cycle identity model | architecture approval | **Phase 5** |
| **PX** | Price snapshot confirmation | confirmation | **Phase 4** |
| **V1V2** | V1 / V2 compatibility & deprecation | decision | **Phase 10** |

**Count: 17 decisions.** No item below has been inferred, defaulted, or worked around.

---

## 1. G1 — Pricing Rule Combination

### 1.1 Current repository evidence `[PROVEN]`

- A pricing snapshot records **which rule produced the price**, but not how rules combine:
  `pricing_rule_key` and `pricing_rule_version` are single scalar columns —
  `db/run-sqleditor.sql:931-932` (`velrepeat_pricing_snapshots`, table `:921-936`).
- A snapshot records **exactly one** discount as a lump sum:
  `discount_type` `:927`, `discount_value` `:928`, `discount_amount` `:929`; plus
  `subtotal_amount` `:926` and `total_amount` `:930`.
  **There is no array of applied rules and no per-rule amount column.**
  `[PROVEN]` — one discount field means the storage can represent a *resolved* outcome, never a stack.
- There is **no pricing-rule table anywhere in the schema.** A `grep` of `db/run-sqleditor.sql`
  finds no `CREATE TABLE … pricing_rules`. Pricing rule data is currently expected to live in
  `platform_settings` (`:657-662`, a flat `TEXT` key/value table with no typing and no versioning)
  or to be seeded by a later phase. `[PROVEN]`
- The live V1 repeat path has **hardcoded** discount percentages, not rules — the 1/2/4/8/16-cycle
  → 0/3/7/10/15 % ladder — recorded in `.ai/tasks/audits/medium-10-velrepeat-commerce-lifecycle-2026-09-30.md`
  and superseded by the owner's decision **H/Q11** (pricing rules are platform-controlled,
  data-driven configuration). `[OWNER DECISION]`
- Live V1 re-pricing happens on every scheduler run:
  `backend/jobs/velrepeat-scheduler.ts:245` — `UPDATE velrepeat_items SET unit_price = $1 …`.
  `[PROVEN]` This is the exact opposite of the V2 snapshot model and is Phase 4/5 work.

### 1.2 Why it matters

This is **the amount the customer is charged**. Phase 2's entire deliverable is the pricing engine,
whose contract exit criterion is *"tier changes need no code edit"*. An engine cannot compute a total
without knowing whether two applicable rules combine. The difference is customer-visible money:

- **Stacking (A):** 7 % commitment tier + 5 % quantity tier → 12 % off, or 7 % then 5 % off the
  already-discounted price (= 11.65 % effective). These are **three different totals**.
- **One-wins (B):** whichever rule has the higher `priority` wins outright; the other is discarded.

The owner named `priority` as a required field but never stated whether rules **combine**.
`[OWNER DECISION REQUIRED]`

### 1.3 Exact question

> **G1:** When more than one pricing rule applies to a single VelRepeat commitment — for example a
> 4-cycle commitment tier (7 %) and a quantity tier (5 %) — **how is the final discount determined?**

### 1.4 Choices

| Choice | Meaning | Requires a cap answer? |
|---|---|---|
| **A** | Discounts **stack additively** (7 % + 5 % = 12 %) | **Yes** — see G1.5 |
| **B** | Discounts **stack multiplicatively/sequentially** (apply rule 1, then apply rule 2 to the reduced amount) | **Yes** — see G1.5 |
| **C** | The single highest-`priority` applicable rule **wins outright**; all others are discarded | No cap needed, but state whether the runner-up is recorded in `metadata` for audit |
| **D** | Other owner-defined rule — describe it exactly | State it |

### 1.5 Follow-up if stacking is chosen (G1.5)

> **G1.5:** Is there a **maximum combined discount** (e.g. never exceed 15 %, or never exceed 20 %)?
> If yes, give the exact cap and the exact comparison (`>=` or `>`), because that boundary decides the
> charged amount.
> Also: when the cap binds, is the cap recorded as a rule row in the snapshot, or only in `metadata`?
> `[OWNER DECISION REQUIRED]`

### 1.6 Downstream phase blocked

**Phase 2** — the pricing engine. Also transitively Phase 4 (the charged amount) and every refund
formula in §5, which need a discount allocation to divide.

### 1.7 Source files affected after approval

*New (none exist today — Phase 2 creates them):*
- pricing rule storage — new table in `db/run-sqleditor.sql` **and** `db/schema.sql` (must stay
  byte-identical), plus a new `db/migrations/05X_*.sql` **only after migrations 048–050 are applied
  in production** (see the production note in §19.3)
- the Phase 2 pricing engine module under `backend/lib/`
- the snapshot writer that populates `velrepeat_pricing_snapshots.discount_type/discount_value/discount_amount` (`:927-929`)

*Existing (Phase 4/5, not this decision):*
- `backend/jobs/velrepeat-scheduler.ts:245` — the live V1 re-price, must become impossible for prepaid plans

---

## 2. G2 — Rounding and Currency

### 2.1 Current repository evidence `[PROVEN]`

**All money in the repository is `NUMERIC(12, 2)` — exactly two decimal places.** There is no
per-currency precision table anywhere.

| Location | Column |
|---|---|
| `db/run-sqleditor.sql:926,929,930` | `subtotal_amount`, `discount_amount`, `total_amount` (all `NUMERIC(12,2)`) |
| `db/run-sqleditor.sql:928` | `discount_value NUMERIC(12,2)` — a **percentage** stored in a 2-decimal money type |
| `db/run-sqleditor.sql:943-944` | snapshot item `unit_price`, `line_total` (`NUMERIC(12,2)`) |
| `db/run-sqleditor.sql:856` | `velrepeat_items.unit_price NUMERIC(12,2)` |
| `db/run-sqleditor.sql:524-525` | `commissions.amount NUMERIC(12,2)`, `rate NUMERIC(5,4) DEFAULT 0.05` |

**Currency is a free-text column with a `'THB'` default and no constraint:**

- `db/run-sqleditor.sql:373` (`orders.currency`), `:444` (`payments.currency`),
  `:838` (`velrepeat_plans.currency`), `:857` (`velrepeat_items.currency`),
  `:925` (`velrepeat_pricing_snapshots.currency`) — all `TEXT NOT NULL DEFAULT 'THB'`,
  **no CHECK, no ISO-4217 validation, no per-currency exponent table**. `[PROVEN]`

**The only rounding rule in the entire repository** is in the Stripe adapter:

```ts
// backend/routes/stripe.ts:198-202
function toMinor(amount: unknown): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(n * 100);      // half-up on the major unit, currency-agnostic
}
```
Used at `backend/routes/stripe.ts:1133` — `const expectedMinor = toMinor(order.total_amount);`
`[PROVEN]` This is a **single boundary rounding at the Stripe handoff** and it is *not* a
VelRepeat pricing rule. It also implicitly assumes every currency has 2 minor digits.

**The division that has no defined behaviour:** a commitment of N cycles is bought with one
`total_amount` (`:930`). There is **no per-cycle amount column** in the snapshot and **no
allocation column**. So "the price of one cycle" is undefined. `[OWNER FORMULA REQUIRED]`

**The discount that has no allocation:** `discount_type` / `discount_value` / `discount_amount`
(`:927-929`) are stored as **one lump**. Whether that lump is spread across cycles proportionally,
applied to early cycles first, or never attributed to a cycle is not derivable. `[OWNER FORMULA REQUIRED]`

### 2.2 Why it matters

- **Rounding is customer-visible money.** Under the owner's own rule **H/Q11**, no business pricing
  rule may be hardcoded in source. A rounding mode chosen silently in code would be exactly that.
- **The two plausible models produce different totals for the same cart.** Rounding the per-cycle
  price first and multiplying gives a different `total_amount` than computing the total once and
  dividing; both are defensible and both are used in real commerce.
- **A non-even division has no home.** THB 990 over 4 cycles = 247.50 exactly; THB 999 over 4 =
  249.75 exactly; THB 1,000 over 3 = 333.33 + remainder 0.01. Something must receive that
  remainder, and *which side* is a business decision, not a rounding-mode detail.
- **Stripe re-rounds.** `toMinor` (`stripe.ts:198-202`) rounds again at the boundary. If the
  snapshot and Stripe disagree by one minor unit, the webhook comparison at `stripe.ts:1133`
  diverges.

### 2.3 Exact question

> **G2:** Define the money rules for VelRepeat V2. Answer each of the six:
>
> **G2.1 Currency policy** — is every VelRepeat plan priced only in THB, or in the seller's/customer's
> currency? May a snapshot carry a currency other than `THB`, and if so, which?
>
> **G2.2 Decimal precision** — is 2 decimal places (`NUMERIC(12,2)`, matching every existing money
> column) the correct precision for **all** VelRepeat amounts, including per-cycle amounts and
> percentages?
>
> **G2.3 When rounding occurs** — pick the boundary:
> **(i)** round each **per-cycle** amount to 2 dp at derivation time and let `total_amount` be their
> sum; **(ii)** compute and round `total_amount` **once** at the snapshot boundary and derive
> per-cycle amounts by division afterwards; **(iii)** compute exactly in high precision and round
> only at the Stripe handoff (`stripe.ts:1133`).
>
> **G2.4 How per-cycle amounts are derived** — give the **exact formula**. If the answer is
> `total_amount / commitment_cycles`, say so **explicitly**; it is not stated anywhere in the
> repository today and must not be assumed.
>
> **G2.5 Non-even division** — what happens when `total_amount` does not divide evenly by
> `commitment_cycles` (e.g. 1,000.00 ÷ 3)?
>
> **G2.6 Which side receives the remainder** —
> **(a)** all remainders accumulate to the **last** cycle (that cycle is slightly larger);
> **(b)** all remainders accumulate to the **first** cycle (that cycle is slightly larger);
> **(c)** the remainder is **split evenly** down to the minor unit among as many cycles as needed;
> **(d)** the remainder is returned to the customer as a **separate adjustment**;
> **(e)** other owner-defined rule.
>
> **G2.7 Discount allocation** — how is the single `discount_amount` (`:929`) spread across cycles?
> Proportional to each cycle's line value? Applied to the earliest cycles first? Never attributed to
> a cycle at all (total-level only)?
>
> **G2.8 Rounding mode** — half-up, half-even (banker's), or half-down? State it explicitly; the
> repository's only existing rounding (`stripe.ts:201`) is `Math.round`, i.e. **half-up on the
> absolute value**, but that is a Stripe-adapter detail, not an approved business rule.

`[OWNER DECISION REQUIRED]` for G2.1–G2.3, G2.5, G2.6, G2.8 · `[OWNER FORMULA REQUIRED]` for
G2.4 and G2.7 (the value does not exist in the repository).

### 2.4 Choices — G2.5 / G2.6 (the remainder)

| Choice | Remainder behaviour |
|---|---|
| **A** | Remainder to the **last** cycle |
| **B** | Remainder to the **first** cycle |
| **C** | Remainder **split evenly** across as many cycles as needed (one minor unit each) |
| **D** | Remainder **not given to any cycle** — refunded/credited separately |
| **E** | Owner-defined — describe |

### 2.5 Downstream phase blocked

**Phase 2** (the pricing engine must produce the stored value), and transitively **Phase 9** —
the §5 refund formula cannot be computed without a per-cycle amount and a discount allocation.

### 2.6 Source files affected after approval

- `velrepeat_pricing_snapshots` (`:921-936`) — a per-cycle amount column and/or an allocation column
  would have to be **added**; `db/run-sqleditor.sql` **and** `db/schema.sql`, plus a new migration
  **only after 048–050 are applied in production**
- the Phase 2 pricing/snapshot writer module
- the refund calculation in Phase 9 (`backend/routes/velrepeat-plans.ts`, new refund route)
- `backend/routes/stripe.ts:198-202` — only if G2.3(iii) is chosen, to confirm the boundary agrees
- `db/run-sqleditor.sql:373,444,838,857,925` — only if G2.1 introduces a currency CHECK

---

## 3. G3 — Package Authoring Ownership

### 3.1 Current repository evidence `[PROVEN]`

The V2 package tables carry **no owner, no author, no seller, and no price**:

```sql
-- db/run-sqleditor.sql:898-906
CREATE TABLE IF NOT EXISTS velrepeat_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

```sql
-- db/run-sqleditor.sql:908-919
CREATE TABLE IF NOT EXISTS velrepeat_package_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  package_id UUID NOT NULL REFERENCES velrepeat_packages(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- **No `seller_id`, no `created_by`, no `author`, no `price`, no `stock` column.** `[PROVEN]`
  The schema does not even *record* who may write these rows.
- **Contrast V1**, which is single-product, single-seller and fully denormalized:
  `vrepeat_packages` (`:680-707`) carries `product_id` `:682`, `shop_id`, `seller_id`,
  `unit_price` / `regular_unit_price` / `discount_amount` / `total_amount`,
  `currency DEFAULT 'THB'` `:694`, its own `status` CHECK (`:696`, values
  `pending_payment, paid, active, paused, completed, cancelled, refunded`) and
  `payment_id UUID REFERENCES payments(id)` — plus `vrepeat_deliveries` (`:710-727`) with
  `UNIQUE (package_id, delivery_number)` `:724`. V1 has **its own price and its own status**;
  V2 has neither. `[PROVEN]`
- Because a V2 package has no price, its price is **derived** from the product catalog plus the
  pricing rules — which means its *composition* is a pricing input. Whoever authors the composition
  therefore influences the customer's total. `[PROVEN]`
- **There is no route that writes these tables.** A grep for `velrepeat_packages` /
  `velrepeat_package_items` outside `db/` and tests finds no INSERT/UPDATE route. `[PROVEN]`
  So no authorization rule exists to inspect, and none is invented here.
- The owner's **Q15** answered only *which tables* V2 uses (coexistence with V1). It did not
  answer authorship. `[OWNER DECISION]`

### 3.2 Why it matters

- **Authorization, not just pricing.** Repo rules (`AGENTS.md`, `.ai/AI_RULES.md` §4, §9) require
  the backend to enforce ownership on every mutation. "Who may write this row" must be decided
  before the row can be written by anyone.
- **Seller-authored packages change the money model.** If a seller can author a package, its
  composition is seller-controlled pricing input, and the §9 (MS) multi-seller attribution question
  moves **earlier** from Phase 7/9 into Phase 2.
- **Post-purchase modification** is a snapshot-safety question: customers have already bought
  plans whose snapshot derives from a package. Changing a package after purchase must be impossible
  or versioned — decision **E** fixed the *price* half (snapshot at purchase) but not the
  *package-edit-after-purchase* half. `[OWNER DECISION REQUIRED]`

### 3.3 Exact question

> **G3:** Who may **create** a `velrepeat_packages` row and edit its `velrepeat_package_items`
> composition?

| Choice | Meaning |
|---|---|
| **A** | **Platform/admin only** — sellers never author packages; a seller may only *request* one |
| **B** | **Seller only** — each seller authors its own packages |
| **C** | **Both**, with **different permissions** — state precisely what each role may do (e.g. admin may create/cross-seller; seller may create only within its own catalog) |
| **D** | Other owner-defined model — describe |

### 3.4 Follow-ups (G3.1 – G3.5)

> **G3.1 Own-products restriction** — may a seller author a package containing only **its own**
> products, or any product? (If G3 = C, this is the difference between seller-scoped and platform-scoped.)
>
> **G3.2 Cross-seller packages** — may **one** package contain items from **multiple sellers**?
> See also §10 (PS) — that question is asked separately because it also constrains V1/V2.
>
> **G3.3 Operator cross-seller packages** — may a platform operator author a package that mixes
> sellers? (`is_active BOOLEAN` exists at `:901`, so a platform-authored, seller-agnostic package
> is structurally possible today — but nothing authorizes it.)
>
> **G3.4 Publish / unpublish** — who may flip `is_active` (`:901`)? Seller, admin, or both? Is
> publish required before a package is purchasable, and is an unpublished package still visible?
>
> **G3.5 Modify after purchase** — may a package be edited **after** customers have already bought
> plans derived from it?
> **(a)** never — packages are immutable once referenced by a plan;
> **(b)** freely — but existing plans are unaffected because of the price snapshot (decision E);
> **(c)** editable only for **future** plans, with existing plans pinned to a package version;
> **(d)** other. Note: there is **no package-version column** today, so (c) requires new storage. `[PROVEN]`

`[OWNER DECISION REQUIRED]` — none of G3.1–G3.5 can be inferred from the schema or any existing route.

### 3.5 Downstream phase blocked

**Phase 2** (package composition is a pricing input). Transitively §10 (PS) and §9 (MS), which can
move Phase 7/9 items earlier.

### 3.6 Source files affected after approval

- `velrepeat_packages` (`:898-906`) — an owner/author column (and possibly a version column if
  G3.5 = c) would have to be **added**; `db/run-sqleditor.sql` **and** `db/schema.sql`, plus a new
  migration **only after 048–050 are applied in production**
- `velrepeat_package_items` (`:908-919`) — a seller denormalization if G3.2/G3.3 allow cross-seller
- a new package CRUD route (none exists) plus its authz middleware
- `backend/lib/permissions.ts` — if seller-authored packages need a new permission key
- `packages/shared/src/lib/api-routes.ts` — new route constants

---

## 4. Q2 — When does one VelRepeat unit count toward `products.sold_count`?

> This is the **critical unresolved architecture conflict.** It was reported and stopped in the
> closure pass (`.ai/tasks/audits/velrepeat-v2-owner-decision-closure-2026-09-30.md` §3.4, §4.1).
> It is **not** a preference question — it changes what `sold_count` *means* in one schema.

### 4.1 Current repository evidence `[PROVEN]`

**`sold_count` is written in exactly one place.**

```ts
// backend/lib/inventory.ts:141  (inside commitOrderInventory, declared :115)
`UPDATE products SET sold_count = sold_count + $1 WHERE id = $2`,
```

That function's own header states its lifecycle and gate:

```ts
// backend/lib/inventory.ts:77-81
 *   reserve (checkout) → commit (payment settled)  xor  release (order ended)
 * EXACTLY-ONCE. The caller's status claim (`orders.status → 'paid'`, taken
```

- Its **only** caller is the Stripe webhook settlement:
  `backend/routes/stripe.ts:559` inside `markPaymentSucceeded` (`:418`), whose order claim is
  `status IN ('pending','pending_payment')` (`:430-434`) and which locks the order first (`:428`).
  `[PROVEN]`
- `commitOrderInventory` settles what it reads from `order_items WHERE order_id = $1`
  (`inventory.ts:119-122`), so **a `sold_count` can only be committed if the cycle's order actually
  carries `order_items` rows.** `[PROVEN]` — this ties Q2 structurally to Phase 8 (cycle → order).
- Corollary: **recognition happens when money settles, i.e. before the goods are packed, shipped or
  delivered.** Corroborated by the fulfillment graph, where `packing` has **no** edge to `cancelled`
  (`backend/lib/order-fulfillment.ts:86`, transitions `:89-96`).

**The V2 path has no payment to settle.** Under owner decision **Q14** the customer pays **once** at
plan level. A cycle order never receives its own payment settlement, so **the canonical writer is
unreachable for every cycle order.** `[PROVEN]`

**The existing scheduler already violates the single-writer rule:**

```ts
// backend/jobs/velrepeat-scheduler.ts:344
`UPDATE products SET sold_count = sold_count + $1 WHERE id = $2`,
```

and the structural guard test **deliberately excludes this file and names it as a known finding**
(`backend/tests/inventory-settlement.test.ts:98-99`; the guard list `:95-121` forbids
`sold_count = sold_count +` in `cart.ts`, `stripe.ts`, `seller-orders.ts`, `center.ts`,
`payment-reservation-scheduler.ts`). `[PROVEN]` Nothing ever reverses that increment.
Removing it is **Phase 6** work, not this task.

**Two supporting findings from the closure pass that Q2 must account for:**
1. The release guard's *"a settled payment outranks a cancellation"* protection is keyed to
   **per-order `payments` rows** (`inventory.ts:226-232` — `NOT EXISTS (… settled payment …)`)
   and **disappears entirely for cycle orders** under Q14. `[PROVEN]`
2. `paymentAllowsConfirmation` (`backend/lib/order-fulfillment.ts:218-235`) looks **only at that
   order's own payment history** (`PAID_PAYMENT_STATUSES = ["paid"]` `:189`, COD path `:192`) and
   would therefore **refuse every cycle order** for confirmation. `[PROVEN]` Phase 8 must extend
   that gate, not bypass it.

### 4.2 Why it matters

`sold_count` drives product popularity in the storefront. Under Q2 the model is:

```
Plan → ONE prepaid payment → N cycles → N fulfillment orders
```

whereas the repository's entire commerce surface assumes:

```
Order → its own payment → settlement → sold_count
```

Choosing the recognition moment decides whether VelRepeat sales appear **in step** with every other
sale in the system, or **later** than every other sale.

### 4.3 Exact question

> **Q2:** When does **one** VelRepeat unit count toward `products.sold_count`?

| Choice | Recognition moment | Consequence in this repository |
|---|---|---|
| **A** | When the corresponding **Cycle becomes financially settled** — i.e. the cycle order is **created and claimed** from the already-paid commitment | **Consistent with existing semantics.** It sits in the same relative position as "payment settled" for an ordinary order: the money is already in, the obligation is now real. `commitOrderInventory` stays the single writer and gets a per-cycle trigger in Phase 6. `sold_count` keeps one meaning repo-wide. **Requires** a cycle-state claim, because the release guard's payment-based protection does not apply to cycle orders. |
| **B** | When the Cycle's **fulfillment is successfully completed** — i.e. the order reaches `completed` via `delivered` (`order-fulfillment.ts:93-94`) | **Diverges from existing semantics.** VelRepeat would recognize revenue *strictly later* than every other commerce path, and the `packing`/`shipped`/`delivered` states would gain a money side effect they have never had. The `inventory-settlement` single-writer guard would describe two different business moments. **Requires** a claim at `delivered`/`completed` and a release path that survives a long hold (the 30-minute payment window is meaningless for a prepaid cycle). |
| **C** | When the Cycle's **Order reaches the canonical paid/sold order state** (`orders.status → 'paid'`, `db/run-sqleditor.sql:1029-1033`) | **Explicitly requires synthesizing a `paid` order status for an order that was never charged.** This would let the existing guards keep working unchanged, but it makes `orders.status = 'paid'` mean "covered by a plan payment" rather than "this order's money arrived" — a second meaning for the same column. **Requires** the payment-authority decision Q13=B (plan-level linkage inside the one `payments` authority) to land first. |
| **D** | Other owner-defined rule — describe the exact event and the exact claim |

`[OWNER DECISION REQUIRED]` — the owner's own Q2 text named the *forbidden* cases (no increment at plan
creation, none at the prepaid payment, no double count, no counting an unfulfilled cycle, canonical
writer only) but left the exact moment open.

### 4.4 Two sub-questions that follow Q2

> **Q2.1** Should `sold_count` be incremented **once per delivered unit per cycle** (so a 4-cycle
> plan of 2 units each yields 8 over its life), and never decremented on skip/cancel?
>
> **Q2.2** Under Q14 there is **no per-cycle `payments` row**. Should Phase 6 introduce a
> **cycle-state claim** for inventory commit/release that does **not** depend on a `payments` row
> (the alternative to reusing choice C)? `[OWNER DECISION REQUIRED]`

### 4.5 Downstream phase blocked

**Phase 6** (per-cycle commit trigger) and **Phase 8** (cycle → order creation, plus extending
`paymentAllowsConfirmation` at `order-fulfillment.ts:218-235`).
**Phase 2 is NOT blocked by Q2** — Phase 2 writes no counter.

### 4.6 Source files affected after approval

- `backend/lib/inventory.ts` — a per-cycle commit/release claim (or an extended caller contract at
  `:79-81`); the single writer at `:141` must **stay** the only increment
- `backend/routes/stripe.ts:559` — unchanged in principle; a cycle trigger is a **new** call site
- `backend/jobs/velrepeat-scheduler.ts:344` — the violating direct increment to be removed (Phase 6)
- `backend/lib/order-fulfillment.ts:218-235` — confirmation gate must recognize plan-covered orders
- `velrepeat_cycles.status` CHECK (`db/run-sqleditor.sql:954`) — only if the claim uses a new state
  (see §12, CS)
- `backend/tests/inventory-settlement.test.ts:95-121` — the guard list must be extended when the new
  call site is added, so the single-writer contract stays enforceable

---

## 5. B — Refund Formula for Future Unfulfilled Cycles `[OWNER FORMULA REQUIRED]`

### 5.1 What is already decided `[OWNER DECISION]`

Decision **B** closed the *policy*: refund only **future unfulfilled** cycles; a fulfilled cycle is
not "future"; never edit a payment amount; canonical `refunds` / Stripe only; immutable calculation
recorded in a snapshot; idempotent; no over-refund; no auto-refund from an ambiguous webhook; fully
back-auditable.

### 5.2 Current repository evidence `[PROVEN]`

**The mechanism exists; only the amount is missing.**

| Element | Evidence |
|---|---|
| `refunds` table | `db/run-sqleditor.sql:502-518` |
| `refunds.order_id` is `NOT NULL REFERENCES orders(id)` | `:504` — **a plan-linked refund row is unrepresentable until Q13=B's linkage lands** |
| `refunds.payment_id` | `:505` |
| `provider_refund_id` uniquely indexed (idempotency) | `:517` |
| Webhook-confirmed recomputation reads `payment.amount, payment.refunded_amount` | `backend/routes/stripe.ts:1641` |
| `refundableMinorFor(paidAmount, alreadyRefunded)` never returns a negative | `backend/routes/stripe.ts:320` |
| `payments.refunded_amount`, `refunds.status` | `:450-451` area — `refunded_amount NUMERIC(12,2) NOT NULL DEFAULT 0`, `refund_status TEXT` |

**What does NOT exist `[OWNER FORMULA REQUIRED]`:**

- **No per-cycle amount column** anywhere. The snapshot (`:921-936`) stores `commitment_cycles`
  `:924`, `subtotal_amount` `:926`, `discount_type` `:927`, `discount_value` `:928`,
  `discount_amount` `:929`, `total_amount` `:930` — a **lump**. `[PROVEN]`
- **No discount→cycle allocation.** `:927-929` is one discount, not one per cycle. `[PROVEN]`
- **No per-line-to-cycle allocation** — snapshot items (`:937-949`) carry `product_id`, `variant_id`,
  `quantity` `:942`, `unit_price` `:943`, `line_total` `:944`, with no cycle reference. `[PROVEN]`
- **No credit instrument** for a non-refund resolution anywhere in the schema. `[PROVEN]`

> ⚠️ **`total_amount / commitment_cycles` is NOT an approved formula.** It is one candidate only. It
> is stated nowhere in the repository, and it interacts directly with G2's rounding answer (§2.3,
> G2.4). It is **not** used as a default anywhere in this document.

### 5.3 Exact question — the owner must supply all seven

> **B — Refund of future unfulfilled cycles.** Given a plan paid with one charge, define:
>
> **B.1 Value of one cycle** — the **exact formula**. Is it `total_amount / commitment_cycles`? Or
> `subtotal_amount` before/after discount? Or a per-cycle figure stored at snapshot time? State it
> exactly, and state whether the G2.6 remainder belongs to a refundable cycle.
>
> **B.2 Discount allocation** — how is the single `discount_amount` (`:929`) distributed when only
> *some* cycles are refunded? Proportional to cycle value? Discount applied to earliest cycles first
> (so late refunds are full price)? Never attributed to a cycle? State exactly.
>
> **B.3 Rounding** — rounding mode and rounding point for the refund amount, and whether the refund
> may differ from the sum of its cycles by one minor unit. Must agree with **G2.8**.
>
> **B.4 Already-fulfilled cycles** — confirm policy B: a fulfilled cycle is **never** refunded by this
> path. (Already decided; stated here so the formula covers it.)
>
> **B.5 Reserved but not packed cycles** — the decisive boundary. A cycle order can be
> `pending`/`confirmed` (inventory reserved, `inventory.ts:54-68`, nothing shipped) or `cancelled`.
> Which of these are **refundable**?
> `(a)` any cycle not yet `shipped`/`delivered`; `(b)` only cycles with **no order row at all**;
> `(c)` only cycles in `scheduled` state; `(d)` other.
> This matters because `releaseOrderInventory` (`inventory.ts:209`) can restore stock for an order
> (`RELEASABLE_STATUSES` `:176-182`) and the release claim at `:221-234` is gated by
> `NOT EXISTS (… settled payment …)` — **which a cycle order never has** under Q14. `[PROVEN]`
>
> **B.6 Cancelled cycles** — a cycle already in `cancelled` state: is it refundable, already
> refunded, or excluded?
>
> **B.7 Multi-seller allocation** — for a plan spanning sellers, how is the refund split? See §9 (MS);
> `commissions.order_id` is `NOT NULL` (`:522`), `settlements` (`:528-534`) has no plan/cycle
> reference, and **neither table has any backend writer** (grep for `INSERT INTO commissions`,
> `FROM commissions`, `INTO settlements`, `FROM settlements` in `backend/**` excluding tests → **0
> matches each**). `[PROVEN]` So a per-seller refund split is **not representable today**.

### 5.4 Choices — B.5 (the refundable boundary)

| Choice | Refundable cycles |
|---|---|
| **A** | Every cycle **not yet shipped/delivered** |
| **B** | Only cycles with **no order row** created yet |
| **C** | Only cycles in `scheduled` state (not `processing`/`ordered`) |
| **D** | Owner-defined — describe |

### 5.5 Downstream phase blocked

**Phase 9 STOPPED.** Also transitively Phase 4 (the snapshot must store whatever B.1/B.2 define).

### 5.6 Source files affected after approval

- `velrepeat_pricing_snapshots` (`:921-936`) — **a per-cycle amount column and a discount
  allocation column would have to be added**; `db/run-sqleditor.sql` **and** `db/schema.sql`, plus a
  new migration **only after 048–050 are applied in production**
- `velrepeat_cycles` (`:950-965`) — only if a per-cycle amount is stored per cycle instead
- `refunds` (`:502-518`) — the plan-level linkage implied by Q13=B, since `order_id` is `NOT NULL` `:504`
- `backend/routes/stripe.ts:320,1641` — the refund writer must use the canonical helpers
- a new refund route in `backend/routes/velrepeat-plans.ts` or a new `backend/routes/velrepeat.ts` section
- `backend/lib/inventory.ts:209-234` — release path must recognize cycle orders without a `payments` row

---

## 6. C — Skip a Future Cycle `[OWNER FORMULA REQUIRED]`

### 6.1 What is already decided `[OWNER DECISION]`

Decision **C** closed the *policy*: skip only a **future unfulfilled** cycle; **never** `packing`;
**never** `shipped`; never rewrite a historical financial record; skip writes an audit/event; skip is
**not** a successful delivery; the skipped cycle's inventory is **not** committed as sold.

### 6.2 Current repository evidence `[PROVEN]`

- **There is no skip endpoint at all.** `grep -c skip backend/routes/velrepeat-plans.ts` → **0**.
  `[PROVEN]` Skip is a new capability in Phase 9, not an edit.
- `velrepeat_cycles.status` CHECK (`:954`) already contains **`skipped`** as a distinct value from
  `completed` — so "skip is not success" is structurally representable today. `[PROVEN]`
- `velrepeat_runs.status` CHECK (`:873`) also contains `cancelled` and `failed` separately. `[PROVEN]`
- The non-oversell / non-success halves are already guaranteed: a throw inside the cycle transaction
  rolls the whole cycle back (`velrepeat-scheduler.ts:111` claim → `:394`), and
  `packing → [shipped]` is the only edge out of `packing` (`order-fulfillment.ts:92`). `[PROVEN]`
- `velrepeat_cycles` has `UNIQUE (plan_id, cycle_number)` (`:962`) and
  `cycle_number > 0` (`:953`), plus a `due` index (`:965`). `[PROVEN]`
- **The money half is missing:** there is no per-cycle value (§5.2) and **no credit instrument**
  anywhere in the schema, so "the customer paid for N and receives N−1" cannot be quantified or
  compensated by anything other than a refund.

### 6.3 The owner's own words (recorded in the closure pass)

The owner explicitly wrote, when deciding C: *"ต้องกำหนดว่าจะเลื่อนไปท้าย commitment
หรือถือเป็น consumed cycle"* — "**it must be decided** whether to postpone to the end of the
commitment **or** treat it as a consumed cycle" — and then instructed that if the monetary
consequence is unclear, mark it `OWNER FORMULA REQUIRED`. `[OWNER DECISION REQUIRED]`

### 6.4 Exact question

> **C — Skip a future cycle.** When a future cycle is skipped:
>
> **C.1 (A/B/C)** Does the skipped cycle:
> **(A)** **move to the end of the commitment** — the customer eventually receives that delivery;
> **(B)** **consume one commitment cycle** — the customer received N−1 deliveries for a price paid
> for N; **(C)** other owner-defined behaviour.
>
> **C.2 (if A)** How does the schedule behave? Is the cycle re-inserted after the current last cycle,
> or does the whole remaining horizon shift? What happens if the customer is *also* paused, or the
> commitment end date is already reached? Does `commitment_cycles` (`:830`) stay at N, or grow to N+k?
>
> **C.3 (if A)** Is the re-queued cycle **financially identical** to the one that was skipped (same
> price, same items), or is it re-priced at the then-current catalog price?
>
> **C.4 (if B)** **Financial consequence** — the customer paid for N cycles and receives N−1. Is the
> value gap: **(i)** credited back at cancellation time, **(ii)** never compensated (accepted),
> **(iii)** compensated only if the plan is later cancelled, **(iv)** handled by an owner-issued
> credit/goodwill outside the system, **(v)** other.
> If (i)/(iii), the amount requires **B.1** and **B.2** first.
>
> **C.5** Does skipping **stop the scheduler from re-attempting** that cycle, permanently and
> idempotently, given `UNIQUE (plan_id, cycle_number)` (`:962`) and
> `UNIQUE (plan_id, scheduled_for)` on `velrepeat_runs` (`:882`)?

### 6.5 Choices — C.1

| Choice | Behaviour |
|---|---|
| **A** | Move to the **end of the commitment** |
| **B** | **Consume** one commitment cycle |
| **C** | Owner-defined — describe |

### 6.6 Downstream phase blocked

**Phase 9 STOPPED.** Also Phase 5 (cycle generation) if C.2 changes how the horizon is computed.

### 6.7 Source files affected after approval

- a **new** skip endpoint in `backend/routes/velrepeat-plans.ts` (none exists — `grep -c skip` → 0)
- `velrepeat_cycles.status` (`:954`) — `skipped` already exists; a re-queue may need `scheduled_at`
  update (`:955`) and a new cycle row, which collides with `UNIQUE (plan_id, cycle_number)` (`:962`)
  → **the cycle-number allocation strategy must be part of the Phase 5 design (CI, §15)**
- `velrepeat_events` (`:887-897`) — the audit/event row for the skip
- `velrepeat_plans.commitment_cycles` (`:830`) — only if C.2 changes the commitment count
- Phase 9 refund/credit code — only if C.4 requires compensation

---

## 7. D — Pause a Prepaid Plan `[OWNER FORMULA REQUIRED]`

### 7.1 What is already decided `[OWNER DECISION]`

Decision **D** closed the *policy*: pause applies to **future cycles only**; never stop a cycle whose
fulfillment has started; historical cycles unchanged; a pause event is stored; no future fulfillment
while paused; resume creates **no duplicate cycles**; deterministic and idempotent.

### 7.2 Current repository evidence `[PROVEN]`

The **live V1 behavior is a silent one-interval deferral with no commitment accounting**:

```ts
// backend/routes/velrepeat-plans.ts:508-520 (resume)
`UPDATE velrepeat_plans SET status = 'paused', …`      // :508, event PLAN_PAUSED :512
               next_run_at = GREATEST(next_run_at, NOW()),   // :520  ← resume defers by one interval
```

- `next_run_at` is advanced by `GREATEST(next_run_at, NOW())` (`:520`) — the plan resumes on its own
  schedule from "now", **losing the elapsed intervals**. `[PROVEN]`
- `velrepeat_plans` has `started_at`, `ended_at`, `next_run_at`, and `commitment_cycles` (`:830`) —
  but **no stored commitment-end date**, so there is nothing today that knows how many cycles the
  customer is still entitled to. `[PROVEN]`
- `idx_velrepeat_plans_due` (`:847`) is `WHERE status = 'active'`, so a paused plan is naturally
  excluded from the due sweep. `[PROVEN]`
- The scheduler's `calculateNextRunAt` (`backend/jobs/velrepeat-scheduler.ts:38-65`) uses
  `setUTCDate` (`:47`, `:50`) and `setUTCFullYear` with month clamping (`:60`) — **UTC**, matching
  owner decision **Q16** (`velrepeat_plans.timezone` `:839` is display-only). `[PROVEN]`
- **The money half is missing:** `velrepeat_plans.commitment_cycles` is nullable (`:830`,
  `IS NULL OR > 0`), so a plan may exist with **no** committed cycle count at all. `[PROVEN]`

### 7.3 Why it matters

Today's behavior (`:520`) means **a customer who pauses for two months receives two fewer deliveries
for a price already paid** — silently. That is exactly the "consume scheduled time/cycles" outcome
and it was never ratified as a business rule. The closure pass recorded it as
`OWNER FORMULA REQUIRED`, not as the answer.

### 7.4 Exact question

> **D — Pause a prepaid plan.** When a prepaid plan is paused:
>
> **D.1 (A/B/C)** Does the pause:
> **(A)** **Extend the commitment horizon** so the customer still receives **all paid cycles**;
> **(B)** **Consume scheduled time/cycles** (customer receives fewer cycles for a price already paid);
> **(C)** Other owner-defined behaviour.
>
> **D.2 (if A)** What exactly extends? Options: (i) each paused cycle's `scheduled_at` (`:955`) is
> pushed forward by the paused duration; (ii) a single `commitment_end` date is stored and the
> generator schedules up to it; (iii) the pause count is stored and added at resume.
> **(iii) requires a new column** — there is none today. `[PROVEN]`
>
> **D.3 (if A)** Financial consequence: the customer paid N and receives N — so there is **no** money
> consequence for the pause itself. Confirm explicitly, so Phase 9 has no refund line for it.
>
> **D.4 (if B)** Financial consequence: the customer paid N and receives N−k. Same options as **C.4**
> (credit at cancellation / never compensated / credit only on cancellation / goodwill / other), and
> the amount again requires **B.1** and **B.2**.
>
> **D.5** Is a pause **time-boxed** (max duration, e.g. 30/60/90 days)? If a pause is unbounded and
> the answer is (A), the commitment end date drifts indefinitely — is that acceptable?
>
> **D.6** Can a customer pause **during a cycle that is already ordered/reserved**? Decision D already
> forbids stopping started fulfillment; confirm the reservation is released or held.
> (Release path: `inventory.ts:209-234` — its claim requires `NOT EXISTS (… settled payment …)`,
> which a cycle order never has under Q14, so a cycle-state claim is needed. `[PROVEN]`)

### 7.5 Choices — D.1

| Choice | Behaviour |
|---|---|
| **A** | **Extend** the commitment horizon — customer receives all paid cycles |
| **B** | **Consume** scheduled time/cycles |
| **C** | Owner-defined — describe |

### 7.6 Downstream phase blocked

**Phase 9 STOPPED.** Also **Phase 5** (cycle generation must know the horizon) and **Phase 3**
(plan lifecycle must record the pause semantics).

### 7.7 Source files affected after approval

- `backend/routes/velrepeat-plans.ts:508-520` — the current `GREATEST(next_run_at, NOW())` deferral
  must change if the answer is (A)
- `velrepeat_plans` (`:824-847`) — needs a pause-count / commitment-end column if **D.2(ii)** or
  **D.2(iii)**; `db/run-sqleditor.sql` **and** `db/schema.sql`, plus a migration **only after 048–050**
- `velrepeat_cycles.scheduled_at` (`:955`) — if D.2(i), each future cycle shifts
- `backend/jobs/velrepeat-scheduler.ts:38-65` — `calculateNextRunAt` must honour the extended horizon
- `velrepeat_events` (`:887-897`) — the pause/resume audit rows
- `backend/lib/inventory.ts:209-234` — release of a reserved-but-unstarted cycle

---

## 8. F — Out-of-Stock Future Prepaid Cycle `[OWNER FORMULA REQUIRED]`

### 8.1 What is already decided `[OWNER DECISION]`

Decision **F** closed the *non-monetary* policy: **no oversell**; **no auto-substitute**;
**do not commit** the reserved inventory; **do not increment** `sold_count`; **no false success**;
a durable cycle-failure state/event; notify system / operator / customer; **never auto-refund without
a policy**; **never silently skip**.

> ⚠️ **The current retry behaviour is NOT the approved rule.** It is what the code happens to do
> today. The owner has **not** ratified it, and it is recorded here only so the choice is informed.

### 8.2 Current repository evidence `[PROVEN]`

**Non-oversell is structurally guaranteed:**

```ts
// backend/lib/inventory.ts:60-63
`UPDATE inventory SET reserved = reserved + $1, updated_at = NOW()
  … WHERE quantity - reserved >= $1`
// :65-67  → throws INSUFFICIENT_STOCK
```

- The throw happens inside the cycle transaction, so the whole cycle rolls back
  (`velrepeat-scheduler.ts:111` plan claim → `:394` transaction end). `[PROVEN]`
- **Today's behaviour is implicit retry-forever:** the plan is claimed again on the next sweep by
  `processDuePlans` (`:444`) → `processPlan` (`:110`) → claim `FOR UPDATE` (`:113-120`). There is no
  attempt counter, no backoff, and no escalation. `[PROVEN]`
- **Variant / non-variant asymmetry `[PROVEN]`:** variants decrement directly —
  `UPDATE product_variants SET stock = stock - $1` (`velrepeat-scheduler.ts:328`) — bypassing
  `inventory.ts` entirely; non-variants go through `reserveInventoryStock` (`:341`). A variant
  shortfall and a non-variant shortfall therefore fail **differently**, and the two are not symmetric.
- Failure vocabulary already exists in **all three** CHECKs: cycle `:954`, run `:873`, plan `:827`
  (`out_of_stock`, `item_unavailable`). `[PROVEN]`
- Notification surface exists: `velrepeat_events` (`:887-897`) + the event write at
  `velrepeat-scheduler.ts:376-388`. `[PROVEN]`
- Commit is caller-gated (`inventory.ts:79-81`), so a failed cycle never increments `sold_count`
  through the canonical writer. `[PROVEN]`

**The money half is missing.** The customer has **already paid** for a cycle that cannot be served.
Decision F forbids auto-refund and auto-substitute but says nothing about whether the cycle is
retried forever, retried N times then escalated, postponed, or cancelled with a refund/credit.
`[OWNER FORMULA REQUIRED]` — and it depends on **B.1/B.2** (no per-cycle value) and **G2** (rounding).

### 8.3 Exact question

> **F — A future prepaid cycle cannot be fulfilled (no stock).** Define:
>
> **F.1 Retry behaviour** — how many times, with what backoff?
> `(a)` **retry indefinitely** (today's implicit behaviour — **not** previously ratified);
> `(b)` retry **N times** then escalate; `(c)` retry until a **maximum age** is reached; `(d)` owner-defined.
>
> **F.2 Maximum retries** — if (b), give the exact **N** and the exact retry interval/backoff
> schedule. `[OWNER FORMULA REQUIRED]`
>
> **F.3 Escalation** — on exhaustion, what happens? **System/operator notification only**;
> **customer notification only**; **both**; **auto-skip** (see C); **auto-cancel** (see B); **other**.
>
> **F.4 Is the cycle delayed?** — is `velrepeat_cycles.scheduled_at` (`:955`) pushed forward (delayed)
> or does the cycle stay at its original slot and simply fail? If delayed, by how much — a fixed
> interval, or the time until stock returns?
>
> **F.5 Does the commitment horizon extend?** — if the cycle is delayed indefinitely, does the
> customer still receive all `commitment_cycles` (`:830`) deliveries later? (Same fork as **D.1**;
> the answer must be consistent with it.)
>
> **F.6 Eventual refund or credit** — is a refund/credit **ever** allowed automatically after
> exhaustion? If yes: what amount (requires **B.1**), what trigger, and how many days after exhaustion?
> If no: what is the permanent resolution — customer keeps waiting, or an operator manually issues a
> resolution?
>
> **F.7 Who decides** — is the resolution **automatic**, **operator-decided**, or **customer-decided**
> (the customer may accept a substitute or cancel)? Note this interacts with **Q2**'s recognition
> moment (§4) and with **B**'s boundary (§5.3 B.5).
>
> **F.8 Variant asymmetry** — should the variant path (`velrepeat-scheduler.ts:328`) be brought under
> the same `inventory.ts` authority as non-variants (`:341`), so both fail identically? Or is the
> asymmetry intended? `[PROVEN]` The asymmetry is real today and nothing records it as intended.

### 8.4 Choices — F.3 (escalation)

| Choice | On retry exhaustion |
|---|---|
| **A** | Notify system/operator **only**; plan keeps retrying |
| **B** | Notify **customer + operator**; cycle marked failed; no automatic money movement |
| **C** | **Auto-skip** the cycle (then C.1 applies) |
| **D** | **Auto-cancel** the cycle and refund (then B.1 applies) |
| **E** | Owner-defined — describe |

### 8.5 Downstream phase blocked

**Phase 9 STOPPED.** Transitively **Phase 5** (scheduling must know about backoff) and
**Phase 6** (inventory commit/release behaviour on failure).

### 8.6 Source files affected after approval

- `backend/jobs/velrepeat-scheduler.ts:328` (variant) and `:341` (non-variant) — retry/backoff and the
  asymmetry in F.8
- `backend/jobs/velrepeat-scheduler.ts:110-120,444` — the plan claim needs an attempt/escalation record
- `backend/lib/inventory.ts:54-68` — reservation must respect the window chosen in §13 (RW)
- `velrepeat_cycles.status` (`:954`) — `out_of_stock` / `item_unavailable` exist; an escalation or
  attempt counter would need a **new column** (no attempt counter exists today)
- `velrepeat_events` (`:887-897`) + the write at `:376-388` — the failure/escalation audit trail
- Phase 9 refund code — only if F.6 allows it

---

## 9. MS — Multi-Seller Financial Attribution `[OWNER DECISION REQUIRED]`

### 9.1 What is already decided `[OWNER DECISION]`

Decision **Q17**: one plan **may span sellers**; the plan-level payment is **ONE payment**; sellers see
and manage **only their own** orders; a seller **may not** change plan-level financial truth.

### 9.2 Current repository evidence `[PROVEN]` — per-seller money is unrepresentable today

| Fact | Evidence |
|---|---|
| `commissions` is **order-bound**: `order_id UUID NOT NULL REFERENCES orders(id)` | `db/run-sqleditor.sql:522` (table `:520-526`) |
| `commissions` has **no** `plan_id`, **no** `cycle_id`, **no** `payment_id` | `:520-526` — columns are `id, order_id, seller_id, amount, rate, created_at` |
| `settlements` (`:528-534`) columns are `id, seller_id, amount, status, created_at` — **no payment, plan or cycle reference at all** | `:528-534` |
| **Neither table has any backend writer** — `grep -rEn 'INSERT INTO commissions\|FROM commissions\|INTO settlements\|FROM settlements'` over `backend/**` excluding tests → **0 matches each** | `[PROVEN]` |
| **There is no Stripe Connect / payout rail at all** | `.ai/context/payment.md:239-250`: *"no connected account, no `accountLink`/onboarding, no `transfer_data` / `application_fee` / `on_behalf_of`, no seller↔Stripe account mapping, no KYC state, no Stripe payout … seller amounts are internal accounting only"* |
| `payouts.process` was **deliberately removed** from the permission catalog | `.ai/context/payment.md`, guarded by `center-rbac.test.ts` |
| A plan can genuinely span sellers | `velrepeat_items.seller_id UUID NOT NULL REFERENCES sellers(id)` `:854` alongside `shop_id` `:853` — one plan's items may point at different sellers |
| The scheduler already creates **one order per shop** | `backend/jobs/velrepeat-scheduler.ts:270` — `INSERT INTO orders (user_id, shop_id, …)` inside a loop |
| Seller-facing endpoints are seller-scoped but process the **plan as a whole** | `backend/routes/seller-orders.ts:695` (`WHERE vi.seller_id = $1`), `:766` `POST /api/subscriptions/process-due`, `:784` (`EXISTS (… vi.plan_id = vp.id AND vi.seller_id = $1)`) |
| `[CITATION CORRECTION]` the prior audit cited `commissions.order_id` at `:521`; it is at **`:522`** (`:521` is the `id` column). Verified this pass. |

### 9.3 Why it matters

"One payment" + "several sellers" + "plan-level financial truth" **requires** the platform to know
how much of that one payment belongs to each seller. Today it cannot even record that:
`commissions` needs an `order_id` (a cycle order), `settlements` needs nothing to hang from, and
neither has a writer. So the answer determines whether Phase 7/9 needs **new money infrastructure**.

### 9.4 Exact question

> **MS — Multi-seller financial attribution.**
>
> **MS.1 (A/B/C)** At plan-payment level, who owns the money?
> **(A)** The **platform holds the entire prepaid amount**; seller attribution happens only at each
> **cycle/order settlement**;
> **(B)** The prepaid payment is **allocated across sellers at purchase time**;
> **(C)** Other owner-defined model — describe.
>
> **MS.2 (if A)** What is the per-seller allocation basis at cycle settlement? The cycle's
> `unit_price` × quantity per line (`velrepeat_items.unit_price` `:856`)?
> How is the discount (`:929`) attributed?
>
> **MS.3 (if B)** What is the split rule — by line value, by quantity, by commission rate
> (`commissions.rate NUMERIC(5,4) DEFAULT 0.05` `:525`), or equal?
>
> **MS.4 Payout** — is there a **real payout rail** (Stripe Connect / transfer), or are seller
> amounts **internal accounting only** as today (`.ai/context/payment.md:239-250`)?
> If a payout rail is wanted, that is a **separate architecture decision** — see 9.6.
>
> **MS.5 Recognition timing** — is a seller's share recognized at **cycle settlement** (one
> commitment), at **plan purchase** (all at once), or at **cash payout**?
>
> **MS.6 Seller visibility** — can a seller see the plan-level total (all sellers' money), or only
> their own attributed amount? `[PROVEN]` The repo rule is that a seller must not change
> plan-level financial truth (decision Q17); visibility is a separate question.

### 9.5 Choices — MS.1

| Choice | Meaning |
|---|---|
| **A** | Platform holds the whole prepaid amount; attribution at **cycle/order settlement** |
| **B** | Allocate across sellers **at purchase** |
| **C** | Owner-defined — describe |

### 9.6 Separate architecture decision (flagged, NOT designed here)

If **MS.1 = A or B** requires recording or paying out per-seller money, that is a **new capability**
and is marked as a **separate architecture decision** for the owner:

| Need | Current state | Tag |
|---|---|---|
| `commissions` with a plan/cycle reference | `order_id NOT NULL` only (`:522`); no `plan_id`/`cycle_id` | `[PROVEN]` — needs new columns |
| `settlements` linked to a payment/plan/cycle | no such columns (`:528-534`) | `[PROVEN]` — needs new columns |
| Any writer for either table | **none** | `[PROVEN]` — needs new code |
| Stripe Connect / payout | **none** | `[PROVEN]` — `.ai/context/payment.md:239-250` says out of scope until the owner asks |

**This sheet does not design or implement the payout system.** It only marks the decision.

### 9.7 Downstream phase blocked

**Phase 7 / Phase 9.** Does **not** block Phase 2 (a multi-item package can be expressed without
attributing money) — **unless G3 = "seller-authored packages"**, in which case seller prices become a
Phase 2 pricing input and this moves earlier.

### 9.8 Source files affected after approval

- `commissions` (`db/run-sqleditor.sql:520-526`) — new `plan_id` / `cycle_id` / `payment_id` columns
  and a writer; `db/run-sqleditor.sql` **and** `db/schema.sql`, plus a migration **only after 048–050**
- `settlements` (`:528-534`) — same
- a new attribution/settlement module under `backend/lib/` (none exists)
- `backend/routes/seller-orders.ts:695,766,784` — seller-scoped views and the process-due endpoint
- `backend/lib/seller-stats.ts` — the current internal-accounting surface
- **If MS.4 = a real payout rail:** Stripe Connect integration in `backend/routes/stripe.ts` and a new
  payout endpoint + permission (the `payouts.process` key was deliberately removed and is guarded by
  `center-rbac.test.ts`) — **separate architecture decision, out of scope for this sheet**

---

## 10. PS — Package ↔ Seller Relationship

### 10.1 Current repository evidence `[PROVEN]`

- `velrepeat_packages` (`:898-906`) and `velrepeat_package_items` (`:908-919`) carry **no
  `seller_id`**, so **the schema permits a package to mix sellers today** — there is simply nothing
  preventing it. `[PROVEN]`
- `velrepeat_items` — the per-plan denormalized copy — **does** carry `seller_id NOT NULL`
  (`:854`) alongside `shop_id NOT NULL` (`:853`), so **multi-seller plans are structurally
  representable** and the scheduler already handles them (one order per shop,
  `velrepeat-scheduler.ts:270`). `[PROVEN]`
- Owner decision **Q17** already approved a **multi-seller plan** with per-seller fulfillment. `[OWNER DECISION]`
- V1 was strictly single-seller and single-product: `vrepeat_packages.product_id NOT NULL` (`:682`),
  `shop_id`, `seller_id`. `[PROVEN]`
- The unique indexes on package items are `(package_id, product_id, variant_id)` partials
  (`:918`-area) — **no seller dimension**, so the same product from two sellers would collide or be
  indistinguishable. `[PROVEN]`

### 10.2 Why it matters

This is asked **separately from G3** because it constrains the schema, not just the authorization.
A "one seller only" answer would make packages **seller-scoped** and pull §14 (SE) eligibility
earlier into Phase 2. A "multiple sellers" answer confirms Q17 at the package level and keeps
attribution entirely in Phase 7/9.

### 10.3 Exact question

> **PS:** Can a VelRepeat package contain:
>
> **(A)** Products from **one seller only**;
> **(B)** Products from **multiple sellers**;
> **(C)** **Both**, depending on package type (state the types).
>
> **PS.1** If (B) or (C): **who** may create a multi-seller package — platform operator only
> (§3.3 G3.3), sellers too, or sellers creating only single-seller packages?
>
> **PS.2** If (B) or (C): does `velrepeat_packages` / `velrepeat_package_items` need a **denormalized
> `seller_id`** so a seller can be authorized against their own items without joining through
> `products`? (Today there is none — 10.1.)
>
> **PS.3** If (A): does the plan-level payment stay one payment (Q14) with a single seller behind it,
> and does §9 (MS) become unnecessary for single-seller plans?

### 10.4 Downstream phase blocked

**Phase 2** (if the answer is seller-scoped or requires schema change) / **Phase 7**.

### 10.5 Source files affected after approval

- `velrepeat_packages` (`:898-906`) and `velrepeat_package_items` (`:908-919`) — a denormalized
  `seller_id` if PS.2 = yes; `db/run-sqleditor.sql` **and** `db/schema.sql`, plus a migration
  **only after 048–050 are applied in production**
- the unique indexes on package items (`:918`-area) if a seller dimension is added
- the package CRUD route's authz (new route; none exists)
- `backend/lib/permissions.ts` if seller-scoped package access needs a new permission key

---

## 11. LS — Plan Status Vocabulary `[OWNER DECISION REQUIRED]`

### 11.1 Current repository evidence `[PROVEN]`

`velrepeat_plans.status` CHECK — `db/run-sqleditor.sql:827`:

```sql
status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
  'draft', 'active', 'paused', 'processing', 'payment_failed',
  'out_of_stock', 'item_unavailable', 'price_changed',
  'cancelled', 'completed'))
```

**10 values today.** Compare the list this question asks about:

| Asked-about state | Present today? | Note |
|---|---|---|
| `draft` | ✅ yes | |
| `pending_payment` | ❌ **no** | Present in **V1** (`vrepeat_packages.status`, `:696`) but **absent from V2** |
| `active` | ✅ yes | Also the **DEFAULT** (`:827`) — V2 plans are born active |
| `paused` | ✅ yes | |
| `completed` | ✅ yes | |
| `cancelled` | ✅ yes | |
| `expired` | ❌ **no** | |
| `failed` | ❌ **no** | V2 has `payment_failed` and `out_of_stock`/`item_unavailable` instead — three different failure shapes |

- V1's own vocabulary (`:696`) is `pending_payment, paid, active, paused, completed, cancelled, refunded`.
  `[PROVEN]` V1 and V2 **disagree**, and V2 has no `paid` state at all — because under **Q14** the
  money is a separate axis (§11.4).
- `idx_velrepeat_plans_due` (`:847`) is `WHERE status = 'active'`, so only `active` plans are swept. `[PROVEN]`
- `velrepeat_plans` has `started_at`, `ended_at` and `next_run_at`, and **no stored commitment-end
  date** — so an `expired` state has no column to hang from today. `[PROVEN]`

### 11.2 Why it matters

The plan state machine is the first thing Phase 3/4 implements and it drives the due sweep (`:847`),
the pause/resume/cancel routes (`velrepeat-plans.ts:508,531`), and the customer's plan list. Getting
the vocabulary wrong means a migration later — which is expensive here, because **migrations 048–050
are already queued and production is Neon-quota-blocked** (§19.3).

### 11.3 Exact question

> **LS:** Approve or amend the V2 plan status vocabulary. Specifically:
>
> **LS.1** Is `pending_payment` required? (A plan created before its prepaid charge settles.)
> **LS.2** Is `expired` required? If yes, **what expires it** — the commitment horizon ending, the
> payment reservation expiring, or something else? (There is no stored commitment-end date today.)
> **LS.3** Is a generic `failed` required, given `payment_failed`, `out_of_stock` and
> `item_unavailable` already exist?
> **LS.4** Is `draft` required, and should the **DEFAULT stay `'active'`** (`:827`)?
> **LS.5** Should the **V2 vocabulary drop V1's `paid` and `refunded`** states, keeping money strictly
> on the separate Payment axis (§11.4)?
> **LS.6** Are the V1-only failure states `price_changed` and `processing` retained, or cleaned up?

### 11.4 Design constraint already recorded `[PROVEN]`

Owner decision and contract §48 both require **separate axes**:

```
PAID PLAN  ≠  FULFILLED PLAN
PAID CYCLE ≠  DELIVERED ORDER
```

So money state belongs to `payments.status` (`:446`), **not** to `velrepeat_plans.status`. Any
request to add `paid`/`refunded` to the plan CHECK should be read against that rule.

### 11.5 Downstream phase blocked

**Phase 3 / Phase 4** (plan lifecycle + the one prepaid charge). Not a Phase 2 gate.

### 11.6 Source files affected after approval

- `velrepeat_plans.status` CHECK (`db/run-sqleditor.sql:827`) — `db/run-sqleditor.sql` **and**
  `db/schema.sql`, plus a migration **only after 048–050 are applied in production**
- `idx_velrepeat_plans_due` (`:847`) if the due-sweep predicate changes
- `backend/routes/velrepeat-plans.ts:508,531` — pause/cancel transitions
- any new plan-creation/plan-list frontend surface (Phase 3/4)
- `backend/tests/velrepeat-v2-domain-schema.test.ts` — structural domain/schema assertions

---

## 12. CS — Cycle Status Vocabulary `[OWNER DECISION REQUIRED]`

### 12.1 Current repository evidence `[PROVEN]`

`velrepeat_cycles.status` CHECK — `db/run-sqleditor.sql:954`:

```sql
status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
  'scheduled', 'processing', 'ordered',
  'completed', 'skipped', 'cancelled',
  'out_of_stock', 'item_unavailable'))
```

**8 values today.** The three words this question is about map as follows:

| Word asked about | Present today? | Nearest existing value |
|---|---|---|
| **"due"** | ❌ **no** | `scheduled` + `idx_velrepeat_cycles_due` (`:965`, on `(status, scheduled_at)`) — the word exists only as an **index name**, not a status |
| **"reserved"** | ❌ **no** | reservation is currently only **implicit** in `inventory.reserved` (`backend/lib/inventory.ts:60-63`) — the cycle row does not record that its stock is held |
| **"fulfilled"** | ❌ **no** | `completed` (`:954`) — the order-side word is `delivered`→`completed` (`order-fulfillment.ts:93-94`) |

`velrepeat_runs.status` CHECK (`:873`) is a **different 8-value vocabulary**:
`processing, success, payment_failed, out_of_stock, item_unavailable, price_changed, failed, cancelled`.
`[PROVEN]` The two tables use disjoint state names for overlapping ideas — a direct consequence of
the dual-identity problem in §15 (CI).

Other relevant columns: `scheduled_at NOT NULL` (`:955`), `started_at`, `completed_at`,
`UNIQUE (plan_id, cycle_number)` (`:962`), `pricing_snapshot_id` (`:958`).

### 12.2 Why it matters

- **"reserved" is a money-adjacent fact.** If the cycle row does not record that stock is held, then
  the release guard (`inventory.ts:221-234`, gated on `NOT EXISTS (… settled payment …)`) has nothing
  to key on for a cycle order — §4's finding 1. A `reserved` state would give it a claim.
- **"fulfilled" collides with Q2 (§4).** If `completed` means "sold_count committed" in one place and
  "goods delivered" in another, the same column means two things. Naming matters.
- **Every added state is a migration**, and migrations are currently blocked in production (§19.3).

### 12.3 Exact question

> **CS:** Approve or amend the canonical V2 cycle lifecycle. Should the canonical cycle state
> vocabulary distinguish all of:
>
> `scheduled/due` → `reserved` → `order_created` → `fulfillment` → `fulfilled` → `skipped` →
> `failed` → `cancelled` ?
>
> **CS.1** Which of these eight exist as **distinct cycle states**, and which are **derived** (computed
> from the cycle's order row rather than stored)?
> **CS.2** Is `due` a **state**, or is it "`scheduled` whose `scheduled_at` has passed"
> (i.e. the existing `idx_velrepeat_cycles_due` query, `:965`)?
> **CS.3** Is `reserved` a state? If yes, does `out_of_stock`/`item_unavailable` (`:954`) replace it,
> or coexist?
> **CS.4** Is `fulfilled` the same thing as `completed` (`:954`)? If `fulfilled` means "sold_count
> committed", that ties CS.4 **directly to Q2 (§4.3)** — please answer them consistently.
> **CS.5** Do `out_of_stock` and `item_unavailable` remain distinct, and do they feed **F** (§8)?
> **CS.6** Is `failed` a cycle state, or only a **run** state (`velrepeat_runs.status`, `:873`)?

### 12.4 Choices — CS.1 (which are stored vs derived)

| Choice | Model |
|---|---|
| **A** | Store **all eight** as cycle states |
| **B** | Store the **current eight** (`:954`) and **derive** `due`/`reserved`/`fulfilled` from timestamps, `inventory.reserved`, and the cycle's order |
| **C** | Hybrid — state the exact split (e.g. store `reserved` + `fulfilled`, derive `due`) |
| **D** | Owner-defined — describe |

### 12.5 Downstream phase blocked

**Phase 5** (cycle generation + scheduling). Interacts with Phase 6 (Q2 commit claim) and Phase 9
(B/C/D/F resolution states).

### 12.6 Source files affected after approval

- `velrepeat_cycles.status` CHECK (`db/run-sqleditor.sql:827`-block → **`:954`**) — new values and/or a
  new reserved-at timestamp column; `db/run-sqleditor.sql` **and** `db/schema.sql`, plus a migration
  **only after 048–050 are applied in production**
- `velrepeat_runs.status` CHECK (`:873`) — only if the two vocabularies are reconciled (§15 CI)
- `backend/jobs/velrepeat-scheduler.ts:110-394` — the state transitions it writes
- `backend/lib/inventory.ts:54-68,209-234` — reserve/release must read/write the cycle's claim
- `backend/tests/velrepeat-v2-domain-schema.test.ts` — domain/schema assertions

---

## 13. RW — Inventory Reservation Window `[OWNER DECISION REQUIRED]`

### 13.1 What is already decided `[OWNER DECISION]`

Decision **A/Q1 = B**: reserve inventory **per cycle** (not for the whole plan up front).

### 13.2 Current repository evidence `[PROVEN]`

**The per-order analogue exists and is proven:**

| Element | Evidence | Value |
|---|---|---|
| `orders.payment_expires_at` | `db/run-sqleditor.sql:378` | set at checkout |
| `orders.reservation_policy` | `db/run-sqleditor.sql:379` | JSONB policy blob |
| `orders.inventory_released` | `db/run-sqleditor.sql:377` | exactly-once release claim |
| `PAYMENT_RESERVATION_POLICY_VERSION` | `backend/lib/payment-reservation.ts:36` | `"v2"` |
| **`PAYMENT_RESERVATION_MINUTES`** | `backend/lib/payment-reservation.ts:44` | **30** |
| Expirable statuses / expired status | `backend/lib/payment-reservation.ts:58,61` | `"expired"` |
| Checkout reservation uniqueness | `checkout_requests` `UNIQUE (user_id, scope, request_key)` | `db/run-sqleditor.sql:391-400`, key at `:399` |
| Payment idempotency | `payments.idx_payments_one_active_stripe` | `db/run-sqleditor.sql:462` |
| Webhook idempotency | `payment_events.event_id TEXT NOT NULL UNIQUE` | `db/run-sqleditor.sql:466` |
| **No plan-level analogue** | `velrepeat_plans` (`:824-847`) has **no** `payment_expires_at`, **no** `reservation_policy`, **no** `inventory_released` | `[PROVEN]` |

**The reservation primitive itself** — `backend/lib/inventory.ts:54-68`:
`reserveInventoryStock` does a guarded `UPDATE inventory SET reserved = reserved + $1 … WHERE
quantity - reserved >= $1` (`:60-63`) and throws `INSUFFICIENT_STOCK` (`:65-67`).
`releaseOrderInventory` (`:209`) claims with `inventory_released = FALSE` (`:225`),
`status = ANY($2)` (`:226`) and `NOT EXISTS (… settled payment …)` (`:227-231`),
with the log line *"a settled payment outranks a cancellation"* at `:252-259`.
`RELEASABLE_STATUSES` at `:176-182`. `[PROVEN]`

> ⚠️ **The closure pass recorded that the 30-minute window is meaningless for a prepaid plan.** The
> customer pays at plan level; stock is held per cycle weeks or months later. So the window must be
> re-derived — it cannot be inherited.

### 13.3 Exact question

> **RW — Inventory reservation window.**
>
> **RW.1 (A/B/C/D)** When is inventory reserved for a cycle?
> **(A)** at **cycle creation** (when `velrepeat_cycles` row is inserted);
> **(B)** **near fulfillment time** (a short window immediately before the order is created);
> **(C)** a **configurable window** before the scheduled fulfillment time;
> **(D)** other — describe.
>
> **RW.2** How long is a reservation **valid** once taken? (Today the only precedent is
> `PAYMENT_RESERVATION_MINUTES = 30`, `payment-reservation.ts:44` — designed for a checkout that
> expires in 30 minutes, not for a prepaid commitment.) Give the exact duration or the exact rule.
>
> **RW.3** What happens if the reservation **expires** before the cycle runs? Is the cycle:
> (a) still `due` and retried, (b) marked `out_of_stock`, (c) delayed, (d) escalated to an operator?
> This is the same fork as **F** (§8.3 F.3) — the answers must be consistent.
>
> **RW.4** Does the cycle **remain `due`** after a reservation expiry, or does its status change
> permanently? (Today "due" is not a state — §12.2.)
>
> **RW.5** Does expiry require **operator intervention**, or is it fully automatic?
>
> **RW.6** Where is the window **stored**? Candidates: `platform_settings` (`:657-662`, flat TEXT
> key/value, no typing/versioning), a new settings table, or a per-plan column mirroring
> `orders.payment_expires_at` (`:378`) / `orders.reservation_policy` (`:379`). State the exact storage.
>
> **RW.7** Should a reservation be **released** when the customer pauses (**D**, §7) or skips
> (**C**, §6) a cycle? (The release path `inventory.ts:209-234` is gated on a `payments` row that a
> cycle order never has under Q14 — a cycle-state claim is needed, per §4.4 Q2.2.)

### 13.4 Choices — RW.1

| Choice | Reservation moment |
|---|---|
| **A** | At **cycle creation** |
| **B** | **Near fulfillment** (short window before the order is created) |
| **C** | A **configurable window** before scheduled fulfillment |
| **D** | Owner-defined — describe |

### 13.5 Downstream phase blocked

**Phase 6** (per-cycle reserve/commit/release). Also **Phase 4** if a plan-level window is required
(the 4A analogue the closure pass flagged as undecided).

### 13.6 Source files affected after approval

- `velrepeat_plans` (`:824-847`) and/or `velrepeat_cycles` (`:950-965`) — a `payment_expires_at` /
  `reservation_policy` / `reservation_expires_at` analogue of `orders:378-379`;
  `db/run-sqleditor.sql` **and** `db/schema.sql`, plus a migration **only after 048–050 are applied
  in production**
- `platform_settings` (`:657-662`) — only if RW.6 chooses the existing flat key/value table
- `backend/lib/inventory.ts:54-68,176-182,209-234` — reserve/commit/release with an expiry claim
- `backend/lib/payment-reservation.ts:36,44,58,61` — the window constant/policy, if reused
- `backend/jobs/velrepeat-scheduler.ts:328,341` — reserve call sites
- a reservation-expiry job alongside `startPaymentReservationScheduler()` (`backend/server.ts:525`)

---

## 14. SE — Seller Eligibility for VelRepeat `[OWNER DECISION REQUIRED]`

### 14.1 Current repository evidence `[PROVEN]`

- `sellers.status` CHECK — `db/run-sqleditor.sql:140`:
  `('pending', 'under_review', 'needs_correction', 'approved', 'rejected', 'suspended')`.
- `sellers.verification_status` CHECK — `db/run-sqleditor.sql:141`:
  `('unverified','pending','verified','rejected','suspended')`, with `verified_at` `:142`.
- **Today, any `approved` seller is eligible** for repeat commerce: `velrepeat_items.seller_id UUID NOT
  NULL REFERENCES sellers(id)` (`:854`) has no additional eligibility gate, and there is no
  VelRepeat-eligibility column anywhere on `sellers`. `[PROVEN]`
- Seller-facing repeat surface is already seller-scoped:
  `backend/routes/seller-orders.ts:695` (`WHERE vi.seller_id = $1`),
  `:766` `POST /api/subscriptions/process-due`, `:784`
  (`EXISTS (… vi.plan_id = vp.id AND vi.seller_id = $1)`).
- V1's `vrepeat_packages.seller_id` (`:685`-area) is equally ungated. `[PROVEN]`

### 14.2 Why it matters

Repeat commerce is **prepaid** — a customer pays for N cycles up front. That makes it a materially
bigger commitment for the seller than a single COD order, and it is exactly the kind of surface where
"any approved seller" may be too loose. But the repo's authorization model is deliberately simple
(`approved` is the gate everywhere else), and **nothing in source says repeat commerce is different**.
`[OWNER DECISION REQUIRED]`

**Timing note:** contract §62 assigns seller surfaces to **Phase 7**, so this is **not** a Phase 2
gate — **unless** §3 (G3) or §10 (PS) makes packages seller-scoped, which would pull it earlier.

### 14.3 Exact question

> **SE:** Which sellers may participate in VelRepeat?
>
> **(A)** **All `approved` sellers** — today's implicit behaviour, no change;
> **(B)** Only sellers meeting **specific requirements** — name them (e.g. `verification_status =
> 'verified'`, a minimum rating, a minimum order count, a minimum on-time fulfilment rate, an
> explicit allow-list);
> **(C)** **Platform-selected** sellers — an explicit flag/allow-list maintained by an operator;
> **(D)** **Seller must opt in** — eligibility is a seller-side action;
> **(E)** **Package-specific** — eligibility is a property of each package, not of the seller;
> **(F)** Other — describe.
>
> **SE.1** If (B)/(C)/(D)/(E): **where is the eligibility flag stored?** No such column exists today;
> `platform_settings` (`:657-662`) is flat TEXT key/value with no typing or versioning.
> **SE.2** If a seller becomes **ineligible** mid-plan — what happens to plans already paid for?
> (Relates to **D** §7 and **B** §5, and to the release path `inventory.ts:209-234`.)
> **SE.3** Should `verification_status = 'verified'` (`:141`) be required **in addition to**
> `status = 'approved'` (`:140`), or is `approved` alone sufficient?

### 14.4 Downstream phase blocked

**Phase 7** — or **Phase 2** if G3/PS make packages seller-scoped.

### 14.5 Source files affected after approval

- `sellers` (`db/run-sqleditor.sql:137-143`) — an eligibility column, or a new eligibility table;
  `db/run-sqleditor.sql` **and** `db/schema.sql`, plus a migration **only after 048–050**
- `platform_settings` (`:657-662`) — only if SE.1 chooses the flat key/value store
- `backend/routes/velrepeat-plans.ts:260` (plan insert) and `backend/routes/seller-orders.ts:766,784`
  — eligibility enforcement
- the seller-side frontend eligibility display (Phase 7)

---

## 15. CI — Cycle Identity Model `[ARCHITECTURE APPROVAL REQUIRED]`

### 15.1 Current repository evidence `[PROVEN]` — the dual-identity hazard

**`velrepeat_runs` — `db/run-sqleditor.sql:867-886`:**

| Line | Content |
|---|---|
| `:867` | `CREATE TABLE IF NOT EXISTS velrepeat_runs (` |
| `:873` | `status … CHECK (status IN ('processing','success','payment_failed','out_of_stock','item_unavailable','price_changed','failed','cancelled'))` |
| `:874` | `order_id UUID REFERENCES orders(id) ON DELETE SET NULL` — **one** order, "first order only" |
| `:882` | `UNIQUE (plan_id, scheduled_for)` |
| `:884` | `idx_velrepeat_runs_order … WHERE order_id IS NOT NULL` |
| `:885` | FK `orders.velrepeat_run_id → velrepeat_runs(id)` (DO-block, circular-safe) |
| `:886` | `idx_orders_velrepeat_run … WHERE velrepeat_run_id IS NOT NULL` |

**`velrepeat_cycles` — `db/run-sqleditor.sql:950-965`:**

| Line | Content |
|---|---|
| `:950` | `CREATE TABLE IF NOT EXISTS velrepeat_cycles (` |
| `:952` | `plan_id UUID NOT NULL REFERENCES velrepeat_plans(id)` |
| `:953` | `cycle_number INTEGER NOT NULL CHECK (cycle_number > 0)` |
| `:954` | `status … CHECK (8 values)` |
| `:955` | `scheduled_at TIMESTAMPTZ NOT NULL` |
| `:958` | `pricing_snapshot_id UUID REFERENCES velrepeat_pricing_snapshots(id)` |
| `:962` | `UNIQUE (plan_id, cycle_number)` |
| `:965` | `idx_velrepeat_cycles_due ON (status, scheduled_at)` |
| `:966` | FK `orders.velrepeat_cycle_id → velrepeat_cycles(id)` (DO-block) |
| `:967` | `idx_orders_velrepeat_cycle … WHERE velrepeat_cycle_id IS NOT NULL` |

**The hazard, stated exactly `[PROVEN]`:**

- **`velrepeat_runs` and `velrepeat_cycles` have NO relation to each other — in either direction.**
  A grep of the schema confirms no `cycle_id` on `velrepeat_runs` and no `run_id` on `velrepeat_cycles`.
- **`orders` references BOTH**: `orders.velrepeat_run_id` (`:380`) and `orders.velrepeat_cycle_id`
  (`:381`), each with its own FK (`:885`, `:966`) and its own partial index (`:886`, `:967`).
- Both are keyed on `plan_id`, both have a `scheduled`-time notion
  (`velrepeat_runs.scheduled_for` vs `velrepeat_cycles.scheduled_at`), and both have **their own
  disjoint 8-value status vocabularies** (`:873` vs `:954`).
- So an order can point at a run, at a cycle, at both, or at **neither**, and nothing in the schema
  prevents the inconsistent combinations. `[PROVEN]`
- Under **Q17** a cycle produces **one order per shop** (`velrepeat-scheduler.ts:270`), but
  `velrepeat_runs.order_id` is a **single** `order_id` (`:874`) — so for a multi-seller cycle the run
  can only ever point at **one** of them. `[PROVEN]`

### 15.2 The proposed direction to approve

> **`velrepeat_cycles` = canonical business identity**
> **`velrepeat_runs` = execution attempt / history**

Meaning: the cycle is the thing the customer bought and the thing money is attributed to; a run is a
non-authoritative record of "the scheduler tried to execute this cycle at this time and here is what
happened". Under this model an order belongs to a **cycle**, and a cycle has **many** runs.

### 15.3 Exact question

> **CI:** Is the model above approved as the **permanent** architecture?
>
> **CI.1** Should `orders.velrepeat_run_id` (`:380`) be **deprecated** in favour of
> `orders.velrepeat_cycle_id` (`:381`)? (Dropping a column is a destructive migration — say so
> explicitly, or state it must be kept for legacy V1 rows.)
>
> **CI.2** What is the exact relation between `velrepeat_runs` and `velrepeat_cycles`? Candidates:
> `velrepeat_runs.cycle_id UUID REFERENCES velrepeat_cycles(id)` (one cycle → many runs), or runs are
> **dropped** from V2 entirely and kept for V1 history only.
>
> **CI.3** If a cycle can have many runs, `velrepeat_runs.UNIQUE (plan_id, scheduled_for)` (`:882`)
> can no longer serve as the cycle's exactly-once guard — **`velrepeat_cycles.UNIQUE (plan_id,
> cycle_number)` (`:962`) becomes the canonical cycle identity guard.** Confirm this is intended.
>
> **CI.4** Do the two status vocabularies (`:873` vs `:954`) get reconciled, or does each keep its own
> meaning (run = execution outcome, cycle = business state)? This overlaps **CS** (§12).
>
> **CI.5** Is `velrepeat_runs.order_id` (`:874`) retired, since a multi-seller cycle has several
> orders and the run can only reference one?
>
> **CI.6** Should the two tables' `scheduled_for` / `scheduled_at` be unified or deliberately kept
> distinct? (Contract **Q16** already fixed scheduling as **UTC**, `velrepeat_scheduler.ts:38-65`;
> `velrepeat_plans.timezone` `:839` is display-only.)

### 15.4 Choices — CI.2

| Choice | Relation |
|---|---|
| **A** | Add `velrepeat_runs.cycle_id → velrepeat_cycles(id)`; one cycle, many runs |
| **B** | Drop `velrepeat_runs` from V2; keep it for V1 history only |
| **C** | Other — describe |

### 15.5 Downstream phase blocked

**Phase 5** — owed **before** any generator/scheduler code is written. The closure pass classified
this as *architecture owed, not owner-blocked*, but it needs explicit approval to be permanent.

### 15.6 Source files affected after approval

- `db/run-sqleditor.sql:867-886` and `:950-967` — new FK, retired columns, new indexes; **both**
  `db/run-sqleditor.sql` **and** `db/schema.sql`, plus a migration **only after 048–050 are applied**
  in production
- `orders` VelRepeat legs `db/run-sqleditor.sql:377-381`
- `backend/jobs/velrepeat-scheduler.ts` — run/cycle write sites (`:127` run insert, `:270` order insert)
- `backend/routes/velrepeat-plans.ts` — cycle listing
- `backend/tests/velrepeat-v2-domain-schema.test.ts` — structural domain/schema assertions

---

## 16. PX — Price Snapshot Confirmation `[CONFIRMATION REQUIRED]`

### 16.1 Current repository evidence `[PROVEN]`

- **The storage already satisfies this decision `[IMPLEMENTED]`:**
  - `velrepeat_pricing_snapshots` (`:921-936`) — `plan_id` `:923`, `commitment_cycles` `:924`,
    `currency` `:925`, `subtotal_amount` `:926`, `discount_type` `:927`, `discount_value` `:928`,
    `discount_amount` `:929`, `total_amount` `:930`, `pricing_rule_key` `:931`,
    `pricing_rule_version` `:932`
  - `velrepeat_pricing_snapshot_items` (`:937-949`) — `product_id` `:941`, `variant_id`,
    `quantity` `:942`, `unit_price` `:943`, `line_total` `:944` — so **package composition AND
    quantity are structurally snapshottable** (this was a stated requirement of decision **E**)
  - `velrepeat_cycles.pricing_snapshot_id` (`:958`) — the link from cycle to snapshot
- **What is missing is the writer.** No route currently inserts into
  `velrepeat_pricing_snapshots` / `..._items`. `[PROVEN]`
- **The live behaviour is the opposite:** `backend/jobs/velrepeat-scheduler.ts:245` —
  `UPDATE velrepeat_items SET unit_price = $1 … WHERE id = $2` — re-prices from the current catalog
  on **every run**. This must become impossible for a prepaid plan (Phase 4/5). `[PROVEN]`

### 16.2 Exact question — please confirm each explicitly

> **PX:** Confirm that, **after** the prepaid commitment is purchased:
>
> **PX.1** **Product price changes do not affect future cycles** of an existing plan.
> **PX.2** **Package composition changes do not affect** an existing plan.
> **PX.3** **Pricing-rule changes do not affect** an existing plan (new rules apply only to new plans).
> **PX.4** **Seller price changes do not affect** an existing plan.
>
> **PX.5** Do you confirm that **new plans always use the new pricing rules** in force at purchase time?
>
> **PX.6** If a cycle's inventory price has genuinely changed before that cycle runs (e.g. a
> multi-month commitment bought at today's price), is the customer's snapshot price **honoured for
> all N cycles**? Or is the seller permitted to refuse/re-price future cycles — which would make the
> prepayment a partial refund situation governed by **B** (§5)?
>
> **PX.7** Should a snapshot be **immutable** once written? (`velrepeat_pricing_snapshots` has
> `created_at` but no version column; `pricing_rule_version` `:932` versions the **rule**, not the
> snapshot.)
>
> **PX.8** Should `pricing_snapshot_id` on the **cycle** (`:958`) be `NOT NULL` and `ON DELETE
> RESTRICT`? It is currently nullable with `ON DELETE SET NULL` (`:958`) — meaning a deleted snapshot
> would silently leave a cycle with **no price record**. This looks like a defect worth deciding
> explicitly. `[PROVEN]`

### 16.3 Downstream phase blocked

**Phase 4** (snapshot writer). Decision **E** is already closed as policy; this is a **confirmation**
plus the two open sub-questions (PX.6, PX.7/PX.8).

### 16.4 Source files affected after approval

- the Phase 4 snapshot writer (new) — must copy package composition → snapshot items and freeze prices
- `backend/jobs/velrepeat-scheduler.ts:245` — the live V1 re-price must be removed for prepaid plans
- `velrepeat_cycles.pricing_snapshot_id` (`db/run-sqleditor.sql:958`) — if PX.8 = yes (nullability +
  delete behaviour); **both** canonical schema files + a migration **only after 048–050**
- `backend/lib/inventory.ts:115-141` — commit must read the snapshotted value, not the live price

---

## 17. V1/V2 — Compatibility and Deprecation `[OWNER DECISION REQUIRED]`

### 17.1 What is already decided `[OWNER DECISION]`

Decision **Q15**: **V1 coexists as legacy.** V2 is the new prepaid model and must **not** build on
V1's old COD/recurring behaviour.

### 17.2 Current repository evidence `[PROVEN]`

**V1 tables still exist and are fully populated by live code:**

| Element | Evidence |
|---|---|
| `vrepeat_packages` | `db/run-sqleditor.sql:680-707` — `user_id` `:681`, `product_id NOT NULL` `:682`, `variant_id` `:683`, `shop_id` `:684`, `seller_id` `:685`, `package_type IN ('weekly','monthly','custom')` `:686`, `quantity_total` `:687`, `quantity_delivered` `:688`, `unit_price` / `regular_unit_price` / `discount_amount` / `total_amount` `:689-692`, `currency DEFAULT 'THB'` `:694`, **own status CHECK** `:696` = `('pending_payment','paid','active','paused','completed','cancelled','refunded')`, `interval_days DEFAULT 7` `:697`, `payment_id UUID REFERENCES payments(id)` `:700`-area |
| `vrepeat_deliveries` | `:710-727` — `package_id` `:711`, `delivery_number > 0` `:713`, `scheduled_at` `:714`, `shipped_at`, `delivered_at`, **own status CHECK** `:716` = `('scheduled','processing','shipped','delivered','failed','cancelled')`, `order_id` `:719`, `UNIQUE (package_id, delivery_number)` `:724` |
| V1 routes still mounted | `backend/server.ts:472` |
| V1 plans routes mounted | `backend/server.ts:475` |
| V1 scheduler runs unconditionally | `backend/server.ts:519` — `startVelRepeatScheduler()` |
| V1 is **COD-only** in practice | `backend/routes/velrepeat-plans.ts:223` — `if (paymentMethod !== "cod")` → 400 |
| V1 plans default to COD | `velrepeat_plans.payment_method TEXT NOT NULL DEFAULT 'cod'` `db/run-sqleditor.sql:836` |
| V1's status vocabulary **disagrees with V2's** | `:696` vs `:827` (see §11.1) |
| `payouts.process` permission deliberately removed | `.ai/context/payment.md`, guarded by `center-rbac.test.ts` |
| **V1 production usage cannot be measured from this environment** | `[BLOCKED]` — no production DB access; this environment cannot read Neon |

### 17.3 Exact question

> **V1V2:**
>
> **V1V2.1** Are **new V1 plans still allowed** to be created after V2 ships?
> (a) Yes, indefinitely; (b) yes, for a fixed window; (c) **no — V1 creation is frozen** at V2 launch;
> (d) no — V1 is switched off immediately.
>
> **V1V2.2** Should **V1 be hidden from new customers** in the storefront while existing V1 customers
> continue normally?
> (a) Yes, hide V1 from new customers only; (b) no, keep V1 visible; (c) hide V1 entirely.
>
> **V1V2.3** Should **existing V1 plans continue normally** (deliveries keep running on the V1
> scheduler at `backend/server.ts:519`) until they complete?
>
> **V1V2.4** What **condition allows V1 deprecation**? Candidates: (a) a fixed date; (b) **zero active
> V1 packages** remain (`vrepeat_packages.status` = `pending_payment|paid|active|paused`); (c) a
> migration of all remaining V1 packages into V2 plans; (d) both (a) and (b). Give the exact rule.
>
> **V1V2.5** Are V1 deliveries cancellable/refundable **during** the overlap window, and under which
> rules — V1's own, or V2's (**B**, §5)?
>
> **V1V2.6** Confirm again that **V2 must not build on V1's COD/recurring behaviour**
> (`velrepeat-plans.ts:223`, `db/run-sqleditor.sql:836`). Under Q14 the V2 plan is a **single prepaid
> charge** — confirm COD is **never** a V2 payment method.
>
> **V1V2.7** Does the **V1 discount ladder** (0/3/7/10/15 % for 1/2/4/8/16 cycles) stay hardcoded in
> the V1 path only, and stay **out** of V2 entirely (per **H/Q11** — pricing is platform-controlled,
> data-driven configuration)?

`[OWNER DECISION REQUIRED]` for V1V2.1–V1V2.7. `[BLOCKED]` for any answer that depends on live V1
production volume — this environment has **no production database access**, so the "zero active V1
packages" condition in V1V2.4(b) cannot be evaluated from here.

### 17.4 Downstream phase blocked

**Phase 10** (rollout / deprecation). Not a Phase 2 gate. Blocks the eventual retirement of
`backend/routes/velrepeat.ts` (mounted `backend/server.ts:472`) and the V1 scheduler branch.

### 17.5 Source files affected after approval

- `db/run-sqleditor.sql:680-727` — eventual drop of `vrepeat_packages` / `vrepeat_deliveries`
  (**destructive**; **both** canonical schema files + a migration **only after 048–050 are applied**
  in production)
- `backend/routes/velrepeat.ts` — mounted `backend/server.ts:472`; freeze/hide/retire logic
- `backend/server.ts:475,519` — V1 plan routes and the scheduler start
- `backend/jobs/velrepeat-scheduler.ts:245` — the V1 re-price (shared code path with V2 until split)
- the storefront/customer-facing V1 entry points in `apps/velshop`

---

## 18. Owner Answer Form

**Fill this in and return it.** Short answers are fine — e.g. `G1: B`, `Q2: A`, `D.1: A`.
Write `OWNER DECISION REQUIRED` next to anything you want a follow-up question on, and
`OWNER FORMULA REQUIRED` next to any money number you want the team to bring back to you as an option.

### Blocking Phase 2

| ID | Answer | Notes / free text |
|---|---|---|
| **G1** Pricing rules combine how? | `A / B / C / D` | |
| **G1.5** Max combined discount cap? | `none / ___%` | Comparison at the boundary (`>=` or `>`)? |
| **G2.1** Currency policy | | |
| **G2.2** Decimal precision | | |
| **G2.3** Rounding point | `i / ii / iii` | |
| **G2.4** Per-cycle derivation formula | | **Must be stated explicitly** — `total_amount / commitment_cycles` is **not** assumed |
| **G2.5** Non-even division | | |
| **G2.6** Remainder goes to | `A / B / C / D / E` | |
| **G2.7** Discount allocation | | |
| **G2.8** Rounding mode | `half-up / half-even / half-down` | |
| **G3** Who may author packages? | `A / B / C / D` | |
| **G3.1** Seller restricted to own products? | | |
| **G3.2** Multi-seller packages allowed? | | |
| **G3.3** Operator cross-seller packages? | | |
| **G3.4** Who publishes/unpublishes? | | |
| **G3.5** Edit after purchase? | `a / b / c / d` | |
| **PS** Package ↔ seller relationship | `A / B / C` | |
| **PS.1** Who may create multi-seller packages? | | |

### Blocking Phase 6

| ID | Answer | Notes / free text |
|---|---|---|
| **Q2** `sold_count` recognition moment | `A / B / C / D` | |
| **Q2.1** Once per unit per cycle, never decremented? | | |
| **Q2.2** Cycle-state claim without a `payments` row? | | |

### Blocking Phase 7 / 9

| ID | Answer | Notes / free text |
|---|---|---|
| **MS.1** Who owns the plan-level money? | `A / B / C` | |
| **MS.2** (if A) Allocation basis at cycle settlement | | |
| **MS.3** (if B) Split rule | | |
| **MS.4** Real payout rail, or internal accounting only? | | If a rail: mark as a **separate architecture decision** |
| **MS.5** Seller recognition timing | | |
| **MS.6** Seller visibility of plan total | | |
| **SE** Seller eligibility | `A / B / C / D / E / F` | |
| **SE.1** Where is eligibility stored? | | |
| **SE.2** Seller becomes ineligible mid-plan | | |

### Blocking Phase 9 — money formulas

| ID | Answer | Notes / free text |
|---|---|---|
| **B.1** Value of one cycle — exact formula | | **Must be stated explicitly** |
| **B.2** Discount allocation | | |
| **B.3** Refund rounding | | Must agree with **G2.8** |
| **B.5** Refundable boundary (reserved-but-not-packed) | `A / B / C / D` | |
| **B.6** Cancelled cycles | | |
| **B.7** Multi-seller refund split | | Depends on **MS.1** |
| **C.1** Skip → end of commitment or consumed cycle? | `A / B / C` | |
| **C.2** (if A) Schedule behaviour | | |
| **C.3** (if A) Re-priced or identical? | | |
| **C.4** (if B) Financial consequence | `i / ii / iii / iv / v` | |
| **D.1** Pause → extend horizon or consume cycles? | `A / B / C` | |
| **D.2** (if A) What extends? | `i / ii / iii` | |
| **D.4** (if B) Financial consequence | | |
| **D.5** Is a pause time-boxed? | | Max duration? |
| **D.6** Pause during an ordered/reserved cycle | | |
| **F.1** Out-of-stock retry behaviour | `a / b / c / d` | Today's retry-forever is **not** assumed |
| **F.2** Max retries / backoff | | |
| **F.3** Escalation | `A / B / C / D / E` | |
| **F.4** Is the cycle delayed? | | |
| **F.5** Does the commitment horizon extend? | | Must be consistent with **D.1** |
| **F.6** Eventual refund or credit allowed? | | |
| **F.7** Who decides the resolution? | | |
| **F.8** Variant / non-variant asymmetry | | |

### Blocking Phase 4 / 5 — lifecycle and inventory

| ID | Answer | Notes / free text |
|---|---|---|
| **LS.1** Is `pending_payment` required? | | |
| **LS.2** Is `expired` required? What expires it? | | |
| **LS.3** Is a generic `failed` required? | | |
| **LS.4** Is `draft` required; default stay `'active'`? | | |
| **LS.5** Drop V1-style `paid`/`refunded` from V2? | | |
| **LS.6** Retain `price_changed` / `processing`? | | |
| **CS.1** Which cycle states are stored vs derived? | `A / B / C / D` | |
| **CS.2** Is `due` a state or derived? | | |
| **CS.3** Is `reserved` a state? | | |
| **CS.4** Is `fulfilled` the same as `completed`? | | Must be consistent with **Q2** |
| **CS.5** Do `out_of_stock` / `item_unavailable` stay distinct? | | Feeds **F** |
| **CS.6** Is `failed` a cycle state or a run state only? | | |
| **RW.1** When is inventory reserved? | `A / B / C / D` | |
| **RW.2** How long is a reservation valid? | | 30 min (`payment-reservation.ts:44`) is **not** inherited |
| **RW.3** What happens on reservation expiry? | | Must be consistent with **F.3** |
| **RW.4** Does the cycle remain `due`? | | |
| **RW.5** Operator intervention required? | | |
| **RW.6** Where is the window stored? | | |
| **RW.7** Release on pause / skip? | | |

### Architecture approvals and confirmations

| ID | Answer | Notes / free text |
|---|---|---|
| **CI** Approve `velrepeat_cycles` = identity, `velrepeat_runs` = execution attempt? | `yes / no` | Permanent model? |
| **CI.1** Deprecate `orders.velrepeat_run_id`? | | Keep for V1 rows? |
| **CI.2** Exact run↔cycle relation | `A / B / C` | |
| **CI.3** `UNIQUE (plan_id, cycle_number)` becomes canonical guard? | | |
| **CI.4** Reconcile the two status vocabularies? | | Overlaps **CS** |
| **CI.5** Retire `velrepeat_runs.order_id`? | | |
| **CI.6** Unify `scheduled_for` / `scheduled_at`? | | |
| **PX.1** Product price changes do not affect existing plans | `confirm` | |
| **PX.2** Package composition changes do not affect existing plans | `confirm` | |
| **PX.3** Pricing-rule changes do not affect existing plans | `confirm` | |
| **PX.4** Seller price changes do not affect existing plans | `confirm` | |
| **PX.5** New plans use the new rules | `confirm` | |
| **PX.6** Honour the snapshot for all N cycles? | | |
| **PX.7** Snapshots immutable once written? | | |
| **PX.8** `pricing_snapshot_id` NOT NULL + ON DELETE RESTRICT? | | Currently nullable `ON DELETE SET NULL` |

### Phase 10 — V1 / V2

| ID | Answer | Notes / free text |
|---|---|---|
| **V1V2.1** New V1 plans still allowed? | `a / b / c / d` | If (b), the window? |
| **V1V2.2** Hide V1 from new customers? | `a / b / c` | |
| **V1V2.3** Existing V1 plans continue normally? | `yes / no` | |
| **V1V2.4** Condition allowing V1 deprecation | `a / b / c / d` | Exact rule? |
| **V1V2.5** V1 refund/cancel rules during overlap | | |
| **V1V2.6** Confirm COD is never a V2 payment method | `confirm` | |
| **V1V2.7** V1 discount ladder stays V1-only, out of V2 | `confirm` | |

---

## 19. Scope, Honesty Notes, and Verification

### 19.1 What this task did

**Documentation only.** One new file under `.ai/tasks/audits/` plus a handoff pointer.

**Not done, by explicit instruction:** no Phase 2 implementation; no backend, frontend, Stripe,
webhook, inventory, scheduler or fulfillment behavior change; **no migration 051**; no change to
`db/schema.sql` or `db/run-sqleditor.sql`; no resurrection of `db/run-update.sql`; no payment-authority
change; no COD enablement; no mock data or mock APIs; no auth/authz/ownership/payment-guard bypass;
no production state change.

### 19.2 What was NOT decided here

No answer to any of the 17 decisions was selected, inferred, or defaulted. Where source could not
prove a rule, this document says `OWNER DECISION REQUIRED` or `OWNER FORMULA REQUIRED` and stops.

Three things that look like defaults are explicitly **not** defaults:

- `total_amount / commitment_cycles` is **not** the refund formula (**B.1**) nor the per-cycle price
  (**G2.4**). It is stated nowhere in the repository and must be approved explicitly.
- The current **retry-forever** behaviour on out-of-stock (`velrepeat-scheduler.ts:328,341` +
  claim `:113-120`) is **not** ratified as the rule (**F.1**).
- The current **silent one-interval pause deferral** (`velrepeat-plans.ts:520`,
  `GREATEST(next_run_at, NOW())`) is **not** ratified as the rule (**D.1**).

### 19.3 Production state — unchanged, and still blocked `[BLOCKED]`

- **Phase 1 schema exists in the repository but NOT in production.** Migrations
  `048_payment_reservation`, `049_payment_incidents`, `050_orders_status_check` are **still pending**
  and have never been applied (last successful migrate 2026-09-25; Neon quota error `53000` —
  an owner action).
- **Consequence for this sheet:** every "new column / new migration" listed in §1.7, §2.6, §3.6,
  §5.6, §6.7, §7.7, §10.5, §11.6, §12.6, §13.6, §14.5, §15.6, §16.4, §17.5 is **gated behind 048–050
  landing first**. No migration `051` may be created before then —
  `.github/workflows/migrate-neon.yml` applies **all pending** migrations unattended on push to `main`.
- **No production behavior changed by this task.** The V2 tables are unread by any live code path.

### 19.4 Test/verification caveat

This environment has **no local PostgreSQL**, so DB-gated tests **SKIP locally**. The only real
database execution is CI's disposable `postgres:16`
(`.github/workflows/test.yml` — `psql -f db/run-sqleditor.sql`, then `bun test backend/tests`).
Local results must never be reported as "database tests passed", and production must never be
reported as PASS.

### 19.5 Anchor verification note

Every `file:line` in this sheet was re-read in this pass at commit `3d798b9`. One prior citation was
corrected: **`commissions.order_id` is at `db/run-sqleditor.sql:522`**, not `:521` (§9.2, tagged
`[CITATION CORRECTION]`). The table block remains `:520-526`.

---

## 20. What happens next

1. The owner fills in **§18** and returns it.
2. Each answer is converted into the Phase 2/4/5/6/7/9 implementation, in that order, **only after**
   the answers that affect **customer-visible money, inventory, seller ownership, payment authority,
   and fulfillment** are all in hand.
3. **Phase 2 does not start until G1, G2 and G3 are answered.**
4. Production migrations 048–050 remain blocked on the Neon quota — an owner action, unchanged by
   this task.

**Until then: `PHASE 2 = BLOCKED`, and nothing about VelRepeat V2 is implemented.**
