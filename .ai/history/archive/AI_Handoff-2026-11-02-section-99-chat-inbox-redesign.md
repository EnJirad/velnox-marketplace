# §99. Chat inbox + thread redesign, real presence (2026-11-01)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 to keep the live handoff under
> this environment's ~55 KB edit-tool ceiling. Nothing was discarded.

## §99. Chat inbox + thread redesign, real presence (2026-11-01) — PARTIAL

**SHA:** `930de65` → this commit. **Report:**
[`.ai/history/2026-11-01-chat-inbox-redesign.md`](./history/2026-11-01-chat-inbox-redesign.md).

Messages-style inbox in all three apps — search + All/Unread/Support over server data, avatar/preview/time/
unread rows, one shared composer (`+` attach, emoji, Enter/Shift+Enter, disabled in flight, inline retry),
mint outgoing + gray incoming bubbles, date separators, load-older with scroll anchoring, "new messages"
chip. Presence is now REAL: `isUserOnline()` / `getUserLastSeenAt()` read the live socket registry and
`chat:presence` is addressed to the other side of a customer↔seller thread only — no dot for support threads
or internal rooms, nothing hardcoded. Image-only sends preview as `📷`. Reused the one chat core, the shared
socket, `chat-message`/`chat-timeline` and the R2 `purpose=chat` upload: no new table, endpoint, socket or
polling loop.

**Production DB verified read-only (Neon `run_sql`, no writes):** `chat_messages.attachment_key`,
`chat_messages_body_or_attachment_check` and `uq_chat_messages_client_id` exist — image messaging is
schema-ready; no migration was run or needed.

**Verified:** typecheck 4/4, backend `tsc`, build 4/4, i18n 1280/1280/1280, chat suites **34 pass / 38 skip /
0 fail**, full suite **1113 pass / 375 skip / 8 fail** (the 8 are the known Termux DB-guard probes),
`git diff --check` clean. **NOT RUN:** browser E2E and every DB-gated chat test — this device has no session
(Google OAuth only) and no disposable database (PG18 `initdb` hangs at its bootstrap probe here); R2 upload is
untested (no credentials). Presence is in-memory per process and resets on restart — documented, not hidden.

---
