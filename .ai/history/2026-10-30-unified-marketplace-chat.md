# 2026-10-30 — Unified Marketplace Chat (Customer / Seller / Company / Internal)

**Status:** COMPLETE — implementation, schema, tests, verification, documentation.

## 1. Starting SHA

`2633cdf8bf2f11acfb0c0f4cb3100cfff361a228`

`HEAD == origin/main` (0 ahead / 0 behind), branch `main`, working tree clean before editing. `git fetch origin --prune` was run first.

## 2. Architecture inspected before changing anything

- `AGENTS.md`, `.ai/AI_RULES.md`, `.ai/README.md`, `.ai/AI_HANDOFF.md`
- `.ai/context/project-map.md`, `database.md`, `realtime.md`, `security.md`
- `backend/routes/chat.ts`, `backend/realtime/index.ts`, `backend/routes/index.ts` (account summary), `backend/server.ts`
- `backend/lib/permissions.ts`, `backend/middleware/auth.ts`
- `packages/shared/src/lib/chat-socket.ts`, `packages/shared/src/hooks/use-chat-unread.ts`, `packages/shared/src/lib/api-routes.ts`
- `apps/velshop/src/pages/ShopChat.tsx`, `ShopProductDetail.tsx`, `ShopDetail.tsx`, `ShopOrderDetail.tsx`
- `apps/velseller/src/pages/SellerChat.tsx`
- `apps/velcenter/src/pages/Center.tsx`, component conventions
- `db/schema.sql`, `db/run-sqleditor.sql`, `backend/tests/helpers/canonical-schema.ts`, `backend/tests/db-run-sqleditor-reconciler.test.ts`
- `backend/tests/chat-support-phase2d.test.ts` (the existing chat contract)

## 3. What already existed

- ONE `conversations` + `chat_messages` pair for customer↔seller.
- `conversations` required customer + seller + shop, `UNIQUE (customer_id, shop_id)`, `product_id` context.
- `chat_messages.sender_role` allowed only `customer` / `seller`; 1..4000 char check.
- Customer and seller REST endpoints with session-derived sender identity, bounded reads (`upTo`), in-process `clientId` idempotency.
- Addressed realtime (`sendToUser`) for `chat:message` / `chat:read`, one shared browser socket, reconnect refetch.
- A server-derived unread badge (`useChatUnread`) using account-summary / seller conversation rows.
- Velnox Support was a **reserved marketplace shop** (`velnox-support`) owned by a seeded support seller; support threads were ordinary customer↔shop conversations.
- VelCenter had **no** chat surface, and no company/internal conversation concept.

## 4. What changed

### 4.1 One conversation model, four types

`conversations.type`:

```
CUSTOMER_SELLER   customer ↔ marketplace seller (unchanged behaviour)
CUSTOMER_COMPANY  customer ↔ Velnox company support
SELLER_COMPANY    seller ↔ Velnox company
COMPANY_INTERNAL  company staff only
```

The same table, message table, validator, read bound, pagination and idempotency helper are used by all four. VelCenter (`routes/center-chat.ts`) imports the helpers from `routes/chat.ts`; there is no second chat engine, table, socket, channel or polling loop.

### 4.2 Customer (VelShop)

- Chat now has two explicit inboxes: **Shops** and **Velnox Support**.
- Shop threads keep product context and the existing customer↔seller endpoints.
- Velnox Support is a `CUSTOMER_COMPANY` row, not a fake shop.
- A legacy reserved-shop support thread is **converted in place** on first open: `type = CUSTOMER_COMPANY`, `seller_id = NULL`, `shop_id = NULL`; messages, timestamps and read state are preserved. Legacy rows are also labelled/treated as company support before conversion, so no history is lost.
- Starting a shop chat is possible from the product page (existing CTA), the **store page** (new CTA), and **order detail** (new CTA, product context when available).

### 4.3 Seller (VelSeller)

- Chat has exactly two primary tabs: **Customers** and **Velnox**.
- Customers lists only the seller's own `CUSTOMER_SELLER` conversations.
- Velnox is a `SELLER_COMPANY` thread; a CTA creates it when absent.
- Replies from company staff arrive through the same seller endpoints and show `sender_role = 'company'`.
- Another seller cannot read or reply to the thread (server-side `seller_id` scope).

