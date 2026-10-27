/**
 * Velnox realtime WebSocket client
 *
 * ONE shared connection per app, owned by the app root (see
 * `components/RealtimeProvider`). The backend authenticates the socket from the
 * httpOnly session cookie during the handshake and answers every `subscribe`
 * from its OWN data: a connection may subscribe to its own `user:{userId}`
 * channel, to an authenticated-only self channel (`cart:updated`,
 * `profile:updated`), and — only while `users.role` really is owner/admin/staff
 * — to the private VelCenter channels (`audit:created`, `config:updated`,
 * `product:updated`, `seller:updated`, `inventory:updated`,
 * `notification:created`). Anything else is refused with a FORBIDDEN error.
 *
 * Order-scoped events are not channels at all: `order:created`,
 * `order:updated` and `shipment:updated` are ADDRESSED by the server to the
 * sessions entitled to them (the order's customer, the shop's seller, every
 * connected VelCenter session), so they arrive without a subscription and no
 * client can widen their audience.
 *
 * Events the server can push:
 *   - "chat:message"          { conversationId, message, clientId? }
 *   - "chat:read"             { conversationId, readerId }
 *   - "notification:created"  { id, type, title, message }  (own channel)
 *   - "order:created" / "order:updated" / "shipment:updated"  { orderId, … }
 *   - "product:moderated", "seller:status-changed", "audit:created",
 *     "config:updated", "employee:created|updated", … (private center channels)
 *
 * Consumers must be idempotent: dedupe incoming messages by message id.
 *
 * The socket is a DELIVERY mechanism only. Every consumer that needs state
 * re-reads it from the API; `onChatReconnect` exists so a consumer can do that
 * once the transport comes back after a drop.
 */
import { apiUrl } from "./sites";

/** Connection states the UI may render ("closed" = deliberately disconnected). */
export type ChatSocketState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

/** WebSocket endpoint derived from the backend origin (VITE_API_URL is origin-only). */
function wsEndpoint(): string {
  return apiUrl.replace(/\/+$/, "").replace(/^http/, "ws") + "/ws";
}

type EventHandler = (data: any, meta: { channel: string }) => void;
type AnyEventHandler = (event: string, data: any, meta: { channel: string }) => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
/** ±30% jitter so many open tabs never reconnect in lockstep. */
const RECONNECT_JITTER = 0.3;
/** Never retry faster than this, even with a negative jitter. */
const RECONNECT_MIN_MS = 500;

let socket: WebSocket | null = null;
let socketUserId: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let manualClosed = false;
let state: ChatSocketState = "idle";
/** True once a connection has opened — reconnect callbacks fire only on re-opens. */
let hasConnectedBefore = false;

const handlers = new Map<string, Set<EventHandler>>();
const anyHandlers = new Set<AnyEventHandler>();
const stateHandlers = new Set<(state: ChatSocketState) => void>();
const reconnectHandlers = new Set<() => void>();

/** Public channels this client wants, reference-counted so one page leaving
 *  cannot unsubscribe a channel another surface still consumes. */
const channelRefs = new Map<string, number>();

function setState(next: ChatSocketState): void {
  if (state === next) return;
  state = next;
  for (const handler of [...stateHandlers]) {
    try {
      handler(state);
    } catch (err) {
      console.error("[chat-socket] state handler error:", err);
    }
  }
}

function emit(event: string, data: any, channel: string): void {
  const set = handlers.get(event);
  if (set) {
    for (const handler of [...set]) {
      try {
        handler(data, { channel });
      } catch (err) {
        console.error("[chat-socket] handler error:", err);
      }
    }
  }
  for (const handler of [...anyHandlers]) {
    try {
      handler(event, data, { channel });
    } catch (err) {
      console.error("[chat-socket] handler error:", err);
    }
  }
}

function notifyReconnect(): void {
  for (const handler of [...reconnectHandlers]) {
    try {
      handler();
    } catch (err) {
      console.error("[chat-socket] reconnect handler error:", err);
    }
  }
}

function backoffDelay(attempt: number): number {
  const base = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
  const jitter = base * RECONNECT_JITTER * (Math.random() * 2 - 1);
  return Math.max(RECONNECT_MIN_MS, Math.round(base + jitter));
}

/** Send a frame if (and only if) the socket is open. */
function sendFrame(payload: unknown): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch (err) {
    console.error("[chat-socket] send failed:", err);
  }
}

/** Re-subscribe everything this client wants — on open AND after a reconnect. */
function subscribeAll(): void {
  if (!socketUserId) return;
  sendFrame({ type: "subscribe", channel: `user:${socketUserId}` });
  for (const channel of channelRefs.keys()) {
    sendFrame({ type: "subscribe", channel });
  }
}

