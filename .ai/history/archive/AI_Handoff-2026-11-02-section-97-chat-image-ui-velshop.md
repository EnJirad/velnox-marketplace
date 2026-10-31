# §97. Chat image UI — VelShop only (2026-10-31)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 to keep the live handoff under
> this environment's ~55 KB edit-tool ceiling. Nothing was discarded.

## §97. Chat image UI — VelShop only (2026-10-31) — PARTIAL

**Report:** [`.ai/history/2026-10-31-chat-image-ui-velshop.md`](./history/2026-10-31-chat-image-ui-velshop.md).

Shared client plumbing landed: `chat-attachment.ts` (validate + presign + XHR PUT with progress) and
`chat-image.tsx` (bubble, full-screen viewer, composer preview/retry/remove). VelShop's `ShopChat` now picks,
previews, removes and sends an image (caption optional) through the existing send action, and renders images
with a viewer.

**NOT DONE:** VelSeller and VelCenter are not wired (they still render `body` only), so an image sent by a
customer is invisible there. DB-gated attachment tests and browser E2E are also pending.

Verified: velShop typecheck/build PASS, i18n 1268/1268/1268, diff clean.

---
