# Archive — payment reservation + order surfaces (§38–§41), moved 2026-09-29

Verbatim record of `.ai/AI_HANDOFF.md` §38, §39, §40 and §41 as they stood at
`2c52bfc734428232ed67dbde3a07b9985d4a506d`, moved out of the current-state handoff on
2026-09-29 so §42 (the full-system audit) could be appended without crossing the ~55 KB
file-edit matching limit. Nothing was rewritten — only relocated.

Current state for all four topics lives in `.ai/AI_HANDOFF.md` §38–§41 stub and **§42**.

---

## 38. Fixed 30-minute payment reservation + countdown + pay-again UX (2026-09-28)

**Reported (Part 1 FINAL, before VelRepeat).** Finish the unpaid-order / payment-reservation
experience and make the Order UI production-ready: the reservation is **exactly 30 minutes** (no
dynamic duration), the customer sees a countdown in the order list and on the order page, and can
pay again — choosing the payment method again — while the window is valid. VelRepeat, customer
memory, traffic/sales signals and personalization are explicitly OUT of scope.

**The window is now a CONSTANT — this supersedes §36's risk-based windows.** `backend/lib/payment-reservation.ts`
was rewritten so the duration is `PAYMENT_RESERVATION_MINUTES = 30` for every eligible order
(`payment_expires_at = created_at + 30 min`). Part 1 forbids deriving it from popularity, views,
clicks, sales velocity, demand or behaviour — the exact inputs the v1 policy read — so the risk
table, the signal query (`gatherOrderReservationSignals`) and `deriveDemandMetrics()` are GONE and
the policy is now a pure function of `now`. Everything else is unchanged: `orders.reservation_policy`
still records the policy that produced a deadline (`version: "v2"`, `reservationMinutes: 30`,
`reason`), so a v1 row stays distinguishable; the SAVEPOINT deploy-order guard, the expiry sweep,
the ONE release path, the "a paid-after-release order is never resurrected" guard and the Stripe
session `expires_at` bound all stand. Side benefit: order creation no longer runs the signal query
at all — one round trip less on the checkout path that §32/§34/§37 were about.

**Countdown — ONE rule for both surfaces.** NEW `paymentReservationPhase()` and
`PAYMENT_RESERVATION_URGENT_MS = 3 min` in `packages/shared/src/lib/commerce.ts`, returning
`active` / `urgent` (last 3 minutes, the documented `02:13` case) / `expired` / `none`. `MyOrders.tsx`
and `ShopOrderDetail.tsx` both read it, so an order can never look active on one surface and expired
on the other. The **list** now counts down per order (it previously had only the button), refetches
once when a window lapses, and refetches on `visibilitychange`; the **detail page** turns the
countdown into the hero (order no + status, "Payment expires in" + a big `MM:SS` + the note) with the
pay action beside it. Paid/cancelled orders show no countdown; a lapsed one shows the expired notice,
never `-00:23`. The clock is presentation only — the backend deadline is the source of truth and the
backend enforces it (checkout answers `400 PAYMENT_RESERVATION_EXPIRED`).

**Order page restructured into a production hierarchy.** Header card (status, countdown, pay) →
progress → items → **delivery** (address + carrier/tracking; there is no shipping-method column, so
none is invented) → **payment** (method, status, payment rows) → **order summary** (subtotal,
shipping, discount only when > 0, total) → shop → **actions** (pay now, back, buy again, cancel
order). Mobile first: `tabular-nums` clock, wrapping address, no horizontal overflow. Every string
lives in the dictionaries (th/en/my).

**Pay again = choose the method AGAIN.** `ResumePaymentButton` no longer auto-uses the recorded rail:
one press always opens a chooser listing the rails the BACKEND reports enabled
(`GET /api/payments/methods` → CARD/PROMPTPAY), preselects the recorded one, and continues with the
one the customer picks. (The backend already abandons a stale open session for a different method
instead of charging the wrong rail.) A `pageshow` listener re-enables the button when the customer
comes Back from Stripe; `onUnknownMethod` is gone from all four surfaces.

