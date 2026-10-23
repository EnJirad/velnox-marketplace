-- Migration 006: Behavioral events
-- Created: 2025-01-01

CREATE TABLE IF NOT EXISTS behavioral_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    metadata JSONB DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_behavioral_events_user_id ON behavioral_events(user_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_events_session ON behavioral_events(session_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_events_type ON behavioral_events(event_type);
CREATE INDEX IF NOT EXISTS idx_behavioral_events_entity ON behavioral_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_events_occurred ON behavioral_events(occurred_at);
