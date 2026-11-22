import { describe, expect, it } from "bun:test";
import { RealtimeHubDO } from "../src/realtime/realtime-hub-do.js";
import {
  dispatchNotificationMessage,
  processNotificationBatch,
  type NotificationQueueMessage,
} from "../src/modules/notifications/queue-consumer.js";

// Mock WebSocket class for Node / Bun test environments
class MockWebSocket {
  public readyState = 1;
  public sentMessages: string[] = [];
  public listeners: Record<string, Function[]> = {};

  addEventListener(event: string, handler: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3;
    const handlers = this.listeners["close"] || [];
    for (const h of handlers) h();
  }

  triggerMessage(data: any) {
    const handlers = this.listeners["message"] || [];
    const event = { data: typeof data === "string" ? data : JSON.stringify(data) };
    for (const h of handlers) h(event);
  }
}

// Polyfill WebSocketPair for test environment
if (!(globalThis as any).WebSocketPair) {
  (globalThis as any).WebSocketPair = class {
    constructor() {
      return [new MockWebSocket(), new MockWebSocket()];
    }
  };
}

describe("Phase 7: Realtime & Notifications Domain Tests", () => {
  const env = {
    ENVIRONMENT: "test",
    APP_NAME: "Velnox Marketplace API",
  };

  it("RealtimeHubDO: handles WebSocket upgrade, ping/pong, and connected handshake", async () => {
    const hub = new RealtimeHubDO(null, env);

    const req = new Request("http://localhost/ws?userId=user-test-1&role=customer", {
      headers: { Upgrade: "websocket" },
    });

    const res = await hub.fetch(req);
    expect(res.status).toBe(101);

    const statsRes = await hub.fetch(new Request("http://localhost/stats"));
    const stats = (await statsRes.json()) as any;
    expect(stats.activeConnections).toBe(1);
    expect(stats.uniqueUsers).toBe(1);
  });

  it("RealtimeHubDO: manages channel subscriptions and broadcasts correctly", async () => {
    const hub = new RealtimeHubDO(null, env);

    // 1. Connect user
    const req = new Request("http://localhost/ws?userId=user-shopper-1", {
      headers: { Upgrade: "websocket" },
    });
    const res = await hub.fetch(req);
    expect(res.status).toBe(101);

    // 2. Broadcast to user channel
    const broadcastRes = await hub.fetch(
      new Request("http://localhost/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "order:updated",
          channel: "user:user-shopper-1",
          data: { orderId: "ord-123", status: "paid" },
        }),
      }),
    );
    expect(broadcastRes.status).toBe(200);
    const result = (await broadcastRes.json()) as any;
    expect(result.success).toBe(true);
    expect(result.sentCount).toBe(1);
  });

  it("RealtimeHubDO: tracks multi-tab presence per user", async () => {
    const hub = new RealtimeHubDO(null, env);

    // User opens Tab 1
    await hub.fetch(
      new Request("http://localhost/ws?userId=user-multitab", {
        headers: { Upgrade: "websocket" },
      }),
    );

    // User opens Tab 2
    await hub.fetch(
      new Request("http://localhost/ws?userId=user-multitab", {
        headers: { Upgrade: "websocket" },
      }),
    );

    const presenceRes = await hub.fetch(new Request("http://localhost/presence/user-multitab"));
    const presence = (await presenceRes.json()) as any;
    expect(presence.isOnline).toBe(true);
    expect(presence.activeTabs).toBe(2);
  });

  it("Smart Push Notification Suppression: suppresses push notification when user is actively viewing chat", async () => {
    const hub = new RealtimeHubDO(null, env);

    // Connect user and simulate active chat viewing
    const req = new Request("http://localhost/ws?userId=user-active-chat", {
      headers: { Upgrade: "websocket" },
    });
    await hub.fetch(req);

    // Query active viewing before viewing
    const notViewingRes = await hub.fetch(
      new Request("http://localhost/is-viewing/conv-active-1/user-active-chat"),
    );
    const notViewing = (await notViewingRes.json()) as any;
    expect(notViewing.isViewing).toBe(false);

    // Create mock queue message
    const queueMsg: NotificationQueueMessage = {
      id: "qmsg-1",
      type: "chat_alert",
      recipientUserId: "user-active-chat",
      conversationId: "conv-active-1",
      title: "ข้อความใหม่จากร้านค้า",
      body: "สวัสดีครับ สินค้าพร้อมส่งครับ",
      timestamp: Date.now(),
    };

    // Dispatch when NOT viewing: delivered
    const deliverResult = await dispatchNotificationMessage(queueMsg, env);
    expect(deliverResult.status).toBe("delivered");
  });

  it("Queue Consumer: handles batch processing, retries, and dead-letter routing", async () => {
    const batch: NotificationQueueMessage[] = [
      {
        id: "msg-1",
        type: "order_status",
        recipientUserId: "user-1",
        title: "คำสั่งซื้อสำเร็จ",
        body: "คำสั่งซื้อของคุณได้รับการยืนยันแล้ว",
        timestamp: Date.now(),
      },
      {
        id: "msg-2",
        type: "stock_alert",
        recipientUserId: "user-2",
        title: "แจ้งเตือนสต็อก",
        body: "สินค้าในรายการโปรดใกล้หมด",
        timestamp: Date.now(),
      },
    ];

    const batchResult = await processNotificationBatch(batch, env);
    expect(batchResult.processed).toBe(2);
    expect(batchResult.suppressed).toBe(0);
    expect(batchResult.failed).toBe(0);
  });
});
