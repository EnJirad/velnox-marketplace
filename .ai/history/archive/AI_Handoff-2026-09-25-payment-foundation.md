# Archived: handoff §15 (payment foundation) + §16 (Stripe E2E, BLOCKED)

Moved out of `.ai/AI_HANDOFF.md` on 2026-09-26 (TASK 007) — the handoff had reached
~55 KB, this environment's file-edit limit, and §18 supersedes the verification
status in these two sections. **The live payment reference is now
[`.ai/context/payment.md`](../../context/payment.md)**; the live verification status
is `.ai/AI_HANDOFF.md` §18. Read those, not this. Kept for provenance.

The text below is unchanged from §15/§16 as they stood before the move (one inline
correction is marked in §16; the live copy of that correction is §18).

---

## 15. Payment foundation — Stripe test mode, Card + PromptPay, COD OFF (TASK 005, 2026-09-25)

Built ON the Stripe code that already existed (`backend/routes/stripe.ts`, V0023)
— no second payment system, no duplicate table. **Stripe: TEST MODE ONLY.**

**Audit-first findings (the pre-existing state, re-verified from source).**
`POST /api/stripe/checkout` set **no `payment_method_types`** (dashboard default,
no PromptPay) and had **no idempotency boundary** — a double-click opened two
Checkout Sessions, i.e. two PaymentIntents. The webhook used **sync
`constructEvent`**, and outside Node the Stripe SDK picks a WebCrypto verifier
whose sync API **throws for every event, valid or not** — so signature
verification could never succeed and every webhook was silently dropped. Any
secret key was accepted, live included. `payment_events` was written **before**
processing and never updated, so an event whose handler threw was left marked
seen and Stripe's retry was skipped. **COD was the DEFAULT** on
`POST /api/customer/checkout` (`body.paymentMethod ?? "cod"`) and was offered as
a normal VelShop radio option. `refunds` existed as a table with no code.

