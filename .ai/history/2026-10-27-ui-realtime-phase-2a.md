# Velnox — Phase 2A: Stability + Realtime Foundation

**Date:** 2026-10-27 (UTC)
**Agent:** Buffy (Codebuff)
**Branch:** `main`
**Base SHA:** `4908d7d34eb7052fcedc6d98fa49f4aee0eb0204` (`main` == `origin/main`, 0/0, clean tree)
**Commit SHA after:** `af302883984d695a52dd697d15875ade2652581e` (pushed; local `main` == `origin/main`; its SHA is recorded in the follow-up `docs(ai)` commit)
**Purpose:** implement the stability / realtime-transport / critical navigation items from the Phase 1
UI/UX + Realtime Professional Audit ([`2026-10-26-ui-realtime-professional-audit.md`](./2026-10-26-ui-realtime-professional-audit.md)) —
still no schema change, no production DB, no Stripe, no support redesign.

> **SOURCE CODE MODIFIED: YES**
> **DATABASE MODIFIED: NO**
> **SQL MODIFIED: NO**
> **PRODUCTION DB CONNECTED: NO**

---

## 1. Pre-change inspection

1. `git fetch origin` → `main` == `origin/main` == `4908d7d…`; working tree clean; fast-forward relationship.
2. Read `AGENTS.md`, `.ai/AI_RULES.md`, `.ai/README.md`, `.ai/AI_HANDOFF.md`, `.ai/context/project-map.md`,
   `frontend.md`, `realtime.md`, `testing.md`, `workflow.md`.
3. Re-read the Phase 1 audit (all 606 lines, §4–§8) — the implementation order and evidence.
4. Inspected the actual implementation before editing: `chat-socket.ts`, `backend/realtime/index.ts`,
   `Center.tsx` socket effect, both notification bells, `ShopChat`, `SellerChat`, `MyOrders`,
   `SellerOrders`, `Income`, `ShopNotifications`, `ShopCart`, `lib/cart.tsx`, `AppHeader`,
   `MobileTabBar`, `index.css` (`.site-app`), `sites.ts` (`apiUrl` is origin-only), app entries.
5. Confirmed `chat-socket` was the only place that constructed a browser WebSocket, and that the
   VelCenter inline client was a second, broken implementation (`<origin>` without `/ws`).

---

## 2. What changed, and why

### 2.1 ONE realtime client, ONE owner

| File | Change | Reason |
|---|---|---|
| `packages/shared/src/lib/chat-socket.ts` | Rewritten around an explicit state machine (`idle/connecting/open/reconnecting/closed`), ref-counted public-channel subscriptions (`subscribeChatChannel`), re-subscribe on every open, exponential backoff **with ±30% jitter** (1 s → 30 s, 500 ms floor), `onChatSocketState`, `onChatReconnect`, `onAnyChatEvent`, guarded `send`, and a guard so a deliberate close cannot schedule a duplicate reconnect. | Phase 2A §4/§5: robust reconnection, no duplicate sockets/timers/subscriptions, no reconnect storm. Previously a page could close the transport and no consumer was told when it came back. |
| `packages/shared/src/components/RealtimeProvider.tsx` **(new)** | App-root owner: connects while authenticated, disconnects only on sign-out. Renders nothing. | Chat pages used to call `disconnectChatSocket()` on unmount, killing the always-mounted header bell's notifications until reload (P1 UI-04). Connection ownership is now explicit. |
| `packages/shared/src/hooks/use-realtime-state.ts` **(new)** | `useRealtimeState()` — reactive state for the UI. | "Connected" must only be shown for a genuinely OPEN socket. |
| `apps/velshop/src/main.tsx`, `apps/velseller/src/main.tsx`, `apps/velcenter/src/main.tsx` | Mount `<RealtimeProvider />` at the app root. Seller root also gets `site-app--tabbar-lg`. | One socket per app, owned by the root. VelCenter previously had its own client; VelNox corporate has no realtime surface and was not touched. |

### 2.2 VelCenter WebSocket

| File | Change | Reason |
|---|---|---|
| `apps/velcenter/src/pages/Center.tsx` | Deleted the inline `new WebSocket(wsUrl)` + fixed 5 s retry loop. The page now `connectChatSocket(user.id)`, subscribes with `subscribeChatChannel(...)` to the same six channels, handles events via `onAnyChatEvent` (same fan-out), and re-reads every queue on `onChatReconnect`. Adds a subtle "กำลังเชื่อมต่อเรียลไทม์ใหม่…" pill while the socket is not open. | The old URL omitted `/ws`, so the handshake was refused (HTTP 400 / close 1006) and every "live" queue badge was manual-refresh only. Task §3/§4 forbid a second socket implementation. |

