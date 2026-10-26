# Velnox — UI/UX + Realtime Professional Audit (Phase 1)

**Date:** 2026-10-26 (UTC) · 2026-10-27 00:16 +07 (Asia/Bangkok)
**Agent:** Buffy (Codebuff)
**Phase:** 1 — AUDIT ONLY. No implementation, no schema change, no database connection.
**Base branch / SHA:** `main` · `f71dcfd2fe26c7c92d94eb2ef7d7418f1c82d4d1` (= `origin/main` at `git fetch`; working tree clean; fast-forward relationship confirmed both ways).
**Resulting commit:** `903501f4594e4d30d3918e579fe39b65c540ef9a` (audit report + handoff §79 + §69 archive; pushed and remote-verified).
**Scope:** `apps/velshop`, `apps/velseller`, `apps/velcenter`, `apps/velnox`, `backend` (routes, realtime, chat, notifications), `packages/shared`, `db/schema.sql` (read only).

> **SOURCE CODE MODIFIED: NO**
> **DATABASE MODIFIED: NO**
> **SQL MODIFIED: NO**
> **PRODUCTION DB CONNECTED: NO**

This report is the deliverable of Phase 1. No source, SQL, dependency or production file was changed. Only `.ai/` Markdown was written.

---

## 1. Executive summary

Velnox is **not** missing a realtime or chat system. The repository already contains a single WebSocket server, one shared browser socket, conversations, chat messages, notifications, seller chat, a VelShop chat UI and a reserved-shop support flow. The gap is **operational quality**: how those systems behave when a socket drops, when an API fails, on a phone, and for the support relationship the business now requires.

The VelShop storefront is the most mature surface: complete loading/empty/error states, a checkout with a true first-click-wins guard and server-owned payment deadlines, order detail that distinguishes 401/403 from 404, and full th/en/my parity (1,249 keys in each locale, `bun run i18n:check` = PASS). VelCenter is a serious internal console with permission-driven tabs and server-side authorization. The payment/order/inventory business logic is intact and was not touched.

The four highest-impact findings are:

1. **VelSeller's mobile navigation has no Chat entry** — the desktop header nav is `lg:` only and the mobile tab bar has no chat item. On a phone, a seller reaches the conversations page only when a chat notification happens to route them there (P0).
2. **VelCenter's realtime socket never connects.** It builds `ws(s)://<VITE_API_URL>` with no `/ws` path, while the server only accepts `/ws`; a local `ws` probe reproduced `400` / close `1006`. Every “live” queue badge in the company console is therefore manual-refresh only (P1).
3. **The shared chat socket is closed by the chat pages themselves** (`disconnectChatSocket()` on unmount), while the header notification bell stays mounted and never reconnects. Visiting /chat and leaving silently disables realtime notifications until a full reload (P1).
4. **Order, payment and shipment events have no customer or seller consumer, and no notification rows at all.** `order:updated` is broadcast in 18 places and consumed only by VelCenter (whose socket is broken); `shipment:updated` has two publishers and zero consumers; no code inserts an order/payment/shipping notification. Customers and sellers learn about fulfilment changes only by refreshing (P1).

Support is currently a **reserved shop** (`velnox-support`) owned by an approved seller account, not a support desk. Customer → support works end-to-end. Seller → support has no UI. VelCenter cannot act as support at all: `CENTER_ROLES` excludes the `support` role and no admin chat endpoint exists. A real staffed support inbox needs an explicit product decision and a **SCHEMA CHANGE** (`chat_messages.sender_role` is `customer | seller` only; no assignment/priority columns).

Overall verdict: **functional foundation, production-grade interaction quality not yet reached.** The implementation order in §8 fixes stability and broken navigation before any cosmetic work.

---

## 2. Method and evidence

### Inspected

- All four app routers and page inventories (`apps/*/src/main.tsx`).
- Shared shell: `AppHeader`, `MobileTabBar`, `RequireAuth`, `RequireRole`, `chat-socket`, `app-shell`, i18n provider.
- VelShop: home, products, product detail, cart, checkout, orders, order detail, tracking, notifications, chat, addresses, profile, help, footer.
- VelSeller: goals dashboard, shop/product editor, orders, order detail, chat, income, reorder, profile.
- VelCenter: Center shell + tabs, order management, moderation, verification, staff, audit, settings, ship dialog.
- VelNox: layout, home, contact, content pages.
- Backend: `server.ts`, route registry, `routes/chat.ts`, `routes/orders` producers, `realtime/index.ts`, `middleware/rate-limit.ts`, `lib/permissions.ts`, `lib/seller-stats.ts`.
- Database **read-only**: `conversations`, `chat_messages`, `notifications`, `users.role` declarations in `db/schema.sql`.

### Executed checks

| Check | Command | Result |
|---|---|---|
| Git state | `git remote -v`, `fetch`, `status`, `rev-parse` | PASS — clean, HEAD == origin/main |
| i18n parity | `bun run i18n:check` | PASS — `th=1249 en=1249 my=1249` |
| WS path behaviour | local `ws` probe against `WebSocketServer({ path: "/ws" })` | CONFIRMED — `/` → HTTP 400 + close 1006; `/ws` → OPEN |
| Docs/code drift | `docs/REALTIME.md` vs `CHANNELS` | WARNING — documented channels do not match implementation |

### Not run (honest limitations)

- **No browser / viewport pass.** This workspace has no browser-driving tool. All responsive findings are static analysis plus geometry computed from the actual Tailwind classes; they are **not** screenshot-confirmed. The 320/375/430/768/1024/1440 visual matrix is therefore **NOT RUN**, not “passed”.
- **No authenticated end-to-end flow** (no account/cookie available), so chat send/receive was not exercised live.
- **No production database** was read or connected to. All DB statements here come from reading `db/schema.sql`.
- No backend build or test run was needed: no code changed.

---

## 3. Current UI strengths

These are real, source-verified qualities worth preserving.

1. **Checkout integrity is treated as product UX, not just backend logic.** `ShopCheckout` has a synchronous `submitRef` guard (“one press = one order”), a UUID request id that replays the same order on back/bfcache, an explicit payment-start error panel with retry, a server-computed reservation deadline, and no client redirect that could announce a completed purchase before payment exists (`apps/velshop/src/pages/ShopCheckout.tsx:194-233, 334-350`).
2. **Order detail tells the truth about failure.** 401/403 (“not yours”) and 404 (“does not exist”) render different copy and different actions; loading uses skeletons; a retry exists (`ShopOrderDetail.tsx:397-465`). Payment status is a separate badge from fulfilment status.
3. **Order history re-reads the API when the tab becomes visible and when a reservation lapses**, rather than trusting a client timer (`MyOrders.tsx:170-200`).
4. **Seller order filters are server-side and race-safe.** The newest request owns the list (`requestFilter` ref), so a slow “all” response cannot overwrite “shipped” (`SellerOrders.tsx:76-100`). Per-row publish/delete busy state prevents double actions (`MyShop.tsx:805-837`).
5. **VelCenter tabs are URL-driven** (`?tab=orders`) and permission-filtered, so views are deep-linkable and a hidden tab cannot be reached by guessing a URL (`Center.tsx:257-271`, tab list `976-1037`).
6. **Realtime transport is hardened at the server:** cookie-authenticated upgrade, revoked-token check plus a 30 s sweep closing `4001`, per-user private channel, public-channel allowlist, 4 KB frame cap, 120 frames/10 s cap, and a 30 msg/min chat-send rate limit (`backend/realtime/index.ts:47-171`, `middleware/rate-limit.ts:174`).
7. **Chat sends are optimistic and deduped by message id**, with read receipts and a presence signal that suppresses redundant notification rows (`ShopChat.tsx:105-150, 315-355`). Intent is right even where lifecycle is wrong (§5).
8. **Responsive structure exists below the breakpoints:** desktop tables become mobile cards (`Center.tsx:1246, 1424, 1840, 2022`), the bottom tab bar respects safe areas, mobile filter sheets have sticky Apply/Reset, and long product names use `truncate` + `overflow-wrap` (`ShopCart.tsx:270-278`).
9. **Accessibility basics are present in places:** `aria-label` on icon-only buttons, `aria-current` on the active tab, `aria-pressed` on filter chips, `aria-haspopup`/`aria-expanded` on the bell, Escape closes the notification panel, and a 44 px hit halo is documented for cart checkboxes (`MobileTabBar.tsx:60-70`, `NotificationBell.tsx:150-175`, `ShopCart.tsx:205-215`).
10. **i18n is enforced, not aspirational:** all three locales are at exact key parity by CI-able script, and `<html lang>` follows the selected language (`packages/shared/src/lib/i18n/index.tsx:103`).