**Migration headroom + production state.** `db/migrations/048_payment_reservation.sql` — comment
updated only (the DDL is byte-identical, additive, idempotent): the runner fires only when a
`db/migrations/*.sql` file changes, and `048` has never applied. **Production Neon therefore still
has NO `payment_expires_at`/`reservation_policy`** (§37, quota `36371800184`), so in production the
reservation and the countdown are INERT — `orders` keeps answering `paymentExpiresAt: null`, the
pages simply render no countdown, and checkout is unaffected (that is the deploy-order net from
§37 working). Do not report the reservation as live in production until an owner read confirms the
columns.

**Verified here.** backend `tsc` 0 · `typecheck` 4/4 · `build:velshop` 0 · `i18n:check`
th=en=my=**1350** · `git diff --check` clean · `payment-reservation-policy` +
`payment-reservation-expiry` **49 pass / 19 skip / 0 fail** — new coverage: the 30:00 start, the
`02:13` urgent case, the full phase matrix (paid/cancelled/shipped → none, sweep-written `expired` →
expired, COD/legacy → none, lapsed → 00:00 never negative), the policy module's "no dynamic input"
source contract (no `riskLevel`/velocity/`featured` in code), the order-API deadline data contract
over HTTP (`29:xx` back out of a fresh 30-minute row), and source contracts for the list countdown
and the pay-again chooser · `checkout-payment-flow` 38 pass / 4 skip (its chooser case now pins
"every rail", not "unknown rail") · full backend suite **789 pass / 119 skip / 1 fail**, the single
failure being the pre-existing `test-database-isolation` child probe, which re-reads this sandbox's
`.env` (production `DATABASE_URL`); it passes in CI, where no `.env` exists and `DATABASE_URL` is unset.


**CI then verified the DB-gated half — `34e8891`, run `36437470190` GREEN: 907 pass / 2 skip / 0 fail**
(909 tests, 41 files) against the disposable `postgres:16` from `test.yml`. All 19 reservation cases
executed and passed, including the ones this sandbox can only skip: "the window written at creation
is a FIXED 30 minutes for every order, stored and auditable", "the order API exposes the deadline, so
a refresh rebuilds the same countdown" (NEW), "five concurrent sweeps still release exactly once",
"a late payment cannot resurrect an expired order — the reconciliation path",
"checkout refuses a lapsed reservation with `PAYMENT_RESERVATION_EXPIRED`", the SAVEPOINT
deploy-order case and "the expiry sweep only ever touches the pre-payment statuses it declares".

**Production — still NOT active, re-confirmed this pass.** The push re-queued the migration runner
(it fires only when `db/migrations/*.sql` changes) and `Migrate Neon Database` run `36437470328`
**failed again** on the same provider condition: `psql: … ERROR: Your account or project has exceeded
the quota. Upgrade your plan to increase limits.` (§22/§37). So `orders.payment_expires_at` /
`reservation_policy` are still absent from production Neon, and the reservation + countdown remain
inert there — orders answer `paymentExpiresAt: null`, the pages render no countdown, and checkout is
unaffected (the §37 deploy-order net). **Owner action to make it live:** clear the Neon quota, then
Actions → Migrate Neon Database → Run workflow (or paste the four statements from §37 into the Neon
SQL Editor).

**Still open (owner-side).** (1) A browser pass over the new order page, the list countdown and the
method chooser in th/en/my. (2) The production migration above.

## 39. Order UX polish — status, progress, address, language (2026-09-28)

**Reported (ORDER UX FINAL POLISH — the last task before VelRepeat).** Make the order list and order
page clear, consistent and multilingual for every unpaid order: per-order countdowns, readable
status, ONE simple progress line, the ORDER's own address, a clearer retry, and no hard-coded Thai.
The 30-minute reservation, the sweep and the release path are untouched.

**Countdown position + states.** Each list card keeps its OWN countdown, placed at the bottom-left of
THAT card (status badge, then the countdown, then one hurry note inside the last 3 minutes) so a
running clock is never ambiguous. ONE presentation clock per page: every card derives its own
remaining time from its own `paymentExpiresAt`. A lapsed card shows the expired state and refetches
once (the sweep may already have released the stock); `visibilitychange` still re-reads the API.
Nothing in the browser writes an order status or a deadline.

