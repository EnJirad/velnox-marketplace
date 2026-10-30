# Handoff §83 — Phase 2D: Chat/Support Fundamentals + Unread Badge (2026-10-27)

> Moved **verbatim** from `.ai/AI_HANDOFF.md` on 2026-10-30 (edit-headroom housekeeping while
> appending §85 / Phase 2F). Nothing discarded. The full Change Report stays at
> [`../2026-10-27-chat-support-phase-2d.md`](../2026-10-27-chat-support-phase-2d.md).

---

## §83. Phase 2D — Chat/Support Fundamentals + Unread Badge (2026-10-27) — **COMPLETE**

**Base SHA:** `1a4cce0543795acf51e37a663a9306554938b03d` (`main` == `origin/main`, 0/0, clean).
**Resulting commit (code):** `4aed0847a8b58b3bd8c6c500b08cee49c3a917ae` — `fix(chat): complete
phase 2D chat support and unread state` (8 files, +1179/−28). This `docs(ai)` commit carries §83
and the report.
**Report:** [`.ai/history/2026-10-27-chat-support-phase-2d.md`](history/2026-10-27-chat-support-phase-2d.md).
**SOURCE CODE MODIFIED: YES · DATABASE MODIFIED: NO · SQL MODIFIED: NO · PRODUCTION DB
CONNECTED: NO · STRIPE MODIFIED: NO**

**What changed (delivers §82's "chat unread badge + chat/support fundamentals"):**
- **Read is bounded (`upTo`).** `POST …/conversations/:id/read` marks only messages created at or
  before an epoch-ms bound the client derives from SERVER timestamps (the newest loaded message, or
  the live message's own `createdAt`), so a message arriving while a read is in flight is never
  swallowed as read. Absent → the old unbounded behaviour; unusable → 400. Needed no schema change
  (`chat_messages.created_at` already exists), so nothing was BLOCKED.
- **Sends are idempotent per `clientId`.** An in-process claim (conversation + session user +
  clientId, 10-min TTL, 1000-entry cap) makes a retried submission REPLAY the stored message — no
  second row, push or notification row — and both chat pages restore the typed draft after a failed
  send and REUSE its clientId. Honest gap, documented in code: the claim dies with the process; the
  durable fix is `UNIQUE (conversation_id, sender_id, client_id)` → owner-approved schema change,
  deliberately not done in this phase.
- **ONE chat-unread badge** (`packages/shared/src/hooks/use-chat-unread.ts`, new): customer =
  `account-summary.chatUnread` (route switched to `apiGetFresh`), seller = the sum of the canonical
  `sellerConversations.unreadCount` — both ownership-scoped in SQL, no new endpoint. `null` = not
  confirmed → renders NOTHING; an error keeps the last known-good count (never a silent 0), and a
  new account can't inherit the previous session's number. Refreshes on the existing `chat:message`
  and `onChatReconnect` signals (coalesced) plus `notifyChatUnreadChanged()` after a confirmed read:
  no polling, no new event, no second socket. Surfaces: both seller `AppHeader` chat entries
  (desktop nav + the <lg icon, count in the aria-label, `99+` cap) and the customer `ShopProfile`
  `/chat` row. Chat unread ≠ notification rows — the bell is untouched.
- **Chat pages:** read failures are caught (no unhandled rejections); reconnect still REPLACES
  list/thread state (no duplicate messages or unread); `disconnectChatSocket` is still never called;
  sender identity stays session-only (a body carrying `senderId`/`senderRole` is ignored).

**Tests:** new `backend/tests/chat-support-phase2d.test.ts` — 18 structural cases + 9 DB-gated
cases (401 on every chat/unread endpoint; customer B/seller B isolation; empty/whitespace rejected
with nothing persisted; forged sender stored as the session user; duplicate send → one row + one
notification + `duplicate: true`, fresh clientId does store; get-or-create idempotency; the unread
lifecycle including the stale-read race and `upTo: NaN` → 400; unread isolation across two
customers/shops; addressed `chat:message`/`chat:read` with a stranger's socket getting nothing).
**Verified:** 4 app typechecks PASS · backend typecheck PASS · `bun run build:apps` PASS (4/4) ·
`bun run i18n:check` PASS `1257/1257/1257` · `bun test tests` **1033 pass / 332 skip / 0 fail**
(1365 tests, 66 files; baseline 1015/321) · `git diff --check` clean.
**BLOCKED/NOT RUN:** the 9 DB-gated cases (no safe `TEST_DATABASE_URL` here — CI's disposable
`postgres:16` runs them; all chat FKs are `ON DELETE CASCADE`, so `purgeUsers` covers the
fixtures); live browser/E2E (no browser in this workspace).

**Still open:** the responsive/visual matrix; the Phase 2C `outbox_events` drain worker (owner
decision); durable send-idempotency needs the unique index above (owner approval); the seller badge
reuses the conversation list per mount (a tiny aggregate endpoint is the refinement if lists grow).
**Housekeeping this pass:** the 2026-10-04 payment-integrity narrative moved verbatim →
[`history/archive/AI_Handoff-2026-10-04-payment-integrity.md`](history/archive/AI_Handoff-2026-10-04-payment-integrity.md)
(+ index row).
