# Chat image UI — VelShop (2026-10-31)

**Date:** 2026-10-31 · **Agent:** Android Harness
**Starting commit:** `ee86b01` · **Ending commit:** this commit · **Branch:** `main`

## Task
Finish the user-facing half of §96 (minimal chat UI + image messaging). This session delivers the shared
client plumbing and the VelShop surface; **VelSeller and VelCenter are NOT wired yet** — see Remaining.

## Changes
| File | Change |
|---|---|
| `packages/shared/src/lib/chat-attachment.ts` (new) | `validateChatImage` (type/size, mirrors the server) and `uploadChatImage` (presign `purpose:"chat"` → XHR PUT with real progress → returns the server-minted `objectKey`). The key is only used after the PUT succeeds. |
| `packages/shared/src/components/chat/chat-image.tsx` (new) | `ChatImageMessage` (bubble image → full-screen viewer), `ChatImageViewer` (Escape/backdrop/close, `aria-modal`), `ComposerImagePreview` (thumbnail, progress bar, error + retry, remove). |
| `apps/velshop/src/pages/ShopChat.tsx` | attachment state + hidden file input + `ImagePlus` button; upload runs BEFORE the message is created; `attachmentKey` is passed to the existing send action (the action posts its arg object, so no API-route change); optimistic bubble shows a local object URL; image rendered above the caption, body optional; send button enabled for image-only. |
| i18n `th/en/my` | `chat.attachImage`, `chat.imageAlt`, `chat.viewImage` (parity 1268). |

## Tests performed
- `bun --filter @velnox/velshop typecheck` → **PASS**
- `bun run i18n:check` → **PASS (1268/1268/1268)**
- `bun --filter @velnox/velshop build` → **PASS**
- `git diff --check` → clean
- NOT RUN: Seller/Center typecheck+build (not wired yet), DB-gated attachment tests, browser E2E (no accounts).

## Database
No change. Production already has `attachment_key` and `chat_messages_body_or_attachment_check`
(reconcile run `41189938588`), verified by EXPLAIN in §96's follow-up.

## Current State
**PARTIALLY WORKING** — a VelShop customer can pick, preview, remove and send an image (with or without a
caption), and images render in the timeline with a full-screen viewer. Sellers receiving that image will see
a bubble **without** the image until VelSeller is wired (it renders `body` only).

## Remaining (next session, in order)
1. Wire `SellerChat.tsx` and `center/ChatManagement.tsx` with the same shared lib/components (sender +
   bubble + composer).
2. DB-gated tests: cross-conversation key rejected, oversized/non-image rejected, missing object rejected.
3. Browser E2E with two accounts (blocked: no credentials).
4. Deliberate UI polish pass toward the minimal reference beyond the current baseline.
