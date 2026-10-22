# REALTIME

> **SUPERSEDED (2026-10-22).** There is **no WebSocket** in this repository: the
> server and `backend/realtime/` were removed in `AI_HANDOFF.md` §92. Every MVP
> page reads `/api/mvp/*` and refetches. Do not reintroduce a channel without a
> stated consumer.

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
