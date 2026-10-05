# AI Handoff — §68 (archived verbatim 2026-10-05)

Moved out of `.ai/AI_HANDOFF.md` for edit-headroom housekeeping. The fix it describes is SHIPPED and LIVE;
the section is a historical record, not current state. Current state: §69.

---

## §68. "Failed to create checkout session" on a multi-shop PromptPay order (2026-10-05)

**Symptom.** Order `46d6e39b-e6f0-457b-86eb-58a09ae296b1` / `017911592602649656` (PromptPay) was
created, then the storefront showed `สร้างคำสั่งซื้อแล้ว แต่ยังไม่ได้เริ่มการชำระเงิน` +
`Failed to create checkout session`, and offered `ลองชำระเงินอีกครั้ง`.

**Root cause — Case C, not Case A.** The cart spans shops, so the storefront always sends
`checkoutGroupId` and the request dispatches to `openCheckoutGroupSession()`. That handler names
`payments.checkout_group_id` (migration **054 §3**) as a bare column in two statements. On the
production database — which never received 054 §3, the same defect §66/§67 recorded for the
SETTLEMENT read — both raise **42703**. The order and `checkout_groups` row are written earlier by
`POST /api/customer/checkout`, which does NOT need the column, which is exactly why "order created"
and "payment cannot start" coexist. Order of events:

```
POST /api/customer/checkout  → order + checkout_groups      (needs no 054 §3)
stripe.checkout.sessions.create(...)  → session EXISTS      ← Stripe DID create it
INSERT INTO payments (checkout_group_id, …) → 42703         ← the write that cannot happen
outer catch → 500 "Failed to create checkout session"        ← the reported text
```

So the reported message was never "Stripe refused": **Stripe created an OPEN session that no
payment row pointed at**, and every retry spent another one.

**Why §67's fix did not cover it.** `to_jsonb(p) ->> 'checkout_group_id'` makes a READ
schema-tolerant. A WRITE cannot be phrased that way: `INSERT INTO t (c, …)` NAMES the column, so
its absence is an error regardless. The group OPEN path must know whether the column exists BEFORE
it asks Stripe for money.

**Fix (code, `backend/routes/stripe.ts`).**
1. `paymentsCheckoutGroupColumnExists()` — a `pg_attribute` catalogue probe (true on an EMPTY
   `payments`, which is the production shape), cached per process, warned once naming the
   reconciler. Consulted **before** `sessions.create`; the customer gets **503
   `CHECKOUT_GROUP_UNAVAILABLE`** instead of an orphan session. No Stripe call is made.
2. `logCheckoutSessionFailure()` — one `console.error` JSON line per failure carrying
   `failure_stage`, `provider`, `occurred_at`, `order_id`, `checkout_group_id`, `method`,
   `currency`, `amount_minor`, `stripe_session_id`, `payment_attempt_id`, `provider_error_type`,
   `provider_error_code`, `provider_http_status`, `provider_request_id`, `provider_error_param`,
   `provider_error_message`. The attempt id is resolved best-effort (the failure is often the very
   INSERT that would have created it, so the field is explicitly `null` rather than absent).
   No secret key, no `whsec_`/`sk_`/`pk_`, no card data, no customer email/phone, `metadata` never
   echoed wholesale. The **client response is unchanged** — `fail()` still returns only the generic
   message. Numeric `statusCode`/`pg` codes are coerced, so the HTTP status is not silently dropped.
3. The group `sessions.create` and the group `INSERT` are stage-instrumented
   (`group_session_create`, `group_payment_insert`). A failed INSERT that is not a unique violation
   now logs the **session id** and **expires the session** instead of abandoning a payable URL.
4. The **request key is now claimed on the group path too**. It was only claimed on the single-order
   path, *below* the group dispatch — so the multi-shop flow had no durable request-key idempotency.
   Claimed after the group is verified as owned (a bogus id cannot burn a key) and before any Stripe
   call. `rememberResponse` now attributes a group snapshot to the group's representative order; it
   previously passed the empty `orderId`, so the UPDATE threw and the snapshot was dropped, leaving
   the key permanently "claimed but unfinished".

**Tests (new, `backend/tests/checkout-group-session-open.test.ts`, 13 cases).** Six structural
(the probe precedes `sessions.create`; the probe reads the catalogue; a write failure is logged
WITH the session id and the session is expired; the log carries the diagnostic fields; the client
still sees only the generic text; no transaction is held across the Stripe call) and the six
required regressions driven against the REAL route with an in-process Stripe stub (prototype
spies restored in `afterAll` — a `mock.module` on the SDK leaked into the VelRepeat Phase 4 suite
in CI and had to be replaced): 1/6 first
PromptPay multi-shop session succeeds and the request Stripe received is `mode:"payment"`,
`payment_method_types:["promptpay"]`, `thb`, summing to the **database** total (a hostile client
`amount` cannot move it); 2 Stripe refuses → order stays payable, no attempt, the failure is logged
with `provider_request_id`, and a retry succeeds; 3 the session is created and the INSERT raises the
**real 42703** → the session is expired, named in the log, and the retry leaves exactly one live
session; 4 double-click → one `sessions.create`, one payment row, the request key claimed and the
response replayable; 5 attempt A retired (`SESSION_NOT_REUSABLE`) then B succeeds → B authoritative
and a LATE failure for A cannot un-pay the order; plus the pre-054 refusal, which reaches Stripe
zero times. Two of these were checked by disabling the fix and confirming the test fails.
The suite also caught a real defect in the fix itself: numeric `statusCode` was being dropped.

**Suite after this change: 1988 pass / 2 skip / 0 fail (68 files)**, typecheck 4/4 + backend 0,
build 4/4, `db:verify` ALL SCENARIOS PASSED, `git diff --check` clean.

**STILL BLOCKED — unchanged owner action.** Production `payments` still has no `checkout_group_id`,
so a MULTI-SHOP checkout answers 503 with a log line naming the fix instead of failing at Stripe
after the session is opened. Run `db/run-sqleditor.sql` against the database Render's
`DATABASE_URL` points at (secret `NEON_PRODUCTION_DATABASE_URL`; `Production DB Verify` reads it).
**Real Stripe TEST E2E remains BLOCKED, never PASS** — payment is a Stripe **hosted** Checkout
Session; this workspace has no browser, no test account and no Stripe credentials. Live reads of the
reported order are equally unavailable, so its state above is derived from code plus the reproduced
42703, not asserted as observed.

---

