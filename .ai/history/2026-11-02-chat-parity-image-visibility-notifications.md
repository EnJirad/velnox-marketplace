# Chat parity: VelCenter images, bell-free chat, per-conversation unread (2026-11-02)

**Status:** PARTIALLY COMPLETE — code + data path fixed and verified by test/source/HTTP evidence;
browser E2E could not be run (no session on this device). Nothing below is claimed beyond what was observed.

**Starting SHA:** `e58cd8b` (`HEAD == origin/main`, working tree clean).

## Root cause — VelCenter could not see chat images

VelCenter's message timeline rendered `attachmentUrl` **only inside the SYSTEM-message branch**. The
normal human bubble printed `m.body` and the timestamp, so a customer's or seller's photo arrived as a
message with no media at all (an image-only message looked like an empty bubble).

The data path was NOT broken, and that was proven before touching UI:

- production `GET /api/health/r2` → `{configured:true, bucket:true, verify:true}`;
- production chat rows with `attachment_key` exist (`chat_messages` read-only query);
- the exact object URL derived by `mapMessage`
  (`${R2_PUBLIC_DOMAIN}/chat/{conversation}/{sender}/{uuid}.webp`) returned **HTTP 200 image/jpeg**
  when requested directly;
- `GET /api/center/chat/conversations/:id/messages` and the `chat:message` socket frame both use the
  ONE `mapMessage`/`loadMessages` pair from `routes/chat.ts`, so the DTO already carried the URL.

Conclusion: the bug lived in one render branch, not in upload, storage, authorization or realtime.

## Changes

### 1. VelCenter image rendering (root-cause fix)

`apps/velcenter/src/components/ChatManagement.tsx`
- the human bubble now renders `<ChatImageMessage url={m.attachmentUrl} …/>` (shared renderer + viewer)
  before the text, exactly like VelShop/VelSeller;
- empty body is no longer emitted as an empty paragraph (`{m.body ? … : null}`), so image-only messages
  render as media only;
- the duplicated render site is marked `THE ROOT-CAUSE FIX` so a future refactor cannot move it back
  into the system branch alone.

### 2. Chat removed from the global bell

`backend/routes/chat.ts`, `backend/routes/center-chat.ts`
- every chat `notifyUser()` / `notifyCompanyStaff()` call was removed (customer→seller,
  customer→support, seller→support, center→customer/seller/internal). Realtime delivery
  (`sendToUser`/`sendToCenter` `CHANNELS.CHAT_MESSAGE`) is untouched;
- the two helper functions were deleted so chat cannot accidentally write bell rows again, with a
  comment recording the rule;
- `GET /api/customer/notifications` now filters `AND type <> 'chat'`, so the historical rows already in
  production (8 as of this run) disappear from the bell **without deleting data**;
- the bell badge is `items.filter(!isRead).length`, so the count is chat-free by construction;
- business notifications (orders, payments, shipping, verification, security) are untouched — the
  verification flow still writes and pushes as before.

Chat unread continues to come from the chat tables (`chat_messages.read_at`), exposed through
`account-summary`, `/api/seller/conversations` and `/api/center/chat/unread` — never from
`notifications`.

### 3. Unread preview = latest unread message

`backend/routes/chat.ts` (customer + seller lists) and `backend/routes/center-chat.ts`
(`UNREAD_SUBQUERY`):
- added `last_unread_body` — the newest message from somebody else with `read_at IS NULL`
  (`CASE WHEN body <> '' THEN body ELSE '📷' END`, so an unread photo previews as media);
- `mapConversation` / `mapCompanyConversation` use `r.last_unread_body ?? r.last_message`;
- unread counts still come from the existing partial index `idx_chat_messages_unread`
  `(conversation_id, sender_id, read_at) WHERE read_at IS NULL` — one indexed subquery per row, no N+1,
  no history load;
- system rows (`sender_id IS NULL`) never count as unread because `sender_id <> $1` is NULL for them.

### 4. Support is a separate inbox

- VelShop: `All` / `Unread` now exclude the Velnox Support conversation; `Support` shows only it. The
  support CTA remains when no support thread exists.
- VelSeller: `All` / `Unread` exclude the `SELLER_COMPANY` thread; `Support` shows only it.
- VelCenter keeps its existing three-tab model (customers / sellers / internal): company support *is*
  that inbox, so nothing was renamed or merged.

## Verification actually performed

| Check | Command | Result |
|---|---|---|
| New parity guards | `bun test backend/tests/chat-parity.test.ts` | 8 pass / 0 fail |
| Full backend suite | `bun test backend/tests` | **1121 pass / 375 skip / 8 fail** (the 8 are the known Termux `test database guard` probes) |
| Apps typecheck | `bun run typecheck` | PASS 4/4 |
| Backend typecheck | `bunx tsc --noEmit` in `backend/` | PASS |
| Builds | `bun run build:apps` | PASS 4/4 |
| i18n parity | `bun run i18n:check` | OK — 1280 keys per locale |
| Production R2 path | `curl -I <public>/chat/{conv}/{sender}/{uuid}.webp` | HTTP 200, `image/jpeg` |
| Production schema (read-only) | Neon `run_sql` | `attachment_key`, body-or-attachment CHECK, `uq_chat_messages_client_id`, `idx_chat_messages_unread` all present |
| Production bell data (read-only) | `SELECT type, COUNT(*) FROM notifications GROUP BY type` | 8 `chat` rows (now filtered, not deleted), 2 verification rows untouched |

Two existing source-contract tests encoded the OLD rule (chat pushes a bell notification). They were
updated to the new contract with the same strength — they now assert that chat contains **no**
`notifyUser`/`NOTIFICATION_CREATED` at all — and the reason is recorded in the test comments.

## NOT RUN

- Browser/E2E in VelShop, VelSeller and VelCenter: this device has no session (Google OAuth only) and no
  disposable database (PG18 `initdb` hangs in this Android sandbox), so a real two-role conversation
  could not be opened. The centre image fix is therefore verified by the shared-code proof (same DTO,
  same component, URL 200) and by source guards — not by a screenshot.
- DB-gated chat suites (WebSocket delivery, idempotency, typing, read bound) still skip locally.
- R2 upload from the UI (no credentials on device); production upload path was only verified by the
  stored object being publicly retrievable.

## Remaining work

1. Run the browser matrix (user↔seller, user↔support, seller↔support, center↔both) on a real deployment
   and confirm the image bubble + viewer visually.
2. Run the DB-gated suites with `TEST_DATABASE_URL` on a Neon branch.
3. Optional: a one-off, owner-approved cleanup/archival of the 8 historical `chat` notification rows —
   deliberately NOT done here; filtering is the least destructive correct fix.
