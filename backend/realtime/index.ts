import type { IncomingMessage } from "http";
import jwt from "jsonwebtoken";
import type { WebSocketServer, WebSocket } from "ws";

interface ConnectedClient {
  ws: WebSocket;
  userId?: string;
  subscriptions: Set<string>;
}

const clients = new Map<WebSocket, ConnectedClient>();

/**
 * Presence: which conversation a user is currently viewing (chat:viewing /
 * chat:viewingEnd frames). Used so chat notifications are skipped while the
 * recipient is already looking at that thread — the message still arrives
 * over the socket; only the notification row/toast is suppressed.
 */
const viewingConversation = new Map<string, string>();

/** Extract the velnox_session cookie from an upgrade request. */
function readSessionCookie(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.match(/(?:^|;\s*)velnox_session=([^;]+)/);
  const value = match?.[1];
  return value ? decodeURIComponent(value) : null;
}

/** Resolve the authenticated user id from the upgrade request cookie (if any). */
function resolveUserIdFromRequest(req: IncomingMessage): string | undefined {
  try {
    const token = readSessionCookie(req);
    if (!token) return undefined;
    const secret = process.env.JWT_SECRET;
    if (!secret) return undefined;
    const payload = jwt.verify(token, secret) as { userId: string };
    return payload.userId;
  } catch {
    return undefined;
  }
}

export function setupWebSocket(wss: WebSocketServer): void {
  wss.on("connection", (ws, req: IncomingMessage) => {
    const client: ConnectedClient = {
      ws,
      userId: resolveUserIdFromRequest(req),
      subscriptions: new Set(),
    };
    clients.set(ws, client);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string; channel?: string };

        // Only allow subscribing to your OWN private user channel, or to
        // public broadcast channels (cart/order/product/notification feeds).
        // This prevents one user from eavesdropping on another user's channel.
        if (msg.type === "subscribe" && msg.channel) {
          const isOwnChannel = !!client.userId && msg.channel === `user:${client.userId}`;
          const isPublicChannel =
            msg.channel === "cart:updated" ||
            msg.channel === "order:created" ||
            msg.channel === "order:updated" ||
            msg.channel === "product:updated" ||
            msg.channel === "inventory:updated" ||
            msg.channel === "seller:updated" ||
            msg.channel === "notification:created";
          if (isOwnChannel || isPublicChannel) {
            client.subscriptions.add(msg.channel);
            ws.send(JSON.stringify({ type: "subscribed", channel: msg.channel }));
          } else {
            ws.send(JSON.stringify({ type: "error", code: "FORBIDDEN", message: "Channel not allowed" }));
          }
        }

        if (msg.type === "unsubscribe" && msg.channel) {
          client.subscriptions.delete(msg.channel);
          ws.send(JSON.stringify({ type: "unsubscribed", channel: msg.channel }));
        }

        // Chat presence — track which conversation this user is viewing.
        if (msg.type === "chat:viewing" || msg.type === "chat:viewingEnd") {
          const data = (msg as { data?: { conversationId?: unknown } }).data;
          const conversationId =
            typeof data?.conversationId === "string" ? data.conversationId : null;
          if (client.userId) {
            if (msg.type === "chat:viewing" && conversationId) {
              viewingConversation.set(client.userId, conversationId);
            } else {
              viewingConversation.delete(client.userId);
            }
          }
        }
      } catch { /* ignore malformed messages */ }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.send(JSON.stringify({ type: "connected", message: "Welcome to Velnox WebSocket" }));
  });
}

/** Broadcast an event to every client subscribed to a channel. */
export function broadcast(channel: string, event: string, data: unknown): void {
  const payload = JSON.stringify({ type: event, channel, data, timestamp: new Date().toISOString() });

  for (const client of clients.values()) {
    if (client.ws.readyState === 1 && client.subscriptions.has(channel)) {
      client.ws.send(payload);
    }
  }
}

/**
 * Send an event to every live connection of a specific user (their private
 * `user:{userId}` channel). Used for chat messages, read receipts and
 * notifications. No-op when the user has no open connections.
 */
export function sendToUser(userId: string, channel: string, event: string, data: unknown): void {
  const targetChannel = channel || `user:${userId}`;
  const payload = JSON.stringify({ type: event, channel: targetChannel, data, timestamp: new Date().toISOString() });

  for (const client of clients.values()) {
    if (client.userId === userId && client.ws.readyState === 1) {
      client.ws.send(payload);
    }
  }
}

/** Whether the user is currently viewing the given conversation thread. */
export function getViewingConversation(userId: string, conversationId: string): boolean {
  return viewingConversation.get(userId) === conversationId;
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
  CHAT_MESSAGE: "chat:message",
  CHAT_READ: "chat:read",
} as const;