### 2.3 Chat pages no longer own the transport

| File | Change | Reason |
|---|---|---|
| `apps/velshop/src/pages/ShopChat.tsx` | Removed `disconnectChatSocket()` from unmount; on `onChatReconnect` re-reads the conversation list and the active thread; renders a real error + retry when the list load fails; connection chip (Connected / Reconnecting…). | Leaving chat silenced notifications (P1 UI-04); a failed list load left the skeleton forever (P1 UI-06). |
| `apps/velseller/src/pages/SellerChat.tsx` | Same changes. | Same defects on the seller surface. |

### 2.4 Backend transport hardening

| File | Change | Reason |
|---|---|---|
| `backend/realtime/index.ts` | Presence (`viewingConversation`) is now cleared when a user's **last** socket closes/terminates; 30 s server ping with a missed-pong `terminate()`; `broadcast`/`sendToUser` guard each `ws.send`. | A closed tab never sends `chat:viewingEnd`, so a user stayed "viewing" a thread forever and every future notification for it was suppressed (P1 UI-09). There was no heartbeat, so a proxy-dropped connection could look open indefinitely. |

### 2.5 Seller navigation (P0 + tablet P1)

| File | Change | Reason |
|---|---|---|
| `packages/shared/src/components/AppHeader.tsx` | Chat action (`MessageCircle`, `aria-label="แชท"`, active state) shown below `lg`, next to the bell; header nav remains `lg:`-only. | VelSeller mobile had **no** chat entry (P0 UI-01). The tab bar stays at five tabs (Goals · Shop · Orders · Income · Profile) so no label is cramped at 320 px — the audit's own recommended "primary navigation + chat icon" option. |
| `packages/shared/src/components/MobileTabBar.tsx` | New `until?: "md" \| "lg"` prop (default `"md"`); seller passes `until="lg"`. | At 768–1023 px the bar hid at `md` while the header nav only appeared at `lg` → no navigation at all (P1 UI-02). |
| `packages/shared/src/index.css` | `.site-app--tabbar-lg` reserves the bar's height from 768–1023 px. | The bar is fixed; without the reservation it would cover page content in that band. VelShop/VelCenter keep the original `<md` rule. |
| `apps/velseller/src/main.tsx` | `SELLER_TABS` unchanged (5), `until="lg"`, root class `site-app--tabbar-lg`. | Same as above. |

### 2.6 Notification panels on phones

| File | Change | Reason |
|---|---|---|
| `apps/velshop/src/components/shop/NotificationBell.tsx` | Panel is `fixed inset-x-3` under the header below `sm` (viewport-gutter sheet) and the anchored `sm:absolute sm:right-0` popover above `sm`; a failed load keeps the last good list and renders error + retry instead of "all caught up"; refetch on reconnect; never closes the socket. | At 320/375 px the `absolute right-0` panel started ≈80 px off-screen (P1 UI-05); a failed fetch rendered as an empty inbox. |
| `packages/shared/src/components/SellerNotificationBell.tsx` | Same panel treatment (≈36 px overflow at 320/375 px), same failure handling, reconnect refetch. | Same defects; the seller variant was already careful never to close the socket. |

### 2.7 API failure ≠ empty state

| File | Change | Reason |
|---|---|---|
| `apps/velshop/src/pages/MyOrders.tsx` | `error` state + full error panel with retry; stale list kept with a non-blocking banner when a refresh fails. | A failed load rendered "ยังไม่มีออเดอร์" (false fact, no retry). |
| `apps/velseller/src/pages/SellerOrders.tsx` | Same; the existing `requestFilter` race guard is preserved and errors are also filter-guarded. | Failure looked like an empty order list. |
| `apps/velseller/src/pages/Income.tsx` | `loading` + `error` + retry; no more infinite spinner. | `report` stayed `null` forever on failure. |
| `apps/velshop/src/pages/ShopNotifications.tsx` | `error` state + retry; no `setItems([])` on failure. | Failure looked like "all caught up". |
| `apps/velshop/src/pages/ShopChat.tsx` | Conversation-list error panel with retry. | The error flag existed but was never rendered. |
| `apps/velshop/src/pages/ShopCart.tsx` + `apps/velshop/src/lib/cart.tsx` | The cart provider's existing `error`/`reload` are now consumed: error panel when the cart failed and nothing is cached, banner when a refresh fails with lines on screen; the provider clears the previous error when a retry starts. | A failed cart load looked like an empty cart. |

### 2.8 Text / i18n

