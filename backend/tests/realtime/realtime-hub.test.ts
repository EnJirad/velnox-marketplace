import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RealtimeHub, type SocketConnection } from "../../src/modules/realtime/services/realtime-hub.ts";
import { PushNotificationService } from "../../src/modules/realtime/services/push-notification-service.ts";
import { REALTIME_CHANNELS } from "../../src/modules/realtime/domain/realtime.ts";
import type { DbQueryable } from "../../../database/src/types.ts";

describe("Realtime Hub & Push Notification Architecture", () => {
  class MockSocket implements SocketConnection {
    public messages: string[] = [];
    public readonly id: string;
    public readonly userId?: string;

    constructor(id: string, userId?: string) {
      this.id = id;
      this.userId = userId;
    }

    public send(msg: string) {
      this.messages.push(msg);
    }
  }

  let hub: RealtimeHub;

  beforeEach(() => {
    hub = new RealtimeHub();
  });

  it("handles client registration, channel subscriptions, and broadcast delivery", () => {
    const s1 = new MockSocket("sock_1", "user_a");
    const s2 = new MockSocket("sock_2", "user_b");
    const s3 = new MockSocket("sock_3", "user_c");

    hub.registerClient(s1, "user_a");
    hub.registerClient(s2, "user_b");
    hub.registerClient(s3, "user_c");

    // s1 and s2 subscribe to orders channel
    hub.subscribe("sock_1", REALTIME_CHANNELS.ORDER_UPDATED);
    hub.subscribe("sock_2", REALTIME_CHANNELS.ORDER_UPDATED);

    // s3 subscribes only to chat
    hub.subscribe("sock_3", REALTIME_CHANNELS.CHAT_MESSAGE);

    // Broadcast to orders channel
    const delivered = hub.broadcastToChannel(
      REALTIME_CHANNELS.ORDER_UPDATED,
      "order:paid",
      { orderId: "ord_123", status: "paid" },
    );

    assert.equal(delivered, 2);
    assert.equal(s1.messages.length, 1);
    assert.equal(s2.messages.length, 1);
    assert.equal(s3.messages.length, 0); // s3 did not receive order update

    const msg = JSON.parse(s1.messages[0]);
    assert.equal(msg.channel, REALTIME_CHANNELS.ORDER_UPDATED);
    assert.equal(msg.event, "order:paid");
    assert.equal(msg.data.orderId, "ord_123");
  });

  it("tracks user presence accurately across multiple client connections", () => {
    const s1 = new MockSocket("sock_tab1", "user_multi");
    const s2 = new MockSocket("sock_tab2", "user_multi");

    // Connect tab 1 -> user is online
    hub.registerClient(s1, "user_multi");
    let presence = hub.getUserPresence("user_multi");
    assert.equal(presence.isOnline, true);
    assert.equal(presence.activeConnectionsCount, 1);

    // Connect tab 2 -> user is still online with 2 connections
    hub.registerClient(s2, "user_multi");
    presence = hub.getUserPresence("user_multi");
    assert.equal(presence.isOnline, true);
    assert.equal(presence.activeConnectionsCount, 2);

    // Disconnect tab 1 -> user is still online via tab 2
    hub.unregisterClient("sock_tab1");
    presence = hub.getUserPresence("user_multi");
    assert.equal(presence.isOnline, true);
    assert.equal(presence.activeConnectionsCount, 1);

    // Disconnect tab 2 -> user goes offline and lastSeenAt is recorded
    hub.unregisterClient("sock_tab2");
    presence = hub.getUserPresence("user_multi");
    assert.equal(presence.isOnline, false);
    assert.equal(presence.activeConnectionsCount, 0);
    assert.ok(typeof presence.lastSeenAt === "number");
  });

  it("routes direct messages to a user across all their active sockets", () => {
    const s1 = new MockSocket("sock_a", "user_direct");
    const s2 = new MockSocket("sock_b", "user_direct");
    const sOther = new MockSocket("sock_c", "other_user");

    hub.registerClient(s1, "user_direct");
    hub.registerClient(s2, "user_direct");
    hub.registerClient(sOther, "other_user");

    const delivered = hub.sendToUser("user_direct", "custom:channel", "ping", { message: "hello" });
    assert.equal(delivered, 2);
    assert.equal(s1.messages.length, 1);
    assert.equal(s2.messages.length, 1);
    assert.equal(sOther.messages.length, 0);
  });

  it("suppresses push notifications when recipient is actively viewing the conversation", async () => {
    let notifSavedInDb = false;

    const mockDb: DbQueryable = {
      async query(sql: string) {
        if (sql.includes("INSERT INTO notifications")) {
          notifSavedInDb = true;
          return { rows: [{ id: "notif_db_1" }] };
        }
        if (sql.includes("FROM user_device_tokens")) {
          return { rows: [{ device_token: "fcm_token_123", platform: "android" }] };
        }
        return { rows: [] };
      },
    };

    // User is actively looking at thread "conv_999"
    hub.setViewingConversation("user_active_viewer", "conv_999");
    assert.equal(hub.isUserViewingConversation("user_active_viewer", "conv_999"), true);
    assert.equal(hub.isUserViewingConversation("user_active_viewer", "conv_other"), false);

    // Notification for conv_999 -> should be suppressed by presence
    const res1 = await PushNotificationService.dispatchNotification(
      mockDb,
      {
        recipientUserId: "user_active_viewer",
        title: "New Message",
        body: "You have a new message",
        category: "chat",
        conversationId: "conv_999",
      },
      hub,
    );

    assert.equal(res1.suppressedByPresence, true);
    assert.equal(res1.pushDispatched, false);
    assert.equal(res1.pushStatus, "suppressed_presence");
    assert.equal(notifSavedInDb, true); // Still saved in DB

    // Honest missing-credentials behavior when Firebase credentials not configured
    const oldProj = process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PROJECT_ID;

    const res2 = await PushNotificationService.dispatchNotification(
      mockDb,
      {
        recipientUserId: "user_active_viewer",
        title: "New Message",
        body: "You have a new message",
        category: "chat",
        conversationId: "conv_another_thread",
      },
      hub,
    );

    assert.equal(res2.suppressedByPresence, false);
    assert.equal(res2.pushDispatched, false);
    assert.equal(res2.pushStatus, "blocked_missing_credentials");

    // With configured credentials & active tokens -> delivered
    process.env.FIREBASE_PROJECT_ID = "velnox-test";
    process.env.FIREBASE_CLIENT_EMAIL = "firebase@velnox-test.iam.gserviceaccount.com";
    process.env.FIREBASE_PRIVATE_KEY = "test_key";

    const res3 = await PushNotificationService.dispatchNotification(
      mockDb,
      {
        recipientUserId: "user_active_viewer",
        title: "New Message",
        body: "You have a new message",
        category: "chat",
        conversationId: "conv_another_thread",
      },
      hub,
    );

    assert.equal(res3.suppressedByPresence, false);
    assert.equal(res3.pushDispatched, true);
    assert.equal(res3.pushStatus, "delivered");

    // Cleanup env
    if (oldProj) process.env.FIREBASE_PROJECT_ID = oldProj;
    else delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
  });

  it("cleans up user mapping when socket object does not have userId property", () => {
    // Socket object without userId property
    const bareSocket: SocketConnection = {
      id: "bare_sock_1",
      send: () => {},
    };

    hub.registerClient(bareSocket, "user_bare");
    let presence = hub.getUserPresence("user_bare");
    assert.equal(presence.isOnline, true);
    assert.equal(presence.activeConnectionsCount, 1);

    // Unregister by socket id
    hub.unregisterClient("bare_sock_1");
    presence = hub.getUserPresence("user_bare");
    assert.equal(presence.isOnline, false);
    assert.equal(presence.activeConnectionsCount, 0);
  });

  it("enforces channel subscription authorization on user-scoped channels", () => {
    const s1 = new MockSocket("sock_user1");
    hub.registerClient(s1, "usr_111");

    // Can subscribe to own user channel
    const allowed = hub.subscribe("sock_user1", "user:usr_111");
    assert.equal(allowed, true);

    // Cannot subscribe to another user's channel
    const forbidden = hub.subscribe("sock_user1", "user:usr_222");
    assert.equal(forbidden, false);
  });
});
