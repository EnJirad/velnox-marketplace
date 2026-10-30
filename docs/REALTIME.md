# Realtime

## Architecture

WebSocket server runs alongside the Express backend.

### Endpoint
```
ws://your-backend.onrender.com/ws
```

The socket is authenticated during the handshake from the `velnox_session`
httpOnly cookie (JWT signature + `revoked_tokens`), and the connection's role is
read from `users.role` **server-side** — never from a frame the client sent.

## Channels

A `subscribe` frame is a REQUEST. The server answers from its own data and
refuses anything else with `{ "type": "error", "code": "FORBIDDEN" }`.

| Channel | Events | Audience |
|---------|--------|----------|
| `user:{userId}` | `chat:message`, `chat:read`, `chat:typing`, `notification:created` | that user's own connections only |
| `cart:updated` | Cart item changed | authenticated (own data) |
| `profile:updated` | User profile changed | authenticated (own data) |
| `order:created` | New order placed | **addressed, not subscribable** |
| `order:updated` | Order status changed | **addressed, not subscribable** |
| `shipment:updated` | Parcel status changed | **addressed, not subscribable** |
| `product:updated` | Product details changed | owner / admin / staff only |
| `inventory:updated` | Stock level changed (cross-shop fact) | owner / admin / staff only |
| `seller:updated` | Seller profile changed | owner / admin / staff only |
| `audit:created` | Audit log entry written | owner / admin / staff only |
| `config:updated` | Categories / platform settings changed | owner / admin / staff only |
| `notification:created` | Employee account events | owner / admin / staff only |

### Order-scoped events are addressed

`order:created`, `order:updated` and `shipment:updated` have no subscribable
channel. The backend resolves the order's entitled sessions from Neon
(`orders.user_id`, `orders.shop_id → shops.seller_id → sellers.user_id`) and
delivers to those connections plus every connected VelCenter session. Payloads
carry identifiers and status only — no customer PII, no payment data. A client
cannot subscribe to a feed of other people's orders, and an anonymous socket
receives nothing.

The role is re-read every 30 s by the same sweep that closes revoked sessions, so
losing a center role drops the private subscriptions instead of leaving them live.

## Client Protocol

```json
// Subscribe to a channel the connection is entitled to
{ "type": "subscribe", "channel": "product:updated" }

// Unsubscribe
{ "type": "unsubscribe", "channel": "product:updated" }

// Server pushes
{ "type": "event_name", "channel": "product:updated", "data": {...}, "timestamp": "..." }

// Refused subscription
{ "type": "error", "code": "FORBIDDEN", "message": "Channel not allowed" }
```

### Chat presence frames (ephemeral)

`chat:viewing` / `chat:viewingEnd` (`{ conversationId }`) and `chat:typing`
(`{ conversationId, typing }`) are COMMANDS a client sends upward, not
subscriptions. The server resolves the conversation's audience from
`conversations` (`backend/lib/chat-access.ts`) and refuses a frame from anyone
who is not a participant — a staff session is refused on a private
`CUSTOMER_SELLER` thread. `chat:typing` is addressed to the OTHER participants
only (never echoed to the sender), is throttled client-side (2.5 s) and expires
after 6 s, and is **never written to the database**: a dropped stop frame must
not leave a permanent "…is typing" state.

All browsers use the ONE shared client (`packages/shared/src/lib/chat-socket.ts`),
owned by `RealtimeProvider` at the app root with backoff + jitter and
resubscription after a drop.

## Important

WebSocket is a DELIVERY MECHANISM.
Neon PostgreSQL is the SOURCE OF TRUTH.
Never treat WebSocket state as permanent database state.
Every consumer re-reads authoritative data from `/api/*` (and once more after a
reconnect), because events published while the socket was down were never
delivered.
