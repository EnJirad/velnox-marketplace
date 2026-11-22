/**
 * Chat & Realtime Messaging Domain Service
 * Pure TypeScript implementation for Cloudflare Workers with Neon / In-Memory storage.
 */

import type { Bindings } from "../../types.js";
import { RealtimeHubDO } from "../../realtime/realtime-hub-do.js";

export interface ConversationItem {
  id: string;
  type: "CUSTOMER_SELLER" | "CUSTOMER_COMPANY" | "SELLER_COMPANY" | "COMPANY_INTERNAL";
  title?: string | null;
  customerId?: string | null;
  sellerId?: string | null;
  shopId?: string | null;
  orderId?: string | null;
  supportStatus: "OPEN" | "ASSIGNED" | "WAITING" | "CLOSED";
  assignedTo?: string | null;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  unreadCount: number;
  customer?: { id: string; name: string; avatarUrl?: string | null } | null;
  seller?: { id: string; name: string; shopName?: string | null } | null;
  shop?: { id: string; name: string; slug: string; logoUrl?: string | null } | null;
  updatedAt: string;
}

export interface ChatMessageItem {
  id: string;
  conversationId: string;
  senderId: string | null;
  senderRole: "customer" | "seller" | "company" | "system";
  messageType: "text" | "image" | "system" | "order_card" | "action";
  content: string;
  attachmentUrl?: string | null;
  clientId?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
}

export class ChatService {
  private inMemoryConversations = new Map<string, any>();
  private inMemoryParticipants = new Map<string, any[]>();
  private inMemoryMessages = new Map<string, any[]>();
  private inMemoryNotifications = new Map<string, any[]>();
  private recentClientIds = new Map<string, ChatMessageItem>();

  constructor(
    private readonly env?: Bindings,
    private readonly realtimeHub?: RealtimeHubDO,
  ) {
    this.seedDefaults();
  }

