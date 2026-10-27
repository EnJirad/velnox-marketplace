# AI_HANDOFF archive — Payment integrity narrative (2026-10-04)

Moved **verbatim** from `.ai/AI_HANDOFF.md` on 2026-10-27 (edit-headroom housekeeping while
appending §83 / Phase 2D — the handoff must stay well under its ~55 KB edit ceiling). Nothing was
discarded or rewritten; index row: [`../AI_Handoff_Archive.md`](../AI_Handoff_Archive.md).

---

## Payment integrity — a captured Stripe charge could never settle in production (2026-10-04)

**Reported symptom.** Checkout → first attempt seen as failed → customer retried → the NEW Stripe
attempt was genuinely charged → Velnox still showed "รอดำเนินการชำระ" and offered payment again.
Retrying made it worse: every retry captured another real charge that also could not settle.

**Root cause: failure class H (production schema ≠ backend code), surfacing as class D
(`handleStripeEvent()` throws).** `checkoutGroupIdForAttempt()` (`backend/routes/stripe.ts`) decided
which parent a charge belongs to by reading `payments.checkout_group_id` — added by migration
**054**, which production never received. Naming an absent column raises `undefined_column` (42703),
which is a THROWN ERROR, and it was thrown on the one query **every** order's settlement runs,
before the order or payment row is touched:

```
payment_intent.succeeded → checkoutGroupIdForAttempt() throws 42703 → handleStripeEvent() throws
  → payment_events.status = 'failed' → HTTP 500 → Stripe redelivers → the identical error
  → payments.status and orders.status NEVER move → the storefront keeps offering payment
```

**Why partial application, not total absence.** `POST /api/customer/checkout` writes
`checkout_groups` + `orders.checkout_group_id` unconditionally, so checkout demonstrably worked in
production ⇒ 054's sections 1–2 landed ⇒ only section 3 (`payments.checkout_group_id`) did not.
That is exactly the state `db/verify-reconciler.sh` scenario H reproduces, and it is the
direct consequence of §66 (migrations reaching a different Neon than Render's `DATABASE_URL`).

**Ruled out with live evidence, not reasoning.** `GET /api/stripe/configured?selfTest=1` on
`velnox-api.onrender.com` → `configured: true, mode: "test", webhookConfigured: true`,
`webhookSecretHealth.shapeUsable: true`, `webhookSignatureSelfTest.verified: true` ⇒ **A** (not
sent) and **B** (signature) are out; an unsigned `POST /api/payments/stripe/webhook` → 400 ⇒ the
endpoint is live and refusing. **G** is out too: `ShopCheckoutSuccess.tsx` polls
`GET /api/orders/:orderId` until the payment settles, so the UI reported the truth.

**The fix (code).** The column is read as a JSON KEY — `to_jsonb(p) ->> 'checkout_group_id'` —
so ONE statement is correct against both schemas and cannot raise 42703; the companion `?`
operator distinguishes "no group" from "no column" so the process can say so ONCE, naming
`db/run-sqleditor.sql`. This is the same pattern `selectOrderPaymentRow()` already uses for
`orders.payment_expires_at` in `lib/payment-reservation.ts`. It is **not** a bypass: the
signature check, the `payment_events` claim, the 500-on-failure redelivery policy and the
`status IN ('pending','pending_payment')` settlement guards are unchanged, and NULL is the safe
answer — the column is what links a payment to a purchase, so on a database without it there is
no group payment to route.

**Tests.** `backend/tests/payment-webhook-schema-lag.test.ts` (new, 12 cases): the production
routing SQL executed against a `payments`-shaped table **without** the column returns NULL and
detects the absence where the pre-fix statement raises 42703 (the regression, demonstrated); a real
group payment is still routed; attempt A failed then attempt B succeeds settles B and the order;
a duplicate delivery settles nothing twice; an UNPAID `checkout.session.completed` never marks paid;
an event identifying no attempt writes nothing; a processing failure answers **500** and records the
event `failed`; and Stripe's retry of that same event id re-processes it. Suite: **1974 pass /
2 skip / 0 fail** (67 files). `checkout-group-sql-scope.test.ts` was updated to pin the new
statement (in scope for `payments`, no bare column reference left).

**STILL BLOCKED — owner action, unchanged.** Production `payments` has no `checkout_group_id`, so a
MULTI-SHOP checkout still cannot be paid for until `db/run-sqleditor.sql` is run against the
database Render's `DATABASE_URL` actually points at. Confirm with `Production DB Verify`
(`backend/routes/stripe.ts` is in its trigger paths), which needs the
`NEON_PRODUCTION_DATABASE_URL` secret. Live `payment_events` / `payments` / `orders` reads are
likewise BLOCKED in this workspace (no production DB access). **Real Stripe TEST E2E is BLOCKED,
not PASS**: Stripe TEST mode is configured and verifiable in production, but payment is a Stripe
**hosted** Checkout Session, so only a human in a browser can complete it and only then can Stripe
deliver the webhook; this workspace has no browser and no test account.
