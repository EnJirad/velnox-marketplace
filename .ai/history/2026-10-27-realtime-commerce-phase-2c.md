# Phase 2C — Realtime Commerce Correctness — Change Report

| Field | Value |
|---|---|
| Date / time | 2026-10-27, ~15:00–16:20 UTC (sandbox clock) |
| Agent | Buffy (Codebuff), Freebuff workspace |
| Branch | `main` |
| Commit SHA before | `f78322f9aa8006f950315db6984d79206fd5c892` (= `origin/main` at `git fetch`; 0/0, clean tree) |
| Commit SHA after (code) | `38662de6c55db5aba9245914aa18bccd784c4119` — `fix(realtime): complete phase 2C commerce events` (16 files, +1551/−119) |
| Commit SHA after (docs) | the `docs(ai)` commit carrying this file, `AI_HANDOFF.md` §82 and the §80/§81 archive — it is the final `HEAD` of this task (`git log -1 --format=%H` on `main` after the push; a commit cannot contain its own SHA, so it is reported in the task's final answer instead) |
| Purpose | Deliver the five Phase 2C workstreams: publish `order:created`, deliver `order:updated` / `shipment:updated` only to authorized consumers, persist order-lifecycle notification rows, and secure the private admin realtime channels — with no schema, SQL, Stripe or unrelated change. |
| What was inspected before changing | `AGENTS.md`, `.ai/AI_RULES.md`, `.ai/README.md`, `.ai/AI_HANDOFF.md`, `.ai/context/{project-map,frontend,realtime,testing,workflow}.md`, `.ai/history/2026-10-27-ui-realtime-phase-2a.md`, `.ai/history/2026-10-27-ui-commerce-phase-2b.md`, `.ai/history/2026-10-26-ui-realtime-professional-audit.md`; then the actual implementation: `backend/realtime/index.ts`, `packages/shared/src/lib/chat-socket.ts`, `components/RealtimeProvider.tsx`, `backend/routes/{cart,seller-orders,center,stripe,chat}.ts`, `backend/jobs/payment-reservation-scheduler.ts`, `backend/lib/{order-shipment,order-fulfillment,permissions,inventory}.ts`, `apps/velcenter/src/pages/Center.tsx`, `db/schema.sql` (read-only), `backend/tests/*` conventions, `.github/workflows/test.yml`. |

> **SOURCE CODE MODIFIED: YES**
> **DATABASE MODIFIED: NO**
> **SQL MODIFIED: NO**
> **PRODUCTION DB CONNECTED: NO**
> **STRIPE MODIFIED: NO**
> (`backend/routes/stripe.ts` is in the diff, but ONLY in its realtime-publish and
> notification calls: settlement, pricing, session/webhook semantics and money state are
> byte-identical — see §4.)

---

## 1. Preflight (before any edit)

- `git fetch origin main` → `HEAD == origin/main == f78322f9aa8006f950315db6984d79206fd5c892`, fast-forward
  relationship, empty `git status --porcelain` (clean tree, no user changes to preserve).
- Confirmed no Phase 2C work already existed: `order:created` had **no publisher**, `shipment:updated`
  had two publishers **and no subscribable channel** (so it was undeliverable), and the order/shipment
  channels were in a client-chosen "public" allowlist (`isPublicChannel`) that even an **anonymous**
  socket satisfied.

## 2. Root causes and fixes per workstream

### A — `order:created` had no publisher

**Root cause.** `POST /api/customer/checkout` committed the order rows inside `withTransaction` and then
answered; nothing announced the creation. `CHANNELS.ORDER_CREATED` existed but was never used.

**Fix.** In `backend/routes/cart.ts`, after the transaction returns (i.e. only for a committed creation)
and before the response, one addressed event is published per created shop order:

```ts
for (const created of createdOrders) {
  await publishOrderEvent("order:created", created.orderId, {
    orderId: created.orderId, orderNumber: created.orderNumber,
    shopId: created.shopId, checkoutGroupId,
  });
  await notifyOrderSellerOfNewOrder(created.orderId);
}
```

- Only a **real** creation publishes: every refusal path answers and returns earlier, and a **replayed**
  `requestId` is answered from `checkout_requests` with `createdOrders` empty, so it publishes nothing
  and writes no notification.
- A failed/rolled-back checkout cannot reach the line (the failure returns inside the `catch` above it)
  — asserted structurally by the test suite.
- Multi-shop support follows the real order model: `createdOrders` holds one row per shop, so a
  3-shop purchase publishes 3 events that share `checkoutGroupId`.
- No PII: identifiers + status only.

**Delivery guarantee, stated honestly:** the event is published AFTER the commit, so it is
**at-most-once**, not exactly-once. There is no outbox drain worker in this repository
(`outbox_events` exists in `db/schema.sql` with `status/attempt_count/next_retry_at` but **no writer and
no drain**) — a process crash in the window between COMMIT and publish loses the signal. Per the task's
instruction, **no queue/outbox was introduced**; consumers refetch from the API on mount and on
reconnect. A drain worker is documented as owner-approved future work (§7).

### B — `order:updated` was a global broadcast

**Root cause.** `broadcast(CHANNELS.ORDER_UPDATED, "order:updated", { orderId, to })` fanned out to every
socket that had subscribed to the name, and ANY socket (including an anonymous one) could subscribe. A
customer or seller therefore received other users' order ids and statuses; the payload's `orderId` is
also the identifier needed to probe `/api/customer/orders/:id`.

**Fix.** New `backend/lib/order-events.ts` — the ONE publisher:

```ts
resolveOrderParties(orderId)  // orders.user_id + orders.shop_id → shops.seller_id → sellers.user_id
publishOrderEvent(event, orderId, data)  // sendToUsers([customer, seller], …) + sendToCenter(…)
```

Every writer now calls it after its commit and only for a real change:
`routes/cart.ts` (customer cancel, single + group), `routes/seller-orders.ts` (seller status),
`routes/center.ts` (operator status), `routes/stripe.ts` (12 webhook branches: paid / payment_failed /
cancelled, single + group; single-order branches keep their `result.moved` gate, group branches iterate
`outcome.claimed`), `jobs/payment-reservation-scheduler.ts` (expiry, single + group, after the atomic
claim; skipped rows publish nothing). `broadcast(CHANNELS.ORDER_UPDATED…)` no longer exists anywhere.

**Authorized recipients (server-resolved, never client-supplied):**

| Event | Customer (`orders.user_id`) | Shop's seller (`shops.seller_id→sellers.user_id`) | VelCenter sessions (owner/admin/staff) | Everyone else |
|---|---|---|---|---|
| `order:created` | ✅ | ✅ | ✅ | ❌ nothing, and no channel to subscribe to |
| `order:updated` | ✅ | ✅ | ✅ | ❌ |
| `shipment:updated` | ✅ | ✅ | ✅ | ❌ |

Delivered through `sendToUsers` / `sendToCenter` — **addressed** delivery: no subscription is needed
(so a seller list that never subscribed still learns), and none can widen the audience. The three
order/shipment channel names are deliberately **not subscribable** (`isPublicChannel` removed).

### C — `shipment:updated` was undeliverable and unconditional

**Root causes.** (1) No client could receive it: the server allowlist has no `shipment:updated` entry.
(2) Both routes published it even for a no-op repeat. (3) A subtle third one: the FIRST parcel creation
returns `moved: false`, because `ensureShipmentForShipping` materialises the row directly in `created`
and `transitionShipment` then sees `currentStatus === targetStatus` — so a `moved`-only gate would have
suppressed the one real event.

**Fix.** Both parcel routes (`routes/seller-orders.ts`, `routes/center.ts`) publish after the commit and
only when `outcome.moved || outcome.created`; `ShipmentTransitionResult` gained `created: boolean`
(set only on the call that brought the parcel into existence). Payload: `{ orderId, shipmentId, from,
to }`. No state, transition table or ownership rule was touched — the seller route still re-checks
ownership under the order lock and still accepts no shipment id from the client.

**Deliberately NOT split into two events:** when the ORDER's own status route moves an order to
`shipped`, the parcel is created as a side effect of that one operator action. It publishes
`order:updated` only (plus one order notification), so one action never produces a duplicate event or a
second notification row about the same parcel.

### D — no notification ROWS for order lifecycles

**Root cause.** Only four paths inserted notifications (seller application, seller status, chat,
verification). `NotificationBell`'s `order/payment/shipping` icons had nothing to render, and customers
and sellers learned about fulfilment changes only by refreshing. `notifications` (schema read-only)
already existed, so nothing new was needed.

**Fix.** New `backend/lib/order-notifications.ts` — the ONE writer, reusing the existing table, the
existing endpoints and the existing per-user push:

| Business event | Row to | Type |
|---|---|---|
| order created | shop's seller | `order` |
| customer cancellation | shop's seller | `order` |
| status confirmed/packing/shipped/delivered/completed/cancelled | customer | `order`/`shipping` |
| paid / payment_failed / pending_payment / expired / refunded | customer | `payment` |
| parcel created/picked_up/in_transit/out_for_delivery/delivered/cancelled/lost | customer | `shipping` |

- **Row first, frame second:** `INSERT INTO notifications …` then
  `sendToUser(recipient, "", CHANNELS.NOTIFICATION_CREATED, …)`. The socket frame is only a nudge for
  the bell to re-read; it is never treated as proof that a row exists.
- **Consistent with the mutation:** every call site runs after the commit (post-transaction in the
  checkout, after the claim/`moved` gates everywhere else), so a rolled-back order leaves no
  notification.
- **Idempotency:** the existing guards are the boundary — `createdOrders.length > 0` (a replayed
  `requestId` writes nothing), `moved === true` on state transitions, `moved || created` on parcels,
  the sweep's atomic claim. No new unique index or column was added (none is needed, and none was
  allowed in this phase).
