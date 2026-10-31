# §94. Commerce Messenger: durable idempotency + shared timeline (2026-10-31)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-01 to keep the live handoff under this
> environment's ~55 KB edit-tool ceiling. Nothing was discarded.

## §94. Commerce Messenger: durable idempotency + shared timeline (2026-10-31) — COMPLETE

**SHA:** `905835e` → this commit. **Report:**
[`.ai/history/2026-10-31-phase-2i-messenger-upgrade.md`](./history/2026-10-31-phase-2i-messenger-upgrade.md).

**Idempotency moved into the database.** `chat_messages.client_id` + partial UNIQUE
`uq_chat_messages_client_id (conversation_id, sender_id, client_id) WHERE client_id IS NOT NULL`, declared
in both canonical files (additive, rerunnable). All three human send paths go through
`insertHumanMessage()` (`ON CONFLICT … DO NOTHING`); the loser replays via `findMessageByClientId()` and
returns `duplicate:true` without re-running the conversation update, the daily ack or notifications. The
in-memory map is now only a fast path.

**Shared timeline.** `packages/shared/src/lib/chat-timeline.ts` gives all three surfaces the same day
separators (localised with `Intl.RelativeTimeFormat`), sender grouping inside a 5-minute window, and
bubble hugging — wired into VelShop, VelSeller and VelCenter.

**Verified.** `chat-durable-idempotency` (3 structural pass, 5 DB cases skip locally / run in CI),
`chat-timeline` 10/10, chat suites green, full suite **1116 pass / 375 skip / 8 fail** (the 8 are the
Termux-only probes), typecheck 4/4, backend tsc, build 4/4, i18n 1265, diff clean. Deferred and NOT faked:
reactions, edit, media/R2 attachments, product/order messages, search, image viewer.

---
