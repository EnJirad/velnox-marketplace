# Archived handoff section — §82. Phase 2C — Realtime Commerce Correctness (2026-10-27)

Moved out of [`.ai/AI_HANDOFF.md`](../../AI_HANDOFF.md) **verbatim** on 2026-10-28 during Phase 2E
(edit-headroom housekeeping while appending §84). Nothing was discarded: the text below is unchanged,
and the same work is also recorded in the Phase 2C change report
[`.ai/history/2026-10-27-realtime-commerce-phase-2c.md`](../2026-10-27-realtime-commerce-phase-2c.md).
Index row: [`history/AI_Handoff_Archive.md`](../AI_Handoff_Archive.md).

---

## §82. Phase 2C — Realtime Commerce Correctness (2026-10-27) — **COMPLETE**

**Base SHA:** `f78322f9aa8006f950315db6984d79206fd5c892` (`main` == `origin/main`, 0/0, clean).
**Resulting commit (code):** `38662de6c55db5aba9245914aa18bccd784c4119` — `fix(realtime): complete
phase 2C commerce events` (16 files, +1551/−119). This `docs(ai)` commit carries §82, the report and the
§80/§81 archive pointers.
**Report:** [`.ai/history/2026-10-27-realtime-commerce-phase-2c.md`](history/2026-10-27-realtime-commerce-phase-2c.md).
**SOURCE CODE MODIFIED: YES · DATABASE MODIFIED: NO · SQL MODIFIED: NO · PRODUCTION DB
CONNECTED: NO · STRIPE MODIFIED: NO** (no Stripe logic touched; `routes/stripe.ts` changed only in
its realtime-publish/notification calls — settlement, pricing and webhook handling byte-identical).

**What changed (5 workstreams):**
- **`order:created` now exists.** The checkout publishes it AFTER the transaction commits, one event
  per created shop order, only when orders were really created (a replayed `requestId` replays the
  stored response, so it creates and announces nothing).
- **`order:updated` / `shipment:updated` are addressed, not broadcast.** New
  `backend/lib/order-events.ts` resolves the audience from Neon (`orders.user_id` + `orders.shop_id →
  shops.seller_id → sellers.user_id`) and delivers to those sessions **plus every connected VelCenter
  session** via `sendToUsers` / `sendToCenter`. The three order/shipment channels are no longer
  subscribable at all — no client can watch someone else's orders, and no anonymous socket can.
- **Shipment events only for a real change.** Both parcel routes gate on `moved || created`; the
  first creation is announced because `transitionShipment` now reports `created` (its row
  materialises directly in `created`, so `moved` was false there).
- **Notification ROWS for order lifecycles** (`backend/lib/order-notifications.ts`): seller on new
  order and on customer cancellation; customer on payment/status/shipment changes. Row first, socket
  frame second (the frame is never proof of persistence), non-fatal, no new table/queue, and never a
  second row for a repeat (the transitions' own `moved`/claim guards are the idempotency boundary).
- **Private admin channels authorized server-side.** `users.role` is read at connect and re-read by
  the 30 s sweep; `audit:created`, `config:updated`, `product:updated`, `seller:updated`,
  `inventory:updated`, `notification:created` are owner/admin/staff only, a lost role drops its live
  subscriptions, and every subscription requires an authenticated user.

**New test:** `backend/tests/realtime-commerce-phase2c.test.ts` — 23 contract assertions plus 8
DB-gated end-to-end cases (owner vs customer subscriptions, addressed `order:created` recipients,
replay/no-duplicate, failed checkout emits nothing, `order:updated` on cancel, `shipment:updated`
once-per-real-move) over a REAL HTTP + WebSocket server.

**Verified:** 4 app typechecks PASS · backend typecheck PASS · `bun run build:apps` PASS (4/4) ·
`bun run i18n:check` PASS `1257/1257/1257` · `bun test backend/tests` **1015 pass / 321 skip / 0 fail** ·
`git diff --check` clean. **BLOCKED/NOT RUN:** the 8 DB-gated cases (no safe `TEST_DATABASE_URL` here —
they skip; CI's disposable `postgres:16` runs them), live browser/E2E (no browser here).

**Still open (Phase 2D/next):** durable delivery needs an OWNER-APPROVED drain worker for the
unused `outbox_events` table (a crash between COMMIT and publish still loses a signal — consumers
refetch on reconnect); staff with a centre role but no `audit.view` still receive the `audit:created`
signal (payload is `{ action, entityType }` and the API stays permission-gated); seller/customer
chat unread badge, chat/support fundamentals, responsive/visual matrix.
