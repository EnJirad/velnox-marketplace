# AI Handoff — §80 (Phase 2A) + §81 (Phase 2B) — moved verbatim 2026-10-27

Moved out of [`.ai/AI_HANDOFF.md`](../../AI_HANDOFF.md) on 2026-10-27 as edit-headroom
housekeeping while appending **§82 (Phase 2C)**: the current-state file was 49.3 KB against this
environment's ~55 KB file-edit ceiling. Nothing was discarded — the text below is the verbatim
section text, and the two phases keep their own full Change Reports (linked from their pointers in
the handoff and again at the end of this file).

Index row: [`.ai/history/AI_Handoff_Archive.md`](../AI_Handoff_Archive.md).

---

## §80. Phase 2A — Stability + Realtime Foundation (2026-10-27) — **COMPLETE**

**Base SHA:** `4908d7d34eb7052fcedc6d98fa49f4aee0eb0204` (`main` == `origin/main`, 0/0, clean).
**Resulting commit:** `af302883984d695a52dd697d15875ade2652581e` (`fix(realtime): stabilize ui and
realtime foundation`; its SHA is recorded here in the follow-up `docs(ai)` commit).
**Report:** [`.ai/history/2026-10-27-ui-realtime-phase-2a.md`](../2026-10-27-ui-realtime-phase-2a.md).

**What changed (no schema / SQL / DB / Stripe changes):**
- **ONE realtime client + ONE owner.** `chat-socket` rewritten: explicit state
  (`idle/connecting/open/reconnecting/closed`), ref-counted public channels, re-subscribe on every
  open, 1 s→30 s exponential backoff **with jitter**, `onChatReconnect`, guarded sends. New
  `<RealtimeProvider>` at the VelShop/VelSeller/VelCenter roots owns connect/disconnect.
- **VelCenter socket FIXED.** The inline client (wrong URL, no `/ws`, fixed 5 s retry) is gone; the
  page uses the shared client, subscribes the six channels, and re-reads every queue on reconnect.
- **Chat no longer kills notifications.** `disconnectChatSocket()` removed from ShopChat/SellerChat/
  bell cleanup; both chat pages and both bells refetch after a reconnect.
- **Backend transport:** presence cleared when a user's last socket closes/terminates; 30 s ping with
  missed-pong terminate; per-client guarded fan-out.
- **Seller navigation:** header Chat action below `lg` (P0 mobile entry); tab bar now stays through
  tablet (768–1023 px) via `until="lg"` + `.site-app--tabbar-lg`.
- **Notification panels:** fixed viewport-gutter sheet below `sm`, anchored popover at `sm+`; failure
  renders error + retry, never "all caught up".
- **Error ≠ empty:** MyOrders, SellerOrders, Income, ShopNotifications, ShopChat and the cart now have
  real error states with retry; last good data is kept where it exists.
- Three architecture tests updated to assert the new one-socket invariant.

**Verified:** 4 app typechecks PASS · backend typecheck PASS · `bun run build:apps` PASS (4/4) ·
`bun run i18n:check` PASS `1251/1251/1251` · `bun test backend/tests` **987 pass / 303 skip / 0 fail** ·
`git diff --check` clean. **NOT RUN:** browser/viewport pass, live WebSocket handshake, production DB
(not connected).

**Still open (Phase 2C):** `order:created` publisher, `order:updated`/`shipment:updated`
consumers, transactional notification rows, private admin channels. Seller chat icon has no unread
badge (no seller unread-count endpoint).

## §81. Phase 2B — Broken UX + Commerce Correctness (2026-10-27) — **COMPLETE**

**Base SHA:** `ded711776e06b5bb41bb125d7e36d003f709a199` (`main` == `origin/main`, 0/0, clean).
**Resulting commit:** `eca58eb` — `fix(ui): complete phase 2B commerce correctness` (18 files,
+1288/−116; its SHA is recorded here in this `docs(ai)` commit).
**Report:** [`.ai/history/2026-10-27-ui-commerce-phase-2b.md`](../2026-10-27-ui-commerce-phase-2b.md).
**SOURCE CODE MODIFIED: YES · DATABASE MODIFIED: NO · SQL MODIFIED: NO · PRODUCTION DB
CONNECTED: NO · STRIPE MODIFIED: NO.**

**Fixed (5 findings, root causes verified by trace):**
- **Buy Now quantity + cart integrity.** The checkout posted `cartItemIds`, so the CHARGED quantity
  came from the cart line (and buying appended to/overwrote the saved cart). Now the product page and
  the selection sheet navigate without touching the cart, `ShopCheckout` sends
  `buyNow: { productId, variantId, quantity }`, and `POST /api/customer/checkout` builds a synthetic
  line from the row it reads in Neon — same validation, price revalidation, stock reservation,
  idempotency claim, payment-reservation policy and order-number path as a cart checkout; cart cleanup
  skips it. A client price is never accepted.
- **Order-history pagination** on all three surfaces: `offset` + `ORDER BY created_at DESC, id DESC`
  and an opt-in `paginated=1 → { orders, pagination }` shape (bare array default kept, so old
  consumers are untouched). Frontends append page-by-page with id dedupe, a sync ref guard, a
  sequence guard against stale responses, filter change → offset 0, refresh → page 1. VelCenter's
  pending badge now reads the exact `marketKpi.pendingOrders`.
- **Bootstrap claim `res.ok`:** non-2xx never toasts success nor writes a claimed state; 409 re-reads
  owner status; success is confirmed by re-reading `/admin/bootstrap-status`; the status probe failure
  is its own gate with a retry instead of offering the bootstrap form.
- **VelCenter destructive actions:** confirmation before `cancelled` and before any role change;
  `busyOrderId`/`busyUserId` per-row guards (only that row's control disables); success awaits the
  authoritative refetch, failure toasts the real error and re-reads server state.
- **Footer/marketing links:** corporate `/privacy` + `/terms` (both used to open the corporate home),
  returns → `/help#orders`, VelSeller login → `/auth` (the old `/seller/login` route does not exist),
  `rel="noopener noreferrer"` on corporate external links. All four apps audited against the real
  route tables: no other dead links, no `#`, no VelRepeat references.

**New test:** `backend/tests/buy-now-checkout.test.ts` — 5 contract assertions (no client price,
buyNow ⊥ cartItemIds, server-priced row, total = price × quantity, no cart mutation on the buy path)
plus 10 DB-gated route cases (qty 1/2/5, over-stock, invalid qty, double submit, mixed payload,
unpublished product).

**Verified:** 4 app typechecks PASS · backend typecheck PASS · `bun run build:apps` PASS (4/4) ·
`bun run i18n:check` PASS `1257/1257/1257` · `bun test backend/tests` **992 pass / 313 skip / 0 fail** ·
`git diff --check` clean. **BLOCKED/NOT RUN:** the 10 DB-gated Buy Now cases (no safe
`TEST_DATABASE_URL` in this workspace — they skip, no production credential used), browser/E2E pass
(no browser here), real Stripe TEST E2E (no keys). `bun run lint` still not configured.
**UNVERIFIED, deliberately untouched:** the corporate domain defaults (`velnox.com` in
`sites.ts` vs `velnx.com` in INSTALLATION.md) — needs the owner's confirmation, not a guess.

**Still open (Phase 2C/2D):** realtime commerce events (`order:created` publisher,
`order:updated`/`shipment:updated` consumers), transactional notification rows, private admin
channels, chat/support fundamentals, seller-chat unread badge, responsive/visual matrix.
