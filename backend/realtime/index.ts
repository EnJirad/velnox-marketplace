import type { IncomingMessage } from "http";
import jwt from "jsonwebtoken";
import { isTokenRevokedSync } from "../middleware/auth.js";
import type { WebSocketServer, WebSocket } from "ws";

interface ConnectedClient {
  ws: WebSocket;
  userId?: string;
  jti?: string;
  subscriptions: Set<string>;
  /** Fixed-window frame budget — stops connection-level flooding. */
  frameCount: number;
  frameWindowStart: number;
  /** Heartbeat liveness — a connection that misses a whole ping window is
   *  terminated so presence and subscriptions cannot outlive the tab. */
  isAlive: boolean;
}

/** Max client frames per window before the connection is closed (1008). */
const MAX_FRAMES_PER_WINDOW = 120;
const FRAME_WINDOW_MS = 10_000;

const clients = new Map<WebSocket, ConnectedClient>();

/**
 * Presence: which conversation a user is currently viewing (chat:viewing /
 * chat:viewingEnd frames). Used so chat notifications are skipped while the
 * recipient is already looking at that thread — the message still arrives
 * over the socket; only the notification row/toast is suppressed.
 *
 * Presence is EPHEMERAL: it lives exactly as long as a live socket for that
 * user. A closed tab never sends `chat:viewingEnd`, so close/terminate must
 * clear it — otherwise every future message in that thread would suppress the
 * notification row forever.
 */
const viewingConversation = new Map<string, string>();

/** Drop a client and any presence it still holds when it was its user's last socket. */
function forgetClient(ws: WebSocket, client: ConnectedClient): void {
  clients.delete(ws);
  const userId = client.userId;
  if (!userId) return;
  for (const other of clients.values()) {
    if (other.userId === userId) return; // another tab is still connected
  }
  viewingConversation.delete(userId);
}

/** Extract the velnox_session cookie from an upgrade request. */
function readSessionCookie(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.match(/(?:^|;\s*)velnox_session=([^;]+)/);
  const value = match?.[1];
  return value ? decodeURIComponent(value) : null;
}

/** Resolve the authenticated user id and jti from the upgrade request cookie (if any).
 *  Checks revocation synchronously via the in-memory cache. */
function resolveUserFromRequest(req: IncomingMessage): { userId: string; jti?: string } | undefined {
  try {
    const token = readSessionCookie(req);
    if (!token) return undefined;
    const secret = process.env.JWT_SECRET;
    if (!secret) return undefined;
    const payload = jwt.verify(token, secret) as { userId: string; jti?: string };
    // Reject revoked tokens — do not authenticate.
    if (payload.jti && isTokenRevokedSync(payload.jti)) return undefined;
    return { userId: payload.userId, jti: payload.jti };
  } catch {
    return undefined;
  }
}

/**
 * Periodic revocation sweep — every 30 seconds, check all authenticated
 * WebSocket connections. If their jti has been revoked (in-memory cache
 * or DB), close the connection with 4001 (Policy Violation).
 *
 * This closes the gap where a user logs out (revoking the token) but
 * their existing WebSocket connection was established before the logout.
 */
/**
 * Heartbeat — ping every live connection once per window. A client that failed
 * to answer the previous ping is terminated, which also releases its presence
 * and subscriptions. Without this an idle proxy-dropped connection can look
 * "open" to the server for hours and keep consuming broadcasts.
 */
let heartbeatStarted = false;
function startHeartbeat(): void {
  if (heartbeatStarted) return;
  heartbeatStarted = true;
  const HEARTBEAT_INTERVAL_MS = 30_000;
  setInterval(() => {
    for (const [ws, client] of clients) {
      if (!client.isAlive) {
        try {
          ws.terminate();
        } catch { /* already closed */ }
        forgetClient(ws, client);
        continue;
      }
      client.isAlive = false;
      try {
        ws.ping();
      } catch { /* closing socket */ }
    }
  }, HEARTBEAT_INTERVAL_MS).unref();
}

