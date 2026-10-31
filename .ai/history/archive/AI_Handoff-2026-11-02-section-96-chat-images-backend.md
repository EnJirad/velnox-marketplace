# §96. Chat images — backend only (2026-10-31)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 to keep the live handoff under
> this environment's ~55 KB edit-tool ceiling. Nothing was discarded.

## §96. Chat images — backend only (2026-10-31) — PARTIAL

**Report:** [`.ai/history/2026-10-31-chat-image-messaging-backend.md`](./history/2026-10-31-chat-image-messaging-backend.md).

Image messages now exist server-side: `chat_messages.attachment_key` (+ relaxed body CHECK so a caption is
optional), a `chat` presign purpose that proves conversation membership before minting
`chat/{conversation}/{sender}/{uuid}.webp`, `resolveChatAttachment()` in the three send routes (prefix + R2
`head` + `image/*` + ≤10 MB), and `mapMessage` exposing `attachmentKey`/`attachmentUrl`.

**NOT DONE: the UI** (picker, preview, bubbles, viewer) in all three apps. Do **not** treat this as shipped:
production also needs a reconcile (the column does not exist there yet) before any client can send one.

Verified: backend tsc PASS; suite 1113 pass / 375 skip / 8 fail (Termux-only probes).

---
