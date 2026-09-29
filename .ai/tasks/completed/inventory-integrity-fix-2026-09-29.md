# Inventory integrity fix — CRITICAL #1 (settlement) + CRITICAL #2 (single release path)

**Task:** `fix(inventory): harden settlement and release` · **Date:** 2026-09-29
**Scope:** ONLY audit §42 CRITICAL #1 and CRITICAL #2 (`.ai/AI_HANDOFF.md` §42). No HIGH/MEDIUM
item was fixed, no schema/migration/production change, no VelRepeat work, no Stripe E2E, no
browser E2E.

Evidence tiers used below: **LOCAL VERIFIED** = executed in this workspace with its output
quoted · **PRODUCTION VERIFIED** = a live production read · **PRODUCTION BLOCKED** = blocked by a
provider condition · **NOT TESTED** = not executed from a workspace. Nothing is labelled PASS
unless a command or test actually produced it.

---

## A. Starting point

| Item | Value |
|---|---|
| Audited commit (handoff §42) | `2c52bfc734428232ed67dbde3a07b9985d4a506d` |
| Starting git SHA | `829347e518f17db883cd6b47bb0f780898b7a8de` |
| Branch | `main` |
| Working tree at start | clean (`git status --short` empty) |
| §0 startup sync | `git fetch origin` → `HEAD == origin/main == 829347e` → case **in sync**, proceeded |
| Code delta audited-commit → start | NONE — only `.ai/` documentation moved (`docs(ai)` commit `829347e`), so the source audited in §42 was byte-identical to the source at task start |
| Ending git SHA (code) | `8b89ecf139df08866ff09179c02a1e0ad094e150` (pushed, `HEAD == origin/main`) |

## B. Files inspected (read before any edit)

Mandated reading, in order: `AGENTS.md`, `.ai/AI_RULES.md`, `.ai/AI_HANDOFF.md` (incl. §42),
`.ai/context/project-map.md`, `.ai/context/database.md`, `.ai/context/checkout.md`,
`.ai/context/payment.md`, `.ai/context/testing.md`, `.ai/context/backend.md`.

Source actually read (not inferred from docs):

- `backend/lib/inventory.ts` — `validateCheckoutQuantity`, `reserveInventoryStock`,
  `RELEASABLE_STATUSES`, `releaseOrderInventory`
- `backend/lib/order-lock.ts` — `lockOrderRow`, `PAYMENT_SETTLED_STATUSES`,
  `paymentBlocksCancellation`, `latestPaymentStatusForOrder`
- `backend/routes/stripe.ts` — `markPaymentSucceeded` / `markPaymentFailed` /
  `markPaymentCanceled` (order-claim + inline inventory loop)
- `backend/routes/cart.ts` — order creation + reservation (`:940-:975`), customer cancellation
  (`:1245-1460`, claim → payments → release, and the `alreadyFinal` 200 for a lost race)
- `backend/routes/seller-orders.ts` — status PATCH (`:520-640`), the inline stock restore
- `backend/routes/center.ts` — admin status PATCH (`:439-510`), `:503`
- `backend/jobs/payment-reservation-scheduler.ts` — `expirePaymentReservation` (pre-read, guarded
  claim, payment write, release, session close)
- `backend/jobs/velrepeat-scheduler.ts` — second order-creation path (`:328-344`)
- `backend/lib/order-fulfillment.ts` (via `normalizeOrderStatusToFulfillment` usage in both routes)
- `db/schema.sql` — `inventory` (`:322-330`), `product_variants` (`:249-263`), `products.sold_count`
  (`:222`), `orders.status` (`:368`, no CHECK)
- Tests read: `payment-reservation-expiry.test.ts`, `payment-cancellation-race.test.ts`,
  `inventory-race.test.ts`, `customer-order-cancel.test.ts`,
  `order-fulfillment-state-machine.test.ts`, `seller-order-ux.test.ts`,
  `checkout-payment-flow.test.ts`, plus `backend/tests/helpers/{test-db,purge}.ts` usage

Repository-wide searches executed (evidence for §16 of the brief): `UPDATE inventory`,
`UPDATE product_variants`, `SET stock = stock +`, `SET quantity =`, `reserved = reserved +`,
`sold_count = sold_count`, `inventory_released`, `releaseOrderInventory(`, `commitOrderInventory(`.

## C. Findings before the fix (proved from source, not from the audit text)

### CRITICAL #1 — settlement never consumed `inventory.quantity`

- **FILE** `backend/routes/stripe.ts` · **FUNCTION** `markPaymentSucceeded` ·
  **LOCATION** `:426-435` (pre-fix line numbers)
