# Archived handoff section — §35 (customer order cancellation)

Extracted from `.ai/AI_HANDOFF.md` on 2026-09-28 to restore edit headroom (§37 pushed the file past
the tooling ceiling). Body verbatim.

---

## 35. Customer order cancellation — unpaid orders get a way out (2026-09-28)

**Reported:** after a failed or abandoned Stripe payment the order page offered only
"ชำระต่อ" — there was no way to cancel an order the customer no longer wanted, even though a
`pending_payment` order is holding stock and its Checkout Session is still open at Stripe.

**Root cause (code, not policy):** `PATCH /api/customer/orders/:orderId/cancel` accepted
only `pending` / `confirmed`, and the order page kept its **own** second copy of that list
(`new Set(["pending", "confirmed"])`). `pending_payment` — the status `POST
/api/stripe/checkout` writes, and the one a customer returns with — matched neither.

**Fix (one endpoint, one rule, no new system):**

| Piece | Change |
|---|---|
| `packages/shared/src/lib/commerce.ts` | `CUSTOMER_CANCELABLE_ORDER_STATUSES` = `pending` \| `pending_payment` \| `confirmed`, `isOrderCancelableByCustomer()`, `orderCustomerCancelability()` (refuses when a payment is `paid`/`processing`). ONE rule for button and server |
| `backend/routes/cart.ts` | Same route, widened: ownership in the `WHERE` (404, never 403), status check, payment-state check (`409 ORDER_ALREADY_PAID` / `409 PAYMENT_IN_PROGRESS`), then ONE transaction = guarded `UPDATE … status = ANY($2)` claim + abandon the `pending`/`requires_action` payment row + `releaseOrderInventory()`; terminal states are idempotent no-ops |
| `backend/routes/stripe.ts` | New `expireStripeCheckoutSession()` — the abandoned session is expired **before** the order is cancelled, so the old Stripe tab can no longer charge it. `markPaymentSucceeded` now logs (order id only) when funds land on a non-payable order |
| `backend/lib/order-read.ts` | NEW. `fetchOrderItemsForOrders()` / `fetchShipmentsForOrder()` moved out of `routes/cart.ts` verbatim (pure readers) — see the tooling note below |
| `apps/velshop/src/pages/ShopOrderDetail.tsx` | Reads the shared rule; cancel button + confirm dialog now appear for an unpaid order next to "ชำระต่อ"; cancelled orders show `orderCancel.cancelledNotice` and never a pay button |
| i18n (`th`/`en`/`my`) | NEW top-level `orderCancel` namespace: `back`, `dialogDescUnpaid`, `cancelledNotice` (i18n:check th=en=my=**1334**) |

**State machine (unchanged except where it was broken):**

```
pending ──┐
pending_payment ──┼── cancel  → cancelled  (stock released once, session expired)
confirmed ──┘
paid / shipped / delivered / completed / refunded  → REFUSED (400 INVALID_STATUS)
payment paid (order row lagging)                   → REFUSED (409 ORDER_ALREADY_PAID)
payment processing                                 → REFUSED (409 PAYMENT_IN_PROGRESS)
already cancelled / payment_failed / expired       → 200 no-op (nothing released twice)
```

**Stock:** reserve at creation (`reserveInventoryStock` for non-variant, immediate
`product_variants.stock -= qty` for variants); release through the ONE path,
`releaseOrderInventory()`. Cancellation adds NO second mechanism — it calls that function
inside its transaction, so the `inventory_released` claim keeps a repeated, concurrent,
retried or webhook-driven cancel from returning stock twice, and its status guard refuses to
release for an order that became `paid` meanwhile.

**Webhook when the order is cancelled:** `markPaymentSucceeded` only moves orders from
`pending`/`pending_payment`, so a cancelled order can never become `paid` — the money stays on
the payment row (that is what makes it refundable) and the new log line names the case.
`checkout.session.expired` and duplicate deliveries stay idempotent. Signature verification,
raw body and the event claim are untouched.

**Verification (executed here):** `backend/tests/customer-order-cancel.test.ts` NEW —
**23 pass / 14 skip / 0 fail** (the 14 are `TEST_DATABASE_URL`-gated; no Postgres/docker
exists in this workspace, and CI `.github/workflows/test.yml` provisions `postgres:16`, bootstraps
`db/run-sqleditor.sql` and runs the full suite). Full backend suite **732 pass / 107 skip / 0
fail** (839 tests, 39 files); payment/webhook/order suites **170 pass / 28 skip / 0 fail**;
backend `tsc` 0; `typecheck` 4/4; `build:apps` 4/4; `i18n:check` 1334 each; `git diff --check`
clean. **No DB-gated case is claimed as passing** — run them with `TEST_DATABASE_URL` or watch CI.

**Tooling finding (important for the next agent):** this workspace's `str_replace` only matches
inside roughly the first **55 KiB** of a file. `backend/routes/cart.ts` was 70 KB and its cancel
handler sat at byte 56,594 — **unmatchable**, which is why `lib/order-read.ts` was extracted (a
real cleanup, not a workaround for its own sake). The same limit is why the new copy became a
top-level `orderCancel` namespace instead of living in `orderDetail`: in `th.ts` (106 KB) and
`my.ts` (100 KB) that block is past the window — the existing `myAuthPatch` / `myShopPatch` /
`myOrderPatch` precedent.

**Open / owner-side.** (1) Re-run the 14 DB-gated cases (CI or a disposable Postgres). (2)
A browser check of the new dialog in velShop (th/en/my) — not executable here. (3) The `min: 1`
reservation cost (§34) is unchanged; `INSTALLATION.md` still carries the wrong `velnx-api` host (§31).

**Superseded in part by §37 (2026-09-28):** the two `customer-order-cancel` failures that reddened
`main` were test-side (scenario 9's fixture never set `inventory_released`; scenario 11 filtered on
`cancelled` instead of `alreadyFinal`). Both are fixed there.