- `realtime.connected` + `realtime.reconnecting` added to **th / en / my** (2 keys per locale).
- `bun run i18n:check` → **1251 / 1251 / 1251**, parity PASS (was 1249).

### 2.9 Tests updated to the new invariant

| File | Change | Reason |
|---|---|---|
| `backend/tests/center-seller-state-sync.test.ts` | The VelCenter block now asserts **zero** `new WebSocket(` under `apps/velcenter/src`, shared-client subscriptions, `onAnyChatEvent` and `onChatReconnect` instead of the removed inline client. | The old assertion enforced the two-socket architecture the task removes. Intent (one transport, events are signals) is unchanged and stronger. |
| `backend/tests/center-rbac.test.ts` | `channel: "…"` / `msg.type === …` assertions updated to `subscribeChatChannel("…")` / `type === …`. | Same reason. |
| `backend/tests/seller-access-authorization.test.ts` | Tab-bar render string now `<MobileTabBar items={SELLER_TABS} until="lg" />`. | Same gate invariant (exactly one render, after the guard); the breakpoint argument changed. |

**No files were deleted. No file was moved.**

---

## 3. Systems affected / unaffected

**Affected:** browser realtime transport and its ownership; VelCenter live queues; VelSeller navigation
(phone + tablet); both notification panels and their loading states; six failure-state surfaces;
backend WebSocket presence + heartbeat; three architecture tests.

**Unaffected (verified by diff):** Stripe/payment routes and webhooks; order/inventory/refund/shipment
business logic; `db/schema.sql` / `db/run-sqleditor.sql`; database; authentication rules; VelNox
corporate site; chat REST contracts; notification table/endpoints; `order:updated` publishers.

---

## 4. Checks actually run

| Check | Command | Result |
|---|---|---|
| Four app typechecks | `bun run typecheck` | **PASS** (velshop, velseller, velcenter, velnox — all exit 0) |
| Backend typecheck | `cd backend && bun run typecheck` | **PASS** |
| App builds | `bun run build:apps` | **PASS** (4/4 production builds) |
| i18n parity | `bun run i18n:check` | **PASS** — `th=1251 en=1251 my=1251` |
| Backend tests | `cd backend && bun test tests` | **987 pass, 303 skip, 0 fail** (1,290 tests / 63 files) — skips are `TEST_DATABASE_URL`/JWT-gated integration groups; no database was connected |
| Whitespace | `git diff --check` | **PASS** (clean) |

**NOT RUN (honest limitations):**
- **Browser / viewport verification — NOT RUN.** No browser-driving capability in this workspace. The
  320/375/430 panel geometry and the 768/820/900/1024 navigation bands are static-geometry changes,
  not screenshot-confirmed.
- **Live WebSocket end-to-end — NOT RUN.** No running API + authenticated session here; the shared
  client was verified against the server's path/allowlist by source reading and the existing transport
  tests, not by a live handshake.
- **Production DB / Neon — NOT CONNECTED** (and must not be).
- No performance measurement was made.

---

## 5. Known limitations / remaining work

1. **Seller chat icon has no unread badge.** There is no seller unread-count endpoint; computing it
   would add a per-page call or a new endpoint (out of Phase 2A). The header bell still shows unread
   notifications, including chat.
2. **`order:created` has no publisher and `shipment:updated` has no consumer / is not in the server
   allowlist.** Left untouched deliberately (Phase 2C), per "do not add events just to look realtime".
3. **No transactional notification rows** for order/payment/shipment transitions yet (Phase 2C).
4. **VelCenter reconnect refetches all tabs at once.** Correct but potentially bursty on a flaky
   network; debouncing is future work.
5. **Presence has no TTL.** It is cleared on last-socket close/terminate, which covers tab close and
   network loss; a TTL remains a belt-and-braces improvement.
6. **Panel positioning relies on the header's blurred containing block.** Static geometry is correct;
   a visual pass at 320/375/430 is still required before calling it visually verified.
7. Chat scroll anchoring, failed-message retry, `client_id` idempotency, pagination, Buy Now quantity
   and cart-quantity serialization remain open (Phase 2B/2D) and were **not** touched.

---

## 6. Exact next recommended step

**Phase 2B — Broken UX from audit §8 (remaining):** Buy Now quantity (charge exactly the selected
quantity, stop mutating the cart), order-history pagination on all three lists, the VelCenter
bootstrap-claim `res.ok` guard, confirmation + per-row busy state for destructive VelCenter actions,
and the footer/marketing link corrections. Then Phase 2C realtime correctness (publish `order:created`,
consume `order:updated`/`shipment:updated`, transactional notification rows, private admin channels).

Do not start Phase 2B in this task — this report ends Phase 2A.
