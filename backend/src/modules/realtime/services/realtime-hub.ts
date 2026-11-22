import type {
  RealtimeChannel,
  RealtimeEnvelope,
  UserPresence,
} from "../domain/realtime.ts";

export interface SocketConnection {
  readonly id: string;
  readonly userId?: string;
  send(message: string): void;
}

/**
 * High-performance, Edge/Durable-Object compatible Realtime Hub.
 *
 * Capabilities:
 * - Subscriptions by channel (pub/sub)
 * - User-targeted message routing (multi-tab fan-out)
 * - Realtime presence tracking (online/offline, last-seen timestamps)
 * - Chat thread viewing presence (used to suppress redundant push notifications)
 */
export class RealtimeHub {
  private readonly connections = new Map<string, SocketConnection>();
  private readonly userConnections = new Map<string, Set<string>>();
  private readonly socketToUser = new Map<string, string>();
  private readonly channelSubscriptions = new Map<string, Set<string>>();
  private readonly connectionSubscriptions = new Map<string, Set<string>>();
  private readonly viewingConversations = new Map<string, string>(); // userId -> conversationId
  private readonly lastSeen = new Map<string, number>(); // userId -> timestamp ms

  /**
   * Registers a connected socket client.
   */
  public registerClient(socket: SocketConnection, userId?: string): void {
    this.connections.set(socket.id, socket);
    this.connectionSubscriptions.set(socket.id, new Set<string>());

    const effectiveUserId = userId || socket.userId;
    if (effectiveUserId) {
      this.socketToUser.set(socket.id, effectiveUserId);
      let userSockets = this.userConnections.get(effectiveUserId);
      if (!userSockets) {
        userSockets = new Set<string>();
        this.userConnections.set(effectiveUserId, userSockets);
      }
      userSockets.add(socket.id);
    }
  }

  /**
   * Unregisters a socket on disconnect and updates presence.
   */
  public unregisterClient(socketId: string): void {
    const socket = this.connections.get(socketId);
    if (!socket) return;

    this.connections.delete(socketId);

    // Clean up channel subscriptions for this connection
    const subs = this.connectionSubscriptions.get(socketId);
    if (subs) {
      for (const channel of subs) {
        const channelSubs = this.channelSubscriptions.get(channel);
        if (channelSubs) {
          channelSubs.delete(socketId);
          if (channelSubs.size === 0) {
            this.channelSubscriptions.delete(channel);
          }
        }
      }
      this.connectionSubscriptions.delete(socketId);
    }

    // Clean up user connection mapping
    const resolvedUserId = this.socketToUser.get(socketId) || socket.userId;
    this.socketToUser.delete(socketId);
    if (resolvedUserId) {
      const userSockets = this.userConnections.get(resolvedUserId);
      if (userSockets) {
        userSockets.delete(socketId);
        if (userSockets.size === 0) {
          this.userConnections.delete(resolvedUserId);
          this.viewingConversations.delete(resolvedUserId);
          this.lastSeen.set(resolvedUserId, Date.now());
        }
      }
    }
  }

  /**
   * Subscribes a connection to a specific realtime channel.
   */
  public subscribe(socketId: string, channel: string): boolean {
    if (!this.connections.has(socketId)) return false;

    // Security check: if channel is user-scoped (e.g. "user:usr_123"),
    // verify the connection belongs to that user
    const socketUserId = this.socketToUser.get(socketId);
    if (channel.startsWith("user:")) {
      const targetUserId = channel.slice("user:".length);
      if (socketUserId && socketUserId !== targetUserId) {
        return false;
      }
    }

    let channelSubs = this.channelSubscriptions.get(channel);
    if (!channelSubs) {
      channelSubs = new Set<string>();
      this.channelSubscriptions.set(channel, channelSubs);
    }
    channelSubs.add(socketId);

    let clientSubs = this.connectionSubscriptions.get(socketId);
    if (!clientSubs) {
      clientSubs = new Set<string>();
      this.connectionSubscriptions.set(socketId, clientSubs);
    }
    clientSubs.add(channel);

    return true;
  }

  /**
   * Unsubscribes a connection from a specific channel.
   */
  public unsubscribe(socketId: string, channel: string): void {
    const channelSubs = this.channelSubscriptions.get(channel);
    if (channelSubs) {
      channelSubs.delete(socketId);
      if (channelSubs.size === 0) {
        this.channelSubscriptions.delete(channel);
      }
    }

    const clientSubs = this.connectionSubscriptions.get(socketId);
    if (clientSubs) {
      clientSubs.delete(channel);
    }
  }

  /**
   * Broadcasts a message to all subscribers of a channel.
   */
  public broadcastToChannel<T>(channel: RealtimeChannel | string, event: string, data: T): number {
    const subscribers = this.channelSubscriptions.get(channel);
    if (!subscribers || subscribers.size === 0) return 0;

    const envelope: RealtimeEnvelope<T> = {
      channel,
      event,
      data,
      timestamp: Date.now(),
    };
    const message = JSON.stringify(envelope);

    let deliveredCount = 0;
    for (const socketId of subscribers) {
      const socket = this.connections.get(socketId);
      if (socket) {
        try {
          socket.send(message);
          deliveredCount++;
        } catch {
          // If socket fails sending, schedule unregister
          this.unregisterClient(socketId);
        }
      }
    }

    return deliveredCount;
  }

  /**
   * Sends a targeted message to all active sockets of a specific user.
   */
  public sendToUser<T>(
    userId: string,
    channel: RealtimeChannel | string,
    event: string,
    data: T,
  ): number {
    const userSockets = this.userConnections.get(userId);
    if (!userSockets || userSockets.size === 0) return 0;

    const envelope: RealtimeEnvelope<T> = {
      channel,
      event,
      data,
      timestamp: Date.now(),
    };
    const message = JSON.stringify(envelope);

    let deliveredCount = 0;
    for (const socketId of userSockets) {
      const socket = this.connections.get(socketId);
      if (socket) {
        try {
          socket.send(message);
          deliveredCount++;
        } catch {
          this.unregisterClient(socketId);
        }
      }
    }

    return deliveredCount;
  }

  /**
   * Sets the thread that the user is currently viewing.
   */
  public setViewingConversation(userId: string, conversationId: string | null): void {
    if (!conversationId) {
      this.viewingConversations.delete(userId);
    } else {
      this.viewingConversations.set(userId, conversationId);
    }
  }

  /**
   * Checks if user is currently looking at a specific conversation.
   * Used to suppress push notifications when user is actively reading.
   */
  public isUserViewingConversation(userId: string, conversationId: string): boolean {
    return this.viewingConversations.get(userId) === conversationId;
  }

  /**
   * Returns current user presence state.
   */
  public getUserPresence(userId: string): UserPresence {
    const activeSockets = this.userConnections.get(userId);
    const isOnline = Boolean(activeSockets && activeSockets.size > 0);
    const lastSeen = isOnline ? null : this.lastSeen.get(userId) ?? null;

    return {
      userId,
      isOnline,
      lastSeenAt: lastSeen,
      activeConnectionsCount: activeSockets ? activeSockets.size : 0,
    };
  }

  /**
   * Diagnostic statistics for monitoring.
   */
  public getStats(): {
    totalConnections: number;
    totalOnlineUsers: number;
    activeChannelsCount: number;
  } {
    return {
      totalConnections: this.connections.size,
      totalOnlineUsers: this.userConnections.size,
      activeChannelsCount: this.channelSubscriptions.size,
    };
  }
}

// Canonical singleton instance
export const realtimeHub = new RealtimeHub();
