# Velnox Realtime

## Overview

Velnox uses WebSocket connections on Render for realtime updates. Neon PostgreSQL is the source of truth; WebSocket is the delivery layer.

## Architecture

```
Frontend → API → Neon (write) → WebSocket event → Frontend (update)
```

## WebSocket Endpoint

```
wss://your-backend.onrender.com/ws
```

## Events

| Event | Description | Payload |
|-------|-------------|---------|
| `PROFILE_UPDATED` | User profile changed | `{ userId, changes }` |
| `CART_UPDATED` | Cart contents changed | `{ cartId, items }` |
| `ORDER_CREATED` | New order placed | `{ orderId, shopId, amount }` |
| `ORDER_UPDATED` | Order status changed | `{ orderId, status }` |
| `PRODUCT_UPDATED` | Product info changed | `{ productId, changes }` |
| `INVENTORY_UPDATED` | Stock level changed | `{ productId, quantity }` |
| `NOTIFICATION_CREATED` | New notification | `{ notification }` |

## Flow

1. Backend receives API request (e.g., create order)
2. Backend writes to Neon PostgreSQL
3. Backend publishes event to WebSocket
4. Connected clients receive the event
5. Frontend updates local state

## Principle

**Neon = Source of Truth**
**WebSocket = Delivery Layer**

The WebSocket never holds state. If a client misses an event, it can always query the API to get the current state.

## Connection Management

- Clients authenticate via JWT on connect
- Server maintains connection registry per user
- Automatic reconnection on client side
- Heartbeat every 30s to detect stale connections