---

## 4. UI problems

Severity: **P0** broken / data-loss / security / unusable · **P1** major UX · **P2** noticeable polish · **P3** minor polish.

### P0

#### UI-01 · P0 · VelSeller · mobile navigation
- **Page / component:** `apps/velseller/src/main.tsx` (`SELLER_TABS`), `packages/shared/src/components/AppHeader.tsx`.
- **Problem:** There is no navigation entry to chat on mobile. The seller tab bar is Goals · Shop · Orders · Income · Profile; the desktop header nav (which contains Chat and Smart Reorder) is `hidden … lg:flex`; the tab bar is `md:hidden`. Smart Reorder is also unreachable below `lg`. A chat notification can still route to `/seller/chat`, but the inbox itself is not reachable from the UI.
- **Why it feels unprofessional:** customer conversations are a core seller obligation; a phone-only seller simply cannot answer buyers. They only reach chat if a chat notification happens to route them there.
- **Evidence:** `main.tsx:21-28` (five tabs, no chat), `AppHeader.tsx:7-15` (`/seller/chat`, `/seller/reorder`), `AppHeader.tsx:27` (`lg:flex`), `MobileTabBar.tsx:47` (`md:hidden`).
- **Recommended fix:** put Chat in the seller mobile tab bar (6 items is too many — replace one, or add a header chat icon with unread badge at all widths). Add Reorder as a secondary action in the Shop page. Keep one nav system, not two.

### P1

#### UI-02 · P1 · VelSeller · tablet widths 768–1023 px
- **Page / component:** `AppHeader` + `MobileTabBar`.
- **Problem:** At 768–1023 px the bottom tab bar is hidden at `md` and the desktop nav only appears at `lg`. The header shows only the logo, bell and user menu — no Shop / Orders / Income / Chat links.
- **Why it feels unprofessional:** a tablet is a normal seller device; navigation disappears exactly at the width where the layout starts to look “desktop”.
- **Evidence:** `MobileTabBar.tsx:47` (`md:hidden`), `AppHeader.tsx:27` (`lg:flex`).
- **Fix:** align the breakpoints — either show the header nav at `md`, or keep the tab bar until `lg`; add a regression check at 768 and 1024.

#### UI-03 · P1 · VelCenter · realtime queues
- **Page / component:** `apps/velcenter/src/pages/Center.tsx` socket effect; `backend/server.ts`.
- **Problem:** VelCenter opens `new WebSocket(wsUrl)` where `wsUrl` is `VITE_API_URL` with `http→ws` only. The server mounts `WebSocketServer({ server, path: "/ws" })`. The handshake is refused with HTTP 400; the client reconnects every 5 s forever. All queue badges/audit refreshes that depend on this socket are dead.
- **Why it feels unprofessional:** a company console that claims live counters silently isn’t live; it also generates an endless 5 s retry loop.
- **Evidence:** `Center.tsx:429-431`, `backend/server.ts:448`; local `ws` probe: `CLIENT(/): ERROR Unexpected server response: 400` / `CLOSE 1006`, `CLIENT(/ws): OPEN`. `sites.ts:29-33` states `VITE_API_URL` is the origin only, so appending `/ws` to the env var would break every REST call instead.
- **Fix:** use the shared socket (or `apiUrl + "/ws"`); do not build a second client. Add exponential backoff with jitter and a refetch-on-open.

#### UI-04 · P1 · VelShop + VelSeller · shared socket lifecycle
- **Page / component:** `ShopChat`, `SellerChat`, `NotificationBell`, `chat-socket`.
- **Problem:** The chat pages call `disconnectChatSocket()` in their effect cleanup. The singleton is shared with the always-mounted notification bell and the seller-application hook, which do not reconnect when the chat page unmounts. Leaving `/chat` (or `/seller/chat`) therefore stops all realtime notifications until a full reload or another component that calls `connectChatSocket` mounts.
- **Why it feels unprofessional:** notifications and read receipts silently stop; there is no visible “disconnected” state, so the user assumes the marketplace is quiet.
- **Evidence:** `ShopChat.tsx:145`, `SellerChat.tsx:122`, `NotificationBell.tsx:89-95`, `chat-socket.ts:96-120` (global `manualClosed`, no reference count), `SellerNotificationBell.tsx:120-127` deliberately never closes because it knows the socket is shared.
- **Fix:** make connection ownership explicit — a provider at app root, or reference-counted `acquire/release`; never let a page tear down a shared transport. Add a connection-state indicator and refetch on reconnect.

#### UI-05 · P1 · VelShop + VelSeller · notification panel on phones
- **Page / component:** `NotificationBell`, `SellerNotificationBell`.
- **Problem:** The panel is `absolute right-0` inside the bell wrapper with `w-[min(360px,calc(100vw-1.5rem))]`. On a 320 px screen the bell’s right edge is ≈104 px from the viewport edge (language + bell + cart + profile), so the panel’s left edge is ≈−80 px. At 375 px it is still ≈−80 px; the seller variant is ≈−36 px (its bell is nearer the right edge).
- **Why it feels unprofessional:** the primary notification surface is cut off on the left; avatars and the start of every row are unreadable. It reads as a layout bug on the most common device class.
- **Evidence:** `NotificationBell.tsx:183`, `SellerNotificationBell.tsx:215`, header geometry in `ShopHeader.tsx:59-105` and `AppHeader.tsx:42-49`.
- **Fix:** render the panel in a portal as a fixed sheet on `<sm` (full-width, safe-area padding), and keep the anchored popover for `sm+`. Verify at 320/375/430.

#### UI-06 · P1 · VelShop + VelSeller · failure states
- **Page / component:** `MyOrders`, `ShopNotifications`, `SellerOrders`, `ShopChat`, cart provider, `Income`.
- **Problem:** API failures are commonly rendered as an empty or loading state instead of an error:
  - `MyOrders` logs the error, leaves `data=null`, then derives `orders = []` → “no orders yet” (`MyOrders.tsx:106-115`, empty state `~205`).
  - `ShopNotifications` does `setItems([])` on failure → “all caught up” (`ShopNotifications.tsx:51-59`).
  - `SellerOrders` only `console.error`s; `loading` becomes false and the list is empty (`SellerOrders.tsx:96`).
  - `ShopChat` sets `error` but never renders it, so a failed list load leaves the skeleton forever (`ShopChat.tsx:84, 94-97`).
  - The cart provider records `cartError` (`lib/cart.tsx:170`) but `ShopCart` never reads it (`ShopCart.tsx:66`) → a failed cart load looks like an empty cart.
  - `Income` leaves `report=null` on failure → an infinite spinner (`Income.tsx:64-70, 90-95`).
- **Why it feels unprofessional:** the user is told a false fact (“you have no orders / no notifications / empty cart”) or is shown a spinner forever. There is no retry path, so the only recovery is a reload.
- **Evidence:** paths above.
- **Fix:** one shared pattern — `loading | ready | empty | error` with a retry that re-runs the same loader. Never convert an error into an empty array. Keep the last good data visible when a refresh fails, with a non-blocking error banner.

#### UI-07 · P1 · VelShop + VelSeller · chat scroll behaviour
- **Page / component:** `ShopChat`, `SellerChat`.
- **Problem:** A single effect sets `scrollTop = scrollHeight` whenever `messages.length` or the active id changes. Loading 30 older messages prepends them and immediately jumps to the bottom; an incoming message also yanks the user away from history.
- **Why it feels unprofessional:** reading earlier context is impossible once a page of history loads; it is the classic “chat fights the reader” bug.
- **Evidence:** `ShopChat.tsx:149-154`, `loadOlder` `289-312`; `SellerChat.tsx:126-130, 167-190`.
- **Fix:** preserve the scroll anchor when prepending (`scrollHeight` delta), and only auto-scroll on a new message when the user is within ~80 px of the bottom (plus a “new messages” pill otherwise).

