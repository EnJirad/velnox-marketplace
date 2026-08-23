import type { WebSocketServer, WebSocket } from "ws";

interface ConnectedClient {
  ws: WebSocket;
  userId?: string;
  subscriptions: Set<string>;
}

const clients = new Map<WebSocket, ConnectedClient>();

export function setupWebSocket(wss: WebSocketServer): void {
  wss.on("connection", (ws) => {
    const client: ConnectedClient = { ws, subscriptions: new Set() };
    clients.set(ws, client);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string; channel?: string };

        if (msg.type === "subscribe" && msg.channel) {
          client.subscriptions.add(msg.channel);
          ws.send(JSON.stringify({ type: "subscribed", channel: msg.channel }));
        }

        if (msg.type === "unsubscribe" && msg.channel) {
          client.subscriptions.delete(msg.channel);
          ws.send(JSON.stringify({ type: "unsubscribed", channel: msg.channel }));
        }
      } catch { /* ignore malformed messages */ }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.send(JSON.stringify({ type: "connected", message: "Welcome to Velnox WebSocket" }));
  });
}

export function broadcast(channel: string, event: string, data: unknown): void {
  const payload = JSON.stringify({ type: event, channel, data, timestamp: new Date().toISOString() });

  for (const client of clients.values()) {
    if (client.ws.readyState === 1 && client.subscriptions.has(channel)) {
      client.ws.send(payload);
    }
  }
}

export const CHANNELS = {
  CART_UPDATED: "cart:updated",
  ORDER_CREATED: "order:created",
  ORDER_UPDATED: "order:updated",
  PRODUCT_UPDATED: "product:updated",
  INVENTORY_UPDATED: "inventory:updated",
  SELLER_UPDATED: "seller:updated",
  NOTIFICATION_CREATED: "notification:created",
  PROFILE_UPDATED: "profile:updated",
} as const;
