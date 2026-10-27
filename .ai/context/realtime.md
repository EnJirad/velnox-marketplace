# REALTIME

## Purpose

WebSocket delivery for cart, orders, products, inventory, and notifications. Neon remains source of truth.

## Source Locations

- `backend/realtime/index.ts` — WebSocket server, `subscribe`/`unsubscribe`, `broadcast`, `sendToUser`, `sendToUsers`, `sendToCenter`
- `backend/lib/order-events.ts` — the ONE publisher for `order:created` / `order:updated` / `shipment:updated` (resolves the entitled audience from Neon)
- `backend/lib/order-notifications.ts` — the ONE writer of order/payment/shipment notification ROWS
- `backend/server.ts` — mounts realtime on same process as Express

## Channels (audience)

- `user:{id}` — own connections only. `cart:updated`, `profile:updated` — authenticated, self.
- `product:updated`, `inventory:updated`, `seller:updated`, `audit:created`, `config:updated`, `notification:created` — **owner/admin/staff only** (role read from `users.role`, refreshed every 30 s; downgrade drops the live subscriptions).
- `order:created`, `order:updated`, `shipment:updated` — **not subscribable**: addressed delivery to the order's customer, its shop's seller, and connected VelCenter sessions.

## Data Flow

```
Neon mutation commits → publisher resolves the audience (Neon) → addressed push
  {type, channel, data, timestamp} → consumers re-read /api/*
```

## Important Rules

- WebSocket is delivery only; never persist WS state as DB state. On reconnect, re-fetch from Neon.
- Every subscription is authorized SERVER-side at subscribe time from `users.role` — never from client input; anonymous connections get no channels.
- Publish only AFTER the mutation commits, and only for a real change (`moved === true`, a freshly created order, a non-replayed request). No outbox drain worker exists, so a crash between COMMIT and publish loses a signal — consumers refetch on reconnect.
- Order-event payloads carry identifiers/status only: no PII, no payment data.
- Notification rows are written first (row = record), the socket frame is only a nudge.

## Verification

Test subscribe/unsubscribe, broadcast on order/product/cart changes, and that refresh re-syncs from `/api/*`.

Related: `docs/REALTIME.md`, `architecture.md`, `backend.md`.
