# MEDIUM #8 — duplicated reservation-urgency contracts in `commerce.ts` (2026-09-30)

**Decision: FIXED (CASE C — one contract was provably dead).**
Commit `fix(shared): resolve reservation urgency contract duplication` · baseline `d21de22`
(= `origin/main` at start).

---

## 1. Objective — what MEDIUM #8 actually was

Audit §42.2 **M8**, verbatim from the archived detail:

> `paymentReservationPhase()` / `PAYMENT_RESERVATION_URGENT_MS = 3 min` AND `paymentReservationTone()` /
> `PAYMENT_RESERVATION_YELLOW_MS = 15 min` / `RED_MS = 5 min` live in the SAME file
> (`packages/shared/src/lib/commerce.ts:783-898`), and both `MyOrders.tsx` and `ShopOrderDetail.tsx` call
> both. **EXPECTED: ONE urgency authority.**

The finding was *not* allowed to be resolved on names alone. Two questions had to be answered from
source first:

1. Are the two contracts genuinely **duplicated** (same job, one can be canonical), **semantically
   different** (both must stay), or is one of them **dead**?
2. If a contract is removed, does any consumer's **rendered output change**?

## 2. Baseline

| Check | Result |
|---|---|
| `git status --short` | empty — **no uncommitted changes, nothing to preserve** |
| `git branch --show-current` | `main` |
| `git log -8 --oneline` | `d21de22 docs(ai): record the green CI run for LOW #12` (HEAD) |
| `git fetch origin` → `git rev-parse HEAD` vs `origin/main` | both `d21de223ed25f80174f978bcaf7d4dbf3f20ee50` — **in sync, not behind, not diverged** |

## 3. Investigation — every contract examined

All in `packages/shared/src/lib/commerce.ts` unless stated. Category per the brief's 9-way split.

| # | Symbol | Consumers | Runtime / type | Owner | Verdict |
|---|---|---|---|---|---|
| 1 | `OrderReservationInput` (`:750`) | `paymentReservationState`, `paymentReservationPhase` | type-only | shared | **live — input contract** (cat. 1) |
| 2 | `PaymentReservationState` (`:755`) | `paymentReservationState` return; `orderStripePayability` (`:734`) | type-only | shared | **live** (cat. 1) |
| 3 | `paymentReservationState()` (`:776`) | `orderStripePayability:734`, `paymentReservationPhase:902`, both pages, 3 test files | runtime | shared | **live — canonical window reader** (cat. 1) |
| 4 | `formatPaymentCountdown()` (`:806`) | both pages, tests | runtime | shared | **live** (cat. 6 helper) |
| 5 | `PAYMENT_RESERVATION_URGENT_MS` (`:825`) | **one** site: `paymentReservationPhase:905`, to choose `"urgent"` vs `"active"` | runtime | shared | **DEAD — removed** (cat. 8) |
| 6 | `PAYMENT_RESERVATION_YELLOW_MS` (`:840`) | `paymentReservationTone:854` | runtime | shared | **live** (cat. 2) |
| 7 | `PAYMENT_RESERVATION_RED_MS` (`:841`) | `paymentReservationTone:853` | runtime | shared | **live** (cat. 2) |
| 8 | `PaymentReservationTone` (`:843`) | `MyOrders` (`Record<PaymentReservationTone, string>` ×3), `ShopOrderDetail` (`RESERVATION_TONE_STYLES`) | type-only | shared | **live** (cat. 2) |
| 9 | `paymentReservationTone()` (`:849`) | both pages, `order-ux-polish.test.ts` | runtime | shared | **live — THE urgency authority** (cat. 2) |
| 10 | `paymentReservationProgress()` (`:865`) | both pages, tests | runtime | shared | **live** (cat. 2) |
| 11 | `PaymentReservationPhase` (`:882`) | both pages, 2 test files | type-only | shared | **live, minus one dead member** (cat. 8) |
| 12 | `paymentReservationPhase()` (`:898`) | both pages (`MyOrders:163,198,392,507`; `ShopOrderDetail:303,509`), 2 test files | runtime | shared | **live** (cat. 1) |
| 13 | `PAYMENT_RESERVATION_MINUTES` / `_SECONDS` / `_MS` | `backend/lib/payment-reservation.ts` + backend tests | runtime | **backend** | **live — the policy, ONE definition** (cat. 4) |
| 14 | `reservationMinutes` (`:324`) | both pages read it as the bar denominator | API response field | backend → API | **live** (cat. 3) |
| 15 | `paymentExpiresAt` | both pages, `orderStripePayability`, `cart.ts` mapping | API response field | backend → API | **live** (cat. 3) |