  private seedDefaults() {
    const convId = "conv-support-seed";
    this.inMemoryConversations.set(convId, {
      id: convId,
      type: "CUSTOMER_COMPANY",
      customer_id: "user-frontend-shopper",
      seller_id: null,
      shop_id: null,
      title: "Velnox Support",
      support_status: "OPEN",
      assigned_to: null,
      last_message_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    this.inMemoryParticipants.set(convId, [
      { conversation_id: convId, user_id: "user-frontend-shopper", role: "member", last_read_at: new Date().toISOString() },
      { conversation_id: convId, user_id: "staff-support-1", role: "admin", last_read_at: new Date().toISOString() },
    ]);
    this.inMemoryMessages.set(convId, [
      {
        id: "msg-welcome-1",
        conversation_id: convId,
        sender_id: "staff-support-1",
        sender_role: "company",
        message_type: "text",
        content: "สวัสดีครับ ทีมงาน Velnox ยินดีให้บริการครับ",
        created_at: new Date().toISOString(),
      },
    ]);
  }

  async listCustomerConversations(customerId: string): Promise<ConversationItem[]> {
    const results: ConversationItem[] = [];
    for (const conv of this.inMemoryConversations.values()) {
      if (conv.customer_id === customerId) {
        const msgs = this.inMemoryMessages.get(conv.id) || [];
        const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        results.push({
          id: conv.id,
          type: conv.type,
          title: conv.title || (conv.type === "CUSTOMER_COMPANY" ? "Velnox Support" : "ร้านค้า"),
          customerId: conv.customer_id,
          sellerId: conv.seller_id,
          shopId: conv.shop_id,
          supportStatus: conv.support_status,
          assignedTo: conv.assigned_to,
          lastMessage: lastMsg?.content || null,
          lastMessageAt: lastMsg?.created_at || conv.last_message_at,
          unreadCount: 0,
          customer: { id: customerId, name: "Customer User" },
          shop: conv.shop_id ? { id: conv.shop_id, name: "Demo Shop", slug: "demo-shop" } : null,
          updatedAt: conv.updated_at,
        });
      }
    }
    return results;
  }

  async getOrCreateCustomerConversation(customerId: string, shopId: string): Promise<ConversationItem> {
    for (const conv of this.inMemoryConversations.values()) {
      if (conv.customer_id === customerId && conv.shop_id === shopId && conv.type === "CUSTOMER_SELLER") {
        return {
          id: conv.id,
          type: conv.type,
          title: conv.title,
          customerId: conv.customer_id,
          shopId: conv.shop_id,
          supportStatus: conv.support_status,
          unreadCount: 0,
          updatedAt: conv.updated_at,
        };
      }
    }

    const id = `conv-shop-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const newConv = {
      id,
      type: "CUSTOMER_SELLER",
      customer_id: customerId,
      seller_id: null,
      shop_id: shopId,
      title: null,
      support_status: "OPEN",
      assigned_to: null,
      last_message_at: now,
      created_at: now,
      updated_at: now,
    };
    this.inMemoryConversations.set(id, newConv);
    this.inMemoryParticipants.set(id, [
      { conversation_id: id, user_id: customerId, role: "member", last_read_at: now },
    ]);
    this.inMemoryMessages.set(id, []);

    return {
      id,
      type: "CUSTOMER_SELLER",
      customerId,
      shopId,
      supportStatus: "OPEN",
      unreadCount: 0,
      updatedAt: now,
    };
  }

  async getOrCreateSupportConversation(customerId: string): Promise<ConversationItem> {
    for (const conv of this.inMemoryConversations.values()) {
      if (conv.customer_id === customerId && conv.type === "CUSTOMER_COMPANY") {
        return {
          id: conv.id,
          type: conv.type,
          title: "Velnox Support",
          customerId: conv.customer_id,
          supportStatus: conv.support_status,
          unreadCount: 0,
          updatedAt: conv.updated_at,
        };
      }
    }

    const id = `conv-support-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const newConv = {
      id,
      type: "CUSTOMER_COMPANY",
      customer_id: customerId,
      seller_id: null,
      shop_id: null,
      title: "Velnox Support",
      support_status: "OPEN",
      assigned_to: null,
      last_message_at: now,
      created_at: now,
      updated_at: now,
    };
    this.inMemoryConversations.set(id, newConv);
    this.inMemoryParticipants.set(id, [
      { conversation_id: id, user_id: customerId, role: "member", last_read_at: now },
    ]);
    this.inMemoryMessages.set(id, []);

    return {
      id,
      type: "CUSTOMER_COMPANY",
      title: "Velnox Support",
      customerId,
      supportStatus: "OPEN",
      unreadCount: 0,
      updatedAt: now,
    };
  }

  async listSellerConversations(sellerId: string): Promise<ConversationItem[]> {
    const results: ConversationItem[] = [];
    for (const conv of this.inMemoryConversations.values()) {
      if (conv.seller_id === sellerId || conv.type === "SELLER_COMPANY") {
        const msgs = this.inMemoryMessages.get(conv.id) || [];
        const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        results.push({
          id: conv.id,
          type: conv.type,
          title: conv.title || "Customer Conversation",
          customerId: conv.customer_id,
          sellerId: conv.seller_id,
          shopId: conv.shop_id,
          supportStatus: conv.support_status,
          lastMessage: lastMsg?.content || null,
          lastMessageAt: lastMsg?.created_at || conv.last_message_at,
          unreadCount: 0,
          updatedAt: conv.updated_at,
        });
      }
    }
    return results;
  }

  async listMessages(conversationId: string, limit = 50): Promise<{ items: ChatMessageItem[]; hasMore: boolean }> {
    const msgs = this.inMemoryMessages.get(conversationId) || [];
    const items: ChatMessageItem[] = msgs.map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      senderRole: m.sender_role,
      messageType: m.message_type || "text",
      content: m.content,
      attachmentUrl: m.attachment_url || null,
      clientId: m.client_id || null,
      metadata: m.metadata || {},
      createdAt: m.created_at,
    }));

