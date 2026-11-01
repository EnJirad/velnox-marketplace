# §102. VelCenter Support Inbox (2026-11-01)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom. Nothing discarded.

## §102. VelCenter Support Inbox (2026-11-01) — PARTIAL

**SHA:** `76133f1` → `e5971cb`. **Report:**
[`.ai/history/2026-11-01-support-inbox-e2e-attempt.md`](./history/2026-11-01-support-inbox-e2e-attempt.md).

Support is now an explicit inbox instead of a hidden corner of the customer tab.
`GET /api/center/chat/conversations?type=support` merges the two existing support queries (customer support
incl. legacy reserved-shop rows + seller support), tags each row `supportAudience`, sorts newest-first, and
`/api/center/chat/unread` returns `support = customers + sellers`. The center UI defaults to a
**Support Inbox** tab with a per-row audience label; the per-audience and internal tabs remain. No new table,
endpoint family or message model, and the same `requireCenterMember` gate.

**Verified in CI on `e5971cb`:** Production DB Verify **#59 all 4 jobs green** (production schema/identity
verified; disposable PostgreSQL suite **1489 pass / 0 fail / 1491 tests**), Tests #232 ✅ — including the new
DB test *"Support Inbox merges customer + seller support and excludes commerce"* (a private customer↔seller
thread never appears) and the badge identity `support = customers + sellers`. Company read stays Model A.

**NOT RUN:** browser/E2E in all three apps and real UI image upload — no session (Google OAuth only, no test
accounts), no disposable DB (PG18 `initdb` hangs in this sandbox) and no R2 credentials on the device.
Local: 8 failures are the documented Termux-only DB-guard probes; typecheck 4/4; builds 4/4.

---