### The decisive evidence

Every comparison against a phase value in the entire repository:

```
MyOrders.tsx:164          phase === "active" || phase === "urgent"
MyOrders.tsx:507          reservationPhase === "active" || reservationPhase === "urgent"
ShopOrderDetail.tsx:509   reservationPhase === "active" || reservationPhase === "urgent"
```

Plus `=== "expired"` (three sites) and `=== "none"` (one site). **There is not one consumer anywhere
that distinguishes `"urgent"` from `"active"`.** The 3-minute tier therefore could not change a single
pixel, a single word, or a single class.

Meanwhile the urgency a customer actually sees is selected from the **tone**:
`tone === "red" ? t("orderReservation.criticalNote") : tone === "yellow" ? t("…urgentNote") : t("…windowNote")`
— on **both** pages, with the colour maps keyed by `PaymentReservationTone`. The alarm escalates at
**15 min and 5 min**, not at 3.

### Why it was dead (history, from the archive)

- **§38** introduced `paymentReservationPhase()` + `PAYMENT_RESERVATION_URGENT_MS = 3 min` when that
  single scale *was* the whole urgency model.
- **§39** (`8261152`) shipped the tier UI (GREEN >15:00 / YELLOW ≤15:00 / RED ≤5:00) and the progress
  bar — **and left the 3-minute tier behind**.
- The old doc comment even claimed *"the last three minutes stay 'urgent' too, which is what turns
  the hurry note on"* — **false**: the hurry note has been driven by `tone === "red"` (5 min) since §39.

So it is a **superseded remnant of the original design**, not an intentionally separate contract.
That is CASE C, not CASE B.

### What is NOT duplicated (checked and deliberately left alone)

- **The phase and the tone are not duplicates of each other.** The phase answers *"is there a
  countdown, and has it lapsed"* (input: an order). The tone answers *"how alarming does it look"*
  (input: a number). Different inputs, different outputs, both live. They now simply do not **overlap**.
- **The backend policy vs the frontend presentation are not duplicates** — the backend owns *how long*
  a window is, the storefront owns *how alarming it looks*.

## 4. Data flow (traced end to end, unchanged)

```
orders.payment_expires_at + orders.reservation_policy   ← Neon
   └─ backend/lib/payment-reservation.ts:44  PAYMENT_RESERVATION_MINUTES = 30   ← THE policy, one definition
        (written at creation; expiry sweep + Stripe checkout guard enforce it)
             ↓  backend/routes/cart.ts:1127,1205
        API: paymentExpiresAt  +  reservationMinutes: r.reservation_policy?.reservationMinutes ?? null
             ↓
        packages/shared:  paymentReservationState(order) → { expiresAt, remainingMs, expired }
                          paymentReservationTone(remainingMs) → green | yellow | red | expired   ← urgency
                          paymentReservationProgress(remainingMs, order.reservationMinutes*60_000)
             ↓
        MyOrders.tsx / ShopOrderDetail.tsx  → clock colour + progress bar + the translated note
```

**No timer or expiry calculation was added, and none was duplicated.** The storefront computes
**no** deadline: `paymentExpiresAt` is read from the API; `reservationMinutes` is the bar denominator
only, and a missing value yields **no bar** rather than a fabricated one. There is no 30-minute
literal anywhere in `apps/` or `packages/` — the policy lives only in the backend.

## 5. Changes

