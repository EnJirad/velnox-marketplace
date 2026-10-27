# Phase 2B — Broken UX + Commerce Correctness — Change Report

| Field | Value |
|---|---|
| Date / time | 2026-10-27, 12:20–13:10 UTC |
| Agent | Buffy (Codebuff), Freebuff workspace |
| Branch | `main` |
| SHA before | `ded711776e06b5bb41bb125d7e36d003f709a199` (= `origin/main` at `git fetch` before editing; 0/0, clean tree) |
| SHA after (code) | `eca58eb` — `fix(ui): complete phase 2B commerce correctness` (18 files, +1288/−116) |
| SHA after (docs) | `262aa2d134a5552e9403f564773a025c9359b9b1` — the `docs(ai)` commit carrying this file, the handoff §81 and the archive of §76/§78/§79 |
| Purpose | Fix only the Phase 1 / Phase 2A findings listed as Phase 2B scope: Buy Now quantity correctness, order-history pagination, VelCenter bootstrap-claim `res.ok`, VelCenter destructive-action guards, footer/marketing links. Preserve every working marketplace system. |

**SOURCE CODE MODIFIED: YES · DATABASE MODIFIED: NO · SQL MODIFIED: NO ·
PRODUCTION DB CONNECTED: NO · STRIPE MODIFIED: NO**

---

## 1. Pre-change inspection (before any edit)

- `git fetch origin` → `HEAD == origin/main == ded7117…`, working tree clean, no divergence. Docs
  SHA (`ded7117`, recorded by §80's follow-up) was re-read from GitHub, not trusted from memory.
- Read `AGENTS.md`, `.ai/AI_RULES.md`, `.ai/README.md`, `.ai/AI_HANDOFF.md`,
  `.ai/context/{project-map,frontend,realtime,testing,workflow}.md`,
  `.ai/history/2026-10-27-ui-realtime-phase-2a.md` and the Phase 1 audit
  (`.ai/history/2026-10-26-ui-realtime-professional-audit.md`).
- Traced each issue frontend → API → backend → schema before touching it (see §2).

## 2. Root cause per issue, and the fix

### A. Buy Now charged the wrong quantity and mutated the cart

**Trace.** `ProductSelectionSheet` / `ShopProductDetail` called `add(product, qty)` and then
navigated to `/checkout` with `buyNow: true, buyNowProductId, buyNowQty`. `ShopCheckout` ignored
`buyNowQty` entirely: it filtered the *cart* for the matching line and posted
`checkoutPayload.cartItemIds = checkoutLines.map(l => l.id)`. The server built the order from
`cart_items`, so the quantity charged was the **cart line's** quantity (or, after `add` appended a
new line, a quantity the customer never chose) — and "Buy Now" appended to or overwrote the saved
cart.

**Fix (server is still the authority).**
- `backend/routes/cart.ts` — `POST /api/customer/checkout` accepts an optional
  `buyNow: { productId, variantId, quantity }`, mutually exclusive with `cartItemIds`. Quantity goes
  through the same `validateCheckoutQuantity` as a cart line; the row is loaded from
  `products`/`inventory`/`shop`/`product_variants` (never from a price the client can send); a
  synthetic line (`id: null`, `cart_id: null`) flows through the *same* validation, price
  revalidation, group/order creation, stock reservation, idempotency claim and payment-reservation
  policy as every cart checkout. Cart cleanup filters non-string ids, so no cart row is deleted, and
  `recalcCart` runs only when a cart row was actually purchased.
- `ShopProductDetail.tsx` / `ProductSelectionSheet.tsx` — the buy branches no longer call `add(...)`;
  they navigate with `buyNowQty` plus a display-only `buyNowItem` snapshot.
- `ShopCheckout.tsx` — renders from `buyNowItem` (no dependency on the cart having loaded) and posts
  `buyNow: { productId, variantId, quantity }`; a client price is never in the payload.

**Why there is no duplicate charge on refresh/retry:** unchanged — the `checkout_requests`
`(user_id, scope, request_key)` claim already replays the same response for the same `requestId`
(the page keeps one UUID per mount), and `requestIdRef`/`submitRef` still enforce one press = one
order. This was verified rather than modified.