#### UI-08 · P1 · VelShop + VelSeller · failed message send
- **Page / component:** chat composer.
- **Problem:** On send failure the optimistic bubble is removed and a toast is shown. There is no failed state, no retry, and the typed text is already cleared.
- **Why it feels unprofessional:** a network blip silently loses the message the user wrote; they must retype it from memory.
- **Evidence:** `ShopChat.tsx:310-338`, `SellerChat.tsx:187-215` (same pattern).
- **Fix:** keep the bubble with `status="failed"` + a retry button; do not clear the draft until the server confirms (or restore it on failure).

#### UI-09 · P1 · VelShop + VelSeller · stale chat presence
- **Page / component:** `backend/realtime/index.ts` presence map.
- **Problem:** `viewingConversation` is set on `chat:viewing` and cleared only by an explicit `chat:viewingEnd` or another conversation. Browser/tab close does not send the end frame and `ws.on("close")` deletes the client but **not** the map entry. The user is then treated as “viewing” that conversation forever, so `notifyUser` is suppressed for it: every future message produces no notification row.
- **Why it feels unprofessional:** messages arrive, but the notification feed never records them; the user misses conversations with no error anywhere.
- **Evidence:** `realtime/index.ts:28, 150-163, 165-168, 214-219`; `ShopChat.tsx:220-236` only sends the end frame on in-app navigation/unmount.
- **Fix:** delete presence on socket close/disconnect, add a `pagehide`/`visibilitychange` best-effort end frame, and give the map a short TTL. Presence must be ephemeral by construction.

#### UI-10 · P1 · VelShop + VelSeller · transactional notifications
- **Page / component:** notifications backend + both bells.
- **Problem:** Only four code paths insert notifications: seller application submitted, seller status changed, chat message, and verification. There is no notification for a new order (seller), payment success/failure (customer), shipment created/status changed (customer), refund, or cancellation. The bell’s `order/payment/shipping/refund` icons are unreachable in practice.
- **Why it feels unprofessional:** a marketplace where “your order shipped” never appears in the bell is not trustworthy; sellers must poll the orders page to discover new sales.
- **Evidence:** `rg "INSERT INTO notifications" backend --glob '!**/tests/**'` → `seller.ts:330`, `seller.ts:1114`, `chat.ts:218`, `verification.ts:883` only; `NotificationBell.tsx:33-44` defines icons for types nothing produces.
- **Fix:** add notification rows inside the existing order/shipment/payment transitions (after commit, non-fatal, as `seller.ts:327` already does). No new table, no new queue. Emit the corresponding realtime event to the affected user.

#### UI-11 · P1 · VelShop + VelSeller + VelCenter · history truncation
- **Page / component:** My Orders, Seller Orders, VelCenter Orders.
- **Problem:** Each page requests a fixed slice and offers no pagination: customer 50, seller 50, center 100. There is no “load more”, page control or pagination metadata rendered. Orders beyond the slice are invisible in the UI.
- **Why it feels unprofessional:** long-time customers cannot open older orders; busy sellers lose access to older sales; the company console silently hides order 101+.
- **Evidence:** `MyOrders.tsx:93, 102, 108`; `SellerOrders.tsx:82, 91`; `Center.tsx:704`.
- **Fix:** use the existing `pagination` payload and add “load more” (or page controls) with the same server-side filters. Keep the current request-race guard.

#### UI-12 · P1 · VelShop · Buy Now quantity
- **Page / component:** product detail → checkout.
- **Problem:** Buy Now adds the selected quantity to the cart and passes `buyNowQty`, but checkout filters cart lines and never applies that quantity. If the item was already in the cart, the customer checks out `existing + selected`, not the quantity they chose; Buy Now also silently mutates the cart.
- **Why it feels unprofessional:** a direct-purchase action charges a different quantity than the one on screen — a money-trust bug.
- **Evidence:** `ShopProductDetail.tsx:946-960` (`add(..., sheetQty)` + `buyNowQty`), `ShopCheckout.tsx:159-166` (type declares `buyNowQty`) and `255-266` (filter only), `rg buyNowQty` → only producers, no consumer.
- **Fix:** build the checkout line from the Buy Now selection (product, variant, quantity) without adding to the cart, or apply `buyNowQty` when the line matches. Add a test for “cart already contains 2, Buy Now 1 → charge 1”.

#### UI-13 · P1 · VelShop · cart quantity reliability
- **Page / component:** cart page + cart provider.
- **Problem:** Every stepper click fires a PUT immediately; responses call `applyServer(items)` with whatever arrives last, so two rapid clicks can resolve out of order and snap the quantity back. The page’s busy state is set and cleared synchronously around a non-awaited `setQty`, so buttons are never actually disabled during the request.
- **Why it feels unprofessional:** quantity changes feel unreliable and “revert themselves”; there is no per-line pending state.
- **Evidence:** `ShopCart.tsx:132-136` (`setBusyId` → `setQty` → `setBusyId(null)`), `lib/cart.tsx:238-268` (fire-and-forget PUT, `then(applyServer)`), `applyServer` `~180`.
- **Fix:** serialize per line (or debounce ~300 ms), keep a per-line pending state until the response, ignore stale responses with a request sequence, and roll back on failure with a visible toast.

#### UI-14 · P1 · VelCenter · bootstrap owner claim
- **Page / component:** `RequireRole` center gate.
- **Problem:** The claim uses `await fetch(...)` with no `res.ok` check. A wrong bootstrap code (4xx) still shows the success toast; the gate does not refetch the user/owner state, so nothing changes until a manual reload.
- **Why it feels unprofessional:** the first-run owner flow reports success for a rejected code — the worst possible moment to lie.
- **Evidence:** `RequireRole.tsx:316-329` (no `res.ok`), success toast at `324`.
- **Fix:** check `res.ok`, parse the server error, show it, and on success refresh auth/owner status (`/api/auth/me` + bootstrap status) before leaving the gate.

#### UI-15 · P1 · VelCenter · destructive actions without a guard
- **Page / component:** Orders tab, People/Directory tab.
- **Problem:** Changing an order status is a single `Select` change; changing a user’s role (including `admin`/`owner`) is also a single `Select` change. Neither asks for confirmation, neither disables the row while the request is in flight, and neither updates optimistically — the control snaps back to the old value until `loadOrders`/`loadPeople` returns.
- **Why it feels unprofessional:** one stray tap can cancel an order or grant admin; the UI gives no “are you sure?” and no progress feedback.
- **Evidence:** `Center.tsx:770-790` (`handleOrderStatus`), `792-817` (`handleSetUserAccess`), selects at `1217-1230` and `1778-1890`.
- **Fix:** confirm irreversible transitions (`cancelled`, `refunded`, role escalation) with an AlertDialog that states the consequence; add per-row busy/disable and an optimistic value with rollback on failure. Keep server authz as the authority.

#### UI-16 · P1 · All apps · support is a shop account, not a support desk
- **Page / component:** `backend/routes/chat.ts`, VelCenter, VelSeller.
- **Problem:** Customer → Velnox Support exists and is clearly labelled. But support staff must log into **VelSeller** as the seeded `support@velnox.com` seller; VelCenter has no support inbox; `CENTER_ROLES` excludes `support`; sellers have no “contact Velnox” entry point; there is no assignment, priority, SLA or internal note. The support shop is also returned by the public `GET /api/shops`.
- **Why it feels unprofessional:** three business relationships are advertised, but only one is operable. Support is indistinguishable from a merchant, and a support agent shares a seller identity rather than a staff identity with audit.
- **Evidence:** `chat.ts:49-120` (reserved shop seed), `chat.ts:391-420` (customer support conversation), `permissions.ts:52` (`CENTER_ROLES`), `products.ts:2551-2561` (no support-slug exclusion); no `POST /api/seller/conversations` and no admin conversation route (`chat.ts`).
- **Fix (product decision first):** keep the reserved shop as the transport, add a VelSeller “Contact Velnox” entry (seller as `customer_id`), and add a VelCenter Support tab restricted to a real `support` staff role. Staff replies require `chat_messages.sender_role ∈ {customer,seller,support}` and assignment/priority fields → **SCHEMA CHANGE REQUIRED**. Until then, do not claim VelCenter can operate support.

