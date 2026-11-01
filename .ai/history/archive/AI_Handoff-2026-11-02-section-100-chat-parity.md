# §100. Chat parity (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 to keep the live handoff under this
> environment's ~55 KB edit-tool ceiling. Nothing was discarded.

## §100. Chat parity: VelCenter images, bell-free chat, real unread (2026-11-02) — PARTIAL

**SHA:** `e58cd8b` → this commit. **Report:**
[`.ai/history/2026-11-02-chat-parity-image-visibility-notifications.md`](./history/2026-11-02-chat-parity-image-visibility-notifications.md).

**Root cause of "VelCenter can't see images":** its human bubble never rendered `attachmentUrl` — the image
renderer existed only in the SYSTEM branch. Proven first: production `/api/health/r2` green, the stored
object URL returned **HTTP 200 image/jpeg**, and all surfaces share one `mapMessage`/`loadMessages`. Fixed by
rendering the shared `ChatImageMessage` in the human bubble and skipping the empty `<p>` of image-only rows.

**Bell is business-only.** Every chat `notifyUser`/`notifyCompanyStaff` call and both helpers were removed;
`GET /api/customer/notifications` filters `type <> 'chat'`, so the 8 historical chat rows in production stop
showing without deleting data. Unread stays per conversation from `read_at`, and the preview now prefers
`last_unread_body` (image-only → `📷`) through the existing partial index. Support is excluded from
All/Unread in VelShop + VelSeller; VelCenter keeps its customer/seller/internal tabs.

**Verified:** `chat-parity` 8/8, full suite **1121 pass / 375 skip / 8 fail** (known Termux DB-guard probes;
two old source-contract tests updated to the no-bell contract), typecheck 4/4 + backend, build 4/4,
i18n 1280. **NOT RUN:** browser/E2E (no session; PG18 `initdb` hangs here) and DB-gated suites.

---
