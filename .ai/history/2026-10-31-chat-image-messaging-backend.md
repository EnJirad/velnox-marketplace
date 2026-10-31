# Chat image messaging — backend — 2026-10-31

**Date:** 2026-10-31 · **Agent:** Android Harness
**Starting commit:** `c00c870` · **Ending commit:** this commit · **Branch:** `main` (committed + pushed)

## Task
Add image messaging to the existing chat (Minimal UI + image messaging request). This session delivers the
BACKEND half only; the UI (picker, bubbles, viewer) is NOT implemented — see Remaining Problems.

## Initial State
`c00c870`, tree clean. `chat_messages` had no attachment column; `/api/upload/presign` allowed only
avatar/cover/shop-logo/shop-cover and every namespace it mints is validated at confirm time
(`upload-security.test.ts` enforces that invariant).

## Investigation
- `backend/routes/upload.ts`: fixed namespaces, membership already solved for shops; `validateObjectKeyOwnership`
  validates at confirm; `headR2Object(key) → {found, size, contentType}` is the only R2 metadata helper;
  `MAX_UPLOAD_BYTES = 10 MB`.
- `backend/routes/chat.ts`: one durable insert helper (`insertHumanMessage`), `mapMessage` shapes the wire.

## Changes Made
| File | Change | Why |
|---|---|---|
| `db/schema.sql` | `attachment_key TEXT`; body CHECK relaxed to `char_length(body) <= 4000` + named `chat_messages_body_or_attachment_check` | an image message may carry no caption |
| `db/run-sqleditor.sql` | same column + guarded `DO` block that drops the old `chat_messages_body_check` and adds the new constraint once | additive, rerunnable repair for existing databases |
| `db/verify-reconciler.sh` | `CANON="63|241|266|661"` (measured: +1 constraint, +1 column) | the count guard must follow the schema |
| `backend/routes/upload.ts` | purpose `chat`; key `chat/{conversationId}/{userId}/{uuid}.webp` minted after `loadChatAudience` + `isChatParticipant`; `validateObjectKeyOwnership` accepts that shape for the sender | proves membership before signing; keeps the presign↔confirm invariant |
| `backend/routes/chat.ts` | `attachmentKey` on `insertHumanMessage`; `resolveChatAttachment()` (prefix must be `chat/{conversation}/{sender}/`, R2 `head` must find an `image/*` ≤ 10 MB); `mapMessage` exposes `attachmentKey` + `attachmentUrl` | server-validated attachment, never a client-chosen key |
| `backend/routes/center-chat.ts` | same validation, sender from `member.id` | staff images use the same rule |
| `backend/tests/upload-security.test.ts` | array assertion updated to include `chat` + asserts the chat namespace branch | the guard now covers the new purpose |

## Tests Performed / Results
- `bun --filter @velnox/backend typecheck` → **PASS**
- `bun test backend/tests` → **1113 pass / 375 skip / 8 fail**; the 8 are the Termux-only
  `test database guard` subprocess probes (green on CI). No other failures.
- `git diff --check` → clean.

## Bugs Found / Fixed
- First attempt put the constraint-repair `DO` block in `db/schema.sql`, and
  `the canonical schema never alters a table it does not create` caught it. Fixed by keeping the snapshot
  pure DDL and the repair in the reconciler only.

## Database Changes
Additive: one nullable column + one replaced CHECK. **No data was touched**; no migration was run against
production in this session.

## Current State
**Backend READY, UI MISSING.** An image message can now be created and read through the API, but no client
offers a picker or renders an image.

## Remaining Problems (next session, in order)
1. Production reconcile is REQUIRED before the UI ships (the same code-before-schema failure mode as §95's
   incident): run `Production DB Reconcile`, then `Production DB Verify`.
2. Shared client helper (presign → PUT → key) + composer attachment button, preview, remove, retry.
3. Bubble rendering (`attachmentUrl`) + full-screen viewer in all three apps.
4. DB-gated tests: attach another conversation's key → refused; oversized/non-image → refused.

## Notes for the next agent
- Never mint a presign namespace that `validateObjectKeyOwnership` cannot validate — that invariant has a test.
- `resolveChatAttachment` is the only place that decides whether an attachment is legitimate; keep it that way.