#### UI-17 · P1 · VelSeller · language
- **Page / component:** whole app shell and pages.
- **Problem:** VelSeller is effectively Thai-only: 209 lines of Thai copy across 6 of 9 pages, the header nav labels are hardcoded Thai, and the app never wraps `LanguageProvider`. `useLanguage()` silently falls back to Thai, so shared components render Thai too. VelShop is fully trilingual; VelSeller is not.
- **Why it feels unprofessional:** the platform promises th/en/my, but a seller who chooses English gets a Thai dashboard, Thai errors and Thai notifications. This is the largest consistency gap between the two commercial surfaces.
- **Evidence:** `rg '\p{Thai}' apps/velseller` → 209 lines; `apps/velseller/src/main.tsx` has no `LanguageProvider` (only `apps/velshop/src/main.tsx:86`); `AppHeader.tsx:7-15`; `SellerGoals.tsx` copy.
- **Fix:** wrap VelSeller in `LanguageProvider` and migrate copy namespace by namespace (start with navigation, orders, income, chat). Backend notification titles are also Thai-only — store a type/code and localize on the client (no schema change needed beyond `data`).

#### UI-18 · P1 · VelShop · footer links
- **Page / component:** `ShopFooter`.
- **Problem:** “Seller login” points to `${SITE_URLS.velseller}/seller/login`, but VelSeller has no such route (auth is `/auth`). “Privacy” and “Terms” both point at the corporate **home**, not `/privacy` / `/terms`.
- **Why it feels unprofessional:** three dead/misleading links in the global footer — the most-clicked trust surface on a commerce site.
- **Evidence:** `ShopFooter.tsx:69`; `ShopFooter.tsx:85, 93`; `apps/velseller/src/main.tsx:139` (`/auth`); `apps/velnox/src/main.tsx:39-40`.
- **Fix:** point seller login at `${SITE_URLS.velseller}/auth` (or the real login route), and privacy/terms at `${SITE_URLS.corporate}/privacy` and `/terms`.

#### UI-19 · P1 · VelNox · marketing accuracy
- **Page / component:** Corporate home + news.
- **Problem:** The hero says sign-up uses an **email OTP** and no password. No OTP exists in the codebase (auth is Google OAuth plus a VelCenter member password). The News page is a “coming soon” list of launches that already happened.
- **Why it feels unprofessional:** a public company site describing a signup method that does not exist destroys trust before the first click; a “news” page that is only a placeholder reads as unfinished.
- **Evidence:** `CorporateHome.tsx:113`; `rg -i otp backend apps packages` → only this line; `apps/velnox/src/pages/corporate/content.ts:174-183`.
- **Fix:** replace the OTP claim with the real Google sign-in text; publish dated news items or remove the page from nav until there is content.

### P2

#### UI-20 · P2 · VelShop + VelSeller · chat pagination boundary
- **Page / component:** backend message loader.
- **Problem:** Keyset pagination uses `created_at < $before` only. Timestamps are not unique; messages sharing the boundary timestamp can be skipped or duplicated.
- **Why it feels unprofessional:** a missing message in a conversation is invisible and erodes trust in the history.
- **Evidence:** `chat.ts:140-148`; client sends `String(oldest.createdAt)` (`ShopChat.tsx:294`).
- **Fix:** keyset on `(created_at, id)` with a compound `before` token; keep dedupe as a safety net.

#### UI-21 · P2 · VelShop + VelSeller · chat send idempotency
- **Page / component:** composer + `POST …/messages`.
- **Problem:** `clientId` is generated and echoed but never stored or used for dedupe. A retry after a timeout inserts a second message. Two Enter presses in the same tick can also send twice because the guard reads React state (`sending`), not a ref.
- **Why it feels unprofessional:** duplicate messages after a flaky connection look like the app is broken.
- **Evidence:** `chat.ts:463-489` (clientId read/echo only), `chat_messages` has no `client_id` column (`db/schema.sql`), `ShopChat.tsx:310-334` (state-only guard).
- **Fix:** add a `client_id` with a unique index per conversation (SCHEMA CHANGE) or an in-memory short-lived dedupe; add a synchronous `sendingRef` guard now.

#### UI-22 · P2 · VelShop + VelSeller · chat UX gaps
- **Page / component:** chat pages.
- **Problem:** The composer is a single-line `<input>` (long text scrolls sideways), there are no date separators, no conversation search/filter, no attachment/image preview, no close/reopen, no assignment, and no “new messages” divider. The conversation `status` column (`active|archived`) exists but no route reads or writes it.
- **Why it feels unprofessional:** a marketplace chat with no search or history anchors feels like a prototype once a seller has 50 threads.
- **Evidence:** `ShopChat.tsx:553` (`input`), `SellerChat.tsx:397` same shape; `db/schema.sql` conversations `status`; `chat.ts` route list has no status/close endpoints.
- **Fix:** in order — textarea that grows, date separators, unread divider, conversation search; attachments after media policy; close/reopen only when the support workflow needs it.

#### UI-23 · P2 · VelShop + VelSeller · chat layout on short screens
- **Page / component:** chat page containers.
- **Problem:** The thread has `h-[calc(100dvh-220px)] min-h-[420px]` (seller `-260px` / `min-h-[460px]`). On a short phone with the keyboard open, the viewport can be <400 px, so the 420/460 px floor forces the composer below the visible area rather than keeping it above the keyboard.
- **Why it feels unprofessional:** the input disappears exactly when the user starts typing.
- **Evidence:** `ShopChat.tsx:435`, `SellerChat.tsx:301`; the back button is `ShopChat.tsx:448`.
- **Fix:** drop the hard `min-h` on mobile, use `h-[100dvh-…]` with `min-h-0`, and verify at 320×568 with the keyboard; consider `visualViewport` only if testing shows it is needed.

#### UI-24 · P2 · VelCenter · tab navigation
- **Page / component:** Center shell.
- **Problem:** Ten top-level tabs in one horizontally scrolling strip; no mobile bottom nav despite the comment mentioning one; the strip is not sticky, so it scrolls away. On a 320 px phone only two or three tabs are visible with no affordance that more exist.
- **Why it feels unprofessional:** Settings/Incidents are effectively hidden; operations staff on a phone hunt horizontally.
- **Evidence:** `Center.tsx:976-1037`; `grep MobileTabBar apps/velcenter` → none; comment at `257` says “mobile bottom nav” but no component renders.
- **Fix:** mobile: a “More” sheet (or bottom nav with 4 primary + More); desktop: keep the strip, make it sticky, and show overflow affordance.

#### UI-25 · P2 · VelCenter · dialogs on small screens
- **Page / component:** `GoalFormDialog`, `OrderShipDialog`, `ProgressDialog`.
- **Problem:** Dialog content has no `max-h`/`overflow-y`; a long form plus an on-screen keyboard can push the footer/actions out of the viewport.
- **Why it feels unprofessional:** the primary action becomes unreachable mid-entry.
- **Evidence:** `GoalFormDialog.tsx:134` (`sm:max-w-lg` only), `OrderShipDialog.tsx:131` (`sm:max-w-md` only); contrast `ProductFormDialog.tsx:882` (`max-h-[92vh] overflow-y-auto`) and `VerificationReviewDialog.tsx:295` (`max-h-[92dvh] … overflow-y-auto`).
- **Fix:** apply the same `max-h-[92dvh] overflow-y-auto` pattern and keep the footer sticky inside the dialog.

#### UI-26 · P2 · All apps · toast placement
- **Page / component:** `Toaster` + sticky headers.
- **Problem:** Toasts are `position="top-left"` at 12–16 px from the top, with a very high z-index. Every app has a `sticky top-0 z-40` header, so the first toast covers the logo/back control on mobile.
- **Why it feels unprofessional:** transient messages obscure navigation and look unplaced.
- **Evidence:** `packages/shared/src/components/ui/sonner.tsx:30-37`; sticky headers `ShopHeader.tsx:48`, `AppHeader.tsx:22`, `Center.tsx:926`.
- **Fix:** offset the toast below the header (`top: calc(4.5rem + safe-area)`), or use a bottom sheet above the tab bar on mobile.