- **Never fatal:** every write is wrapped; a notification failure logs and returns, so a committed sale
  can never fail because of it.
- **Ownership on read/update:** verified unchanged and pinned by a test — list `WHERE user_id = $1`,
  mark-one `WHERE id = $1 AND user_id = $2` (404 otherwise), read-all `WHERE user_id = $1`.

### E — private admin channels were effectively public

**Root cause.** The subscription allowlist was name-only: `audit:created`, `config:updated`,
`product:updated`, `seller:updated`, `inventory:updated`, `notification:created` (and the order channels)
were granted to ANY connection, including an unauthenticated one, with no role lookup anywhere near the
socket (the JWT carries no role, and `users.role` was never read).

**Fix.** In `backend/realtime/index.ts`:

- The connection's role is read from the DATABASE at handshake (`roleOf` from `lib/permissions.ts`) and
  re-read by the existing 30 s sweep, which also **drops** the center channels from a connection whose
  role no longer qualifies. A client frame can never set it (`msg.role` appears nowhere).
- A subscribe frame `await`s the handshake lookup (`roleReady`) so authorization cannot race it — a race
  would have denied the whole VelCenter console.
- Allowed = own `user:{userId}` channel, or an authenticated-only self channel (`cart:updated`,
  `profile:updated`), or a private VelCenter channel **and** `isCenterRole(client.role)`
  (`owner|admin|staff`, the same list `lib/permissions.ts` uses). Everything else answers
  `{type:"error", code:"FORBIDDEN"}`. An anonymous socket now holds **no** channel, and
  `inventory:updated` (a cross-shop fact) is center-only rather than public.
