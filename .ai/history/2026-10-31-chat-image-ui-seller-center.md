# Chat image UI — VelSeller + VelCenter (2026-10-31)

**Starting commit:** `5ec08f3` · **Ending commit:** this commit · **Branch:** `main`

## Task
Continue the reference-matched chat redesign: bring image messaging to the remaining two apps.
`.ai/tasks/active/chat-redesign.md` does **not** exist in this repository; the brief arrived as
`velnox-chat-ui-redesign-task.md` (attached), and that is what was followed.

## Changes
| File | Change |
|---|---|
| `apps/velseller/src/pages/SellerChat.tsx` | Same attachment flow as VelShop: hidden file input + `ImagePlus` button, upload BEFORE the message exists, `attachmentKey` on the existing send action, optimistic object URL, image above the caption, image-only sending, composer preview with progress/remove/retry. |
| `apps/velcenter/src/components/ChatManagement.tsx` | `CenterMessage.attachmentUrl` + `ChatImageMessage` in the bubble, so staff see images customers/sellers send (with the full-screen viewer). |

Shared code reused unchanged: `packages/shared/src/lib/chat-attachment.ts` and
`packages/shared/src/components/chat/chat-image.tsx` (no second upload path, no second viewer).

## Tests performed / results
- `bun run typecheck` → **4/4 PASS**
- `bun run build:apps` → **4/4 PASS**
- `bun run i18n:check` → **PASS (1268/1268/1268)**
- `bun test backend/tests` → **1113 pass / 375 skip / 8 fail** (the 8 are the Termux-only
  `test database guard` subprocess probes; green on CI)
- `git diff --check` → clean

NOT RUN: browser/E2E with two accounts (no credentials), DB-gated attachment-rejection tests.

## Current State
**PARTIALLY COMPLETE** — image messages work end to end in code on all three surfaces:
VelShop sends, VelSeller sends, VelCenter renders (staff sending images is still composer-less).
Search, All/Unread/Support filters, presence and read-receipt polish from the reference are NOT done.

## Remaining
1. VelCenter composer (attach button + upload) — the bubble already renders images.
2. Conversation search + All/Unread/Support filters on the real conversation lists.
3. Presence display only from real data (no presence event exists today — do not fake it).
4. Browser visual verification with two accounts (blocked: no credentials).