#### UI-27 · P2 · All apps · accessibility and legibility
- **Page / component:** shared design system.
- **Problem:** 588 lines use `text-slate-400` (≈2.85:1 on white), 216 lines use 10–11 px text, 63 controls use `size-8` (32 px) below the 44 px touch target, and only 40 `focus-visible` overrides exist across ~1,000 TSX files. Chat has no `aria-live` region for incoming messages; the notification popover has `role="dialog"` but no focus trap.
- **Why it feels unprofessional:** metadata is hard to read outdoors/low-vision; 32 px steppers are easy to miss; keyboard users lose focus context.
- **Evidence:** counts via `rg`; examples `ShopCart.tsx:297, 310` (qty), `ShopChat.tsx:436-560` (thread), `NotificationBell.tsx:180-190`.
- **Fix:** raise metadata to `slate-500` and ≥12 px; make icon controls 40–44 px; add a visible focus ring by default; add `aria-live="polite"` to the thread and a focus trap to the bell dialog. Do it as a token pass, not page-by-page.

#### UI-28 · P2 · All apps · colour semantics
- **Page / component:** theme usage.
- **Problem:** Destructive/error states are split between `red-*` (38 uses) and `rose-*` (107 uses) although the theme names `--destructive: #dc2626`. The brand is both raw `[#10B981]` (280 uses) and `emerald-*` (136 uses), making a future theme change a find-and-replace.
- **Why it feels unprofessional:** the same meaning renders in two different reds on adjacent screens; the design system is not actually the source of truth.
- **Evidence:** counts via `rg`; tokens in `packages/shared/src/index.css:63-74`.
- **Fix:** pick one destructive scale, map it to `text-destructive`/`bg-destructive`, and replace raw emerald with the brand token in a single mechanical pass (verified by typecheck/build).

#### UI-29 · P2 · VelShop · notifications page behaviour
- **Page / component:** `ShopNotifications`.
- **Problem:** The page does not subscribe to `notification:created` (unlike the bell), so it does not update while open. Clicking a row only marks it read; unlike the bell, it does not navigate to the order/chat/product. The list is capped at 50 with no pagination.
- **Why it feels unprofessional:** the dedicated page is less capable than the dropdown, and a chat notification is a dead end.
- **Evidence:** `ShopNotifications.tsx:38-70` (no socket import), row click `handleRead` only, backend `chat.ts:252` `LIMIT 50`.
- **Fix:** reuse the bell’s destination mapping and realtime subscription; add pagination.

#### UI-30 · P2 · VelCenter + config · stale docs
- **Page / component:** `docs/REALTIME.md`.
- **Problem:** The doc lists `cart:updated`, `order:created`, `inventory:updated`, `profile:updated` as live and omits `chat:message`, `chat:read`, `shipment:updated`, `audit:created`, `config:updated`. Three of the listed channels have no publisher at all.
- **Why it feels unprofessional:** a new engineer implements against a document that describes a system that does not exist.
- **Evidence:** `docs/REALTIME.md` vs `backend/realtime/index.ts:221-247`; publisher sweep in §5.
- **Fix:** regenerate the table from `CHANNELS` and mark dead channels explicitly; add a test that every declared channel has at least one publisher or is documented as reserved.

#### UI-31 · P2 · VelNox · contact
- **Page / component:** `Contact`.
- **Problem:** The form is a `mailto:` handoff (documented) with no success state; Line/Facebook are “coming soon”; there is no server-side ticket, no SLA, no acknowledgement.
- **Why it feels unprofessional:** a company contact page that only opens the visitor’s mail client is a 2010 pattern; “coming soon” channels on a production site read as unfinished.
- **Evidence:** `Contact.tsx:66-80` (`action="mailto:…"`), `:18` (“เร็ว ๆ นี้”).
- **Fix:** wire the existing support conversation API as a real contact path (customer chat or a support ticket), or add a transactional email integration; remove “coming soon” until live.

#### UI-32 · P2 · VelSeller · financial display recomputes the fee
- **Page / component:** Income.
- **Problem:** The table computes `Math.round(subtotal * 0.03 * 100) / 100` in the browser instead of using the report’s `commission`/`commissionRate` fields. If the backend rate changes, the seller sees numbers that disagree with payouts.
- **Why it feels unprofessional:** money shown in the UI must come from the money system, not a duplicated constant.
- **Evidence:** `Income.tsx:208, 255` (`subtotal * 0.03`); backend `lib/seller-stats.ts:7, 30-43` returns `commission` and `commissionRate`.
- **Fix:** render the server-computed fee; delete the local 0.03.

#### UI-33 · P2 · VelShop · `window.confirm` and native affordances
- **Page / component:** review delete (`ShopProductDetail`), employee reset (`EmployeeManager`).
- **Problem:** Destructive confirmations use `window.confirm`, while the rest of the product uses themed `AlertDialog`. The native dialog is unstyled, blocks the tab, and is inconsistent on mobile/PWA.
- **Why it feels unprofessional:** the app visibly drops out of its design system at the moment of a destructive action.
- **Evidence:** `ShopProductDetail.tsx:433`, `EmployeeManager.tsx:209`.
- **Fix:** replace with the existing `AlertDialog` and a busy state.

### P3

#### UI-34 · P3 · All apps · generic route fallback
- **Problem:** Lazy route transitions render the literal text “Loading...”, the only such string in the product.
- **Why it feels unprofessional:** it is the most visible tell that a polished page is still a template, and it appears on every slow route.
- **Evidence:** `packages/shared/src/lib/app-shell.tsx:6-11`.
- **Fix:** skeleton matching the shell, or a brand spinner with no words.

#### UI-35 · P3 · VelShop + VelSeller · notification icon map
- **Problem:** `TYPE_ICONS` in the shop bell has no `chat` entry (falls back to a generic bell), and the seller bell uses a red unread badge while the shop uses emerald; the same system looks like two products.
- **Why it feels unprofessional:** chat notifications read as generic alerts, and the two bells disagree about what “unread” looks like.
- **Evidence:** `NotificationBell.tsx:33-44`; `SellerNotificationBell.tsx:195-200` (`bg-[#EF4444]`).
- **Fix:** share one type→icon map and one badge treatment.

#### UI-36 · P3 · VelSeller · dashboard landing
- **Problem:** The seller’s authenticated home is “Goals”, a Thai-only goal tracker with no loading/error treatment; revenue/orders (the operational reasons a seller opens the app) are one tab away, and `useQuery` renders 0s while loading.
- **Why it feels unprofessional:** the first screen after login answers a question most sellers did not ask, and “0” is shown before the data exists.
- **Evidence:** `main.tsx:69` redirects `/` → `/seller/goals`; `SellerGoals.tsx:27-48`.
- **Fix (product):** make the landing page an operational dashboard (new orders, unread chats, revenue) and keep goals as a section. At minimum add loading/error states.

#### UI-37 · P3 · VelNox / VelCenter · language switch
- **Problem:** Neither corporate nor center exposes a language switch; corporate is Thai-only, center is Thai-only, while the design system and i18n provider support three languages.
- **Why it feels unprofessional:** a platform that advertises th/en/my silently offers one language on two of its four surfaces; an international partner sees a Thai-only company site.
- **Evidence:** no `LanguageSwitcher` outside `apps/velshop`; `apps/velnox` / `apps/velcenter` main files.
- **Fix:** decide the supported language set per surface and state it; do not ship a switch that does nothing.

---

## 5. Realtime findings

### 5.1 Event and channel matrix

“Publisher” = code that calls `broadcast`/`sendToUser`. “Consumer” = code that subscribes/handles the event.