function scheduleReconnect(): void {
  if (manualClosed) return;
  if (!socketUserId) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = backoffDelay(reconnectAttempts);
  reconnectAttempts += 1;
  setState("reconnecting");
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
  if (state !== "reconnecting") setState(hasConnectedBefore ? "reconnecting" : "connecting");
  try {
    const ws = new WebSocket(wsEndpoint());
    socket = ws;

    ws.onopen = () => {
      if (socket !== ws) return;
      const reconnected = hasConnectedBefore;
      reconnectAttempts = 0;
      hasConnectedBefore = true;
      setState("open");
      // Resubscribe BEFORE telling consumers to refetch, so no event published
      // between the reconnect and the refetch is silently missed.
      subscribeAll();
      if (reconnected) notifyReconnect();
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (
          msg &&
          typeof msg.type === "string" &&
          msg.type !== "connected" &&
          msg.type !== "subscribed" &&
          msg.type !== "unsubscribed"
        ) {
          emit(msg.type, msg.data, msg.channel ?? "");
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      // Only the CURRENT socket may schedule a reconnect: a deliberate close
      // (logout / account switch) replaced `socket` already, and its late
      // onclose must not start a duplicate timer.
      if (socket !== ws) return;
      socket = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will follow; keep reconnecting
    };
  } catch {
    scheduleReconnect();
  }
}

/** Close the current socket without scheduling a reconnect. */
function closeSocket(): void {
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
  reconnectAttempts = 0;
}

/**
 * Open (or reuse) the shared socket for a user and subscribe to their private
 * channel. Safe to call on every mount — it is a no-op when an open connection
 * for the same user already exists. Switching accounts closes the old socket so
 * a tab can never keep subscribing to the previous user's channel.
 */
export function connectChatSocket(userId: string): void {
  manualClosed = false;
  if (socketUserId && socketUserId !== userId) {
    closeSocket();
    hasConnectedBefore = false;
  }
  socketUserId = userId;
  connect(userId);
}

/**
 * Close the socket deliberately (logout / app teardown). Pages must NOT call
 * this on unmount — the socket is shared with notifications and other surfaces.
 */
export function disconnectChatSocket(): void {
  manualClosed = true;
  closeSocket();
  socketUserId = null;
  hasConnectedBefore = false;
  setState("closed");
}

/** Current connection state (also available reactively via `onChatSocketState`). */
export function getChatSocketState(): ChatSocketState {
  return state;
}

/** Subscribe to connection-state changes. Returns an unsubscribe function. */
export function onChatSocketState(handler: (state: ChatSocketState) => void): () => void {
  stateHandlers.add(handler);
  return () => {
    stateHandlers.delete(handler);
  };
}

/**
 * Run a callback after the transport is re-established (NOT on the first
 * connect). Consumers use it to re-read authoritative API data after a drop.
 */
export function onChatReconnect(handler: () => void): () => void {
  reconnectHandlers.add(handler);
  return () => {
    reconnectHandlers.delete(handler);
  };
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

/** Observe EVERY server event (used by surfaces that fan one signal out to many
 *  tabs). Prefer `onChatEvent` when one event is enough. */
export function onAnyChatEvent(handler: AnyEventHandler): () => void {
  anyHandlers.add(handler);
  return () => {
    anyHandlers.delete(handler);
  };
}

/**
 * Subscribe to a PRIVATE VelCenter channel (e.g. `product:updated`). The server
 * decides whether this connection may have it — from `users.role`, never from
 * anything the client sent — and answers FORBIDDEN otherwise, so an ordinary
 * customer or seller connection receives nothing. The subscription is restored
 * automatically after a reconnect. Returns an unsubscribe function; the channel
 * frame is only sent to the server once the last consumer releases it.
 */
export function subscribeChatChannel(channel: string): () => void {
  const next = (channelRefs.get(channel) ?? 0) + 1;
  channelRefs.set(channel, next);
  if (next === 1) sendFrame({ type: "subscribe", channel });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (channelRefs.get(channel) ?? 1) - 1;
    if (remaining > 0) {
      channelRefs.set(channel, remaining);
      return;
    }
    channelRefs.delete(channel);
    sendFrame({ type: "unsubscribe", channel });
  };
}

/**
 * Send a lightweight command frame to the server over the open socket
 * (no-op when disconnected). Used for presence signals such as
 * `chat:viewing` / `chat:viewingEnd` { conversationId }.
 */
export function sendChatCommand(type: string, data?: unknown): void {
  sendFrame({ type, data });
}

export function offChatEvent(event: string, handler: EventHandler): void {
  const set = handlers.get(event);
  if (set) set.delete(handler);
}