### B. Order history had no pagination (truncated at 50/50/100)

**Root cause:** `/api/customer/orders`, `/api/seller/orders` and `/api/admin/orders` accepted no
`offset`, and the three pages fetched one fixed slice.

**Fix.** Each route now takes `offset` (+ stable `ORDER BY created_at DESC, id DESC` tie-break) and,
when called with `paginated=1`, answers `{ orders, pagination: { limit, offset, total, hasMore } }`.
The default response shape is unchanged (bare array), so existing consumers keep working — verified:
`myOrders` / `sellerOrders` / `ordersListAction` entries in `api-routes.ts` are untouched, with new
`…Paged` actions added alongside.

Frontends `MyOrders.tsx`, `SellerOrders.tsx`, `Center.tsx` (orders tab): page size 20/20/50,
"load more" that **appends** (dedup by id), a synchronous ref guard against double taps, a sequence
guard so a stale response can never overwrite a newer one, filter changes restart at offset 0 (the
filter is carried on every request, and a page arriving for an old filter is dropped), refresh
resets to page 1, and the existing error/loading/empty states were kept.
VelCenter's pending-orders badge now reads the exact `marketKpi.pendingOrders` (a paginated first
page can no longer hide the real count) and the KPI is refetched after a status change.

### C. VelCenter bootstrap claim ignored `res.ok`

**Root cause:** `RequireRole.tsx` `handleClaimOwner` awaited `fetch(...)` without checking status, so
HTTP 401/403/404/409/500 all produced `toast.success`. The `/admin/bootstrap-status` probe likewise
parsed the body unchecked and, on failure, wrote `{ ownerExists:false, configured:false }` — i.e. it
offered the one-time bootstrap form after a *network/server* failure.

**Fix.** The claim now parses the body, and on `!res.ok` shows the server message (or 409-specific
copy), never a success toast, never a "claimed" state; a 409 re-reads the real owner state instead
of leaving an impossible form; success is *confirmed* by re-reading `/admin/bootstrap-status`. The
probe checks `res.ok` and its failure is its own gate with a retry — never the bootstrap form.
New i18n keys `gate.centerBootstrapTaken` / `centerBootstrapFailed` / `centerOwnerCheckFailed` in
th/en/my.

### D. VelCenter destructive actions had no confirmation and no per-row busy

**Root cause:** `handleOrderStatus` and `handleSetUserAccess` ran with no confirmation for
irreversible outcomes (cancelling an order releases stock; a role change grants or removes power)
and no per-row busy/double-submit guard, and they left the row's state to a fire-and-forget refetch.

**Fix.** `window.confirm` before `cancelled` and before any role change; `busyOrderId` /
`busyUserId` guard double submits and disable **only that row's** control (other rows stay usable);
success awaits the authoritative refetch (`loadOrders`, `loadPeople`), failure toasts the real error
and re-reads server state so the UI can't claim a change the server rejected.
(The moderation/verification queues and `EmployeeManager` already had per-row busy + confirmations —
inspected and left unchanged.)

### E. Footer / marketing links

- `ShopFooter`: **Privacy** and **Terms** both opened the corporate home page → now
  `/privacy` and `/terms` via `joinUrl`.
- `ShopFooter`: "การคืนเงิน / คืนสินค้า" pointed at `/orders` (no policy there) → `/help#orders`,
  which is where the returns/refund articles live.
- `ShopFooter`: VelSeller "เข้าสู่ระบบ" pointed at `/seller/login`, a route velseller **does not
  have** → `/auth`.
- `CorporateLayout`: external footer links used `rel="noreferrer"` → `rel="noopener noreferrer"`
  (the repository standard).
- Audited all four apps' link sources (footers, headers, tab bars) against the real route tables in
  each `main.tsx`: no other dead internal links, no placeholder `#`, no VelRepeat references.

## 3. Files

