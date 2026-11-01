# §101. CI green (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom. Nothing was discarded.

## §101. CI green + authoritative unread and company read model (2026-11-02) — PARTIAL

**SHA:** `9150048` → `73cd999`. **Report:**
[`.ai/history/2026-11-02-ci-green-chat-unread-company-read.md`](./history/2026-11-02-ci-green-chat-unread-company-read.md).

**CI was red for one real reason, not infrastructure:** `chat-support-phase2d` still expected **1**
`type='chat'` notification row while `9150048` deliberately stopped chat bell writes. The test now pins the
new contract (one message, one push, **zero** bell rows, re-checked after a fresh send). Production DB Verify
failed only because its verdict job waited on that same suite — its production-schema job passed all along.

**Result:** Tests #230 ✅, Production DB Verify #58 ✅ (all 4 jobs, incl. production schema + identity), with
the disposable-PostgreSQL suite at **1486 pass / 0 fail / 1488 tests**, covering the new cases: four unread messages = one conversation state
(preview = newest unread), Support classified separately, and **company read = Model A** (one `read_at` per
message ⇒ any staff read marks the thread read; asserted with two staff).

**NOT RUN:** browser/E2E (no session; PG18 `initdb` hangs here) and UI upload (no R2 credentials).

---
