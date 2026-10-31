# Chat inbox + thread redesign (2026-11-01) — PARTIAL (UI + presence landed, E2E NOT RUN)

**Status:** PARTIALLY COMPLETE. Implementation, typecheck, builds, i18n and the non-DB test suites are green;
real browser E2E against a live database could not be run on this device (see Blockers).

**Starting SHA:** `930de65` (`HEAD == origin/main`, working tree clean).
**Task brief:** supplied by the owner as an attachment. The path named in the request
(`.ai/tasks/active/chat-redesign.md`) **does not exist** in the repository — checked with `ls` and `grep`.
Work followed the attached brief; nothing was invented in its place.

## What changed

### Backend (reuse only — no new chat engine, table, socket or polling loop)

- `backend/realtime/index.ts`
  - Presence is now derived from the EXISTING connection registry (`clients`): a user is online while at
    least one authenticated socket is open. `isUserOnline()` / `getUserLastSeenAt()` exported.
  - `lastSeenAt` recorded when the user's LAST socket closes (`forgetClient`).
  - New addressed event `chat:presence` `{ userId, online, at }`, pushed only to the other participant of a
    `CUSTOMER_SELLER` thread (the only thread with exactly one human counterpart). Query is bounded
    (`LIMIT 200`), fired on online/offline transitions only.
  - Deliberately NOT subscribable, never persisted: presence is delivery-adjacent state, exactly like
    `chat:typing`.
- `backend/routes/chat.ts`
  - `mapConversation` adds `participantOnline` / `participantLastSeenAt`; both are `null` unless
    `type === 'CUSTOMER_SELLER'`, so support threads and company rooms never fake a dot.
  - Image-only messages set the inbox preview to `📷` instead of an empty `last_message`
    (3 send paths: customer, seller, company).
- `backend/routes/center-chat.ts`
  - Company list attaches presence for the customer / seller tab and `null` for internal rooms.
  - Same `📷` preview rule.

### Shared UI (`packages/shared/src/components/chat/`)

- `chat-avatar.tsx` — squircle avatar, initials fallback, online dot ONLY for an explicit `true`.
- `chat-inbox.tsx` — `ChatSearchField`, `ChatFilterTabs` (All / Unread / Support), `ChatConversationRow`
  (name, preview, time, unread badge, divider), `ChatListState` (loading / empty / error + retry),
  `ChatThreadHeader` (back, avatar, name, presence line).
- `chat-composer.tsx` — one composer for all three surfaces: `+` attach, auto-growing textarea,
  Enter sends / Shift+Enter newline, emoji, send, disabled while in flight, inline error + retry,
  pending-image preview with progress, safe-area padding.
- `emoji-picker.tsx` — dependency-free curated picker (no CDN, no emoji database), Escape/outside close,
  40 px targets, width-capped for 320 px screens.
- i18n: 12 new keys (`messagesTitle`, `searchPlaceholder`, `filterAll/Unread/Support`, `online`,
  `lastActive`, `seen`, `newMessages`, `noResultsTitle/Desc`, `emoji`) merged via
  `locales/index.ts` patches for th/en/my.

### Apps

- **VelShop** (`pages/ShopChat.tsx`) — Messages screen: title + search + All/Unread/Support (all real state,
  filtered over server data), rows with avatar/preview/time/unread, thread header with back + presence,
  date separators, mint outgoing / gray incoming bubbles, load-older with scroll anchoring, "new messages"
  chip instead of forced scroll, composer with image upload + emoji, support thread CTA.
- **VelSeller** (`pages/SellerChat.tsx`) — same screen; Support filter = the `SELLER_COMPANY` thread;
  customer/company reachable through All; image send preserved.
- **VelCenter** (`components/ChatManagement.tsx`) — search + "unread only" over the loaded tab, presence
  line in the thread header and a dot in the list, shared composer with image upload, mint/gray bubbles.
  Its three company tabs (customer/seller/internal) are the center's own model and were kept.