    return {
      items: items.slice(-limit),
      hasMore: items.length > limit,
    };
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    senderRole: "customer" | "seller" | "company",
    content: string,
    clientId?: string,
    attachmentUrl?: string,
  ): Promise<ChatMessageItem> {
    // 1. Idempotency Check with clientId
    if (clientId && this.recentClientIds.has(`${conversationId}:${clientId}`)) {
      return this.recentClientIds.get(`${conversationId}:${clientId}`)!;
    }

    const conv = this.inMemoryConversations.get(conversationId);
    if (!conv) {
      const err = new Error("Conversation not found.");
      (err as any).status = 404;
      throw err;
    }

    const msgId = `msg-${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const messageItem: ChatMessageItem = {
      id: msgId,
      conversationId,
      senderId,
      senderRole,
      messageType: attachmentUrl ? "image" : "text",
      content,
      attachmentUrl: attachmentUrl || null,
      clientId: clientId || null,
      createdAt: now,
    };

    let msgs = this.inMemoryMessages.get(conversationId);
    if (!msgs) {
      msgs = [];
      this.inMemoryMessages.set(conversationId, msgs);
    }
    msgs.push({
      id: msgId,
      conversation_id: conversationId,
      sender_id: senderId,
      sender_role: senderRole,
      message_type: messageItem.messageType,
      content,
      attachment_url: attachmentUrl || null,
      client_id: clientId || null,
      created_at: now,
    });

    conv.last_message_at = now;
    conv.updated_at = now;

    if (clientId) {
      this.recentClientIds.set(`${conversationId}:${clientId}`, messageItem);
    }

    // 2. Broadcast via Realtime DO / Realtime Hub
    if (this.realtimeHub) {
      this.realtimeHub.broadcastToChannel(`chat:${conversationId}`, {
        type: "chat:message",
        channel: `chat:${conversationId}`,
        data: { conversationId, message: messageItem },
      });
    }

    return messageItem;
  }

  async markRead(conversationId: string, userId: string, upTo?: number): Promise<{ success: boolean }> {
    const participants = this.inMemoryParticipants.get(conversationId) || [];
    for (const p of participants) {
      if (p.user_id === userId) {
        p.last_read_at = new Date(upTo || Date.now()).toISOString();
      }
    }

    if (this.realtimeHub) {
      this.realtimeHub.broadcastToChannel(`chat:${conversationId}`, {
        type: "chat:read",
        channel: `chat:${conversationId}`,
        data: { conversationId, readerId: userId, upTo: upTo || Date.now() },
      });
    }

    return { success: true };
  }

  async listNotifications(userId: string): Promise<NotificationItem[]> {
    const notifs = this.inMemoryNotifications.get(userId) || [
      {
        id: "notif-welcome",
        userId,
        type: "system",
        title: "ยินดีต้อนรับสู่ Velnox",
        body: "เริ่มต้นเลือกซื้อสินค้าคุณภาพจากผู้ขายที่ได้รับการยืนยันตัวตนได้ทันที",
        isRead: false,
        createdAt: new Date().toISOString(),
      },
    ];
    return notifs;
  }

  async markNotificationRead(notificationId: string, userId: string): Promise<{ success: boolean }> {
    const notifs = this.inMemoryNotifications.get(userId) || [];
    for (const n of notifs) {
      if (n.id === notificationId) {
        n.isRead = true;
        n.readAt = new Date().toISOString();
      }
    }
    return { success: true };
  }

  async markAllNotificationsRead(userId: string): Promise<{ success: boolean }> {
    const notifs = this.inMemoryNotifications.get(userId) || [];
    for (const n of notifs) {
      n.isRead = true;
      n.readAt = new Date().toISOString();
    }
    return { success: true };
  }
}
