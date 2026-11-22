-- Migration: 0005_realtime_chat.sql
-- Description: Clean schema for Unified Realtime Chat, Notifications, and FCM tokens
-- Applied: Velnox Clean Rebuild Initiative (Singapore Neon Single Source of Truth)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Unified Conversations Table
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL CHECK (type IN ('CUSTOMER_SELLER', 'CUSTOMER_COMPANY', 'SELLER_COMPANY', 'COMPANY_INTERNAL')),
    customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    seller_id UUID REFERENCES sellers(id) ON DELETE SET NULL,
    shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    title TEXT,
    support_status TEXT NOT NULL DEFAULT 'OPEN' CHECK (support_status IN ('OPEN', 'ASSIGNED', 'WAITING', 'CLOSED')),
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Conversation Participants Table
CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin', 'observer')),
    last_read_message_id UUID,
    last_read_at TIMESTAMPTZ DEFAULT NOW(),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

-- 3. Chat Messages Table
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('customer', 'seller', 'company', 'system')),
    message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'system', 'order_card', 'action')),
    content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
    attachment_url TEXT,
    client_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. FCM Tokens Table (Push Notifications)
CREATE TABLE IF NOT EXISTS fcm_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'android', 'ios')),
    device_info TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for sub-millisecond query performance
CREATE INDEX IF NOT EXISTS idx_conversations_type_updated ON conversations(type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_seller ON conversations(seller_id) WHERE seller_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_shop ON conversations(shop_id) WHERE shop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_order ON conversations(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_assigned ON conversations(assigned_to) WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_created ON chat_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_client_id ON chat_messages(conversation_id, client_id) WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user ON fcm_tokens(user_id);

-- Migration Safety & Self-Healing: If tables were previously created with TEXT foreign keys,
-- safely alter them to UUID to reconcile type compatibility without data loss.
DO $$
BEGIN
    -- 1. conversations.customer_id
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'conversations' AND column_name = 'customer_id' AND data_type = 'text'
    ) THEN
        ALTER TABLE conversations ALTER COLUMN customer_id TYPE UUID USING customer_id::uuid;
    END IF;

    -- 2. conversations.seller_id
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'conversations' AND column_name = 'seller_id' AND data_type = 'text'
    ) THEN
        ALTER TABLE conversations ALTER COLUMN seller_id TYPE UUID USING seller_id::uuid;
    END IF;

    -- 3. conversations.shop_id
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'conversations' AND column_name = 'shop_id' AND data_type = 'text'
    ) THEN
        ALTER TABLE conversations ALTER COLUMN shop_id TYPE UUID USING shop_id::uuid;
    END IF;

    -- 4. conversations.order_id
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'conversations' AND column_name = 'order_id' AND data_type = 'text'
    ) THEN
        ALTER TABLE conversations ALTER COLUMN order_id TYPE UUID USING order_id::uuid;
    END IF;

    -- 5. conversations.assigned_to
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'conversations' AND column_name = 'assigned_to' AND data_type = 'text'
    ) THEN
        ALTER TABLE conversations ALTER COLUMN assigned_to TYPE UUID USING assigned_to::uuid;
    END IF;

    -- 6. conversation_participants.user_id
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'conversation_participants' AND column_name = 'user_id' AND data_type = 'text'
    ) THEN
        ALTER TABLE conversation_participants ALTER COLUMN user_id TYPE UUID USING user_id::uuid;
    END IF;

    -- 7. chat_messages.sender_id
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'chat_messages' AND column_name = 'sender_id' AND data_type = 'text'
    ) THEN
        ALTER TABLE chat_messages ALTER COLUMN sender_id TYPE UUID USING sender_id::uuid;
    END IF;

    -- 8. notifications.user_id
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notifications' AND column_name = 'user_id' AND data_type = 'text'
    ) THEN
        ALTER TABLE notifications ALTER COLUMN user_id TYPE UUID USING user_id::uuid;
    END IF;

    -- 9. fcm_tokens.user_id
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'fcm_tokens' AND column_name = 'user_id' AND data_type = 'text'
    ) THEN
        ALTER TABLE fcm_tokens ALTER COLUMN user_id TYPE UUID USING user_id::uuid;
    END IF;
END $$;
