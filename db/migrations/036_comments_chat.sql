-- =============================================================
-- Migration: V0036
-- Date: 2026-09-07
-- Description: Customer ↔ Seller chat (conversations + messages)
-- Reason: Velnox marketplace needs direct customer↔seller
--         messaging. Database is the source of truth; WebSocket
--         is only the realtime delivery mechanism.
-- Affected: conversations (NEW), chat_messages (NEW)
-- Safety: All CREATE TABLE use IF NOT EXISTS.
-- =============================================================

-- ── 1. Conversations ──────────────────────────────────────────────────────
-- One conversation per (customer, shop) pair. A product context can be
-- attached when the chat is started from a product detail page.
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, shop_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations (customer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_seller ON conversations (seller_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_shop ON conversations (shop_id);

-- ── 2. Chat Messages ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL DEFAULT 'customer' CHECK (sender_role IN ('customer', 'seller')),
  body TEXT NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 4000),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'read')),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_unread ON chat_messages (conversation_id, sender_id, read_at) WHERE read_at IS NULL;