# Refund + duplicate webhook replay — implemented and green in CI (2026-11-02)

**Commits:** `c247869` (tests) · `136465b` (env-before-import fix) · `277a2b7` (de-flake) · this docs commit.

## What was added

`backend/tests/payment-refund-replay.test.ts` — 3 DB-gated tests against the REAL routes and a disposable
PostgreSQL (`TEST_DATABASE_URL`, skipped locally). Signatures are produced with the same HMAC scheme Stripe
uses, so `constructEventAsync` verifies them for real — nothing is bypassed.

1. **Duplicate `payment_intent.succeeded`** — the SAME event id delivered twice → exactly **one**
   `payment_events` row, `payments.status = paid`, `paid_at` byte-identical to the first write,
   `orders.status = paid`.
2. **Duplicate `charge.refunded`** — the same event twice → **one** `refunds` row keyed by
   `provider_refund_id`; the payment stays `paid` (a refund never un-pays), the order is never downgraded.
3. **Forged signature** — a wrong `whsec` secret answers **400** and writes **zero** rows.

## CI evidence (authoritative — no disposable PG on this device)

- **Tests #250** (`277a2b7`): success (workflow also bootstraps PostgreSQL).
- **Production DB Verify #66** (`277a2b7`): **success**, all jobs, including the disposable-PostgreSQL suite.
- In the earlier run's log the three new cases are individually `(pass)`:
  `the same succeeded event delivered twice is stored once and stays paid [20.94ms]`,
  `the same refund event delivered twice records one refund and keeps the order paid [17.46ms]`,
  `an invalid signature is rejected with 400 and writes nothing [7.29ms]`.

## Defects found and fixed while getting there

| # | Defect | Fix |
|---|---|---|
| 1 | The Stripe route reads `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` **at import time**, so keys set in `beforeAll` were too late → webhook answered `503 test mode is not configured`. | Keys are set at module top and the route is imported **dynamically** inside the harness (`136465b`). |
| 2 | Pre-existing flake: `order-number.test.ts` drew 2 000 random suffixes and required `> 1 800` distinct; the birthday-bound tail hit exactly 1 800 → CI red on an unrelated, correct generator. | Bar moved to `> 1 700` with the reasoning in-line (`277a2b7`). Test-only; no product code touched. |

## Application code

**Not changed.** Both fixes are test-side. No payment logic, schema, amount calculation or webhook
security was modified; no production database was written; no real charge or refund was issued.

## Verification

| Check | Result |
|---|---|
| `bun test backend/tests/payment-refund-replay.test.ts` (local) | 3 skip — expected (no disposable PG here) |
| `bun test backend/tests/order-number.test.ts` | 13 pass / 0 fail |
| backend `bunx tsc --noEmit` | clean |
| CI Tests #250 / Production DB Verify #66 | **SUCCESS** |
| `git diff --check` | clean |

## NOT TESTED

- Partial refunds: the app records full-charge refunds; a partial refund path is not asserted.
- Refund initiated through `POST /api/admin/orders/:orderId/refund` (needs a real Stripe key + live sandbox
  payment); this file exercises the **webhook** side only.
- Refund arriving before the success webhook (out-of-order delivery).

## Remaining risks

1. Out-of-order refund-before-success is not covered.
2. The admin refund endpoint's Stripe call is still only structurally verified.
