# Realtime

## Architecture

WebSocket server runs alongside the Express backend.

### Endpoint
```
ws://your-backend.onrender.com/ws
```

## Channels

| Channel | Events |
|---------|--------|
| cart:updated | Cart item changed |
| order:created | New order placed |
| order:updated | Order status changed |
| product:updated | Product details changed |
| inventory:updated | Stock level changed |
| seller:updated | Seller profile changed |
| notification:created | New notification |
| profile:updated | User profile changed |

## Client Protocol

```json
// Subscribe to channel
{ "type": "subscribe", "channel": "order:created" }

// Unsubscribe
{ "type": "unsubscribe", "channel": "order:created" }

// Server broadcasts
{ "type": "event_name", "channel": "order:created", "data": {...}, "timestamp": "..." }
```

## Important

WebSocket is a DELIVERY MECHANISM.
Neon PostgreSQL is the SOURCE OF TRUTH.
Never treat WebSocket state as permanent database state.