**Readable, localized status.** The order-status text came from `ORDER_STATUS_META.label`, which is
Thai-only — so English/Myanmar rendered Thai on both surfaces. NEW `orderStatusI18nKey()` (shared)
maps `orders.status` → `orderStatus.*`, NEW `orderStatus` namespace (th/en/my) covers all 11
statuses + `unknown`, and both pages render the translated label. The payment pill now uses the
semantic badge tokens (`getPaymentStatusBadge`) instead of a white-on-white badge. The Burmese table
also gained the six order-page strings that were still English (`myOrderPatch.orderDetail` in
`locales/index.ts`; that patch object can no longer carry the outer `satisfies Partial<Dict>`,
which a partially-filled namespace cannot satisfy).

**ONE progress line, real statuses.** The old five-icon stepper (no payment stage) is replaced by
`ORDER_PROGRESS_STAGES` = placed → payment → processing → shipped → delivered, with
`orderProgressStageIndex()` as the single mapping (`pending`/`pending_payment` → 1,
`paid`/`confirmed` → 2, `shipped` → 3, `delivered`/`completed` → 4). Terminal orders
(`cancelled`, `expired`, `payment_failed`, `refunded`) return -1 and get the notice that explains
them instead of a line implying progress. One `<ol>`, no nested bars; on a narrow screen only the
current stage label shows (all five names stay in the DOM for screen readers) and
`aria-current="step"` marks the stage. Order status and payment status are separate concepts, each
with its own visible caption.

**Address = the order's snapshot.** The delivery section renders `orders.shipping_address` exactly as
stored (`addressSnapshot`), one line per real field, omitting fields the snapshot lacks, with a
labelled recipient and the country translated only for `TH`. It never reads the profile/address
book, so changing the default address later cannot rewrite an existing order.

**Retry + terminal states.** `ResumePaymentButton` reads "Pay again" (`orderReservation.payAgain`)
and still opens the chooser from `GET /api/payments/methods`. A `payment_failed` order gets its own
notice and NO countdown and NO pay button — the backend released the stock at that point, so a
deadline or a pay button would promise a payment the server refuses; "buy again" is the way forward.

