/**
 * Velnox Chat WebSocket Client
 *
 * Single shared connection per app. The backend authenticates the socket
 * from the httpOnly session cookie during the handshake and only allows a
 * client to subscribe to its own `user:{userId}` private channel.
 *
 * Events the server can push:
 *   - "chat:message"          { conversationId, message, clientId? }
 *   - "chat:read"             { conversationId, readerId }
 *   - "notification:created"  { id, type, title, message }
 *
 * Consumers must be idempotent: dedupe incoming messages by message id.
 */
import { apiUrl } from "./sites";

/** WebSocket endpoint derived from the backend origin. */
function wsEndpoint(): string {
  return apiUrl.replace(/\/+$/, "").replace(/^http/, "ws") + "/ws";
}

type EventHandler = (data: any, meta: { channel: string }) => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

let socket: WebSocket | null = null;
let socketUserId: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let manualClosed = false;

const handlers = new Map<string, Set<EventHandler>>();


function emit(event: string, data: any, channel: string): void {
  const set = handlers.get(event);
  if (!set) return;
  for (const handler of set) {
    try {
      handler(data, { channel });
    } catch (err) {
      console.error("[chat-socket] handler error:", err);
    }
  }
}

function scheduleReconnect(): void {
  if (manualClosed) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(socketUserId);
  }, delay);
}

function connect(userId: string | null): void {
  if (!userId) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    const ws = new WebSocket(wsEndpoint());
    socket = ws;

    ws.onopen = () => {
      reconnectAttempts = 0;
      if (socketUserId) {
        ws.send(JSON.stringify({ type: "subscribe", channel: `user:${socketUserId}` }));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg && typeof msg.type === "string" && msg.type !== "connected" && msg.type !== "subscribed" && msg.type !== "unsubscribed") {
          emit(msg.type, msg.data, msg.channel ?? "");
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (socket === ws) socket = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will follow; keep reconnecting
    };
  } catch {
    scheduleReconnect();
  }
}

/**
 * Open (or reuse) the chat socket for a user and subscribe to their
 * private channel. Safe to call on every mount — it is a no-op when an
 * open connection for the same user already exists.
 */
export function connectChatSocket(userId: string): void {
  manualClosed = false;
  socketUserId = userId;
  connect(userId);
}

/** Close the socket (e.g. on logout). */
export function disconnectChatSocket(): void {
  manualClosed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    try {
      socket.close();
    } catch {
      // ignore
    }
    socket = null;
  }
  socketUserId = null;
  reconnectAttempts = 0;
}

/** Subscribe to a server event. Returns an unsubscribe function. */
export function onChatEvent(event: string, handler: EventHandler): () => void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(handler);
  return () => {
    set!.delete(handler);
    if (set!.size === 0) handlers.delete(event);
  };
}

export function offChatEvent(event: string, handler: EventHandler): void {
  const set = handlers.get(event);
  if (set) set.delete(handler);
}