**Implemented.** `backend/lib/payment-config.ts` is the ONE decision point:
test-mode-only key classification (`sk_/rk_test_`; live **and** unrecognized
refused), "payment unavailable" instead of any fallback, fail-closed COD flags,
method normalization, and `assertPaymentMethodUsable` — the guard every payment
route runs. Routes: `GET /api/payments/methods` (backend-driven discovery; the
storefront renders THIS list), `POST /api/stripe/checkout` (Card + PromptPay;
charged amount reconciled to `orders.total_amount` **exactly** — a remainder
becomes its own line item, never a client-supplied total),
`POST /api/payments/stripe/webhook`, `GET /api/stripe/payment-status/:id` (now
ownership-checked — it leaked any session's status before),
`POST /api/admin/orders/:orderId/refund` (`orders.manage`),
`GET /api/orders/:orderId` (payment + refunds). The webhook now uses
`constructEventAsync`.

**Idempotency — DATABASE-BACKED (no in-memory Map).** Two layers.
`checkout_requests` gained `scope`, so checkout and payment keys share ONE
idempotency store via `UNIQUE (user_id, scope, request_key)`; and the partial
unique index `idx_payments_one_active_stripe` allows at most one live Stripe
attempt per order, so the loser of a concurrent insert is answered with the
winner's session. Webhook events are claimed with `INSERT … ON CONFLICT DO
NOTHING`; a duplicate is acknowledged without re-running, a `failed` event is
**re-armed** so Stripe's retry really re-processes, and a throwing handler
returns **500** so Stripe redelivers instead of the sync being lost.

**Order↔Payment sync — separate lifecycles.** Payment carries its own state
(`pending` / `requires_action` / `paid` / `failed` / `cancelled`) plus
`refunded_amount` + `refund_status`. Only paired transitions are written:
`paid`→`paid`, `failed`→`payment_failed`, expired/canceled→`cancelled`, full
refund→`refunded`; each releases reserved stock exactly once. **PromptPay is a
delayed-notification method**, so `checkout.session.completed` with
`payment_status != "paid"` does **not** mark an order paid — only
`async_payment_succeeded` / `payment_intent.succeeded` / a `paid` session do.

**Refunds — webhook-confirmed.** Submit records a `pending` row and calls Stripe
with a deterministic idempotency key; final state comes from the provider
response and the webhook (`charge.refunded`, `refund.updated|failed`) running the
same idempotent sync, which **recomputes** `refunded_amount` from succeeded rows
rather than incrementing. Over-refund is rejected before Stripe is called.
Authorization is the EXISTING `orders.manage` permission.

**Follow-up hardening (same commit lineage).** The charge is DERIVED, never
accepted: `buildCheckoutLineItems` builds the Stripe lines from `orders.total_amount`
so a tampered `amount`/`price`/`quantity` cannot move money (shipping remainder →
its own line; discount → one line for the authoritative total). An **open session
for a different method is expired**, never handed back, and a race winner is only
reused when `metadata.method` matches — otherwise our own session is expired and
the caller gets **409 `DUPLICATE_PAYMENT_IN_PROGRESS`**, not a fabricated success.
A refund request matching an existing `pending`/`succeeded` refund **replays** it
(`duplicate: true`) instead of issuing a second one. `sessionConfirmsPayment`
(only `payment_status === "paid"`) and `refundableMinorFor` (never negative) are
exported pure helpers.

**Schema.** `db/migrations/047_payment_foundation.sql` + both canonical files
(`db/schema.sql` ↔ `db/run-sqleditor.sql` verified byte-identical; the canonical
files alter no table they do not create). `db/run-update.sql` was **not**
created.

**COD: IMPLEMENTED = YES, ENABLED = NO, CUSTOMER_SELECTABLE = NO.**
`COD_ENABLED` / `COD_CUSTOMER_SELECTABLE` default off and fail closed (only
literal `true`/`1` counts; `"yes"`, `"'true'"`, empty, misspelled all stay off).
`method=COD` → **403 `PAYMENT_METHOD_DISABLED`** *before* any
order/payment/shipment/settlement write and **independently of Stripe's state**.
VelShop renders only backend-enabled methods and shows COD as a non-selectable
"Coming soon" row. No carrier, no settlement, no fake collection.

**Verified HERE (actually executed).** Backend `bunx tsc --noEmit` clean;
`bun run typecheck` 4/4 apps exit 0; full suite **511 pass / 43 skip / 0 fail**
(new `backend/tests/payment-foundation.test.ts`: 59 pass / 1 DB-gated skip —
config, live-key refusal, COD fail-closed, webhook signature reject **and
accept**, COD bypass 403 on both endpoints, line-item total reconciliation,
refundable arithmetic, PromptPay unpaid-session trap, secret-leak checks); `i18n:check`
**1295 / 1295 / 1295**; `git diff --check` clean; schema-drift +
migration-numbering tests pass.

**NOT verified — limitations (do not read these as PASS).** No Stripe credential
exists in this workspace, so **no live test-mode PaymentIntent, no PromptPay QR,
no webhook delivery and no Stripe refund was ever executed** → those paths are
**CODE VERIFIED / BLOCKED**. The DB-gated webhook-idempotency test and every
DB-gated payment integration test **skip** here (no `TEST_DATABASE_URL`) and run
only in CI (`postgres:16`). VelShop checkout was typechecked but **never opened
in a browser** → `UI NOT VERIFIED`. Money is held in 2-decimal minor units.

**Safety — explicit.** Stripe remains **Test Mode**; no live credential, no live
endpoint, no real card, no real money, **no production payment was enabled** and
**no real customer funds were processed**; no production payment fixture; no
secret read, printed, logged or committed — only the **test publishable** key can
reach a browser. COD remains disabled.

**Next recommended task.** Add test-mode `STRIPE_SECRET_KEY` (test),
`STRIPE_WEBHOOK_SECRET` (test) and `STRIPE_PUBLISHABLE_KEY` (test) in
Settings → Environment, then run the live test-mode round trip (Card + PromptPay
+ `stripe listen` webhook + a refund) and point `TEST_DATABASE_URL` at a
disposable PostgreSQL so the DB-gated payment tests actually execute.

---

## 16. Stripe TEST-mode E2E verification (TASK 006, 2026-09-25) — **BLOCKED**

**Environment — no credential, no database.** `freebuff-env list` → `{"files":{}}`.
Every key unset: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_MODE`, `COD_ENABLED`, `COD_CUSTOMER_SELECTABLE`,
`DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_SECRET`. No `postgres`/`initdb`/`psql`
binary and no docker/podman, so no disposable DB can be provisioned either. **No
Stripe API call, PaymentIntent, PromptPay QR, webhook delivery or refund has ever
been executed — not by this pass, not by any prior pass.**

> **Correction (live in §18).** The sentence above about the missing
> `postgres`/`initdb`/`psql` binary was **wrong for the sandbox**: PostgreSQL 14 IS
> installed (`pg_ctlcluster 14 main start`). TASK 007 ran every DB-gated payment
> test against a disposable local database — 560 pass / 2 skip / 0 fail. Only the
> Stripe-credential half of this section still holds.

**Executed here** (real HTTP against the real route stack, in an in-process
listening server; probe deleted, tree left clean):

| Probe | Observed |
|---|---|
| `GET /api/stripe/configured` | `configured:false, mode:null, publishableKey:null, reason:STRIPE_NOT_CONFIGURED` — no secret leak |
| `GET /api/payments/methods` | CARD/PROMPTPAY/COD all `enabled:false`; `cod.customerSelectable:false` |
| `POST /api/customer/checkout` `COD` / `cod` / `cash_on_delivery` | **403 `PAYMENT_METHOD_DISABLED`** — no DB connection attempted |
| `POST /api/stripe/checkout` `method=COD` | **403 `PAYMENT_METHOD_DISABLED`** |
| `POST /api/stripe/checkout` `method=CARD`, unconfigured | **503 `STRIPE_NOT_CONFIGURED`** — no fabricated success |
| webhook, unconfigured | **503** — refuses rather than acking an unverifiable event |
| webhook, forged signature | **400 `Invalid signature`** |
| webhook, correctly signed | passes verification, then fails at the DB → **500** (correctly re-deliverable) |

The configure-shape row (`CARD`/`PROMPTPAY` enabled, `COD` disabled) was also
observed with placeholder keys, but **placeholders are not credentials**, so it is a
shape check only — never reported as configuration verification.

**Status / evidence tier.** CODE = source read · AUTO = test really executed here ·
BLOCKED = could not execute.

| Area | Tier |
|---|---|
| Stripe TEST configuration | AUTO (key ordering/refusal) · **BLOCKED** (no credential) |
| Card / PromptPay TEST E2E | **BLOCKED** |
| Webhook signature | AUTO (local HMAC, forged rejected **and** valid accepted) |
| Real webhook delivery / retry / idempotency | **BLOCKED** (DB-gated) |
| Checkout idempotency, method switching | **BLOCKED** |
| Price tampering | AUTO (6 cases — charge is the order total) |
| Stock safety, order↔payment sync, inventory sync | **BLOCKED** (DB-gated) |
| Full / partial / over-refund | AUTO (arithmetic + route rejection) |
| Duplicate refund | AUTO (replay path) · **BLOCKED** (provider) |
| COD disabled | **PASS** (executed) |
| COD direct API bypass 403 | **PASS** (executed) |
| No COD order/payment/shipment/settlement | CODE — the guard precedes the transaction and no DB touch occurred |
| Secret audit | **PASS** |
| Automated tests | **PASS** |
| Browser E2E | **BLOCKED** — no framework in any package.json, no test account |
| Production E2E | **BLOCKED** |

**Secret audit (clean).** No live key anywhere: `sk_live_` / `pk_live_` / `rk_live_`
appear only as zero-filled placeholders in `backend/tests/payment-foundation.test.ts`
(used to prove live keys are *refused*). `git log -S` over all 222 commits: only
`b806be1` ever touched those strings. No hardcoded `Authorization`/`Bearer` token. No
`console.*` or response body in the payment code references a credential identifier.
`.env`/`.env.*` are gitignored and untracked; only `.env.example` is tracked and it
holds placeholders only.

**Full verification run.** backend `tsc --noEmit` exit 0 · `bun run typecheck` 4/4
exit 0 · `bun test backend/tests` **511 pass / 43 skip / 0 fail** ·
`payment-foundation.test.ts` **59 pass / 1 skip / 0 fail** · `i18n:check`
**1295/1295/1295** · `git diff --check` clean · `schema.sql` ≡ `run-sqleditor.sql` ·
no `run-update.sql`.

**No defect found → no code change.** Verification-only, as the brief requires.

**Unblock.** Add test-mode `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` /
`STRIPE_WEBHOOK_SECRET` (+ `STRIPE_MODE=test`) in Settings → Environment, and point
`TEST_DATABASE_URL` at a disposable PostgreSQL (`psql "$TEST_DATABASE_URL" -f
db/run-sqleditor.sql`). CI (`.github/workflows/test.yml`) already runs every
DB-gated suite against a throwaway `postgres:16` and references no repo secret.

**Doc gap (recorded, deliberately not fixed).** `STRIPE_*` / `COD_*` are documented
nowhere outside the code — absent from `.env.example`, `docs/ENVIRONMENT.md`,
`INSTALLATION.md` and `README.md`. Out of scope for a verification-only pass.