- **CURRENT (proved):** inside `if (moved)` the loop ran
  `SELECT product_id, quantity FROM order_items` (no `variant_id`) and for **every** line did
  `UPDATE inventory SET reserved = GREATEST(0, reserved - $1) WHERE product_id = $2` and
  `UPDATE products SET sold_count = sold_count + $1`. `inventory.quantity` was written by **no**
  settlement code path anywhere (the only `quantity` writer in the repository is the seller's
  `PATCH /api/seller/products/:productId/stock` upsert, `backend/routes/products.ts:1487-1490`).
- **Availability (proved):** checkout guards on `quantity - reserved`
  (`backend/lib/inventory.ts:58-60`, `routes/cart.ts` reserve calls). With `quantity` untouched,
  a completed sale lowered `reserved` by N and therefore **raised availability by N** — the sold
  units went back on the shelf for every other customer.
- **VARIANT leg (proved):** for a variant line the hold lives in `product_variants.stock`
  (`routes/cart.ts:955-963` `stock = stock - $1 … WHERE stock >= $1`), and the parent
  `inventory.reserved` was never incremented for it — yet settlement decremented that parent row
  anyway, i.e. it removed a hold belonging to a different order.
- **EXPECTED:** `quantity -= N`, `reserved -= N`, `sold_count += N` (non-variant); variant stock
  stays where the reservation put it; other rows untouched.
- **RISK:** unbounded oversell, `sold_count > quantity`, one order's settlement stealing another
  order's hold.
- **Test that pinned the defect:** `backend/tests/payment-reservation-expiry.test.ts:979`
  `expect(after.quantity).toBe(50)` after a successful payment for 2 units (see §D).

### CRITICAL #2 — the seller cancellation was a second release path

- **FILE** `backend/routes/seller-orders.ts` · **FUNCTION** `PATCH /api/seller/orders/:id/status` ·
  **LOCATION** `:610-623` (pre-fix)
- **CURRENT (proved):** after `UPDATE orders SET status = 'cancelled' …`, the route ran its own
  `SELECT product_id, variant_id, quantity FROM order_items …` and, per item,
  `UPDATE product_variants SET stock = stock + $1` (no clamp) or
  `UPDATE inventory SET reserved = GREATEST(0, reserved - $1)` — **without ever setting
  `orders.inventory_released`** and without any atomic claim.
- **EXPECTED:** every restore through the one authority `releaseOrderInventory()`, whose
  `inventory_released` claim makes exactly-once enforceable.
- **RISK:** seller restore + a later webhook/sweep restore (the flag was still `FALSE`, status
  `cancelled` ∈ `RELEASABLE_STATUSES`) → the same units returned twice; the unclamped
  `stock = stock + q` could manufacture phantom variant units.

