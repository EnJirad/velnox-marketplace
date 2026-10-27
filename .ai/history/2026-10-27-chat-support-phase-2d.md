# Phase 2D — Chat/Support Fundamentals + Seller/Customer Unread Badge — Change Report

| Field | Value |
|---|---|
| Date / time | 2026-10-27, ~17:00–18:30 UTC (sandbox clock) |
| Agent | Buffy (Codebuff), Freebuff workspace |
| Branch | `main` |
| Commit SHA before (base) | `1a4cce0543795acf51e37a663a9306554938b03d` (= `origin/main` at `git fetch` before editing; 0/0, clean tree) |
| Commit SHA after (code) | `4aed0847a8b58b3bd8c6c500b08cee49c3a917ae` — `fix(chat): complete phase 2D chat support and unread state` (8 files, +1179/−28) |
| Commit SHA after (docs) | the `docs(ai)` commit carrying this file and the handoff §83 — it is the final `HEAD` of this task (a commit cannot contain its own SHA; it is reported in the task's final answer and verifiable with `git log -1`) |
| Purpose | Make buyer↔seller chat correct and consistent on top of Phase 2A/2C: fix the read race, make retried sends idempotent, never lose a typed draft, and add ONE server-derived chat-unread badge (seller header entries + customer profile row) on the existing realtime architecture. No schema, SQL, Stripe, notification-system or navigation change. |

> **SOURCE CODE MODIFIED: YES**
> **DATABASE MODIFIED: NO**
> **SQL MODIFIED: NO**
> **PRODUCTION DB CONNECTED: NO**
> **STRIPE MODIFIED: NO**

---

## 1. Preflight (before any edit)

- `git fetch origin main` → `HEAD == origin/main == 1a4cce0543795acf51e37a663a9306554938b03d`, empty
  `git status --porcelain` (clean tree, no user changes to preserve), branch `main`, no divergence.
- Read `AGENTS.md`, `.ai/AI_RULES.md`, `.ai/README.md`, `.ai/AI_HANDOFF.md`,
  `.ai/context/{project-map,frontend,realtime,testing,workflow}.md`, and the three phase reports
  (`2026-10-27-ui-realtime-phase-2a.md`, `2026-10-27-ui-commerce-phase-2b.md`,
  `2026-10-27-realtime-commerce-phase-2c.md`).
- Confirmed no Phase 2D work already existed: no unread badge anywhere (the handoff's known gap),
  no read bound, no `clientId` enforcement.

## 2. Audit findings (what the system actually is)

1. **Chat flow** — symmetric buyer↔seller over `conversations` + `chat_messages`.
   Customer: `GET/POST /api/customer/conversations`, `GET/POST …/:id/messages`, `POST …/:id/read`,
   plus the reserved-shop support conversation (`POST /api/customer/support/conversation`,
   replied through the same seller chat). Seller: the mirror under `/api/seller/*`.
   Presence (`chat:viewing`/`chat:viewingEnd`) suppresses the notification row while a thread is open.
2. **Message persistence** — `chat_messages` rows; sender identity from the session
   (`req.user.userId`) with the role as a route literal; body trimmed and validated 1..4000
   server-side; timestamps from `RETURNING *` (server clock is the source of truth).
3. **Read state** — `chat_messages.read_at`/`status`, per-viewer (`sender_id <> me`).
4. **Unread calculation** — per-conversation `COUNT(*) … AND read_at IS NULL` in both list routes;
   an **aggregate exists only for customers** (`GET /api/customer/account-summary → chatUnread`,
   defined but consumed by nothing); the **seller had no aggregate** — the documented Phase 2A gap.
   `chat_messages` has **no `client_id` column** and **no read-bound column is needed**
   (`created_at` already exists).
5. **Existing realtime** — addressed `chat:message` / `chat:read` via `sendToUser` (never
   `broadcast`), the shared `chat-socket` owned by `RealtimeProvider`, `onChatReconnect` refetch.
   No unread-specific event exists and none is needed: the badge re-reads the API on the existing
   signals.
6. **Seller and customer flows are the same** (same tables, same events, mirrored routes).
7. **Reusable endpoints** — customer: `account-summary.chatUnread`; seller: the canonical
   `GET /api/seller/conversations` (its `unreadCount` is server-computed and ownership-scoped).
   No new endpoint was needed or created.
8. **Defects found (all fixed below)** —
   (a) `POST …/read` was **unbounded**: it marked *every* unread row, so a message created between
   the reader's fetch and the UPDATE was swallowed as read although never seen;
   (b) **no badge** on any chat entry;
   (c) `clientId` was accepted and echoed but **never enforced** → a retried submission inserted a
   second row, a second push and a second notification row;
   (d) a send failure **erased the typed draft** (`setDraft("")` before the await, temp removed in
   `catch`) and generated a fresh clientId on resend, making retry inherently duplicating;
   (e) `account-summary` went through the 60 s GET cache — unusable for a live badge.

## 3. Root cause and fix per requirement

### A. Chat fundamentals

- **Read race (§7).** `POST …/read` now accepts an optional `upTo` (epoch ms) and appends
  `AND created_at <= to_timestamp($3::double precision / 1000)` — a **parameterised** bound, no SQL
  built from input. Absent → previous unbounded behaviour (old client keeps working); present but
  unusable → `400 VALIDATION_ERROR` (never a silently ignored bound). The chat pages derive `upTo`
  **from the server's own timestamps**: on open, the `createdAt` of the newest message actually
  loaded; on a live message, that message's `createdAt`. No client clock is trusted, so the bound is
  exactly "everything I displayed, nothing else". A message created after the fetch stays unread.
  This was achievable **without any schema change**, so no BLOCKED condition arose.
- **Duplicate send (§3).** `clientId` is now enforced server-side through an in-process claim
  (`conversationId:userId:clientId`, 10-min TTL, 1000-entry cap): a replay answers with the stored
  message (`duplicate: true`) **before** any insert, push or notification row. The pages restore the
  draft and reuse the clientId when the same text is resent, so the retry path is the one that
  actually exercises the claim. Honest limitation, documented in-line: the map dies with the process
  and two genuinely concurrent requests are not serialised — the durable fix is a
  `UNIQUE (conversation_id, sender_id, client_id)` index, which is a **schema change deliberately
  left for owner approval**, not smuggled in.
- **Send failure (§1 D).** The typed text is restored to the draft and the temp bubble removed; the
  retry state clears only when the server accepted the send. Failures are `.catch`-logged instead of
  unhandled rejections.
- **Invariants preserved:** ownership still resolved server-side and checked *before* validation;
  sender identity still session-only (a body carrying `senderId`/`senderRole` is ignored — pinned by
  a test); no new contract fields besides the optional `upTo` and the additive `duplicate` flag.

### B. Unread badge — one server-derived count

New `packages/shared/src/hooks/use-chat-unread.ts`: a small module-level store + `useChatUnread(viewer)`.

- **Data:** customer → `account-summary.chatUnread` (route switched from `apiGet` to `apiGetFresh`,
  no other caller existed); seller → the sum of `unreadCount` over `sellerConversations`. Both are
  ownership-scoped **in SQL**; the browser never decides which conversations to count, and
  **notification rows are never counted** (the bell stays the bell — §10 separation).
- **States (§11):** `count: null` = not confirmed → renders **nothing**; a failed refresh keeps the
  last known-good count (`status: "error"`), never a silent `0`; a different account can never
  inherit the previous session's number (owner key = viewer + userId, reset before fetch).
- **Realtime (§6):** refresh on the existing `chat:message` event and on `onChatReconnect`, coalesced
  (one in-flight fetch + one trailing refetch). **No polling, no new event, no second socket.**
- **Read → badge (§7):** chat pages call `notifyChatUnreadChanged(viewer)` inside the **success**
  continuation of their own read request.
- **Surfaces:** seller — both entries in `AppHeader` (desktop `lg` nav item and the always-visible
  phone/tablet icon), count in the accessible name, `99+` cap per the codebase convention; customer —
  the `/chat` row of `ShopProfile`'s Communication group (the canonical customer chat entry; the
  product/help CTAs are links into the same page and were left alone).

### C. Realtime integration

Untouched transport: one WebSocket (`chat-socket`, owned by `RealtimeProvider`), same backoff,
same `subscribeAll()` resubscribe, same replace-on-reconnect refetch (pinned by test). Chat pages
still never call `disconnectChatSocket`. Addressed `chat:message`/`chat:read` delivery and the
Phase 2C channel authorization are unchanged.

## 4. Files changed

**Code commit `4aed0847a8b58b3bd8c6c500b08cee49c3a917ae` (8 files, +1179/−28):**
`backend/routes/chat.ts` (read bound, send idempotency, header docs),
`packages/shared/src/lib/api-routes.ts` (`upTo` forwarding ×2, `accountSummary` → fresh),
`packages/shared/src/hooks/use-chat-unread.ts` **(new)**,
`packages/shared/src/components/AppHeader.tsx` (seller badge ×2 entries),
`apps/velshop/src/pages/ShopProfile.tsx` (customer badge on the chat row),
`apps/velshop/src/pages/ShopChat.tsx`, `apps/velseller/src/pages/SellerChat.tsx`
(`upTo` + notify + draft/clientId retry),
`backend/tests/chat-support-phase2d.test.ts` **(new)**.
**Deleted: none. Moved: none.**

**Docs commit:** this file + `.ai/AI_HANDOFF.md` (§83, with the 2026-10-04 payment-integrity
narrative archived verbatim to `.ai/history/archive/` per the file's own size rule + an index row).

## 5. Systems affected / explicitly unaffected

**Affected:** the two chat send/read routes, the chat-read API arguments, the account-summary fetch
freshness, the two chat pages' read/send behaviour, the seller header chat entries, the profile chat
row, and the tests that pin them.

**Explicitly UNCHANGED (verified by `git diff`):** `db/schema.sql`, `db/run-sqleditor.sql`, every
other SQL file (no DDL/DML, no SQL written at all); Stripe, checkout, pricing, webhooks, inventory;
order/shipment state machines and Phase 2C publishers; the notification system/table/UI; the
realtime server, channel authorization and Phase 2A transport/backoff; authentication; VelCenter;
VelNox; navigation structure; no new dependency, endpoint, table or event.

## 6. Tests actually run (real results)

| Check | Command | Result |
|---|---|---|
| Four app typechecks | `bun run typecheck` | **PASS** — velshop / velseller / velcenter / velnox all exit 0 |
| Backend typecheck | `cd backend && bun run typecheck` | **PASS** — exit 0 |
| App builds | `bun run build:apps` | **PASS** — 4/4 (`✓ built` per app) |
| i18n parity | `bun run i18n:check` | **PASS** — `th=1257 en=1257 my=1257` (no copy added) |
| Backend suite | `cd backend && bun test tests` | **PASS** — **1033 pass / 332 skip / 0 fail** (1365 tests, 66 files). Baseline before this change: 1015 pass / 321 skip / 0 fail (1336 tests, 65 files) |
| New Phase 2D suite | `cd backend && bun test tests/chat-support-phase2d.test.ts` | **PASS** — 18 pass / 11 skip / 0 fail (114 assertions) |
| Whitespace | `git diff --check` (+ `--cached --check`) | **clean** |

Test coverage added (18 structural cases, no database needed): session-derived sender identity +
forged-body resistance, validation-before-insert ordering, ownership scoping for both roles,
duplicate-replay ordering (claim → reply → insert → store) with no push/notification on replay,
no DDL/no broadcast, the `upTo` bound in both routes + both pages, reuse of existing endpoints and
no-new-route, ownership-scoped counting, chat≠notifications, null/error states (never a fake 0),
event/reconnect driven with no polling and no second socket, badge gating + `99+` + both seller
entries + the customer row, single shared socket, replace-not-append reconnect refetch, and
draft/clientId retry behaviour.

## 7. Tests SKIPPED / BLOCKED (honest)

- **SKIPPED — the 9 DB-gated end-to-end cases** in `chat-support-phase2d.test.ts`: 401 for every
  chat/unread endpoint without a session; customer B / seller B isolation (404 + absent from lists);
  empty/whitespace bodies persisted nowhere; a forged `senderId`/`senderRole` stored as the session
  user; duplicate send → one row + one notification + `duplicate: true` (and a fresh clientId does
  store); repeated get-or-create → same conversation; the full unread lifecycle including the
  **stale-read race** (a read bound to the old message leaves the new one unread, and `upTo: NaN` is
  a 400 not a mark-all); unread isolation across two customers/two shops; and addressed realtime
  (`chat:message` to the seller only, `chat:read` to the customer only, a stranger's socket gets
  nothing). Reason: **no safe `TEST_DATABASE_URL` in this workspace** (no PostgreSQL server, no
  Docker/Podman; `backend/db/test-database.ts` refuses anything production-like). No production
  credential was read, requested or used. CI (`.github/workflows/test.yml`) bootstraps a disposable
  `postgres:16` with `db/run-sqleditor.sql` and runs them; **treat them as written-but-unexecuted
  until CI is green.** Fixture cleanup needs no new helper: all chat FKs are `ON DELETE CASCADE`
  (verified in both canonical SQL files), so `purgeUsers` removes them.
- **NOT RUN — browser / E2E.** No browser-driving capability in this workspace: the badge appearing
  on the seller header at 375 px, the profile-row badge after an incoming message, the draft
  restoration on a failed send and the live unread drop after reading are **source- and
  test-verified only**. Code inspection does not prove browser behaviour.

## 8. Unresolved risks / limitations

1. **Send-idempotency is in-process** (see §3.A): a restart forgets the claim map, and concurrent
   identical requests are not serialised. The client-side single-flight guard makes the concurrent
   case unreachable from one tab. Durable fix = a unique index — **owner approval required** (schema).
2. **The seller badge fetches the conversation list per page mount** (reusing the canonical endpoint
   instead of adding an aggregate route). Fine at current scale; a dedicated
   `GET /api/seller/conversations/unread-count` would be the refinement if lists grow large.
3. **The customer badge lives on the profile chat row only** — the product-page "Chat with shop" and
   help-page CTAs are links into `/chat`, not navigation entries, and were deliberately not badged.
4. **The support-agent surface** (`users.role = 'support'`) rides the seller endpoints and therefore
   the seller badge, but support-flow E2E was not exercised (its idempotent seed creates rows outside
   this suite's fixture tracking).
5. **Role staleness ≤ 30 s** (Phase 2C) and the outbox-drain gap (Phase 2C) are unchanged and still open.
6. `bun run lint` does not exist in this repository; nothing lint-related was claimed.

## 9. What the next agent must know first

- Mark-read is **bounded**: pass `upTo` (a server timestamp) from any surface that marks a thread
  read; an unbounded call is a compatibility fallback, not the contract.
- The badge count lives in `use-chat-unread.ts` — one store, `null` = unknown, refreshed from
  `chat:message`/reconnect and from `notifyChatUnreadChanged()` after a confirmed read. Never render
  a count the server has not confirmed, and never count notification rows as chat unread.
- Send idempotency is `clientId` + the in-process claim: a retry must reuse the clientId (the pages
  keep it with the draft). If durable idempotency is ever approved, that is a schema change
  (`UNIQUE (conversation_id, sender_id, client_id)`) touching both canonical SQL files.
- The 9 DB-gated cases must be confirmed by a real `TEST_DATABASE_URL` run (CI) before this phase is
  called end-to-end verified.