**Verified here.** `typecheck` 4/4 · backend `tsc` 0 · `build:velshop` 0 · `i18n:check`
th=en=my=**1369** · `git diff --check` clean · NEW `backend/tests/order-ux-polish.test.ts`
**10 pass / 0 fail** (one-line progress contract + stage mapping, terminal → -1, a localized label
for every status in all three locales, readable badge tokens incl. the unknown case, both surfaces
render the localized label, the detail page uses the order's OWN snapshot and never a profile
address, a failed payment keeps the original deadline and no fabricated one, per-card countdown) ·
reservation + checkout suites **97 pass / 23 skip / 0 fail** · full backend suite **799 pass /
119 skip / 1 fail**, the same pre-existing `test-database-isolation` sandbox probe (it re-reads this
workspace's `.env`; CI, with no `.env`, passes).

**Still open (owner-side).** (1) The browser pass over both order surfaces and the method chooser in
th/en/my. (2) The production migration (§37): without `payment_expires_at` there is no countdown in
production, and the polish only changes what is rendered when the column exists.

## 40. Countdown invisible in production — migration 048 never applied (2026-09-28)

**Root cause: production Neon has no `orders.payment_expires_at`.** Three migration runs died on
`exceeded the quota` (02:57Z, 14:38Z, 16:56Z); last success 2026-09-25, before 048 existed. The write
is then skipped by the deploy-order guard, `SELECT o.*` maps the absent column to
`paymentExpiresAt: null`, phase `none`, both pages render nothing — silent by design (§37's net).
Logic, API mapping and
deploy ruled out (the bundle carries the code); CI `d7282bb` green with the regression tests. Full
trace + owner check: `.ai/context/payment.md` → *Countdown not visible in production*.

**Shipped anyway:** the tier UI (`8261152`) — GREEN >15:00, YELLOW ≤15:00, RED ≤5:00, dark expired —
plus a bar measured against `orders.reservation_policy.reservationMinutes` (now on both read routes),
never a hard-coded 30; deployed on Vercel (chunks carry `reservationMinutes`/`progressbar`/
`criticalNote`).

**Owner action:** clear the quota → apply 048 (re-queued as `d7282bb`, comment-only, still failing)
→ place a NEW order. Rows created earlier keep `NULL` by design and will never show a countdown.

## 41. Order UX refactor — customer + seller order surfaces (2026-09-29)

**Scope.** VelShop Orders / Order Detail and VelSeller Orders + a NEW seller Order Detail. The payment
reservation, countdown, Stripe webhook, inventory release and the database schema were **not** touched
(§38/§39/§40 carry them unchanged) — this pass moves and repaints the surfaces only. No migration, no
new endpoint, no second timer, no second state machine.

**One status vocabulary, one badge.** NEW `packages/shared/src/components/order/OrderStatusBadge.tsx`
owns the icon + palette for every `orders.status` (11 values + `unknown`) and the five progress-stage
icons. Both apps render it, so their statuses cannot drift. `lib/shop.ts`'s `ORDER_STATUS_ICONS` stays
velcenter's six-status fulfilment map (its `shipped` label means something else), so the two were
deliberately NOT merged.

**VelShop.** Orders list: order number on the left and the status badge TOP RIGHT of the same header row
(was: the badge sat in the money footer, where it read as part of the total); every product row is its
OWN link to `/products/:id` (the whole card used to be one order link, so a product could never be
opened from here), and an unavailable product renders unlinked with `orderDetail.productUnavailable`.
Order Detail: the order number is the `h1`; the shop/seller block is REMOVED from the customer surface
(`shopId`/`shopName` stay in the API — the seller page and velcenter still render them); the progress
line keeps ONE ordered list and gains stage icons (done = check, current = the stage icon, not reached =
outline), laid out vertically on a phone and horizontally from `sm`; a 401/403 load and a 404 now get
different copy (`orderDetail.noAccess`/`noAccessDesc` vs `notFound`).

**VelSeller.** `SellerOrders` becomes a management surface: server-side status filter chips
(`?status=`, the six fulfilment statuses), an eight-column desktop table and tappable mobile cards,
every order number linking to the new route. NEW `SellerOrderDetail` at `/seller/orders/:orderId`
inside `RequireRole role="seller"`: customer, items (each product links to the storefront product page —
there is no seller-side product route, and creating one was not this task), the order's OWN address
snapshot, real shipment/tracking events newest-first with an honest empty state, payment, summary, and
status buttons built from `NEXT_ORDER_STATUSES` = the backend's `SELLER_ORDER_STATUS_TRANSITIONS`
(terminal orders explain themselves; cancelling confirms first because it restores stock server-side).
It reads `GET /api/seller/orders/:id`, which resolves the seller from the SESSION and verifies ownership
inside the query — the page passes no seller id.

**Shared API client.** `api-routes.ts` now throws `ApiError` carrying the HTTP status (still an `Error`
with the same message, so every existing `catch (err) { err.message }` is unchanged) — that is what lets
the order page tell "not yours" (403) from "not found" (404).

**Order numbers.** `generateOrderNumber()` moves to `backend/lib/order-number.ts`: ONE definition
(cart.ts plus a dead copy in stripe.ts collapsed), `crypto.randomInt` instead of `Math.random`, and an
alphabet without `0/O`, `1/I/L`, `U/V`. The format is unchanged — `VNX-YYYYMMDD-XXXXXX`, never
sequential, no UUID exposed to a customer. `orders.order_number` was already guarded by
`idx_orders_number_unique` (both schema files), so checkout now retries that ONE collision under a
SAVEPOINT, and `isOrderNumberCollision()` refuses to treat any other unique violation as retryable.

**New i18n.** `sellerOrders.*` (30 keys), `orderDetail.noAccess`/`noAccessDesc`,
`trackingLabels.none` — in th, en and my.

**Verified here.** `order-number` 7 pass · `seller-order-ux` 12 pass · `order-ux-polish` 22 pass (was
20; two assertions moved onto the shared badge) · full backend suite **830 pass / 119 skip / 1 fail**, the
single failure the pre-existing sandbox-only `.env` guard that passes in CI · backend `tsc` 0 ·
`typecheck` 4/4 · `i18n:check` th=en=my=**1404** · `build:velshop` and `build:velseller` green, with
`SellerOrderDetail` emitted as its own chunk · `git diff --check` clean.

**Not verified here.** (1) A browser pass over both apps at 390/430/1280/1440 px — the sandbox has no
session and no dev server is started per policy, so layout is pinned by contract tests, not observed.
(2) The production schema: migration 048 is still unapplied (§40), so the countdown still renders only
where `payment_expires_at` exists. (3) The seller list no longer carries an inline status dropdown —
status changes are made on the order detail page, which is the redesigned flow (list → detail → change →
back).