**Release/commit map built before the fix** (the brief's required proof that >1 path existed):

| Path | Kind | Where |
|---|---|---|
| `releaseOrderInventory()` | release (flagged) | cart.ts:1400, stripe.ts:472, stripe.ts:505, payment-reservation-scheduler.ts:183 |
| seller inline restore | release (**unflagged — the defect**) | seller-orders.ts:616/:621 |
| admin status PATCH | **no release at all** | center.ts:503 |
| inline settlement loop | commit | stripe.ts:426-435 |
| creation-time writes | reserve + `sold_count` | cart.ts:957/:972, velrepeat-scheduler.ts:328/:341/:344 |

## D. Changes made

### 1. `backend/lib/inventory.ts` — the settlement authority (new)

- **Added `commitOrderInventory(client, orderId)`** (the COMMIT path, mirror image of the release).
  Reads `product_id, variant_id, quantity` from `order_items`; per line:
  - non-variant → `UPDATE inventory SET quantity = GREATEST(0, quantity - $1),
    reserved = GREATEST(0, reserved - $1) … WHERE product_id = $2`
  - variant → **no inventory write** (its `product_variants.stock` was already decremented at
    reserve time; that decrement IS the consumption) and, crucially, never the parent row
  - both → `UPDATE products SET sold_count = sold_count + $1 WHERE id = $2`
  - **Invariant protected:** one commit per reservation (the caller's order-status claim is the
    gate), never-negative stock (`GREATEST`), variant lines never touch another order's hold,
    availability `quantity - reserved` unchanged by a sale.
- **Added the settled-payment guard to the release claim** in `releaseOrderInventory()`:
  `AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = orders.id AND p.status =
  ANY($3::text[]))` with `$3 = PAYMENT_SETTLED_STATUSES` imported from `lib/order-lock.ts` (the
  same `["paid","processing"]` rule the expiry sweep already applies), plus a diagnostic branch in
  the "claim lost" log so the reason is visible.
  - **Invariant protected:** no COMMIT+RELEASE and no RELEASE+COMMIT for one reservation, even
    when a status writer later moves a settled order to `cancelled` (seller/admin cancel).
- No other behaviour of the release was changed: flag claim, status list and variant restore are
  untouched.

### 2. `backend/routes/stripe.ts` — use the authority

- Replaced the inline inventory loop in `markPaymentSucceeded` with
  `await commitOrderInventory(client, orderId);` inside the **same transaction**, still guarded by
  `if (moved)`, still after `lockOrderRow`. Import updated.
- **Invariant protected:** money and stock move atomically (a settlement can never be half
  applied), exactly once (only the claim winner reaches it).

### 3. `backend/routes/seller-orders.ts` — route the cancel through the authority

- Replaced the inline restore block with `await releaseOrderInventory(client, orderId);` (import
  added), immediately after the existing `UPDATE orders SET status = $1`.
- **Invariant protected:** one release authority, atomic exactly-once claim, and no restore at all
  for a settled order. The seller route now writes no inventory row (proved by the structural test
  below).

### 4. Tests

- **NEW `backend/tests/inventory-settlement.test.ts`** (14 tests: 2 structural + 12 DB-gated) —
  Tests A/B/C/D/E/I/J of the brief plus races 2,3,5,6,7,9,10,12. Every exactly-once test seeds a
  SECOND unrelated order's hold (`reserved = 2·q` while this order owns `q`), because both writes
  are floored: one release leaves `reserved = q`, two releases leave `0` — so a double release is
  observable instead of being hidden by `GREATEST(0, …)`.
- **Fixed the wrong invariants** (not the numbers — the assertion):
  - `payment-reservation-expiry.test.ts:979` `expect(after.quantity).toBe(50)` after a successful
    payment for 2 → now `toBe(48)` with a comment naming the defect it used to pin.
  - same file `:1374` (`toBe(50)` "available stock untouched" → `toBe(48)` **plus**
    `expect(after.quantity - after.reserved).toBe(48)`, i.e. availability really is unchanged) and
    `:1476` (path A of "one reservation → at most ONE terminal inventory transition" → `48`);
    `:757` and `:1482` are release paths and correctly still assert `50`.
  - `payment-cancellation-race.test.ts` `:834`, `:1149`, `:1177`, `:1203` — now outcome-dependent:
    committed → `47` (50 − 3), released → `50`.

## E. Inventory model (as it actually is in `db/schema.sql`)

| Field | Meaning | Written by |
|---|---|---|
| `inventory.quantity` | **on-hand** units — a unit held by an open order is still counted in it | seller `PATCH /api/seller/products/:id/stock` (upsert), and now **settlement (`quantity −N`)** |
| `inventory.reserved` | units **held** by open orders | `reserveInventoryStock()` (`+N`, guarded by `quantity - reserved >= N`), `releaseOrderInventory()` (`−N`, floored), **settlement (`−N`)** |
| `product_variants.stock` | a variant's **available** units — hold and sale both live in this one column (there is no variant `reserved`/`quantity`) | checkout reserve (`−q`, guarded `stock >= q`), `releaseOrderInventory()` (`+q`), seller stock edit; **settlement leaves it alone** |
| `products.sold_count` | sales counter | **settlement (`+N`, once)**, and VelRepeat at creation (known finding #10, untouched) |
| **available** (non-variant) | `quantity - reserved` | derived — this is what checkout guards on |

Lifecycle:

```
RESERVE   checkout  → non-variant: reserved += q (available −q)
                     variant:      stock     −= q (available −q)
COMMIT    payment settled → non-variant: quantity −q, reserved −q  (available unchanged)
                            variant:      nothing (the reserve decrement IS the consumption)
                            both:         sold_count +q
RELEASE   order ended (cancel / fail / expire) → non-variant: reserved −q; variant: stock +q
                     claimed exactly once via `inventory_released`, refused when money settled
```

Exactly-once: the COMMIT gate is the order-status claim (`pending|pending_payment` → `paid`,
requiring `inventory_released = FALSE`) under `lockOrderRow`; the RELEASE gate is the
`inventory_released` claim + status ∈ `RELEASABLE_STATUSES` + no settled payment. The two gates
are mutually exclusive by construction.

## F. Release authority

**`backend/lib/inventory.ts → releaseOrderInventory()` (line 193) — the ONE release authority.**

All production callers (5):

| Caller | Trigger |
|---|---|
| `backend/routes/cart.ts:1400` | customer cancellation |
| `backend/routes/stripe.ts:465` | `markPaymentFailed` (payment failure) |
| `backend/routes/stripe.ts:498` | `markPaymentCanceled` (session expired / intent canceled / webhook cancel) |
| `backend/routes/seller-orders.ts:613` | seller cancellation (**new** — was inline) |
| `backend/jobs/payment-reservation-scheduler.ts:183` | 30-minute reservation expiry sweep |

**Settlement authority:** `backend/lib/inventory.ts → commitOrderInventory()` (line 115), called
by exactly one caller: `backend/routes/stripe.ts:429`.

Post-fix repository search (evidence, §16 of the brief):

```
direct inventory-table writes (production) : backend/lib/inventory.ts only
  :60 reserve   `UPDATE inventory SET reserved = reserved + $1 … WHERE quantity - reserved >= $1`
  :128 commit   `UPDATE inventory … quantity = GREATEST(0, quantity - $1), reserved = GREATEST(0, reserved - $1)`
  :266 release  `UPDATE inventory SET reserved = GREATEST(0, reserved - $1) …` (claim-gated)
direct variant-stock writes (production)   : RESTORE only in lib/inventory.ts:260 (release)
  RESERVE direction: routes/cart.ts:957 (checkout) and jobs/velrepeat-scheduler.ts:328 (VelRepeat
  creation — audit §42 MEDIUM #10, OUT OF SCOPE here)
order-lifecycle routes touching inventory  : NONE (cart, stripe, seller-orders, center, sweep)
```

Remaining direct write paths are therefore: 1 release authority, 1 settlement authority, 1
reserve authority (+1 pre-existing VelRepeat creation path, reported, not fixed). **No duplicate
release path remains.**

## G. Race matrix — every row actually executed

All rows below are **PASS**; they were produced by CI run `36564425934` on `8b89ecf` against a
disposable PostgreSQL (real connections, `Promise.all` concurrency — never sequential calls).

| Race | Result | Evidence (test) |
|---|---|---|
| payment success × customer cancel | PASS | `payment-cancellation-race.test.ts` — "a concurrent cancellation and settlement both WAIT on the order row, and exactly one wins", "the settlement that lands first wins: the later cancellation is refused and releases nothing" |
| payment success × seller cancel | PASS | **NEW** `inventory-settlement.test.ts` — "J — settlement ∥ seller cancel: commit XOR release, never both" |
| payment success × payment expiry | PASS | **NEW** "K — settlement ∥ expiry sweep: one terminal transition, decided by the DB" + `payment-cancellation-race` "TEST 07" |
| payment success × payment (customer) cancellation | PASS | `payment-cancellation-race` — "a settlement after the cancellation is RECORDED but never resurrects the order" |
| seller cancel × webhook cancellation | PASS | **NEW** "F — seller cancel ∥ checkout.session.expired: one release, never two" |
| customer cancel × webhook cancellation | PASS | **NEW** "I — customer cancel ∥ checkout.session.expired: one release, never two" |
| expiry × webhook cancellation | PASS | **NEW** "G — expiry sweep ∥ checkout.session.expired: one release, never two" |
| duplicate webhook (same event id) | PASS | `payment-cancellation-race` — "TEST 18 — the SAME Stripe event delivered concurrently settles exactly once", "a duplicate payment_intent.succeeded settles exactly once" |
| duplicate cancellation | PASS | **NEW** "D — a cancellation (issued twice, concurrently) releases exactly once" |
| duplicate expiry | PASS | **NEW** "H2 — the expiry sweep run twice concurrently expires once" |
| duplicate payment success (distinct event ids) | PASS | **NEW** "C — a second, differently-identified settlement consumes nothing more" + `payment-cancellation-race` "TEST 06" |
| payment success near the deadline | PASS | `payment-reservation-expiry` — "TEST 01 — a settlement one second before the deadline wins", **NEW** "K" (delivery during the expiry) |

Brief's Tests A–J: **A** = "A/J — settlement: quantity −N, reserved −N, sold_count +N, once" ·
**B** = "B — variant settlement consumes that variant and never the parent's hold" ·
**C** = above · **D** = above (plus the pre-existing `inventory-race` "releaseOrderInventory
restores reserved stock exactly once") · **E** = "E — seller cancellation restores stock exactly
once, through the authority" · **F/G** = the two races above · **H** = "K" ·
**I** = "I2 — stock boundaries: last unit, exact fit, surplus, and an oversell attempt" ·
**J** = "A/J" + "C" + the `soldCount === 0` assertions in D/E/F. All PASS.

## H. Test commands actually run (exit codes are real)

| Command | Exit | Result |
|---|---|---|
| `NODE_ENV=test bun test backend/tests` (local) | **0** | **857 pass / 161 skip / 0 fail**, 4957 `expect()` calls, 1018 tests / 47 files |
| `NODE_ENV=test bun test backend/tests/inventory-settlement.test.ts` (local) | **0** | 2 pass / 12 skip / 0 fail (the 12 DB-gated ones skip here by design) |
| `cd backend && bun tsc --noEmit` | **0** | no type errors |
| `bun run typecheck` | **0** | 4/4 apps: velshop, velseller, velcenter, velnox |
| `bun run build:apps` | **0** | all four Vite builds green (velcenter 7.03 s, velnox 4.90 s, …) |
| `bun run i18n:check` | **0** | `th=1414 en=1414 my=1414 keys, all locales at parity` |
| `bun run lint` | 0 | **PLACEHOLDER** — prints `Lint not yet configured`; there is no real linter in this repo |
| `git diff --check` | **0** | clean (before commit) |
| `gh run watch 36564425934 --exit-status` | **0** | CI green (see §I) |

## I. Full test result

```
LOCAL  (sandbox, no TEST_DATABASE_URL → DB-gated tests skip)
  857 pass · 161 skip · 0 fail · 1018 tests / 47 files

CI     (run 36564425934, commit 8b89ecf, disposable postgres:16, no repo secrets)
  1016 pass · 2 skip · 0 fail · 1018 tests / 47 files · 10.70 s
  job "Typecheck + tests (disposable PostgreSQL)" — every step ✓, including
  "Bootstrap the disposable database", "Verify the guard refuses production",
  "Run the test suite", "Whitespace hygiene"
```

The new file's DB-gated tests are individually confirmed **(pass)** in the CI log:
A/J 25.51 ms, B 26.17 ms, C 31.57 ms, D 26.46 ms, E 24.54 ms, F 22.90 ms, G 24.50 ms,
H2 18.79 ms, I 22.31 ms, J 24.93 ms, K 26.29 ms, I2 53.31 ms.

Baseline for comparison: the audited commit `2c52bfc` ran **1002 pass / 2 skip / 0 fail**;
this commit runs **1016 pass / 2 skip / 0 fail** — the +14 are this task's tests, and none of the
pre-existing 1002 regressed.

## J. Type / build / i18n

- backend `tsc --noEmit` → exit 0
- `bun run typecheck` → 4/4 apps exit 0
- `bun run build:apps` → exit 0 (all four apps)
- `bun run i18n:check` → th=en=my=1414 (unchanged; no UI string was added)
- `bun run lint` → placeholder output, recorded as such

## K. Git diff verification

```
$ git diff --check                 → exit 0 (clean)
$ git status --short               →
   M backend/lib/inventory.ts
   M backend/routes/seller-orders.ts
   M backend/routes/stripe.ts
   M backend/tests/payment-cancellation-race.test.ts
   M backend/tests/payment-reservation-expiry.test.ts
?? backend/tests/inventory-settlement.test.ts
$ git diff --stat                  → 5 files changed, 147 insertions(+), 50 deletions(-) (pre-commit)
$ git diff --stat 829347e..HEAD -- db/ → 0 lines  ⇒ NO SCHEMA CHANGE
$ ls db/run-update.sql             → does not exist (not resurrected)
$ git push origin main             → 829347e..8b89ecf
$ git rev-parse HEAD origin/main   → 8b89ecf139df08866ff09179c02a1e0ad094e150 (both)
```

## L. Production status (do not read as PASS)

| Area | Status | Evidence |
|---|---|---|
| Neon migration 048 | **PRODUCTION BLOCKED** | unchanged by this task; `Migrate Neon Database` still dies on `ERROR: Your account or project has exceeded the quota` (runs `36454467112`, `36454465288`, `36437470328`, `36371800184`), and `GET /api/_diag/schema` answers **401 UNAUTHORIZED** from a workspace. The reservation columns are still absent in production |
| Stripe E2E (real PaymentIntent / PromptPay QR / webhook delivery / refund) | **BLOCKED** | no `STRIPE_*` keys and no `TEST_DATABASE_URL` in this workspace; only locally-signed webhook payloads were used |
| Browser E2E (`/orders`, `/cart`, seller order pages) | **NOT TESTED** | no signed-in session and no dev server per workspace policy; layout/behaviour pinned by contract tests only |
| CI on this commit | **PRODUCTION-BEHAVIOUR VERIFIED (test tier)** | run `36564425934` green against disposable PostgreSQL |
| Deployed backend (Render) | **NOT TESTED** | no deployed-instance probe was run for this change |

## M. Remaining risks (from audit §42 — NOT fixed here)

| # | Severity | Item | State |
|---|---|---|---|
| 1 | CRITICAL | stock not consumed on settlement | **FIXED this task** |
| 2 | CRITICAL | seller double-release path | **FIXED this task** |
| 3 | HIGH | a seller/center can cancel a `paid` order: money kept, no refund, no alert | **open** (policy decision). Behaviour note: stock is now *never* returned for a settled order — before the fix that path decremented `reserved` a second time and wiped other orders' holds, so this task removed the corruption but did not decide the refund policy |
| 4 | HIGH | `payment_intent.payment_failed` is per-attempt but terminal at order level (retry → order stuck `payment_failed` with a paid payment) | **open** |
| 5 | HIGH | a late payment has only `console.warn`, no operator queue / auto-refund | **open** |
| 6 | HIGH | **PRODUCTION BLOCKED** — migration 048 unapplied, Part 2 inert in production | **open** (owner action) |
| 7 | MEDIUM | settlement ignored variants (decremented the parent's hold) | **FIXED this task** — it was the same inline loop as #1 |
| 8 | MEDIUM | two overlapping urgency contracts in `commerce.ts` | **open** |
| 9 | MEDIUM | `orders.status` has no CHECK constraint | **open** |
| 10 | MEDIUM | VelRepeat creates orders bypassing the guards (`sold_count` at creation, `method 'cod'`) | **open** — still the only non-lib writer of `sold_count`/variant stock |
| 11 | MEDIUM | inventory-row AB-BA deadlock → 500 `CHECKOUT_FAILED` instead of 409 | **open** |
| 12–14 | LOW | dead `"failed"` in `RELEASABLE_STATUSES`; `inventory-race` 4 pass/8 skip locally; per-shop settlement split | **open** |

**NEW findings from this pass (reported, deliberately not fixed — out of scope):**

1. **`backend/routes/center.ts:503` releases nothing.** The admin status PATCH moves an order to
   `cancelled` but neither restores stock nor sets `inventory_released`, so an admin cancellation
   of an **unpaid** order leaks its reservation permanently (0 terminal transitions instead of 1).
   It is not a double-release (the flag stays false), but it is a stock leak. Recommended next fix:
   call `releaseOrderInventory()` there too.
2. **Behaviour consequence of the new release guard:** cancelling a settled order (seller or
   admin) no longer returns its units — correct under the exactly-once invariant, and it means a
   refund-driven restock would have to be built as its own flow (ties into HIGH #3).

## N. Final verdict

```
CRITICAL #1:  PASS
  Evidence: commitOrderInventory() in backend/lib/inventory.ts:115 consumes
  quantity/reserved/sold_count atomically with the order claim; called from
  stripe.ts:429. Proven by NEW test "A/J" (50→48, reserved 2→0, sold 0→2) and
  "B" (variant stock unchanged, parent hold intact), both (pass) in CI run
  36564425934. The old pin at payment-reservation-expiry.test.ts:979 now asserts
  the business invariant (48), not the defect.

CRITICAL #2:  PASS
  Evidence: seller-orders.ts:613 calls releaseOrderInventory(); the route no
  longer contains any inventory/variant SQL (structural test) and sets
  inventory_released through the atomic claim. Proven by NEW test "E"
  (release exactly once, stranger's hold intact, flag TRUE) and race "F"
  (seller ∥ webhook → reserved 2, never 0), both (pass) in CI run 36564425934.

Inventory source of truth: Neon `inventory` (quantity/reserved) +
  `product_variants.stock`, both written only by backend/lib/inventory.ts
  (reserve / commit / release) for order lifecycle.
Release authority:    backend/lib/inventory.ts → releaseOrderInventory() — 5 callers
Commit authority:     backend/lib/inventory.ts → commitOrderInventory() — 1 caller

Production readiness: NOT READY
  (migration 048 still BLOCKED by the Neon quota — HIGH #6 — plus open HIGH
  #3/#4/#5; this task changed no production system)

Next recommended task: clear the Neon quota and apply migration 048 (owner), then
  HIGH #5 (an operator surface for late/refused payments) — it is the only
  remaining item where money can be taken with no automated path back.
```

Full evidence chain: this file + CI run `36564425934` on `8b89ecf`.

---

# CI Failure Follow-up — paid-cancellation regression assertion (2026-09-29)

**Outcome: CI GREEN, implementation UNCHANGED.** The only failure left after §44
(`895cebf` + `3d77254`) was a self-contradictory assertion in the test that §44 itself
added. No production source file was touched.

Start SHA `08d6d68` ("docs(ai): record the paid-order cancellation guard (audit HIGH #3)").
Note: the brief named the failing file `backend/tests/fulfilment-gates-and-races.test.ts`.
**That file does not exist.** The failure was in
`backend/tests/order-fulfillment-state-machine.test.ts` — the describe block
`"fulfilment gates and races (requires TEST_DATABASE_URL)"` at line 414 (British
spelling `fulfilment`, hence the brief's spelling). Found by grepping the describe
title, not by guessing the filename.

## Before

- **Exact failing command:** CI job `Tests` → `Typecheck + tests (disposable PostgreSQL)`
  (`.github/workflows/test.yml`), step `bun test backend/tests`, against `3d77254`+.
- **Exact failing test:** `fulfilment gates and races (requires TEST_DATABASE_URL) >
  a paid order is refused a staff cancellation; an unpaid one is not`
  (`backend/tests/order-fulfillment-state-machine.test.ts`, the DB-gated test added in §44).
- **Expected value:** `"confirmed"`
- **Received value:** `"paid"`
- **Exit code:** 1
- **Local reproduction is IMPOSSIBLE, and this is not a guess.** The test is
  `testFn = hasDb ? test : test.skip` (`hasTestDatabase()`), so it only runs where
  `TEST_DATABASE_URL` exists. This sandbox has no Postgres and no container runtime
  (`command -v` for `docker`/`podman`/`pg_ctl`/`postgres`/`initdb`/`psql` → all absent).
  Real local run, `bun test backend/tests/order-fulfillment-state-machine.test.ts`:
  **24 pass / 5 skip / 0 fail, exit 0** — the failing test among the 5 skips.
  The reproduction therefore happened in CI, and the verification of the fix is CI too.

## Investigation

Source files inspected before touching anything:

| File | What it was read for |
|---|---|
| `backend/lib/order-fulfillment.ts` | `assertNoSettledPaymentForCancellation` (line 307) — whether the gate itself writes |
| `backend/tests/order-fulfillment-state-machine.test.ts` | the whole test, lines 670–782 |
| `backend/tests/order-fulfillment-state-machine.test.ts:414` | the `hasTestDatabase()` gate |
| `.github/workflows/test.yml` | how CI provisions `postgres:16` and sets `TEST_DATABASE_URL` |
| `backend/tsconfig.json` | whether `tsc` even covers `tests/` (it does not — `exclude: ["tests"]`) |
| `backend/lib/order-lock.ts` | `PAYMENT_SETTLED_STATUSES` (unchanged, context only) |

**Reason for the failure — a stale/incorrect assertion that contradicted its own
fixture (category 1 + category 4, NOT a production defect).** The old code was:

```ts
const paidRow = await mkOrder();                                  // status 'confirmed'
await query(`UPDATE orders SET status = 'paid' WHERE id = $1`, [paidRow]);   // ← the test sets 'paid'
expect((await attemptCancel(paidRow))?.code).toBe("ORDER_ALREADY_PAID");

// No refusal moved anything: every order is still `confirmed`.
const rows = await query(`SELECT id, status FROM orders WHERE id = ANY($1::uuid[])`, [
  [inFlight, paid, paidRow],
]);
expect(rows.rows.length).toBe(3);
for (const row of rows.rows) expect(row.status).toBe("confirmed");  // ← asserts paidRow is 'confirmed'
```

The test deliberately seeds `paidRow` at `'paid'` — that is the whole point of the
fourth case, proving the raw webhook-written order status is refused too, not just a
`paid` **payment row**. Three lines later the same test asserted that row was still
`'confirmed'`. The two statements cannot both hold, so the loop failed on `paidRow`
with `Expected: "confirmed"` / `Received: "paid"`.

The implementation is correct and was **not** changed, for three reasons proved from
source:

1. `assertNoSettledPaymentForCancellation` is a single `SELECT` (`order-fulfillment.ts:311-319`)
   with no `UPDATE`/`INSERT`/`DELETE` — it is read-only by construction, so it cannot
   move an order back to `confirmed`. The failing assertion was testing a write that
   the gate never performs.
2. The business rule is asserted correctly and DID pass in CI, at line 769
   (`expect((await attemptCancel(paidRow))?.code).toBe("ORDER_ALREADY_PAID")`). CI
   reported exactly one failure, and it was the later sweep, not the gate.
3. `paid → confirmed` is not a transition any code performs. `mkOrder()` seeds
   `'confirmed'`; nothing in `order-fulfillment.ts`, `seller-orders.ts` or `center.ts`
   ever writes `'confirmed'` onto a `'paid'` order. "Fixing" the assertion to force a
   pass would have required inventing a write that the code does not have.

Verdict per the brief's four categories: **(1) stale assertion** and
**(4) state the test did not account for** — the `paid` seed is the test's own fixture,
not production state.

## Fix

- **Exact file changed:** `backend/tests/order-fulfillment-state-machine.test.ts`
  (the ONLY file; `git diff --stat` = `1 file changed, 13 insertions(+), 4 deletions(-)`).
- **Exact assertion corrected:** the blanket "every order is still `confirmed`" loop was
  replaced with a per-order assertion of each row's **seeded** status, and `unpaid` was
  added to the select so the ALLOWED path is covered too:

```ts
const rows = await query(`SELECT id, status FROM orders WHERE id = ANY($1::uuid[])`, [
  [unpaid, inFlight, paid, paidRow],
]);
expect(rows.rows.length).toBe(4);
const statusById = new Map<string, string>();
for (const row of rows.rows) statusById.set(row.id as string, row.status as string);
expect(statusById.get(unpaid)).toBe("confirmed");
expect(statusById.get(inFlight)).toBe("confirmed");
expect(statusById.get(paid)).toBe("confirmed");
expect(statusById.get(paidRow)).toBe("paid");
```

- **Why this reflects the actual state machine:** the original intent — "no refusal
  moved anything" — is a claim about *the gate not writing*, and the correct way to
  express "nothing moved" is to compare each row against its own baseline, not against
  a single hard-coded value that one fixture deliberately violates. The new form keeps
  every original intent and ADDS coverage: `unpaid` (the allowed cancellation) is now
  asserted to be unmoved as well, and the three refusals are each pinned individually
  instead of by one shared loop.
- **Constraints honoured:** no test deleted, no `.skip`/`.only` added (grep for
  `\.only\|\.skip(` in the file → none), no assertion weakened, no business rule
  touched. `backend/lib/inventory.ts`, `backend/routes/stripe.ts`, `releaseOrderInventory()`,
  `commitOrderInventory()`, `inventory_released`, settlement, quantity/variant stock,
  the cancellation rule, Stripe, the reservation system, migration 048, VelRepeat and the
  frontend were all left byte-identical (`git diff` confirms the test file is the only change).

## After (every number below is a real command result, not an estimate)

| Check | Command | Result |
|---|---|---|
| Targeted | `bun test backend/tests/order-fulfillment-state-machine.test.ts` | **24 pass / 5 skip / 0 fail**, exit 0 (the fixed test is one of the 5 DB skips — see Before) |
| Related (12 files) | `payment-cancellation-race`, `payment-reservation-expiry`, `inventory-race`, `inventory-settlement`, `customer-order-cancel`, `seller-orders`, `checkout-payment-flow`, `velrepeat-core`, `order-status-contract`, `seller-order-ux`, `webhook-resilience`, `stripe-webhook-raw-body` | **189 pass / 83 skip / 0 fail**, 272 tests / 12 files, exit 0 |
| Full backend | `NODE_ENV=test bun test backend/tests` | **860 pass / 162 skip / 0 fail**, 1022 tests / 47 files, 4992 expect calls, exit 0 — identical to the §44 baseline |
| Typecheck (apps) | `bun run typecheck` | 4/4 apps exit 0 |
| Typecheck (backend) | `cd backend && bunx tsc --noEmit` | exit 0 |
| Test-file types | `bunx tsc --noEmit … tests/order-fulfillment-state-machine.test.ts` | 4 errors, all pre-existing/environmental (`bun:test` types at :37, `ImportMeta.dir` at :62, `possibly undefined` at :305, `Bun` at :403) — **none in the edited range 771-782** |
| Build | `bun run build:apps` | 4/4 built, exit 0 |
| i18n | `bun run i18n:check` | th=1416 en=1416 my=1416, at parity, exit 0 |
| Lint | `bun run lint` | placeholder (`Lint not yet configured`), exit 0 |
| Diff check | `git diff --check` | clean, exit 0 |

The locally-skipped DB gate is unchanged and still fails closed: no Postgres and no
container runtime exist in this workspace, so the paid-cancellation test executes ONLY
in CI, against the disposable `postgres:16` service container. That is the LOCAL tier
recorded in the handoff, and it is why the CI run below is the proof of this fix.

### CI confirmation (the real proof, since the fixed test cannot run locally)

| | |
|---|---|
| Run | **`36580595287`** — `.github/workflows/test.yml` → job `Typecheck + tests (disposable PostgreSQL)` |
| Commit | `2a725d3c467781d3e22f34a379cdf35c85dc2481` |
| Result | **success** · `1020 pass / 2 skip / 0 fail` · 1022 tests / 47 files · 5958 expect calls |
| The fixed test | `(pass) fulfilment gates and races (requires TEST_DATABASE_URL) > a paid order is refused a staff cancellation; an unpaid one is not [12.72ms]` |

**What the previous run proves about the diagnosis.** Run `36578719384` on `08d6d68` was
`failure` with **exactly one** failing test, and the log is the brief's own error verbatim:

```
Expected: "confirmed"
Received: "paid"
(fail) fulfilment gates and races (requires TEST_DATABASE_URL) > a paid order is refused a staff cancellation; an unpaid one is not [13.58ms]
```

i.e. the failure was at the blanket sweep, NOT at the `ORDER_ALREADY_PAID` gate assertion
that precedes it — the gate itself was green in CI, which is the fourth piece of evidence
that the implementation was correct and the assertion was the defect. It also confirms the
file was `order-fulfillment-state-machine.test.ts` all along, not the
`fulfilment-gates-and-races.test.ts` named in the brief.
