# REALTIME

## Purpose

WebSocket delivery for cart, orders, products, inventory, and notifications. Neon remains source of truth.

## Source Locations

- `backend/realtime/index.ts` — WebSocket server, `subscribe`/`unsubscribe`, `broadcast`
- `backend/server.ts` — mounts realtime on same process as Express
- Channels: `cart:updated`, `order:created`, `order:updated`, `product:updated`, `inventory:updated`, `seller:updated`, `notification:created`, `profile:updated`

## Data Flow

```
Neon mutation → backend broadcasts to channel subscribers → clients receive {type, channel, data, timestamp}
```

## Important Rules

- WebSocket is delivery only; never persist WS state as DB state. On reconnect, re-fetch from Neon.
- Auth for private channels via session cookie where required.

## Verification

Test subscribe/unsubscribe, broadcast on order/product/cart changes, and that refresh re-syncs from `/api/*`.

Related: `docs/REALTIME.md`, `architecture.md`, `backend.md`.