| Channel / event | Publisher | Consumer | Current behaviour | Problem | Recommendation |
|---|---|---|---|---|---|
| `chat:message` (user channel) | `chat.ts:479, 640` | `ShopChat`, `SellerChat` | Appends the message payload; marks read; bumps conversation unread | No refetch after reconnect; no idempotency; shared-socket teardown (UI-04); presence bug (UI-09) | Keep payload for speed, then reconcile on reconnect; add `clientId` dedupe; fix socket ownership |
| `chat:read` (user channel) | `chat.ts:522, 688` | `ShopChat`, `SellerChat` | Flips own messages to read | Not sent when the conversation is closed and reopened? (it is); no timestamp guard | Keep; include `readAt` from DB and ignore stale events |
| `notification:created` (targeted) | `chat.ts:222`, `verification.ts:893` | Both bells, `use-seller-application` | Bell refetches its list; seller app refetches status for `seller*` types | Shop bell has no polling fallback; a dropped socket hides events until remount | Add visibility/poll fallback to the shop bell (the seller bell already has 60 s) |
| `notification:created` (broadcast) | `center.ts:1290, 1329, 1368` (`employee:created/updated`) | VelCenter | Roster/directory tab refetches | Channel is **public** (no auth needed); payload leaks `userId`, `role`, `active` to any listener | Move employee events to an authenticated admin-only channel, or send per-user; never broadcast staff identifiers publicly |
| `order:updated` | `stripe.ts` ×12, `cart.ts` ×2, `center.ts`, `seller-orders.ts`, `payment-reservation-scheduler.ts` ×2 | **VelCenter only** (and its socket is broken) | Center refetches orders/audit | Customers and sellers get no live order state; Center is actually dead (UI-03) | Subscribe VelShop order pages and VelSeller orders to `order:updated` and refetch by id; fix Center path |
| `order:created` | **none** | VelCenter handler (`Center.tsx:462`) | Never emitted | New orders are invisible until manual refresh; no seller notification | Emit once per created order after commit; add seller notification row |
| `shipment:updated` | `center.ts:709`, `seller-orders.ts:747` | **none** | Always broadcast to an empty audience | Tracking/status changes never reach the customer or seller | Add to the allowlist and consume in order detail/tracking + seller order detail; refetch |
| `seller:updated` / `seller:status-changed` | `seller.ts:351`, `verification.ts:277, 916` | VelCenter | Refetches seller/verification queues | Path bug means it does not arrive; seller UI relies on `notification:created` | Fix Center socket; keep notification-based seller refresh |
| `verification:status-changed` | **none** | VelCenter handler (`Center.tsx:453`) | Dead branch | Misleads maintainers | Remove the handler or emit it (prefer keeping one event name) |
| `product:updated` / `product:moderated` | `products.ts:3784` | VelCenter | Refetches moderation + audit | Center socket broken | Fix path; debounce refetch |
| `audit:created` | `lib/audit-log.ts:81` | VelCenter | Audit tab refetch | Public channel leaks action/entity timing to unauthenticated listeners | Restrict to admin/authenticated channel |
| `config:updated` | `server.ts:120` | VelCenter | Categories/settings refetch | Center socket broken | Fix path |
| `cart:updated` | **none** | **none** | Dead constant + allowlist entry | Misleading inventory of features | Remove from allowlist/`CHANNELS` or implement; document as reserved |
| `inventory:updated` | **none** | **none** | Dead | Stock changes appear only on manual reload | Either emit on inventory mutations and refresh product detail/cart, or delete the constant |
| `profile:updated` | **none** | **none** | Dead, not even allowlisted | Dead code | Remove |

### 5.2 The 16 questions

1. **What WebSocket events exist?** `chat:message`, `chat:read`, `notification:created` (targeted + employee broadcasts), `order:updated`, `order:created` (declared, never sent), `shipment:updated`, `seller:status-changed`, `product:moderated` (on the `product:updated` channel), `audit:created`, `config:updated`; `cart:updated`, `inventory:updated`, `profile:updated` are declared but unused.
2. **Which backend systems publish?** `chat.ts` (chat/notifications), `stripe.ts`, `cart.ts`, `center.ts`, `seller-orders.ts`, `payment-reservation-scheduler.ts` (orders/shipments/employees), `verification.ts` + `seller.ts` (seller status), `products.ts` (moderation), `audit-log.ts` (audit), `server.ts` (config).
3. **Which frontend systems consume?** `chat-socket.ts` (chat read/message, notifications) in VelShop/VelSeller; `Center.tsx`’s own socket (product/seller/order/audit/config/notification); `use-seller-application` (seller notifications). Nothing else.
4. **Events with no publisher:** `order:created`, `verification:status-changed`, `cart:updated`, `inventory:updated`, `profile:updated`.
5. **Events with no consumer:** `shipment:updated`; `cart:updated`, `inventory:updated`, `profile:updated` (both none); `order:created` has a handler but no publisher; `order:updated` has no customer/seller consumer.
6. **Reconnect:** `chat-socket` retries with exponential backoff 1 s → 15 s, resets attempts on open, no jitter. VelCenter retries on a fixed 5 s timer. Neither re-reads state on reconnect.
7. **Authentication:** session cookie (`velnox_session`) verified at upgrade; revoked JTIs rejected and swept every 30 s with close code `4001`; a client may subscribe only to `user:{itself}` or the public allowlist. Public channels are readable without auth.
8. **Stale events:** no event id, version or sequence. Consumers either trust the payload (chat) or refetch (Center). There is no stale-event rejection; a delayed event can trigger an unnecessary refetch, which is harmless because the API is authoritative.
9. **Duplicate events:** chat dedupes appended messages by id; the conversation list increments unread on every event without dedupe; Center refetches once per event (idempotent data, noisy traffic). No server-side dedupe of sends (`clientId` ignored).
10. **Lost updates on reconnect:** yes. There is no replay, no cursor, no “refetch on open”; anything published while the socket was down is missed until a manual reload (or, for VelShop order history, a tab-visibility refetch).
11. **Do frontends refetch authoritative data after events?** Center yes (per tab); chat no (it appends the payload and only refetches on conversation open). Chat should reconcile after reconnect.
12. **Are notifications realtime?** Yes for chat and seller verification; no for order/payment/shipment (no rows and no events to the buyer/seller).
13. **Are order state updates realtime?** Published, but not consumed by the customer or seller UI; Center’s consumer is disconnected. Effectively no.
14. **Are inventory updates realtime?** No publisher, no consumer.
15. **Are seller status updates realtime?** Published; Center cannot receive them (path bug); sellers get a `notification:created` and refetch their application status. Partially realtime.
16. **Are chat messages realtime?** Yes when the socket is connected and the page is mounted; the shared-socket lifecycle bug and missing resync reduce reliability.

### 5.3 Transport-level observations

- **No heartbeat.** `setupWebSocket` never pings; an idle connection through Render/proxy layers can be dropped without either side noticing until the next event. Add a 25–30 s ping/pong and treat a missed pong as a close.
- **Two clients, two behaviours.** `chat-socket` is careful (backoff, dedupe handlers, subscription on open); VelCenter’s inline client is not (no `/ws`, no backoff, no auth, no dedupe, no cleanup beyond `ws.close`). This is a duplicate realtime system in the browser, which the architecture rule forbids.
- **Public channels carry private data.** `notification:created` (employee create/update), `audit:created` and `config:updated` are readable by any socket that subscribes, including unauthenticated ones. Employee IDs/roles and audit timing are not customer data, but they are internal.
- **Chat sends are rate-limited** (30/min) — good; there is no equivalent limiter on `POST /api/customer/conversations` (a user can create one per shop, bounded by shops) or on support conversation creation (idempotent).
- **No delivery guarantee.** `sendToUser` is best-effort; if the write throws (closed socket mid-iteration), the caller may see an exception. `broadcast` does not guard `ws.send` per client; a single bad socket can throw inside the loop.

---

## 6. Chat findings

### 6.1 Relationship support today

| Relationship | Current support | Authorization | Realtime | UI | Missing pieces | Recommendation |
|---|---|---|---|---|---|---|
| Customer ↔ Seller | **EXISTS** | Customer routes check `customer_id`; seller routes require an approved seller and check `seller_id` (`chat.ts:427-440, 543-560, 590-610`) | `chat:message` / `chat:read` targeted to the other user | VelShop conversation list + thread; VelSeller list + thread | Seller cannot initiate a conversation; no attachments; no search; mobile seller cannot reach chat (UI-01) | Keep transport; add seller entry point in VelSeller mobile nav; consider `POST /api/seller/conversations` only if product requires seller-initiated threads |
| Customer ↔ Velnox Support | **EXISTS via reserved shop** | `POST /api/customer/support/conversation` seeds/finds `velnox-support` shop; customer owns the conversation; support agent is the shop’s seller | Same chat events; notification to the support user | VelShop Support section + thread; Help CTA `/chat?support=1`; support agent uses VelSeller chat | No VelCenter inbox; no staff identity; no priority/assignment; support shop publicly listed; presence bug can suppress its notifications | Keep the reserved shop as transport; add a real support role/tab in Phase 2 (SCHEMA CHANGE), or explicitly accept a single shared seller account |
| Seller ↔ Velnox Support | **MISSING in UI** | The customer support endpoint only requires auth, so a seller user *could* create a conversation as `customer_id`; no route/UI surfaces it; SellerChat lists only `seller_id = my shop` | Would work if created | None | Entry point, labeling (support must distinguish seller from buyer), seller-side unread state | Add “Contact Velnox” in VelSeller that calls the same support endpoint; support inbox must show participant type |
| Support staff ↔ VelCenter | **MISSING** | `CENTER_ROLES` = owner/admin/staff; `support` is not a center role; no admin conversation endpoints | N/A | N/A | Role, endpoints, UI, audit, assignment | Decide: staff identity + admin chat API + support tab. **SCHEMA CHANGE REQUIRED** for `sender_role='support'` and assignment/priority |