- Delivery: `sendToUsers` (every live connection of the named users) and `sendToCenter` (connections
  whose server-resolved role is a center role) — neither honours a subscription, so delivery cannot be
  widened by a frame.
- Phase 2A architecture preserved: still exactly ONE browser `WebSocket` (in `chat-socket.ts`, owned by
  `RealtimeProvider`), same backoff/jitter, same `subscribeAll()` resubscription, same
  refetch-on-reconnect. VelCenter dropped its now-unnecessary `order:updated` subscription and gained
  `shipment:updated` in its existing event fan-out (nothing else in the console changed).

## 3. Files changed

**Code commit `38662de` (16 files, +1551/−119):** `backend/lib/order-events.ts` **(new)**,
`backend/lib/order-notifications.ts` **(new)**, `backend/realtime/index.ts`, `backend/lib/order-shipment.ts`,
`backend/routes/cart.ts`, `backend/routes/center.ts`, `backend/routes/seller-orders.ts`,
`backend/routes/stripe.ts`, `backend/jobs/payment-reservation-scheduler.ts`,
`apps/velcenter/src/pages/Center.tsx`, `packages/shared/src/lib/chat-socket.ts` (documentation of the
authorization contract only), `backend/tests/realtime-commerce-phase2c.test.ts` **(new)**,
`backend/tests/center-rbac.test.ts`, `backend/tests/center-seller-state-sync.test.ts`,
`backend/tests/customer-order-cancel.test.ts`, `backend/tests/staff-must-change-password.test.ts`.
**Deleted: none. Moved: none.**