**Changed (18):** `backend/routes/cart.ts`, `backend/routes/seller-orders.ts`,
`backend/routes/center.ts`, `backend/tests/seller-order-ux.test.ts`,
`packages/shared/src/lib/api-routes.ts`, `packages/shared/src/components/RequireRole.tsx`,
`packages/shared/src/lib/i18n/locales/{th,en,my}.ts`,
`apps/velshop/src/pages/{ShopCheckout,ShopProductDetail,MyOrders}.tsx`,
`apps/velshop/src/components/shop/{ProductSelectionSheet,ShopFooter}.tsx`,
`apps/velseller/src/pages/SellerOrders.tsx`, `apps/velcenter/src/pages/Center.tsx`,
`apps/velnox/src/pages/corporate/CorporateLayout.tsx`
**Added (1):** `backend/tests/buy-now-checkout.test.ts`
**Deleted (0):** nothing.
**Docs:** `.ai/history/2026-10-27-ui-commerce-phase-2b.md` (this file), `.ai/AI_HANDOFF.md`
(§76/§78/§79 archived to `.ai/history/archive/AI_Handoff-2026-10-27-sections-76-79.md` + index row,
new §81), archive index row.

## 4. Systems affected / explicitly unaffected

**Affected:** storefront checkout request payload, three order-list API responses (opt-in only), the
VelCenter bootstrap gate UI, VelCenter order/role controls, footer links.

**Explicitly UNCHANGED:** `db/schema.sql`, `db/run-sqleditor.sql`, all SQL (no DDL/DML anywhere),
Stripe (no file touched, no session/webhook logic edited), payment amounts/pricing rules, order and
shipment state machines, idempotency and first-click-wins behaviour, payment-deadline logic,
authentication/authorization/ownership checks, R2/media, the Phase 2A single-realtime-client
architecture, notification/chat systems, and every Phase 2C/2D item.

## 5. Tests actually run (real output)

| Command | Result |
|---|---|
| `bun run typecheck` (velshop · velseller · velcenter · velnox) | **PASS** — all 4 exit 0 |
| `cd backend && bun run typecheck` | **PASS** — exit 0 |
| `bun run build:apps` | **PASS** — 4/4 exit 0 (re-run after the last edit) |
| `bun run i18n:check` | **PASS** — `th=1257 en=1257 my=1257`, parity |
| `cd backend && bun test tests` | **PASS** — 992 pass / 313 skip / 0 fail (1305 tests, 64 files) |
| `cd backend && bun test tests/buy-now-checkout.test.ts` | **PASS** — 5 pass / 10 skip / 0 fail |
| `git diff --check` (and `--cached --check`) | **clean** |

## 6. Tests NOT RUN / limitations (honest)

- **BLOCKED — the 10 DB-gated Buy Now cases** (quantity 1/2/5 → order line, total, stock reservation,
  untouched cart; over-stock 400; invalid quantities 400; double-submit = one order; buyNow+cartItemIds
  400; unpublished product 400). They are written against the real route and skip because no safe
  `TEST_DATABASE_URL` exists in this workspace (`hasTestDatabase()` false). They run wherever a test
  database is configured. **No production credential was used or requested.**
- **NOT RUN — browser/E2E pass:** pagination interactions, confirmation dialogs, per-row busy states
  and footer links were verified by code + architecture tests only; this environment has no
  browser/screenshot capability. Real Stripe TEST E2E remains BLOCKED (no keys/browser).
- Structural tests (`seller-order-ux.test.ts`) were **updated, not weakened**: the assertion now
  requires the status filter on *every* list request (first page + load-more) plus the stale-response
  guard, instead of the old single literal call.
- Known remaining issues: seller chat icon has no unread badge (no endpoint); `order:created` /
  `order:updated` / `shipment:updated` consumers and notification rows are Phase 2C;
  `bun run lint` is not configured in this repo; the corporate domain defaults
  (`velnox.com` vs the `velnx.com` documented in INSTALLATION.md) are **UNVERIFIED** and were
  deliberately left untouched rather than guessed.

## 7. Next recommended phase

**Phase 2C** — realtime commerce events + transactional notifications (publisher and consumers,
private admin channels) exactly as scoped by the Phase 1 report §8, after this phase's behaviour is
confirmed in a browser.

## 8. Safety attestations

- No database was connected to. **PRODUCTION DB CONNECTED: NO.**
- No `DROP`/`DELETE`/`UPDATE`/`INSERT`/`ALTER`/`CREATE` was executed against any database by this
  task, and no test fixture writes were run (they were skipped).
- No credentials or secrets were read, written or printed.