### 6.2 Assessment of the reserved-shop design

**Why it exists.** It reuses `conversations`/`chat_messages` without a schema change, keeps customer↔seller untouched, and gives support a normal seller inbox with realtime and notifications (`chat.ts:49-55`). For a first release of “customer can reach a human”, this is a pragmatic choice.

**What works.** Get-or-create is idempotent (`ON CONFLICT (customer_id, shop_id)`), the conversation is labelled `isSupport`, VelShop separates it into its own section, the Help CTA deep-links correctly, and the support agent can reply with the existing seller chat.

**What does not work.**
- **Identity.** Support is a `users.role='support'` account that is also an approved seller. It is authenticated by Google as `support@velnox.com`; if that mailbox is not a real Google account, nobody can answer. There is no staff-level audit of who replied.
- **Operations.** No queue, priority, assignment, SLA, tags, internal notes, close/reopen or supervisor view. One shared inbox account means no accountability.
- **Access.** VelCenter staff cannot see or answer support, even though VelCenter is the operations app.
- **Seller → support.** Not surfaced at all.
- **Marketplace leakage.** `GET /api/shops` has no slug exclusion, so `velnox-support` is a public storefront (`/shops/velnox-support`) with no products.
- **Notification correctness.** The stale-presence bug (UI-09) can suppress support notifications permanently for an agent who once opened that thread.

**Should the design remain?** **Yes as transport, no as the final operating model.** Replacing `conversations` would duplicate a working system and violate the architecture rule. Keep the reserved shop for customer→support now; add a real staffed support surface in Phase 2. Do not create a second conversation table or a second chat API.

### 6.3 Chat UX matrix

| Capability | Status | Evidence / note |
|---|---|---|
| Conversation list | EXISTS | Both apps, sorted by `updated_at` |
| Unread count per row | EXISTS | `unreadCount` from SQL (`chat.ts:314, 555`) |
| Unread badge in global nav | PARTIAL | Bell only; no chat badge in header or tab bar |
| Last message | EXISTS | `last_message` preview |
| Timestamp | EXISTS | Relative time per row, time per message |
| Online / offline | NOT NEEDED (now) | Privacy/scale cost; presence is already partially tracked server-side |
| Last seen | NOT NEEDED (now) | Same |
| Typing indicator | NOT NEEDED (now) | Nice-to-have after fundamentals |
| Sending state | EXISTS | Optimistic temp bubble + spinner |
| Delivered state | NOT NEEDED | `sent` + `read` are sufficient for this product |
| Read state | EXISTS | `chat:read`, double-check icon |
| Failed message + retry | **MISSING** | Bubble is deleted (UI-08) |
| Reconnect + resync | PARTIAL | Backoff exists; no resync; teardown bug (UI-04) |
| Infinite scroll | **MISSING** | Manual “load older” button |
| Message pagination | EXISTS | 30/page, keyset — boundary bug (UI-20) |
| Date separators | **MISSING** | No day grouping |
| Long-message handling | PARTIAL | Bubbles wrap; composer is single-line |
| Image preview / attachments | **MISSING** | No upload path in chat |
| Notification | EXISTS | Row + realtime for chat |
| Mobile chat layout | EXISTS | List ↔ thread with back button |
| Keyboard-safe input | PARTIAL | `dvh` + safe-area, but `min-h` floor (UI-23) |
| Conversation search | **MISSING** | No filter UI |
| Conversation filtering | **MISSING** | Support vs sellers is a section, not a filter |
| Support priority | **MISSING** | No priority field or sort |
| Close / reopen | **MISSING** | `conversations.status` exists, unused |
| Staff assignment | **MISSING** | No owner/assignee column |

### 6.4 Chat authorization audit

- **Customer list/messages/send/read:** every endpoint re-checks `conversations.customer_id = session user` (`chat.ts:300-526`). Correct.
- **Seller list/messages/send/read:** `getSellerForUser` requires `status='approved'`; every query scopes `seller_id = my seller` (`chat.ts:543-690`). Correct.
- **Support conversation:** create is auth-only and idempotent; read/send use the customer endpoints, so ownership still applies. Correct.
- **Message body:** server validates 1–4000 chars; schema also constrains 1–4000. Correct.
- **Rate limit:** chat send 30/min. Correct.
- **Gaps:** no permission for a non-seller staff identity; no way to revoke a single support agent; no audit log entry for support replies; `mapConversation` exposes internal `customerId`/`sellerId` (minor).

---

## 7. Responsive findings

| Viewport | Finding | Evidence | Severity |
|---|---|---|---|
| **320 px** | Notification panel is clipped ≈80 px on the left (shop) / ≈36 px (seller); panel width `calc(100vw-24px)` anchored to a bell that is not at the viewport edge | UI-05, `NotificationBell.tsx:183` | P1 |
| **320 px** | Chat thread `min-h-[420px]` / `[460px]` exceeds the visible height with a keyboard; composer drops below the fold | UI-23, `ShopChat.tsx:435`, `SellerChat.tsx:301` | P2 |
| **320 px** | Cart quantity steppers are 32×32 px; chat back button 36×36 px; below 44 px | `ShopCart.tsx:297,310`; `ShopChat.tsx:449` | P2 |
| **320 px** | VelCenter shows 10 tabs in a horizontal scroller with no More affordance; Settings/Incidents are off-screen | UI-24, `Center.tsx:977` | P2 |
| **320 px** | Product filter sheet is exactly `w-[320px]` — full-bleed with no gutter at this width | `ShopProducts.tsx:520` | P3 |
| **375 px** | Same notification clipping; seller notification clipping (−36 px) | UI-05 | P1 |
| **430 px** | Shop notification panel still extends ≈34 px off-screen; seller panel now fits | geometry from header; verify | P1 |
| **768 px** | **VelSeller loses all page navigation**: tab bar hidden at `md`, header links appear only at `lg` | UI-02, `MobileTabBar.tsx:47`, `AppHeader.tsx:27` | P1 |
| **768 px** | VelShop and VelCenter tables switch to cards correctly; VelShop filter button appears because the sidebar is `lg`-only | `Center.tsx:1246…`, `ShopProducts.tsx:485-540` | PASS (static) |
| **1024 px** | VelSeller nav returns; tables return; VelShop desktop sidebar returns | `lg:` breakpoints | PASS (static) |
| **1440 px** | All apps cap at `max-w-6xl` (1152 px), leaving wide gutters on large monitors; acceptable, but the product grids do not take advantage of the space | `mx-auto max-w-6xl` across apps | P3 |

**Global responsive observations**
- There is no horizontal overflow in the inspected static classes except the notification panel; tables are wrapped in `overflow-x-auto` and have card fallbacks.
- The floating tab bar is correctly offset (`bottom` + safe-area) and page content reserves 4.75 rem via `.site-app` on `<md`.
- The cart’s fixed summary bar is positioned above the tab bar (80 px vs 76 px) — only ~4 px clearance; verify on a device with a large safe-area inset.
- The sticky header (`z-40`) and tab bar (`z-50`) are correctly layered; the cart summary (`z-30`) sits below both.
- **No browser screenshots were taken.** These are static findings, not a visual pass.

---

## 8. Recommended implementation order

Do not start with colour, animation or “make it prettier”. The order below follows the requested priority: stability → broken UX → realtime correctness → chat fundamentals → responsive → polish → micro-interactions.