| File | Change |
|---|---|
| `packages/shared/src/lib/commerce.ts` | Removed `PAYMENT_RESERVATION_URGENT_MS`; `PaymentReservationPhase` is now `"none" \| "active" \| "expired"`; the branch returns `"active"`; both doc comments rewritten to name the tone as the single urgency authority and record why the 3-minute tier is gone. |
| `apps/velshop/src/pages/MyOrders.tsx` | 2 expressions: `phase === "active" \|\| phase === "urgent"` → `phase === "active"` (lines 164, 507). |
| `apps/velshop/src/pages/ShopOrderDetail.tsx` | 1 expression (line 509). |
| `backend/tests/payment-reservation-expiry.test.ts` | The test `"only the last three minutes are urgent"` (which pinned the dead tier) was **replaced** by `"the phase carries NO urgency scale"`, which asserts the countdown stays `active` across six sample points, that `02:13` still formats identically, and that the urgency it used to encode is carried by the tone. The source-pinning assertion was updated. Import list updated. |
| `backend/tests/order-ux-polish.test.ts` | 2 sites: the `"urgent"` expectation now asserts `"active"` **plus** `paymentReservationTone(10_000) === "red"` (the urgency it used to imply); the `reservationOpen` source assertion updated. |
| `backend/tests/reservation-urgency-contracts.test.ts` | **NEW** — 34 tests, §6. |
| `.ai/AI_HANDOFF.md` | M8 row + new §50. |

**Nothing else was touched.** No `orders.status`, no `payments.status`, no Stripe, no inventory, no
`order-fulfillment.ts`, no `payment-reservation.ts`, no DB file, no migration, no i18n key (still 1416).

## 6. Tests

`backend/tests/reservation-urgency-contracts.test.ts` — 34 tests, all DB-free, mapping to the eight
required proofs. **No tautologies**: every urgency claim is checked against what the two pages
actually do, and the semantics claims are behavioural (parse this value, get this result).