**Docs commit:** `.ai/history/2026-10-27-realtime-commerce-phase-2c.md` (this file),
`.ai/AI_HANDOFF.md` (§82 + §80/§81 → pointers), `.ai/history/AI_Handoff_Archive.md` (index row),
`.ai/history/archive/AI_Handoff-2026-10-27-sections-80-81.md` **(new)**, `.ai/context/realtime.md`,
`docs/REALTIME.md`.

## 4. Systems affected / explicitly unaffected

**Affected:** order/shipment realtime delivery (addressed), the WebSocket subscription decision, the
checkout-order announcement, order/payment/shipment notification rows, VelCenter's event fan-out, and
the tests that pinned the old broadcast strings.

**Explicitly UNCHANGED (verified by diff):** `db/schema.sql`, `db/run-sqleditor.sql`, every other SQL
file (no DDL/DML anywhere, no SQL written at all); order/shipment state machines and transition tables;
inventory reservation/release authority; payment-deadline and reservation-expiry rules; refund rules;
order/payment idempotency (`checkout_requests`, payment attempts); Stripe pricing, session creation,
webhook signature/verification and settlement logic (`routes/stripe.ts` differs only in the
broadcast→`publishOrderEvent` + notification calls); cart/Buy Now/pagination from Phase 2B; R2/media;
authentication and the JWT/revocation path; the Phase 2A single-client transport; chat REST contracts;
the notification UI. No VelRepeat reference, no new dependency, no new endpoint, no second event bus.

## 5. Checks actually run (real results)

| Check | Command | Result |
|---|---|---|
| Four app typechecks | `bun run typecheck` | **PASS** — velshop / velseller / velcenter / velnox all exit 0 |
| Backend typecheck | `cd backend && bun run typecheck` | **PASS** — exit 0 |
| App builds | `bun run build:apps` | **PASS** — 4/4 (`✓ built` per app, exit 0) |
| i18n parity | `bun run i18n:check` | **PASS** — `th=1257 en=1257 my=1257` (unchanged; no UI copy added) |
| Backend suite | `cd backend && bun test tests` | **PASS** — **1015 pass / 321 skip / 0 fail** (1336 tests, 65 files). Baseline before this change: 992 pass / 313 skip / 0 fail (1305 tests, 64 files) |
| New Phase 2C suite | `cd backend && bun test tests/realtime-commerce-phase2c.test.ts` | **PASS** — 23 pass / 0 fail / 8 skip (the 8 are the DB-gated cases) |
| Whitespace | `git diff --check` | **clean** |

**Live WebSocket evidence (no database needed, and it really ran):** the anonymous-socket cases start a
real HTTP server, mount the real `setupWebSocket` on `/ws`, connect real `ws` clients and assert that
`audit:created`, `config:updated`, `notification:created`, `product:updated`, `order:created`,
`order:updated`, `shipment:updated`, `cart:updated` and a foreign `user:{id}` all answer
`{type:"error", code:"FORBIDDEN"}`. This is a real handshake + real frames, not source reading.