### 4.4 Company (VelCenter)

- New **Chat** tab with exactly three primary tabs: **Customers**, **Sellers**, **Internal**.
- Customers: `CUSTOMER_COMPANY` + legacy reserved-shop support rows. Staff can read/reply/mark read; customer identity and product context are shown.
- Sellers: `SELLER_COMPANY`; seller + shop identity.
- Internal: `COMPANY_INTERNAL` rooms; staff can create a room, read and reply.
- Lightweight support state: `support_status` (`OPEN`, `ASSIGNED`, `WAITING`, `CLOSED`) and `assigned_to`; a staff reply claims an unassigned thread and moves the status forward. No SLA/CRM/ticket workflow.
- Center staff can **never** open a private customer↔seller thread: the only `CUSTOMER_SELLER` rows reachable from the company module are the reserved-shop legacy support rows.

### 4.5 Shared core correction found during testing

The messages endpoint (`GET .../messages`) returned raw `pg` rows (`sender_id`, `sender_role`, `created_at`) while every consumer expects the camelCase shape produced by `mapMessage` (`senderId`, `senderRole`, `createdAt`). Reloaded threads therefore lost their own-message side, timestamps and read ticks. `loadMessages` now maps every row through the same `mapMessage` used by the send responses. This is a shipped defect fix inside the chat scope, not an unrelated refactor.

## 5. Schema changes (minimal, additive)

Both canonical files updated together: `db/schema.sql` and `db/run-sqleditor.sql`.

`conversations`:

- `type TEXT NOT NULL DEFAULT 'CUSTOMER_SELLER'` with the four-value CHECK.
- `customer_id`, `seller_id`, `shop_id` become nullable **by type**; existing CUSTOMER_SELLER rows already satisfy the participant-shape CHECK.
- `title TEXT` for internal rooms.
- `support_status TEXT NOT NULL DEFAULT 'OPEN'` with OPEN/ASSIGNED/WAITING/CLOSED.
- `assigned_to UUID REFERENCES users(id) ON DELETE SET NULL`.
- `CONSTRAINT conversations_participant_shape_check` enforces exactly which participants each type requires.
- Partial unique indexes: one `CUSTOMER_COMPANY` per customer, one `SELLER_COMPANY` per seller, one internal room per title.
- Indexes: `(type, updated_at DESC)` and `(assigned_to, updated_at DESC) WHERE assigned_to IS NOT NULL`.

`chat_messages`:

- `sender_role` CHECK widened to `customer | seller | company`.

Reconciler: new `ADD COLUMN IF NOT EXISTS` entries, the existing additive `DROP NOT NULL` pass extended to the three participant columns, new indexes, a guarded `assigned_to` FK, guarded type/status/shape CHECKs, and a guarded drop/re-add of `chat_messages_sender_role_check` (PostgreSQL cannot ALTER a CHECK; the vocabulary only adds a value). Applied twice to the disposable PG14 database with no error and no duplicate object; the rerun is a no-op.

The canonical object-count baseline in `db/verify-reconciler.sh` was re-measured and updated `63|234|261|653` → `63|239|265|657` (exactly +4 columns, +5 indexes, +4 constraints; the widened CHECK changes definition, not count). This is a proof fixture, not a schema change.

## 6. Permission model (all resolved server-side)

| Viewer | May access | Scope enforcement |
|---|---|---|
| Customer | CUSTOMER_SELLER, CUSTOMER_COMPANY | `conversations.customer_id = session user` on every read/send/read-receipt |
| Seller | CUSTOMER_SELLER, SELLER_COMPANY | approved `sellers.user_id = session user`, then `conversations.seller_id = that seller` |
| Company | CUSTOMER_COMPANY, SELLER_COMPANY, COMPANY_INTERNAL | `users.role IN (owner, admin, staff)`; private CUSTOMER_SELLER refused unless it is the legacy support row |
| Everyone else | nothing | 403 on company endpoints; 404 on another customer's/seller's conversation |

Client-supplied `senderId` / `senderRole` are ignored everywhere; `assignedTo` is validated to be an active company member. Frontend tab visibility is UX only — every endpoint re-checks.