| # | Required proof | How it is pinned |
|---|---|---|
| 1 | canonical contract is really used | both pages select the note **and** the colour maps from `PaymentReservationTone`; all four tiers reachable and each has a style entry on both pages |
| 2 | the removed contract has no consumer left | `PAYMENT_RESERVATION_URGENT_MS` absent from all shipped source (comments stripped); `"urgent"` absent from the union and never returned; the function never returns it at 6 sample points; both pages gate on the single `=== "active"` |
| 3 | `paymentExpiresAt` semantics unchanged | epoch ms **and** ISO string parse identically; junk → no window; never negative; a decided order keeps its deadline but is not a countdown; no page recomputes or fabricates a deadline; both read routes still map it |
| 4 | `reservationMinutes` semantics unchanged | exact `remaining/total` ratios, clamped; `null`/`undefined`/`0`/negative/NaN/Infinity → `null` (no bar); both pages read `order.reservationMinutes` and never a literal 30; both read routes expose it from `reservation_policy` |
| 5 | 30-minute policy unchanged | `PAYMENT_RESERVATION_MINUTES === 30`; the derived `_MS`/`_SECONDS` still derive from it; **no frontend re-declares the policy**; a fresh window still starts at 30:00 |
| 6 | payment state unchanged | `orderStripePayability` open → payable, lapsed → `expired` and not payable; a `paid` payment still hides the button; non-payable statuses still not payable; `PAYABLE_ORDER_STATUSES` unchanged and still free of payments-only values |
| 7 | order state unchanged | `CUSTOMER_CANCELABLE_ORDER_STATUSES` exactly `pending｜pending_payment｜confirmed`; the `StoreOrderStatus` union still has all 12 values and still has no `failed` (LOW #12 intact) and no payments-only value; the backend state machine untouched |
| 8 | no new duplicate source of truth | each threshold declared exactly once; **every** `*_MS` constant in `commerce.ts` is read by `paymentReservationTone`; no page references a threshold constant or computes one; backend owns the policy, shared owns the presentation, neither names the other's job |

**Mutation-checked** — the tests are not vacuous. Re-inserting the `"urgent"` union member and the
3-minute branch fails 2 of them; reverting returns 34/34. Two earlier failures in this very task were
my own test bugs (an over-strict regex that matched the word "YELLOW" in a *comment*, and a fixed-clock
deadline passed to a function that reads the wall clock) — both fixed properly, not by loosening.

## 7. Verification (real output, 2026-09-30)

> **The `pnpm …` commands named in the task brief are NOT AVAILABLE in this repository.** It is a
> `bun` workspace: `bun.lock` is the only lockfile (no `pnpm-lock.yaml`, `package-lock.json` or
> `yarn.lock`), there is no `packageManager` field, and `.ai/context/testing.md` says *"Commands
> (from package.json — do not invent)"*. The repository's **real** commands were run instead; none
> was created to make anything pass.

| Command | Result |
|---|---|
| `NODE_ENV=test bun run test` (root `test` script = `bun test backend/tests`) | **956 pass / 189 skip / 0 fail** — 1145 tests / 52 files, 6383 assertions |
| baseline at `d21de22` | 922 pass / 189 skip / 0 fail — 1111 tests / 51 files |
| delta | **+34 pass, +0 skip, +1 file** — exactly the new file |
| `cd backend && bunx tsc --noEmit` | exit 0 |
| `bun run typecheck` | 4/4 apps exit 0 |
| `bun run build:apps` | 4/4 apps exit 0 |
| `bun run i18n:check` | `th=1416 en=1416 my=1416` — parity OK, **unchanged** |
| `git diff --check` | clean |
| `pnpm test` / `pnpm exec tsc -b` | **NOT AVAILABLE** — wrong package manager for this repo |
| `bun run lint` | **NOT A REAL CHECK** — `package.json:29` is `echo 'Lint not yet configured'`. Reported as absent, not claimed as run. |

**Targeted test:** `bun test tests/reservation-urgency-contracts.test.ts` → **34 pass / 0 fail**;
`bun test tests/payment-reservation-expiry.test.ts tests/order-ux-polish.test.ts` → **60 pass / 0 fail**.

**No DB-gated test was added** — this change is pure presentation logic with no SQL. The 189 skips
are the pre-existing DB/R2-gated suites, unchanged from baseline.

## 8. Production

**BLOCKED / not verified, and nothing new is blocked by this change.**

- **Migrations 048, 049, 050 remain NOT APPLIED in production** (Neon quota — **OWNER ACTION**).
  This matters *especially* for the reservation: with `orders.payment_expires_at` missing, both
  surfaces render `phase: none` and show no countdown at all (§40's silent-by-design behaviour). This
  task changed nothing about that, and **cannot** make it worse.
- This commit touches **no migration file**, so `Migrate Neon Database` will not re-trigger.
- The browser pass over both order surfaces in th/en/my is **still open** (no signed-in session), so
  the *visual* claim — "rendering is byte-identical" — rests on source proof (`active` and `urgent`
  fed the same JSX branch) and the 60 passing source-pinning tests, **not** on a browser run.
  **Not claimed as visually verified.**

## 9. Invariants — explicitly not changed

- ✅ **Order state machine** — `backend/lib/order-fulfillment.ts` untouched; the phase is presentation only.
- ✅ **Order status values** — `StoreOrderStatus` still 12 values, still no `failed` (LOW #12 intact).
- ✅ **Payment state** — `PAYABLE_ORDER_STATUSES`, `isOrderPayable`, `orderStripePayability` untouched.
- ✅ **Stripe** — no webhook, rail or session change.
- ✅ **Payment reservation duration** — 30 minutes, one definition, in the backend; **unchanged**.
- ✅ **`paymentExpiresAt` / `reservationMinutes` semantics** — unchanged, each pinned behaviourally.
- ✅ **Inventory** — no reservation, release or commit logic touched.
- ✅ **Cancellation / refund / retry** — untouched. HIGH #4 (attempt identity) and HIGH #5 (operator
  flow) untouched. MEDIUM #9 and LOW #12 untouched.
- ✅ **DB schema / migrations** — none. `db/run-update.sql` never touched.
- ✅ **No new status, no second source of truth, no mock data, no fake API.**

## 10. Remaining risks

1. **Migration 048 is still unapplied**, so in production there is still no `paymentExpiresAt` and
   **no countdown renders at all**. The urgency tiers this task cleaned up are only reachable once
   048 lands. *Owner action — the Neon quota.*
2. **No browser pass** over `/orders` or `/orders/:id` in th/en/my. The behavioural argument is
   airtight (one JSX branch, `active || urgent` → `active`) but it has not been *seen*.
3. **MEDIUM #10 / #11 / LOW #13 / #14** remain open and untouched.
4. Low: the shared module now exports a 3-value union; any code outside this monorepo (none exists)
   comparing against `"urgent"` would fail to compile — which is the intended, loud failure mode.
