# Phase 2I — Velnox Commerce Messenger upgrade (2026-10-31)

**Starting SHA:** `905835e78409f47138201dcda7617c63096e6dee`
**Scope delivered in this pass:** durable send idempotency (schema + backend + tests) and the shared
timeline (date separators + sender grouping) wired into VelShop, VelSeller and VelCenter.

## 1. Audit findings that drove the work

| # | Finding | Impact |
|---|---|---|
| A1 | "One message per clientId" lived in `recentSends`, an in-process Map with a 10-minute TTL (`backend/routes/chat.ts`) | a second instance, a restart, another tab or a double tap could duplicate a message; the source even documented it as a limitation |
| A2 | The three surfaces each rendered a flat `messages.map()` | no day separators, no sender runs, no Messenger grouping |
| A3 | System rows were already correct (LEFT, dashed, no tick) — verified, not re-implemented | — |

Everything else (single socket, addressed events, typing, read bound, pagination, ownership helper,
daily ack) was inspected and left intact; no second socket, no polling, no new storage provider.

## 2. Changes

### Durable idempotency (database-level)
- `db/schema.sql` + `db/run-sqleditor.sql`: `chat_messages.client_id TEXT` and
  `uq_chat_messages_client_id` — partial UNIQUE on `(conversation_id, sender_id, client_id)
  WHERE client_id IS NOT NULL`. Additive; the reconciler adds the column with
  `ADD COLUMN IF NOT EXISTS` and the index with `CREATE UNIQUE INDEX IF NOT EXISTS`, so a rerun is a no-op.
- `backend/routes/chat.ts`: `insertHumanMessage()` claims the index with
  `ON CONFLICT … DO NOTHING`; `findMessageByClientId()` replays the winner's row. Customer and seller
  sends use it; the in-memory map stays only as a fast path.
- `backend/routes/center-chat.ts`: the staff send uses the same helper.
- A losing racer returns `duplicate:true` and does **not** re-run the conversation update, the daily
  acknowledgment or any notification.

### Shared timeline (UX)
- `packages/shared/src/lib/chat-timeline.ts`: `buildTimeline()` (one day header per calendar day, runs of
  the same sender inside a 5-minute window, system notes never grouped), `dateSeparatorLabel()` (localised
  via `Intl.RelativeTimeFormat`), `groupCorners()` (bubble hugging), `dayKey()`.
- VelShop, VelSeller and VelCenter render `buildTimeline(messages, { locale })`, draw a day pill and pass
  `firstOfGroup`/`lastOfGroup` into `groupCorners`.

## 3. Tests

| Suite | Result |
|---|---|
| `chat-durable-idempotency.test.ts` | 3 structural PASS, 5 DB-gated SKIP locally (CI runs them) |
| `chat-timeline.test.ts` | 10 PASS |
| chat suites (unified / support-phase2d / messenger-ux) | PASS |
| full backend suite | **1103 → 1116 pass, 375 skip, 8 fail** (the 8 are the known Termux `process.db` guard probes) |
| typecheck 4/4, backend tsc, build 4×2, i18n 265/265/265, `git diff --check` | PASS |

## 4. Not done in this phase (explicitly deferred)

Reactions, message editing, media/media-attachments via R2, product/order message types, full-text
search, full-screen image viewer, optimistic-UI changes, scroll-to-bottom affordance. Each requires either
a schema addition or a UI surface not present today; none were faked.

## 5. Verification gaps

Browser E2E still requires credentials the environment does not have; the durable-idempotency behaviour
tests run in CI (they need a disposable PostgreSQL).
