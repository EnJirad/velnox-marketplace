-- Migration: V0034 — Order Shipments & Tracking Events
-- Date: 2026-09-05
-- Description: Adds shipment + tracking event tables so orders can carry
-- real carrier/tracking data (populated by sellers) and the customer
-- tracking timeline can be rendered from actual data.
-- Reason: Order Detail / Tracking pages had no data source for tracking.

CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  carrier TEXT NOT NULL DEFAULT '',
  tracking_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  estimated_delivery_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments (order_id);

CREATE TABLE IF NOT EXISTS tracking_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'info',
  description TEXT,
  location TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment ON tracking_events (shipment_id, occurred_at);