## 6. Tests NOT RUN / SKIPPED (honest)

- **SKIPPED — the 8 DB-gated cases** in `backend/tests/realtime-commerce-phase2c.test.ts`: owner vs
  customer subscription authorization, addressed `order:created` recipients (customer + seller +
  VelCenter, stranger gets nothing), replay produces one order/one event/one row, a FAILED checkout
  emits nothing and writes no row, `order:updated` on customer cancel (and no second event on a repeat),
  and `shipment:updated` once per real parcel move (repeat included). Reason: **no safe
  `TEST_DATABASE_URL` in this workspace** — the image has no PostgreSQL server, no Docker/Podman, and
  `backend/db/test-database.ts` refuses anything that looks like production. No production credential
  was read, requested or used. CI (`.github/workflows/test.yml`) bootstraps a disposable `postgres:16`
  with `db/run-sqleditor.sql` and runs exactly these tests; **that run has not happened for this commit
  yet** — treat the 8 cases as written-but-unexecuted until CI is green.
- **NOT RUN — browser / E2E.** No browser-driving capability in this workspace: the VelCenter console
  reacting to an addressed `shipment:updated`, the bell badge after a notification row, and the visual
  pass are **not** verified. Code inspection and the socket-level tests do not prove browser behaviour.
- **NOT RUN — a live authenticated handshake against a running API** (no `JWT_SECRET`-signed session
  against a deployed backend here); the role path is covered by the DB-gated cases above.

## 7. Unresolved risks and next steps

1. **Crash window between COMMIT and publish.** No outbox drain worker exists; the signal can be lost
   (consumers refetch on reconnect, so state is never wrong). Next step: an owner-approved drain worker
   over the EXISTING `outbox_events` table (writer + claim + retry), which is a new background job —
   deliberately out of Phase 2C's scope and not started.
2. **Role staleness up to one sweep window (30 s).** A center role revoked in the database keeps its
   private channels for at most 30 s; the subscriptions themselves are dropped when the refresh lands.
   Shortening the window means more queries; a targeted "role changed" push is the cleaner fix.
3. **A `staff` member without `audit.view` still receives the `audit:created` *signal*** (payload is
   `{ action, entityType }`, no details) because channel authorization is role-based, not
   permission-based. The API behind it stays `audit.view`-gated, so nothing private is exposed;
   per-permission channels would be the refinement.
4. **Admins receive addressed order events on every page**, not only the orders tab (that is the
   intended "entitled consumer" behaviour, and the handler is a cheap refetch signal).
5. **Seller/customer unread badge + chat/support fundamentals remain open** (Phase 2D scope), as does the
   responsive/visual matrix; the corporate domain default question (`velnox.com` vs `velnx.com`) is still
   UNVERIFIED and untouched.

**Schema/SQL changes proposed: NONE.** Nothing in this phase needed a table, column, index or
constraint: the notification table, the per-user channel and the outbox table already existed. The only
additive contract change is non-schema: `ShipmentTransitionResult.created` (a TypeScript field).

## 8. What the next agent must know first

- Order-scoped events are **addressed**, not channels: publish through
  `backend/lib/order-events.ts#publishOrderEvent` (never `broadcast`), after the commit, only for a real
  change — and write notification rows through `backend/lib/order-notifications.ts` (row first).
- The three order/shipment channel names are intentionally **not subscribable**; if a new consumer needs
  one, add it to `sendToUsers`/`sendToCenter` recipients (server-resolved) instead of re-opening a
  channel.
- Private channels are authorized from `users.role` at connect + every 30 s; a new channel must be
  classified (own / self / center) in `backend/realtime/index.ts` or it is denied by default.
- The 8 DB-gated cases must be confirmed by a real `TEST_DATABASE_URL` run (CI) before this phase is
  called end-to-end verified.