### Phase A — Stability (P0/P1, smallest possible changes)
1. **Socket ownership (UI-04).** Move `connectChatSocket` to an app-level provider (or ref-count it) and remove `disconnectChatSocket` from page cleanup. Add a visible connection state and a refetch on reconnect.
2. **VelCenter WS path (UI-03).** Replace the inline client with the shared socket (or `apiUrl + "/ws"`), add backoff + jitter, and refetch on open.
3. **Error states (UI-06).** One shared `AsyncState` pattern: never convert failure to `[]`; add retry to My Orders, Notifications, Seller Orders, Shop Chat, cart and Income.
4. **Chat failures (UI-08, UI-09).** Keep failed bubbles with retry; clear presence on socket close and on `pagehide`.
5. **Cart quantity (UI-13).** Serialize per line, add per-line pending, ignore stale responses.
6. **Bootstrap claim (UI-14).** Check `res.ok`, refresh auth state, and do not show success on failure.
7. **Admin destructive actions (UI-15).** Confirm + per-row busy for status and role changes.

### Phase B — Broken UX (P0/P1)
8. **Seller mobile navigation (UI-01, UI-02).** Chat entry at all widths; unify the `md`/`lg` breakpoints; regression at 768/1024.
9. **Notification panel (UI-05).** Portal + mobile sheet; verify at 320/375/430.
10. **Footer + marketing accuracy (UI-18, UI-19).** Fix the three links; remove the OTP claim; publish or hide News.
11. **Buy Now (UI-12).** Charge exactly the selected quantity; stop mutating the cart.
12. **History pagination (UI-11).** Add load-more to all three order lists using the existing pagination payload.

### Phase C — Realtime correctness (P1)
13. **Emit `order:created`** after each order commit and notify the seller (row + targeted event).
14. **Consume `order:updated` / `shipment:updated`** in VelShop order detail/tracking and VelSeller order detail; refetch by id.
15. **Add customer notifications** for paid, shipped, delivered, cancelled and refunded, inside existing transitions (no new table).
16. **Allowlist + private channels:** add `shipment:updated`; move employee/audit/config events off the public allowlist.
17. **Heartbeat + resync:** ping/pong; on reconnect refetch active order/chat/list data.
18. **Remove dead channels** (`cart:updated`, `inventory:updated`, `profile:updated`) or implement them; document reserved ones.

### Phase D — Chat fundamentals (P1/P2)
19. **Support decision (UI-16).** Approve the model before coding. Short term: seller “Contact Velnox” + hide the support shop from `/api/shops`. Next: a VelCenter Support tab with a real `support` role, assignment/priority, and `sender_role='support'` → **SCHEMA CHANGE REQUIRED** (update both `db/schema.sql` and `db/run-sqleditor.sql` when approved).
20. **Chat reliability:** `(created_at, id)` keyset (UI-20), send idempotency (UI-21), synchronous send guard, failed-message retry.
21. **Chat usability:** scroll anchoring, textarea, date separators, search, unread badge in nav.
22. **Seller-initiated conversations** only if product approves; otherwise state that sellers reply only.

### Phase E — Responsive (P1/P2)
23. Chat short-screen layout (UI-23); 44 px touch targets (UI-27); VelCenter mobile navigation (UI-24); cart/tab bar clearance; 320 px pass across all four apps.

### Phase F — Visual polish (P2/P3)
24. Palette unification (UI-28), toast offset (UI-26), dialog max-height (UI-25), generic loading (UI-34), icon/badge consistency (UI-35), metadata contrast and size (UI-27), VelNox contact (UI-31), Income fee source (UI-32), `window.confirm` (UI-33).

### Phase G — Micro-interactions (P3)
25. Focus traps, `aria-live` chat announcements, typing/presence only if the support workflow proves it needs them, subtle transitions.

---

## 9. Architecture guardrails for Phase 2

- **Do not add a second WebSocket client.** VelCenter’s inline client is already a duplicate; the fix is to delete it, not to extend it.
- **Do not add a second notification system.** All rows go to `notifications`; all delivery goes through `sendToUser`/`broadcast`; all reads go through the existing user-scoped endpoints.
- **Do not add a second chat API or conversation table.** Extend `conversations` / `chat_messages`; a support role is a schema change to those tables, not a new system.
- **Neon remains the source of truth.** Events are signals; after reconnect or a suspicious event, refetch. Never let the socket payload become the only copy of an order/chat state.
- **No fake data, no mock realtime, no client-only state for financial/order facts.** The current server-owned deadlines and idempotent checkout must survive any UI refactor.
- **Frontend hiding is UX only.** Every new support/admin surface must re-check permission server-side; `CENTER_ROLES`/`userHasPermission` is the pattern.

---

## 10. Change audit trail

| # | Field | Value |
|---|---|---|
| 1 | Date + time | 2026-10-26 (UTC) · 2026-10-27 00:16 +07 (Asia/Bangkok) |
| 2 | Agent | Buffy (Codebuff) |
| 3 | Branch | `main` |
| 4 | Commit SHA before | `f71dcfd2fe26c7c92d94eb2ef7d7418f1c82d4d1` |
| 5 | Commit SHA after | `903501f4594e4d30d3918e579fe39b65c540ef9a` (pushed; local == `origin/main`) |
| 6 | Purpose | Phase 1 audit of UI/UX, responsive behaviour, realtime and chat; no implementation |
| 7 | Inspected before | Git state; all four app routers/pages; shared shell/socket/i18n; backend chat/realtime/notifications/permissions/rate limit; `db/schema.sql` (read only) |
| 8 | Files / folders touched | `.ai/history/2026-10-26-ui-realtime-professional-audit.md` (new); `.ai/AI_HANDOFF.md` (§79 + §69 archive pointer); `.ai/history/archive/AI_Handoff-2026-10-05-section-69-production-payments-checkout-group.md` (new, verbatim); `.ai/history/AI_Handoff_Archive.md` (index row) |
| 9 | Added | This report; §79 audit record; §69 archive file + index row |
| 10 | Removed | Nothing from product source; §69 text moved verbatim out of the handoff (archiving, not deletion) |
| 11 | What changed | Documentation only |
| 12 | Why | §12 of the task requires the audit report; §15/AI_RULES §18 require a bounded handoff + change record |
| 13 | Systems affected | `.ai/` documentation only |
| 14 | Confirmed unaffected | No `apps/`, `backend/`, `packages/`, `db/` file touched; no SQL executed; no DB connection |
| 15 | Checks run | `git remote -v` / `fetch` / `status` / `rev-parse`; `bun run i18n:check`; local `ws` path probe; source sweeps (`rg`); handoff size + diff check |
| 16 | Results | Git: in sync, clean (PASS) · i18n: 1249/1249/1249 (PASS) · WS probe: wrong path 400/1006, `/ws` OPEN (CONFIRMED) · docs-only diff check (PASS) |
| 17 | Problems found | 1 P0, 18 P1, 14 P2, 4 P3 (detailed in §4); 4 realtime correctness defects; support model not operable in VelCenter |
| 18 | Limitations | No browser/viewport screenshots; no authenticated live flow; no production DB read; not a performance measurement |
| 19 | Work still open | All implementation in §8; support model decision; schema change proposal for a staff support role |
| 20 | Next agent must know first | The realtime transport is sound but its **browser lifecycle** is broken (shared socket teardown + VelCenter path). Fix that before adding any new realtime feature. |

**Explicit state**

```
SOURCE CODE MODIFIED: NO
DATABASE MODIFIED: NO
SQL MODIFIED: NO
PRODUCTION DB CONNECTED: NO
```

---

## 11. Limitations and what was not verified

- **Visual/responsive matrix NOT RUN.** No browser or screenshot capability in this workspace. The findings in §7 are derived from the DOM structure and Tailwind geometry; treat them as high-confidence static findings, not screenshots.
- **No authenticated session.** Chat send/receive, notification badges and checkout were not exercised end-to-end. Authorization conclusions come from reading the route guards.
- **No production data.** Table/column statements come from `db/schema.sql`; the live Neon state is outside this audit (and agents must not connect to it).
- **No performance measurement.** “Refetch storms” and “unbounded lists” are code-level concerns, not benchmarked latency claims.
- **No test suite run** because no code changed; the existing test coverage for these areas was not audited in this phase.