## 7. Realtime model

- No new WebSocket, channel, polling loop or per-surface connection. The app-root `RealtimeProvider` still owns the one shared socket.
- Events reused: `chat:message`, `chat:read`; added `chat:conversation` for a newly created internal room (a signal to refetch the list).
- Delivery is addressed: `sendToUser` for the customer/seller participant, `sendToCenter` for company sessions. No broadcast channel exists to subscribe to.
- All three surfaces dedupe messages by id and refetch authoritative lists/threads after reconnect; `chat:read` updates ticks.
- Notifications reuse `notifications` rows + `notification:created`; a recipient already viewing the thread is skipped. Company notifications go to active owner/admin/staff accounts (bounded at 100).

## 8. Tests

New `backend/tests/chat-unified.test.ts` — 13 tests, 135 assertions:

- customer↔seller create/send/reply/receive; customer and seller isolation.
- customer→company create (stable get-or-create), send, staff list/read/reply, company sender role, account-summary unread, assignment/status + invalid inputs, customer/seller 403 on company endpoints.
- seller→company create/send, staff list/reply, seller receives company message, another seller 404/403.
- internal room create/list/send/reply; customers and sellers 403.
- company cannot open a private CUSTOMER_SELLER thread (404 on messages/send/read, absent from the customer tab).
- addressed realtime: staff receives customer→company, stranger receives nothing, customer receives company reply, seller receives company reply.
- unread counts per role, bounded read, no cross-customer/seller leak.
- structural: one schema/core, center imports shared helpers, no second socket/DDL, reconnect refetch + id dedupe in all three surfaces.

Existing `chat-support-phase2d.test.ts` updated only where the scope genuinely changed:

- three read endpoints now forward `upTo` (customer, seller, company) instead of two;
- no customer/seller unread endpoint was invented; the company aggregate is the one new count;
- the “replay before any push/notification” probe now searches forward from the reply (the shared `notifyCompanyStaff` helper also contains a `notifyUser` call).

No assertion was weakened; the security claims remain pinned.

## 9. Verification (real commands and results)

| Check | Command | Result |
|---|---|---|
| Backend typecheck | `cd backend && bun tsc --noEmit` | PASS (exit 0) |
| Root typecheck (4 apps) | `bun run typecheck` | PASS 4/4 |
| Frontend builds (4 apps) | `bun run build:apps` | PASS 4/4 |
| i18n parity | `bun run i18n:check` | PASS — th=1262 / en=1262 / my=1262 |
| New unified suite | `TEST_DATABASE_URL=… bun test backend/tests/chat-unified.test.ts` | **13 pass / 0 fail** (135 assertions) |
| Existing chat suite | `TEST_DATABASE_URL=… bun test backend/tests/chat-support-phase2d.test.ts` | **27 pass / 0 fail** (224 assertions) |
| Full backend suite | `cd backend && TEST_DATABASE_URL=… bun test tests` | **1412 pass / 2 skip / 0 fail** (1414 tests, 71 files) |
| Reconciler / parity | `bun test backend/tests/db-run-sqleditor-reconciler.test.ts backend/tests/schema-drift.test.ts backend/tests/product-lifecycle.test.ts` | PASS (85 pass / 3 DB-skipped in that invocation; the full run above executes DB-gated ones) |
| Reconciler proof | `bash db/verify-reconciler.sh` | **PASS — all 52 checks**, fresh/legacy/decoy/incident fixtures, three reruns converge at `63|239|265|657` |
| SQL reruns | `psql "$TEST_URL" -v ON_ERROR_STOP=1 -f db/run-sqleditor.sql` twice | PASS both times, no error |
| Whitespace | `git diff --check` | clean |

The two skips are the pre-existing upload/R2 credential-gated cases, not chat; they are **NOT RUN**, not passes.

## 10. Known limitations

