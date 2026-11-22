/**
 * Cloudflare Durable Object — Realtime Hub & State Coordinator
 * Handles WebSocket termination, channel fan-out, multi-tab presence, and active chat viewing.
 */

import type { Bindings } from "../types.js";

export interface SessionInfo {
  socketId: string;
  userId: string;
  role: string;
  channels: Set<string>;
  viewingConversationId: string | null;
  connectedAt: number;
}

export interface RealtimeEventPayload {
  type: string;
  channel?: string;
  data: any;
  timestamp?: number;
}

export class RealtimeHubDO {
  private sessions = new Map<WebSocket, SessionInfo>();
  private userSockets = new Map<string, Set<WebSocket>>();
  private channelSubscriptions = new Map<string, Set<WebSocket>>();
  private conversationViewers = new Map<string, Set<string>>();

  constructor(
    private state: any,
    private env: Bindings,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1. WebSocket Upgrade Request
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request);
    }

    // 2. HTTP Internal Broadcast Endpoint
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const body = (await request.json().catch(() => null)) as RealtimeEventPayload | null;
      if (!body || !body.type || !body.channel) {
        return new Response(JSON.stringify({ error: "Missing type or channel in payload" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const sentCount = this.broadcastToChannel(body.channel, body);
      return new Response(JSON.stringify({ success: true, sentCount }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. HTTP Internal Send-To-User Endpoint
    if (request.method === "POST" && url.pathname === "/send-user") {
      const body = (await request.json().catch(() => null)) as
        | (RealtimeEventPayload & { userId: string })
        | null;
      if (!body || !body.userId || !body.type) {
        return new Response(JSON.stringify({ error: "Missing userId or type" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const sentCount = this.sendToUser(body.userId, body);
      return new Response(JSON.stringify({ success: true, sentCount }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 4. HTTP Query: Check Active Conversation Viewer (for Push Notification Suppression)
    if (request.method === "GET" && url.pathname.startsWith("/is-viewing/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const conversationId = parts[1];
      const userId = parts[2];
      const viewers = this.conversationViewers.get(conversationId);
      const isViewing = !!(viewers && viewers.has(userId));
      return new Response(JSON.stringify({ conversationId, userId, isViewing }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 5. HTTP Query: User Presence
    if (request.method === "GET" && url.pathname.startsWith("/presence/")) {
      const userId = url.pathname.replace("/presence/", "");
      const sockets = this.userSockets.get(userId);
      const activeTabs = sockets ? sockets.size : 0;
      const isOnline = activeTabs > 0;
      return new Response(JSON.stringify({ userId, isOnline, activeTabs }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 6. HTTP Query: DO Stats
    if (request.method === "GET" && url.pathname === "/stats") {
      return new Response(
        JSON.stringify({
          activeConnections: this.sessions.size,
          uniqueUsers: this.userSockets.size,
          channelsCount: this.channelSubscriptions.size,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404 });
  }

  private handleWebSocketUpgrade(request: Request): Response {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") || "anonymous";
    const role = url.searchParams.get("role") || "customer";

    // Create Cloudflare WebSocket pair
    // In Workers environment, WebSocketPair is provided globally
    const pair = new (globalThis as any).WebSocketPair();
    const clientWs = pair[0];
    const serverWs = pair[1];

    if ((serverWs as any).accept) {
      (serverWs as any).accept();
    }

    const socketId = crypto.randomUUID();
    const session: SessionInfo = {
      socketId,
      userId,
      role,
      channels: new Set<string>([`user:${userId}`]),
      viewingConversationId: null,
      connectedAt: Date.now(),
    };

    this.sessions.set(serverWs, session);

    // Register user multi-tab sockets
    let userSet = this.userSockets.get(userId);
    if (!userSet) {
      userSet = new Set();
      this.userSockets.set(userId, userSet);
    }
    userSet.add(serverWs);

    // Auto-subscribe user's own channel
    this.addChannelSubscription(`user:${userId}`, serverWs);

    // Attach WebSocket listeners
    serverWs.addEventListener("message", (event: any) => {
      this.handleSocketMessage(serverWs, event.data);
    });

    const closeHandler = () => {
      this.handleSocketClose(serverWs);
    };

    serverWs.addEventListener("close", closeHandler);
    serverWs.addEventListener("error", closeHandler);

    // Send initial connected handshake
    try {
      serverWs.send(
        JSON.stringify({
          type: "connected",
          socketId,
          userId,
          timestamp: Date.now(),
        }),
      );
    } catch {
      // Ignored
    }

    return new Response(null, {
      status: 101,
      webSocket: clientWs,
    } as any);
  }

  private handleSocketMessage(ws: WebSocket, rawData: string | ArrayBuffer) {
    const session = this.sessions.get(ws);
    if (!session) return;

    try {
      const msg = JSON.parse(typeof rawData === "string" ? rawData : new TextDecoder().decode(rawData));
      if (!msg || typeof msg !== "object") return;

      const type = msg.type;

      switch (type) {
        case "ping": {
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          break;
        }

        case "subscribe": {
          const channel = msg.channel;
          if (typeof channel === "string" && channel.length > 0) {
            session.channels.add(channel);
            this.addChannelSubscription(channel, ws);
            ws.send(JSON.stringify({ type: "subscribed", channel }));
          }
          break;
        }

        case "unsubscribe": {
          const channel = msg.channel;
          if (typeof channel === "string") {
            session.channels.delete(channel);
            this.removeChannelSubscription(channel, ws);
            ws.send(JSON.stringify({ type: "unsubscribed", channel }));
          }
          break;
        }

        case "chat:viewing": {
          const convId = msg.data?.conversationId || msg.conversationId;
          if (typeof convId === "string") {
            // Remove previous viewing state if different
            if (session.viewingConversationId && session.viewingConversationId !== convId) {
              this.removeViewer(session.viewingConversationId, session.userId);
            }
            session.viewingConversationId = convId;
            this.addViewer(convId, session.userId);
          }
          break;
        }

        case "chat:viewingEnd": {
          const convId = msg.data?.conversationId || msg.conversationId || session.viewingConversationId;
          if (typeof convId === "string") {
            this.removeViewer(convId, session.userId);
            session.viewingConversationId = null;
          }
          break;
        }

        default:
          break;
      }
    } catch {
      // Ignore malformed client frames
    }
  }

  private handleSocketClose(ws: WebSocket) {
    const session = this.sessions.get(ws);
    if (!session) return;

    // Clean up viewing state
    if (session.viewingConversationId) {
      this.removeViewer(session.viewingConversationId, session.userId);
    }

    // Clean up channel subscriptions
    for (const channel of session.channels) {
      this.removeChannelSubscription(channel, ws);
    }

    // Clean up user sockets
    const userSet = this.userSockets.get(session.userId);
    if (userSet) {
      userSet.delete(ws);
      if (userSet.size === 0) {
        this.userSockets.delete(session.userId);
      }
    }

    this.sessions.delete(ws);
  }

  private addChannelSubscription(channel: string, ws: WebSocket) {
    let set = this.channelSubscriptions.get(channel);
    if (!set) {
      set = new Set();
      this.channelSubscriptions.set(channel, set);
    }
    set.add(ws);
  }

  private removeChannelSubscription(channel: string, ws: WebSocket) {
    const set = this.channelSubscriptions.get(channel);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        this.channelSubscriptions.delete(channel);
      }
    }
  }

  private addViewer(conversationId: string, userId: string) {
    let set = this.conversationViewers.get(conversationId);
    if (!set) {
      set = new Set();
      this.conversationViewers.set(conversationId, set);
    }
    set.add(userId);
  }

  private removeViewer(conversationId: string, userId: string) {
    const set = this.conversationViewers.get(conversationId);
    if (set) {
      set.delete(userId);
      if (set.size === 0) {
        this.conversationViewers.delete(conversationId);
      }
    }
  }

  public broadcastToChannel(channel: string, payload: RealtimeEventPayload): number {
    const subscribers = this.channelSubscriptions.get(channel);
    if (!subscribers || subscribers.size === 0) return 0;

    const frame = JSON.stringify({
      type: payload.type,
      channel,
      data: payload.data,
      timestamp: payload.timestamp || Date.now(),
    });

    let sent = 0;
    for (const ws of subscribers) {
      try {
        if ((ws as any).readyState === 1 || (ws as any).readyState === undefined) {
          ws.send(frame);
          sent++;
        }
      } catch {
        // Handled on close
      }
    }
    return sent;
  }

  public sendToUser(userId: string, payload: RealtimeEventPayload): number {
    const sockets = this.userSockets.get(userId);
    if (!sockets || sockets.size === 0) return 0;

    const frame = JSON.stringify({
      type: payload.type,
      channel: payload.channel || `user:${userId}`,
      data: payload.data,
      timestamp: payload.timestamp || Date.now(),
    });

    let sent = 0;
    for (const ws of sockets) {
      try {
        if ((ws as any).readyState === 1 || (ws as any).readyState === undefined) {
          ws.send(frame);
          sent++;
        }
      } catch {
        // Handled on close
      }
    }
    return sent;
  }

  public isUserViewing(conversationId: string, userId: string): boolean {
    const viewers = this.conversationViewers.get(conversationId);
    return !!(viewers && viewers.has(userId));
  }
}
