# §89. Messenger UX — ticks, daily support ack, typing (2026-10-31)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-10-31 to keep the live handoff
> under this environment's ~55 KB edit-tool ceiling. Nothing was discarded.

## §89. Messenger UX — ticks, daily support ack, typing (2026-10-31) — COMPLETE

**Starting state:** `HEAD == origin/main` at `903fbeb`, clean tree. Committed on the owner's explicit
instruction after the local checks ran (see "Verified here").

Extends §88's core — no second engine, table, socket, polling loop or notification system.

**Schema (both canonical files, `db/schema.sql` + `db/run-sqleditor.sql`).** `chat_messages.sender_id`
became nullable (a system row has no human sender), the `sender_role` CHECK was widened to
`('customer','seller','company','system')`, and two columns were added: `system_kind TEXT`,
`ack_day DATE`. A partial UNIQUE index
`uq_chat_messages_support_daily_ack (conversation_id, ack_day) WHERE system_kind='support_daily_ack'`
makes "one per day" a DATABASE guarantee.

**Daily acknowledgment.** `createDailySupportAck()` runs only from the customer send handler for
`CUSTOMER_COMPANY` (and the legacy reserved-shop support shape). One statement:
`INSERT … ON CONFLICT (conversation_id, ack_day) WHERE system_kind='support_daily_ack' DO NOTHING
RETURNING *` — a concurrent request, a retry or another instance loses the race and returns no row. The
day is `(NOW() AT TIME ZONE 'Asia/Bangkok')::date`: calendar-day boundary, one authoritative clock,
restart-proof. The ack is a real `chat_messages` row (`sender_role='system'`, `sender_id NULL`), so both
sides read the same sentence; `sender_id <> $reader` being NULL keeps it out of unread counts and out of
mark-read.

**Ticks + realtime read state.** All three surfaces render `<Check/>` when `readAt == null` and
`<CheckCheck/>` once read. `chat:read` now carries `upTo` (the newest `created_at` the UPDATE actually
marked), so a client ticks exactly those messages and ignores its own receipt.

**Typing.** `chat:typing` ({conversationId, typing}) over the ONE existing socket. `lib/chat-access.ts`
resolves the audience from `conversations` (never from the frame); staff are refused on a private
`CUSTOMER_SELLER` thread; the sender never receives its own frame; nothing is stored. Client side:
shared `useChatTyping` (throttle 2.5 s, idle stop 3 s, receive expiry 6 s) + shared `TypingDots`
(CSS-only, `prefers-reduced-motion` aware). `chat:viewing` gained the same membership check.

**Canonical counts:** expected `63|240|265|659` (+1 index, +2 columns) — **derived, not measured**;
`db/verify-reconciler.sh` says so in its own note. Re-measure on a disposable PostgreSQL before trusting it.

**Tests added:** `backend/tests/chat-messenger-ux.test.ts` (structure group always runs; 8 behaviour cases
are DB-gated). `chat-unified.test.ts` had one assertion updated for the widened CHECK.

**Verified here (bun 1.4.4 + 329 deps installed on-device):** `bun run typecheck` **4/4 PASS** ·
backend `tsc --noEmit` **PASS** · `bun run build:apps` **4/4 PASS** · `bun run i18n:check`
**1264/1264/1264** · `git diff --check` clean · full suite `bun test backend/tests`
**1076 pass / 360 skip / 19 fail** of 1455 tests — the 19 are (a) the 11 pre-existing OAuth cases and
(b) 8 `test-database-isolation` subprocess probes that cannot run here because Termux reports
`process.execPath` as Android's `linker64`; both classes pre-date this pass and pass on CI.
The 360 skips are the DB-gated cases (no PostgreSQL: `initdb` hangs at its `max_connections` probe on
this device), so **the new behaviour suite SKIPPED locally** and is only exercised by CI.
`db/verify-reconciler.sh` could not run for the same reason.

**Known pre-existing red:** `main` run `41043341845` fails 11/1414, all in `oauth-route.test.ts`:
`/auth/google` redirects to the frontend error URL because `GOOGLE_CLIENT_ID`/`GOOGLE_REDIRECT_URI` are
empty when `routes/auth.ts` snapshots them at import (module-level env writes land after the first
module load). Production is unaffected (env is set there); it is a test-isolation defect from §87.

**Limitations:** read state is still one `read_at` per message, so a COMPANY_INTERNAL room shows ✓✓ on
the first staff read; the ack body is stored in English by design (both participants must see the same
words); no browser/E2E run.

---

