# Production marketplace E2E audit (2026-11-02)

**SHA audited:** `5965598c64e297f7cbb60b3aeeeb6205e2860460` (`HEAD == origin/main`, working tree clean).
**Method:** read-only. Production domains probed over HTTP, Vercel API read, Neon read-only SQL, source
inspection, CI/local suites. No application code was changed.

## 1. Deployment & availability

| App | Domain | HTTP | Deployment (Vercel API, `0524f46`) |
|---|---|---|---|
| VelShop | `velshop.vercel.app` | **200** | `dpl_4Bxe5u2u…` READY |
| VelSeller | `velseller.vercel.app` | **200** | `dpl_6nyrhFC4…` READY |
| VelCenter | `velcenter.vercel.app` | **200** | `dpl_GjhMtn8Z…` READY |
| Velnox Corporate | `velnox-theta.vercel.app` | **200** | `dpl_FRmmuSa8…` READY |
| Velnox Corporate (marketing domain) | `velnox.com` | **000** | DNS does not resolve |
| Backend API | `velnox-api.onrender.com/api/health` | **200** | Render live |

The three "failed" builds reported earlier were `CANCELED` (superseded mid-build by the next commit), not
`ERROR`; the API returns **0** ERROR deployments for every project (see §109).

## 2. Payment & Stripe — verified invariants

| Invariant | Evidence | Status |
|---|---|---|
| Paid only from a signature-verified webhook | `constructEvent` in the webhook path; `/api/stripe/configured?selfTest=1` → `webhookSignatureSelfTest.verified: true` | PASS |
| Duplicate webhook delivery is idempotent | `INSERT INTO payment_events … ON CONFLICT (event_id) DO NOTHING` + UNIQUE `payment_events_event_id_key`; live data `unprocessed_events = 0` | PASS |
| Replay does not re-stamp money | `paid_at = COALESCE(paid_at, NOW())`, attempt UPDATE guarded by `status <> 'failed'` | PASS |
| One active attempt per order / per group | UNIQUE `idx_payments_one_active_stripe` and `idx_payments_one_active_stripe_group` exist in production | PASS |
| Request-level idempotency | UNIQUE `checkout_requests_user_scope_key (user_id, scope, request_key)` | PASS |
| Abandoned attempt cannot block forever, paid cannot be retired | retire requires `expired` or `complete AND payment_status != 'paid'` (commit `bf…`/§105) | PASS |
| Client can never set paid | no frontend `status = "paid"` writes; success page renders API status only | PASS |
| Financial history preserved | retire is an UPDATE (`cancelled`), no `DELETE FROM payments/payment_events` | PASS |
| Live financial data coherent | `payments: paid 2 / cancelled 3`; `paid orders 1`; **0** paid orders without a paid payment, **0** paid rows without `paid_at`, **0** active rows older than 2 h | PASS |

Real PromptPay sandbox payment verified earlier end-to-end (order `88e51b37…`, PI `pi_3UWrqaKp…`, four
processed events, `orders.status = paid`) — see `2026-11-01-stripe-promptpay-e2e-success.md`.

## 3. Confirmed issues

None at Critical/High. One environmental issue:

| Severity | Issue | Evidence | Proposed fix |
|---|---|---|---|
| Medium | `velnox.com` does not resolve | `curl` → `000`; Vercel project's only domain is `velnox-theta.vercel.app` | DNS/domain task: point the apex at the project or update `VITE_CORPORATE_URL` to the live host |
| Low | `.ai/AI_HANDOFF.md` hovers at the ~55 KiB edit ceiling | 56,313 B before §109, archived §104 to fit | keep archiving one closed section per new one |

## 4. Tests executed

- `bun install --frozen-lockfile` → exit 0
- `bun run typecheck` → **4/4**
- `bun run build:apps` → **4/4** (see §109 run at the same tree)
- `bun test backend/tests` → 1526 tests, **8 fail** — all the documented Termux-only `test database guard`
  probes (environmental, present before this work)
- `git diff --check` → clean
- CI earlier on this tree: Production DB Verify (disposable PostgreSQL) **1489 pass / 0 fail**

## 5. NOT TESTED (and why)

- **Card success / failure in a real browser** — card entry cannot be automated (Stripe is React-controlled
  and its CSP blocks `browser_eval`); needs a human.
- **Refund lifecycle** (`charge.refunded`) — requires a fresh sandbox payment plus owner approval; never
  refund a real user's payment.
- **Duplicate webhook delivery via Stripe resend / Stripe CLI** — the CLI is not installed and the event
  cannot be re-sent from the MCP surface; idempotency is proven by the UNIQUE constraint + `ON CONFLICT`.
- **Delayed webhook arrival simulation** — no harness to hold an event.
- **Role-based UI checks in a browser** (seller/admin flows) — no interactive session for those roles in
  this environment; authorization is covered by DB-gated tests in CI.
- **Database-gated suites locally** — no disposable PostgreSQL (PG18 `initdb` hangs in the sandbox).

## 6. Recommended next task

1. **Refund + duplicate-webhook replay harness** (CI, disposable PG): send the same signed event twice and a
   synthetic `charge.refunded`, assert `payments.refund_status`, one row, and no order downgrade. This is the
   largest untested financial surface and does not need a human.
2. Then the browser matrix for card success/failure with the owner entering the test card.
3. Then the `velnox.com` DNS decision.

## 7. Production readiness verdict

**PARTIAL — not yet "proven production-ready"**, but no critical defect was found. Payments, idempotency,
authorization constraints and deployment are healthy on every piece of evidence available; the missing
proof is interactive card/refund path and DNS for the corporate domain.
