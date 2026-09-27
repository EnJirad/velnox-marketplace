> **Archive — reference only.** Verbatim record of `.ai/AI_HANDOFF.md` §30, moved here
> on 2026-09-27 to keep the current-state handoff editable (the file-edit tools stop
> matching past roughly 55 KB). Current state lives in `.ai/AI_HANDOFF.md`.
> Index row: `.ai/history/AI_Handoff_Archive.md`.

---

## 30. VelShop checkout → Stripe in ONE press + resume payment (2026-09-27)

**Root cause.** `ShopCheckout.tsx` treated order creation as the end of checkout:
`handleSubmit()` → `checkoutAction()` → `setResult(res)` rendered the "คำสั่งซื้อสำเร็จ"
screen, and only ITS second button (`handlePayOnline()`) called
`createStripeCheckoutAction()` and redirected. CARD/PromptPay therefore cost two presses,
the customer could stop on a screen that claimed a completed purchase, and the resulting
order sat unpaid with no way back to Stripe. Two related dead ends: `ShopOrderDetail.tsx`
gated its pay button on a legacy `method === "online" && status === "pending"` payment row
(real sessions are stored as `CARD`/`PROMPTPAY` + `requires_action`), so it never appeared
for a Stripe order; `MyOrders.tsx` had no resume path at all.

**New flow (CARD + PROMPTPAY).** validate address / GPS / method →
`POST /api/customer/checkout` (existing `requestId` idempotency) →
`POST /api/stripe/checkout` with `orderId = parentOrderId`, the customer's own `method`,
the existing request key and `returnPath` → `window.location.assign(url)` in the CURRENT
tab. No success screen, no second press, no new tab/window. The CTA reads
"กำลังเตรียมการชำระเงิน…" while it runs (new `checkout.preparingPayment`), and the click
guard is a ref checked before the first `await` (one press = one order). COD keeps the
order-placed screen — that is now the only path that can reach it.

**Money safety.** The order is created `pending` and moves to `pending_payment` when the
session opens; the payment row is `requires_action`. VelShop reports a sale only from the
API's own state: `POST /api/payments/stripe/webhook` is still the ONLY writer of
`orders.status = 'paid'` (pinned by a test that scans `backend/routes|lib|realtime`), and a
missing/empty session URL throws instead of navigating to `undefined`.

**CARD.** `stripePaymentMethodType("CARD")` → `payment_method_types: ["card"]`.

**PromptPay.** `PROMPTPAY` → `payment_method_types: ["promptpay"]` through the existing
`stripePaymentMethodType()`; the choice is snapshotted at submit and never defaulted (no
client-side QR, no phone-number collection, no new rail, money stays THB-only). The
deliberate `checkout.session.completed` + `payment_status !== "paid"` guard stays, so a
scanned-but-unsettled PromptPay session is never announced as paid.

**Resume payment.** New `apps/velshop/src/components/shop/ResumePaymentButton.tsx` is the
ONE control used by My Orders, the order page, the success page and the cancel page. It
re-opens the rail recorded on the order's own payment row; when no rail was recorded it
asks (the backend's method list) instead of defaulting to card; it sends a fresh
per-attempt `requestKey` and redirects in the same tab. Payability comes from one shared
rule, `orderStripePayability()` in `packages/shared/src/lib/commerce.ts` — only the
statuses the backend accepts (`pending`/`pending_payment`, pinned against the literal list
in `stripe.ts`), never a `paid`/`payment_failed`/`cancelled`/`refunded` order and never a
COD order. `payment_failed` offering no retry is the backend rule: its reserved stock was
already released. `GET /api/customer/orders` now also returns the newest `paymentMethod`
(one additive subselect) so the list can resume the same rail.

**Success / cancel.** `/checkout/success` reads the order back from
`GET /api/orders/:id`, keeps polling while it is unsettled, says
"กำลังรอยืนยันการชำระเงินจาก Stripe", and offers the same rail again — it never labels a
payment from the browser redirect. `/checkout/cancel` now loads the order and offers the
resume too; nothing is deleted or faked client-side.

**Files.** `apps/velshop/src/pages/{ShopCheckout,MyOrders,ShopOrderDetail,ShopCheckoutSuccess,ShopCheckoutCancel}.tsx`,
`apps/velshop/src/components/shop/ResumePaymentButton.tsx` (new),
`packages/shared/src/lib/commerce.ts`,
`packages/shared/src/lib/i18n/locales/{th,en,my}.ts`,
`backend/routes/cart.ts` (one additive list field), `backend/tests/checkout-payment-flow.test.ts`
(new). No schema change, no new cart/payment system, and the cart's quantity / selection /
grouping / persistence behaviour is untouched (only the local cart refresh after an order).

**Verified in this workspace.** `backend/tests/checkout-payment-flow.test.ts` **37 pass /
4 skip / 0 fail** (the skips are its four DB-gated refusal cases) · backend
`bun tsc --noEmit` exit 0 · `bun run typecheck` 4/4 exit 0 · `bun run build:velshop`
exit 0 · `i18n:check` th = en = my = **1331** · `git diff --check` clean · full
`bun test backend/tests` **672 pass / 84 skip / 1 fail**, where the single failure is
`test-database-isolation`'s child probe: it re-reads the workspace `.env` and therefore
sees the production `DATABASE_URL` (pre-existing and environment-only — a local suite run
needs `bun --no-env-file` with `DATABASE_URL` hidden, because `.env` here carries
production credentials). Commit `cfee0bd` on `main`; pushed and remote-verified
(local HEAD == `origin/main`).

**NOT verified here — do not treat as production-ready.** The live browser flow against
Stripe (real session URL → Stripe page → webhook → `paid`) and the DB-gated refusal cases
in CI. This workspace has no signed-in session and no disposable database, and its `.env`
points at production, so no Stripe request or order was exercised from here.

**Note for the next agent:** `.ai/context/payment.md` exists and is the payment narrative
(§15/§16/§18 + archive are its history). Webhook-delivery evidence for the current
settlement investigation is §31.