## Reused systems (no duplicates)

`routes/chat.ts` + `routes/center-chat.ts` (one core), `lib/chat-access.ts` authorization,
`chat-socket.ts` (one shared connection), `chat-message.ts` ownership/dedupe, `chat-timeline.ts`,
`chat-typing.ts`, `upload/presign?purpose=chat` → R2 (`chat/{conversation}/{sender}/…`),
`resolveChatAttachment` / `attachment_key`, `uq_chat_messages_client_id` idempotency.

## Database

Production schema verified read-only through the Neon project (`run_sql`, no writes):

- `public.chat_messages` has `attachment_key text NULL` — VERIFIED.
- `chat_messages_body_or_attachment_check: CHECK (char_length(body) > 0 OR attachment_key IS NOT NULL)`
  — VERIFIED (image-only rows are legal).
- `uq_chat_messages_client_id (conversation_id, sender_id, client_id) WHERE client_id IS NOT NULL`
  — VERIFIED.
- `chat_messages_sender_role_check` includes `system` — VERIFIED.

No migration was needed and none was run.

## Verification actually performed

| Check | Command | Result |
|---|---|---|
| Apps typecheck | `bun run typecheck` | PASS 4/4 |
| Backend typecheck | `bunx tsc --noEmit` in `backend/` | PASS |
| Builds | `bun run build:apps` | PASS 4/4 |
| i18n parity | `bun run i18n:check` | OK — th/en/my = 1280 keys |
| Chat suites | `bun test tests/chat-messenger-ux.test.ts tests/chat-unified.test.ts tests/chat-support-phase2d.test.ts` | 34 pass / 38 skip / 0 fail |
| Full backend suite | `bun test tests` | 1113 pass / 375 skip / **8 fail** (all `test database guard` probes, the known Termux-only failures) |
| Diff hygiene | `git diff --check` | clean |

**NOT RUN:** browser E2E (login, send, receive, image upload, presence, read receipts), DB-gated chat tests
(need `TEST_DATABASE_URL`), R2 upload (no credentials on device).

## Blockers / why E2E did not run

1. The chat routes require an authenticated session; this app only signs in through Google OAuth, and no
   session exists on this device.
2. A disposable database was attempted: PostgreSQL 18 is installed, but `initdb` hangs at
   `selecting default max_connections` (the `postgres --boot` probe never returns in this Android
   sandbox). `postgres --describe-config` works, so the binary is intact — the bootstrap probe is blocked.
   No disposable DB ⇒ no DB-gated tests, no seeded users, no socket round-trip.
3. The production Neon database is reachable read-only (schema verification above); writing test rows into
   production was refused by policy.
4. R2 credentials are backend-only and absent locally, so a real image upload could not be exercised.

The Vite dev server did run and the browser reached it; `/chat` correctly redirected to `/auth` because
there was no session — that is the only visual fact observed, and it is **not** a chat-screen verification.

## Presence semantics (documented limits)

- Online = at least one live authenticated socket right now; two tabs stay online until the last closes.
- State is in-memory: per backend process, lost on restart, and not shared across instances. Chat delivery
  has the same shape, so presence is exactly as accurate as delivery. Nothing is written to Neon.
- Only customer↔seller threads announce presence. Support threads (a team) and internal rooms have no single
  counterpart and therefore show no dot.

## Next steps

1. Run the DB-gated suites with `TEST_DATABASE_URL` on a Neon branch (`bun test backend/tests`) — this also
   runs the WebSocket delivery, typing, read-bound and idempotency cases.
2. Browser E2E on a real environment: sign in, open Messages, filter All/Unread/Support, search, send text,
   send image, check presence and ticks on two sessions.
3. Multi-instance presence (if Render is ever scaled): move the registry to a shared store or accept
   per-instance drift knowingly.
4. Optional: an unread filter in VelCenter's tab counts is currently client-side over the loaded page.
