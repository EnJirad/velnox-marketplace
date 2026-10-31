# §92. Chat ownership + real-time proof (2026-10-31)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-10-31 to keep the live handoff under this
> environment's ~55 KB edit-tool ceiling. Nothing was discarded.

## §92. Chat ownership + real-time proof, shared by all three apps (2026-10-31) — COMPLETE

**Starting SHA:** `1421d25`. **Root cause of the wrong-side rendering:** VelCenter computed ownership
as `m.senderId === (user?.id ?? null)`. The daily acknowledgment is stored with `sender_id = NULL`, so
while the viewer's id was unresolved the comparison became `null === null` and the platform's own
message rendered on the RIGHT. VelShop/VelSeller used `user?.id` (undefined), so the same row was
CENTRED instead — three apps, three answers. System rows were also centred, never placed LEFT.

**Fix.** One shared module, `packages/shared/src/lib/chat-message.ts`:
`isSystemMessage` (any of `isSystem` / `senderRole === 'system'` / NULL sender), `isOwnMessage`
(a null viewer owns nothing), `messageSide`, `belongsToConversation`, `mergeIncomingMessage` (id
dedupe, same array on duplicate) and `applyReadReceipt` (own messages only, bounded by `upTo`).
All three surfaces now import it: system rows render `justify-start` with a dashed muted bubble and
`role="note"`, and `mine` comes from `isOwnMessage(m, viewerId)`.

**Real-time path — verified, not assumed.** The chain was traced end to end and found intact: the
production VelShop chunk (`ShopChat-CFsDLajF.js`) contains `chat:message`/`chat:read`/`chat:typing`,
all three deployed bundles point at `velnox-api.onrender.com` and `/ws`, and the gateway answers
`101 Switching Protocols` with its `connected` frame. What was wrong was rendering + duplicated per-app
dedupe/ownership logic, which is what produced "messages don't appear / appear on the wrong side".

**Tests added.** `chat-message-alignment.test.ts` (14 behavioural cases: LEFT/RIGHT for customer,
seller and staff, system always LEFT, the `null === null` regression, dedupe by id, receipt bounds) and
`chat-realtime-delivery.test.ts` (10 DB+WebSocket cases: customer→seller, seller→customer,
customer→support incl. the system ack on BOTH sockets, staff reply→customer, seller→company,
internal room, non-participant refusal, offline-then-reconnect). Three older source-text assertions
were updated to the new shared helpers (no assertion weakened).

**Verified here.** `typecheck` 4/4 · backend `tsc` PASS · alignment suite **14 pass / 0 fail** ·
full suite **1100 pass / 370 skip / 8 fail** (the 8 are the Termux-only `process.execPath` probes) ·
`build:apps` 4/4 · `i18n:check` 1265/1265/1265 · `git diff --check` clean. The delivery suite needs
`TEST_DATABASE_URL`, so it SKIPS on this device and is exercised by CI.

---