- Read state is a single `read_at` per message, not per staff member. One staff member reading a company thread marks it read for all company staff (the existing model; acceptable for this lightweight phase).
- Send idempotency is still the in-process `recentSends` map. A restart or a second backend instance can forget a `clientId`; the durable fix is a UNIQUE `(conversation_id, sender_id, client_id)` column/index, deliberately not added here.
- Internal rooms are visible to every company member; there is no per-room membership table.
- Company unread counts are message counts, not distinct conversations.
- Product context is preserved; **order context is not stored on a conversation** (the architecture had no `order_id` column). The order page CTA opens the shop thread and carries product context where available.
- No attachments, emoji, reactions, editing, deletion, typing indicators, tickets, SLA, CRM, Redis, broker or separate chat service — all out of scope.
- No browser/E2E run was performed for this task; verification is typecheck/build/API/WebSocket/disposable-DB level.

## 11. Deferred work

- Durable send idempotency (schema column + unique index).
- Per-staff read state if company chat needs individual inbox semantics.
- Internal room membership/roles (e.g. support-only rooms).
- Order-linked conversation context.
- Attachments/images via the existing R2 pipeline.
- A browser E2E journey for the five golden flows (tooling still absent).

## 12. 20-field change record

| # | Field | Value |
|---|---|---|
| 1 | Date + time (timezone) | 2026-10-30 10:37 UTC |
| 2 | AI / agent | Buffy (Codebuff) |
| 3 | Git branch | `main` |
| 4 | Commit SHA before | `2633cdf8bf2f11acfb0c0f4cb3100cfff361a228` |
| 5 | Commit SHA after | Code commit `feat(chat): add unified marketplace company and internal chat`; docs commit `docs(ai): record unified marketplace chat implementation`. Find with `git log -1 --format=%H -- backend/routes/center-chat.ts` and `git log -1 --format=%H -- .ai/history/2026-10-30-unified-marketplace-chat.md`. |
| 6 | Purpose | One marketplace chat: customer↔seller, customer↔company, seller↔company, company internal, with server-side authorization, unread, read state, realtime and legacy support migration. |
| 7 | Inspected before changing | See §2. |
| 8 | Files / folders touched | `backend/routes/chat.ts`, `backend/routes/center-chat.ts` (new), `backend/routes/index.ts`, `backend/server.ts`, `backend/realtime/index.ts`; `db/schema.sql`, `db/run-sqleditor.sql`; shared API/unread/i18n; VelShop chat/store/order pages; VelSeller chat; VelCenter page + new `ChatManagement`; tests. |
| 9 | Added | Four-type conversation model, company/internal routes, center chat UI, seller company thread, customer company thread, tabs, assignment/status, `chat:conversation` signal, i18n keys, tests. |
| 10 | Removed | Reserved-shop **creation** for new support threads (`getSupportShop`); new support threads no longer pretend to be marketplace shops. Legacy rows are preserved. |
| 11 | What changed | Same conversation/message core extended; support migration; message mapping fix; UI surfaces; unread aggregate for company. |
| 12 | Why | The feature request: one Chat Core with role-appropriate views, no duplicate systems, no fake seller for Velnox. |
| 13 | Systems affected | Chat REST, realtime chat delivery, VelShop/VelSeller/VelCenter chat UI, canonical schema, shared API map/unread hook/i18n. |
| 14 | Confirmed unaffected | Orders/payments/Stripe, cart, checkout, products/categories, media/R2, auth/Google OAuth, seller verification, admin permissions, search, marketing site. No SQL/DDL outside `conversations`/`chat_messages`; no `package.json`/lockfile/CI/workflow change; no production database connection. |
| 15 | Tests / checks run | See §9 commands. |
| 16 | Result of each | All PASS except the two pre-existing skips (NOT RUN). |
| 17 | Problems found | Pre-existing GET-messages snake_case/camelCase mismatch (fixed); the old support thread was a fake shop (migrated); existing structural tests assumed exactly two `upTo` forwards and no `/unread` route at all (updated to the new, still-secure reality). |
| 18 | Limitations / not checked | No browser/E2E, no production DB, global read state, in-process dedupe, no order/attachment/internal-membership support. |
| 19 | Work still open | §11. |
| 20 | Next agent must know | The four types are NOT separate systems. Add new chat behaviour to the shared core, never a new table/socket. Company endpoints must keep refusing private CUSTOMER_SELLER rows except `velnox-support`. `sender_role` now includes `company`; both canonical SQL files must stay in declaration parity. |