let revocationSweepStarted = false;
function startRevocationSweep(): void {
  if (revocationSweepStarted) return;
  revocationSweepStarted = true;
  const SWEEP_INTERVAL_MS = 30_000; // 30 seconds
  setInterval(() => {
    for (const [ws, client] of clients) {
      if (!client.userId || !client.jti) continue;
      if (client.ws.readyState !== 1) continue; // not OPEN
      if (isTokenRevokedSync(client.jti)) {
        try {
          ws.close(4001, "Session revoked");
        } catch { /* already closing/closed */ }
        clients.delete(ws);
      }
    }
  }, SWEEP_INTERVAL_MS).unref(); // .unref() so it doesn't keep the process alive
}

export function setupWebSocket(wss: WebSocketServer): void {
  startRevocationSweep();
  startHeartbeat();
  wss.on("connection", (ws, req: IncomingMessage) => {
    const authed = resolveUserFromRequest(req);
    const now = Date.now();
    const client: ConnectedClient = {
      ws,
      userId: authed?.userId,
      jti: authed?.jti,
      subscriptions: new Set(),
      frameCount: 0,
      frameWindowStart: now,
      isAlive: true,
    };
    clients.set(ws, client);
    ws.on("pong", () => {
      client.isAlive = true;
    });

    ws.on("message", (data) => {
      const raw = data.toString();
      // Per-connection frame budget — the socket only carries small control /
      // presence frames (chat messages go over REST), so a flood means abuse.
      if (raw.length > 4096) {
        ws.close(1009, "Frame too large");
        clients.delete(ws);
        return;
      }
      const msgNow = Date.now();
      if (msgNow - client.frameWindowStart >= FRAME_WINDOW_MS) {
        client.frameCount = 0;
        client.frameWindowStart = msgNow;
      }
      client.frameCount += 1;
      if (client.frameCount > MAX_FRAMES_PER_WINDOW) {
        ws.close(1008, "Rate limited");
        clients.delete(ws);
        return;
      }
      try {
        const msg = JSON.parse(raw) as { type: string; channel?: string };

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
            msg.channel === "audit:created" ||
            msg.channel === "config:updated" ||
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
      forgetClient(ws, client);
    });

    ws.send(JSON.stringify({ type: "connected", message: "Welcome to Velnox WebSocket" }));
  });
}

/** Broadcast an event to every client subscribed to a channel. */
export function broadcast(channel: string, event: string, data: unknown): void {
  const payload = JSON.stringify({ type: event, channel, data, timestamp: new Date().toISOString() });

  for (const client of clients.values()) {
    if (client.ws.readyState === 1 && client.subscriptions.has(channel)) {
      try {
        client.ws.send(payload);
      } catch { /* one dead socket must not abort the fan-out */ }
    }
  }
}

/**
 * Immediately close ALL WebSocket connections for a specific user.
 * Called on logout so the session is severed instantly, not just after
 * the next periodic revocation sweep.
 */
export function closeUserConnections(userId: string): void {
  for (const [ws, client] of clients) {
    if (client.userId === userId && client.ws.readyState === 1) {
      try {
        ws.close(4001, "Session revoked");
      } catch { /* already closing/closed */ }
      clients.delete(ws);
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
      try {
        client.ws.send(payload);
      } catch { /* one dead socket must not abort the fan-out */ }
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
  AUDIT_CREATED: "audit:created",
  /**
   * Platform configuration changed (categories / platform_settings). Published
   * so every open VelCenter session re-reads the affected surface instead of
   * only the session that performed the change. The payload carries the
   * `scope` ("categories" | "settings") and never any setting value.
   */
  CONFIG_UPDATED: "config:updated",
  /**
   * A canonical shipment on an order changed status. Published by the shipment
   * lifecycle routes (seller + center) so every open session — VelCenter's
   * shipping view and the seller's order page — follows the parcel, and so the
   * frontends' shipping-status badges can react without polling.
   */
  SHIPMENT_UPDATED: "shipment:updated",
} as const;