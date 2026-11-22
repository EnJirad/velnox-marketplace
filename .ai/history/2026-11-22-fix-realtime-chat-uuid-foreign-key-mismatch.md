# Session History — Fix Neon PostgreSQL Realtime Chat UUID Foreign Key Type Mismatch

**Date:** 2026-11-22
**Task:** Resolve PostgreSQL migration error `SQLSTATE 42804` (foreign key constraint cannot be implemented due to incompatible TEXT and UUID types) in `0005_realtime_chat.sql`.
**Status:** COMPLETED & FULLY VERIFIED
**Branch:** `main`

---

## 1. Problem Root Cause Analysis
During migration execution of `0005_realtime_chat.sql` against clean Neon PostgreSQL, PostgreSQL emitted:
```
ERROR: 42804: foreign key constraint "conversations_customer_id_fkey" cannot be implemented
DETAIL: Key columns "customer_id" and "id" are of incompatible types: text and uuid.
```
- **Referenced Primary Keys:**
  - `users.id` is defined as `UUID PRIMARY KEY DEFAULT gen_random_uuid()` (`0001_identity.sql`).
  - `sellers.id` is defined as `UUID PRIMARY KEY DEFAULT gen_random_uuid()` (`0002_marketplace_core.sql`).
  - `shops.id` is defined as `UUID PRIMARY KEY DEFAULT gen_random_uuid()` (`0002_marketplace_core.sql`).
  - `orders.id` is defined as `UUID PRIMARY KEY DEFAULT gen_random_uuid()` (`0003_commerce_core.sql`).
- **Defect in `0005_realtime_chat.sql`:**
  - Foreign key referencing columns (`customer_id`, `seller_id`, `shop_id`, `order_id`, `assigned_to`, `conversation_participants.user_id`, `chat_messages.sender_id`, `notifications.user_id`, `fcm_tokens.user_id`) were defined as `TEXT`, directly conflicting with the referenced `UUID` primary key types.
  - Table primary keys (`conversations.id`, `chat_messages.id`, `notifications.id`, `fcm_tokens.id`) were also defined as `TEXT` rather than the canonical `UUID PRIMARY KEY DEFAULT gen_random_uuid()`.

---

## 2. Changes Made
1. **`database/clean-migrations/0005_realtime_chat.sql` & `workers/api/migrations/0005_realtime_chat.sql`:**
   - Changed table primary keys (`conversations.id`, `chat_messages.id`, `notifications.id`, `fcm_tokens.id`) to `UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
   - Changed all referencing foreign key columns to `UUID`:
     - `conversations.customer_id UUID REFERENCES users(id) ON DELETE SET NULL`
     - `conversations.seller_id UUID REFERENCES sellers(id) ON DELETE SET NULL`
     - `conversations.shop_id UUID REFERENCES shops(id) ON DELETE SET NULL`
     - `conversations.order_id UUID REFERENCES orders(id) ON DELETE SET NULL`
     - `conversations.assigned_to UUID REFERENCES users(id) ON DELETE SET NULL`
     - `conversation_participants.conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE`
     - `conversation_participants.user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
     - `conversation_participants.last_read_message_id UUID`
     - `chat_messages.conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE`
     - `chat_messages.sender_id UUID REFERENCES users(id) ON DELETE SET NULL`
     - `notifications.user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
     - `fcm_tokens.user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
   - Preserved `chat_messages.client_id TEXT` for client-side message idempotency.
   - Added self-healing idempotent migration block (`DO $$ BEGIN ... END $$;`) to safely alter existing text columns to UUID without data loss if applied against an existing database.
   - Ensured clean migrations and worker migrations remain 100% byte-for-byte identical.
2. **`database/tests/clean-migrations.test.ts`:**
   - Added automated test suite asserting:
     - 100% byte-for-byte parity between `clean-migrations/` and `workers/api/migrations/`.
     - All referenced primary keys across clean migrations are `UUID`.
     - Strict foreign key type compatibility with zero `TEXT REFERENCES <UUID table>` occurrences.
     - Verification of self-healing migration safety.

---

## 3. Verification Results
- `bun run typecheck:all`: 4 apps + 4 packages + Workers API all PASS (0 errors)
- `bun test packages/*/tests`: 28/28 PASS across 4 files
- `bun --filter @velnox/api test`: 94/94 PASS across 15 test suites
- `node --experimental-strip-types --test database/tests/clean-migrations.test.ts`: 4/4 PASS
- `bun run test:rebuild`: 91/91 PASS across 30 domain suites
- `wrangler deploy --dry-run`: PASS (1019.83 KiB)
- `git diff --check`: PASS (clean, 0 warnings)
