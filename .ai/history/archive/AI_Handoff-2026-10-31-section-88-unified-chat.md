# §88. Unified Marketplace Chat (2026-10-30)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-10-31 to keep the live handoff
> under this environment's ~55 KB edit-tool ceiling. Nothing was discarded.

## §88. Unified Marketplace Chat (2026-10-30) — COMPLETE

**Starting SHA:** `2633cdf8bf2f11acfb0c0f4cb3100cfff361a228` (`HEAD == origin/main`, 0/0, clean tree).
**Code commit:** `feat(chat): add unified marketplace company and internal chat` (find with
`git log -1 --format=%H -- backend/routes/center-chat.ts`). **Docs commit:** `docs(ai): record unified
marketplace chat implementation` (find with `git log -1 --format=%H -- .ai/history/2026-10-30-unified-marketplace-chat.md`).
**Report:** [`.ai/history/2026-10-30-unified-marketplace-chat.md`](./history/2026-10-30-unified-marketplace-chat.md).

**Final chat architecture.** ONE core: `conversations` + `chat_messages`, with
`conversations.type` = `CUSTOMER_SELLER` | `CUSTOMER_COMPANY` | `SELLER_COMPANY` | `COMPANY_INTERNAL`.
`routes/chat.ts` owns the customer/seller routes and the shared helpers (`validateBody`, `loadMessages`,
`readUpTo`/`READ_BOUND_SQL`, `replaySend`/`rememberSend`, `notifyUser`, `notifyCompanyStaff`);
`routes/center-chat.ts` imports them for company endpoints. There is NO second table, engine, socket,
channel or polling loop. `sender_role` gained `company`; `conversations` gained `title`,
`support_status` (OPEN/ASSIGNED/WAITING/CLOSED) and `assigned_to`, and its participant columns are now
nullable **by type** (`conversations_participant_shape_check`). Partial unique indexes guarantee one
customer-company thread, one seller-company thread and one internal room per title.

**Surfaces.** VelShop Chat → **Shops** / **Velnox Support**; VelSeller Chat → **Customers** / **Velnox**;
VelCenter → **Chat** tab → **Customers** / **Sellers** / **Internal** (new `ChatManagement.tsx`).
Shop-chat CTAs exist on product, store and order pages. Support is a real `CUSTOMER_COMPANY` thread, not
a reserved shop: a legacy `velnox-support` thread is converted in place (messages preserved) on first
open, and remains readable by company chat before conversion.

**Authorization.** Customer = own `customer_id`; seller = own approved `seller_id`; company =
`users.role IN (owner, admin, staff)` AND only company types — a private `CUSTOMER_SELLER` row is refused
(404) unless it is the legacy support row. Sender identity is always the session; `assignedTo` must be an
active company member. Realtime is addressed (`sendToUser` / `sendToCenter`) on the existing shared
socket: `chat:message`, `chat:read`, plus `chat:conversation` for a new internal room.

**Also fixed (in scope):** `GET .../messages` returned raw `sender_id` / `created_at` while clients read
`senderId` / `createdAt`; `loadMessages` now maps through `mapMessage`, so reloaded threads keep own-side
alignment, timestamps and read ticks.

**Verified:** backend `tsc --noEmit` PASS · root typecheck 4/4 · `build:apps` 4/4 · i18n 1262/1262/1262 ·
new `chat-unified.test.ts` **13 pass / 0 fail** · existing chat suite **27 pass / 0 fail** · full backend
suite on disposable PG14 **1412 pass / 2 skip / 0 fail** (1414 tests, 71 files) · reconciler applied twice
with no error and no duplicate · `bash db/verify-reconciler.sh` **52/52 PASS** after re-measuring the
canonical object counts to `63|239|265|657` · `git diff --check` clean. The 2 skips are pre-existing R2-credential cases.

**Limitations (deliberate, documented):** read state is one `read_at` per message, not per staff member;
send idempotency is still the in-process `recentSends` map (durable UNIQUE column deferred); internal rooms
are visible to every company member (no membership table); company unread counts are messages; product
context is preserved but order context is not stored on a conversation. No browser/E2E run. Out of scope:
attachments, emoji/reactions, editing/deletion, typing indicators, tickets/SLA/CRM, Redis/broker, separate
chat service.

**Next:** durable chat idempotency (schema + unique index), per-staff read state if needed, internal room
membership, order-linked context, then the deferred browser E2E for the five golden flows.

---

