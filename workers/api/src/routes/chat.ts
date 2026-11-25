/**
 * Unified Chat & Notifications HTTP Routes
 * Implements Customer, Seller, and Company conversation flows with auth guards.
 */

import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { neon } from "@neondatabase/serverless";
import { ChatService } from "../modules/chat/chat-service.js";
import { getInProcessRealtimeHub } from "./realtime.js";
import type { Bindings, Variables } from "../types.js";

export const chatRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

let chatServiceInstance: ChatService | null = null;

function getChatService(c: any): ChatService {
  if (chatServiceInstance) return chatServiceInstance;
  const hub = getInProcessRealtimeHub(c.env || {});
  chatServiceInstance = new ChatService(c.env, hub);
  return chatServiceInstance;
}

export function setTestChatService(service: ChatService | null) {
  chatServiceInstance = service;
}

// ----------------------------------------------------
// Customer Endpoints
// ----------------------------------------------------

/**
 * GET /customer/conversations — List customer conversations
 */
chatRoutes.get("/customer/conversations", authMiddleware, async (c) => {
  const user = c.get("user");
  const service = getChatService(c);
  const items = await service.listCustomerConversations(user.sub);
  return c.json({ success: true, data: { items } });
});

/**
 * POST /customer/conversations — Get-or-create customer-seller conversation
 */
chatRoutes.post("/customer/conversations", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => null)) as any;
  const shopId = body?.shopId;

  if (!shopId) {
    return c.json({ success: false, error: "shopId is required" }, 400);
  }

  const service = getChatService(c);
  const conv = await service.getOrCreateCustomerConversation(user.sub, shopId);
  return c.json({ success: true, data: conv }, 201);
});

/**
 * POST /customer/support/conversation — Get-or-create company support thread
 */
chatRoutes.post("/customer/support/conversation", authMiddleware, async (c) => {
  const user = c.get("user");
  const service = getChatService(c);
  const conv = await service.getOrCreateSupportConversation(user.sub);
  return c.json({ success: true, data: conv }, 200);
});

/**
 * GET /customer/conversations/:id/messages — Keyset paginated messages
 */
chatRoutes.get("/customer/conversations/:id/messages", authMiddleware, async (c) => {
  const conversationId = c.req.param("id");
  const limit = Math.min(Number(c.req.query("limit") || 50), 100);

  const service = getChatService(c);
  const result = await service.listMessages(conversationId, limit);
  return c.json({ success: true, data: result });
});

/**
 * POST /customer/conversations/:id/messages — Send chat message
 */
chatRoutes.post("/customer/conversations/:id/messages", authMiddleware, async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as any;

  const content = body?.content || body?.body;
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return c.json({ success: false, error: "Message content cannot be empty" }, 400);
  }

  const service = getChatService(c);
  const message = await service.sendMessage(
    conversationId,
    user.sub,
    "customer",
    content.trim(),
    body?.clientId,
    body?.attachmentUrl,
  );

  return c.json({ success: true, data: { message } }, 201);
});

/**
 * POST /customer/conversations/:id/read — Mark conversation as read
 */
chatRoutes.post("/customer/conversations/:id/read", authMiddleware, async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as any;

  const service = getChatService(c);
  await service.markRead(conversationId, user.sub, body?.upTo);
  return c.json({ success: true, data: { message: "Marked read" } }, 200);
});

/**
 * GET /customer/notifications — List notifications
 */
chatRoutes.get("/customer/notifications", authMiddleware, async (c) => {
  const user = c.get("user");
  const service = getChatService(c);
  const items = await service.listNotifications(user.sub);
  return c.json({ success: true, data: { items } });
});

/**
 * PATCH /customer/notifications/:id/read — Mark one notification read
 */
chatRoutes.patch("/customer/notifications/:id/read", authMiddleware, async (c) => {
  const user = c.get("user");
  const notifId = c.req.param("id");
  const service = getChatService(c);
  await service.markNotificationRead(notifId, user.sub);
  return c.json({ success: true, data: { message: "Notification marked read" } });
});

/**
 * PUT /customer/notifications/read-all — Mark all notifications read
 */
chatRoutes.put("/customer/notifications/read-all", authMiddleware, async (c) => {
  const user = c.get("user");
  const service = getChatService(c);
  await service.markAllNotificationsRead(user.sub);
  return c.json({ success: true, data: { message: "All notifications marked read" } });
});

// ----------------------------------------------------
// Seller Endpoints
// ----------------------------------------------------

/**
 * GET /seller/conversations — List seller conversations
 */
chatRoutes.get("/seller/conversations", authMiddleware, async (c) => {
  const user = c.get("user");
  const service = getChatService(c);
  const items = await service.listSellerConversations(user.sub);
  return c.json({ success: true, data: { items } });
});

/**
 * POST /seller/conversations/:id/messages — Reply to customer
 */
chatRoutes.post("/seller/conversations/:id/messages", authMiddleware, async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as any;

  const content = body?.content || body?.body;
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return c.json({ success: false, error: "Message content cannot be empty" }, 400);
  }

  const service = getChatService(c);
  const message = await service.sendMessage(
    conversationId,
    user.sub,
    "seller",
    content.trim(),
    body?.clientId,
    body?.attachmentUrl,
  );

  return c.json({ success: true, data: { message } }, 201);
});

/**
 * POST /seller/conversations/:id/read — Mark conversation read
 */
chatRoutes.post("/seller/conversations/:id/read", authMiddleware, async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as any;

  const service = getChatService(c);
  await service.markRead(conversationId, user.sub, body?.upTo);
  return c.json({ success: true, data: { message: "Marked read" } }, 200);
});

// ----------------------------------------------------
// VelCenter Company & Support Chat Endpoints
// ----------------------------------------------------

/**
 * GET /center/chat/unread — Badge counters for VelCenter chat tabs
 */
chatRoutes.get("/center/chat/unread", authMiddleware, async (c) => {
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { support: 0, customers: 0, sellers: 0, internal: 0 } });
  }
  try {
    const sql = neon(env.DATABASE_URL);
    const counts = await sql`
      SELECT
        COUNT(DISTINCT c.id) FILTER (WHERE c.type = 'CUSTOMER_COMPANY' AND m.id IS NOT NULL)::int AS customers,
        COUNT(DISTINCT c.id) FILTER (WHERE c.type = 'SELLER_COMPANY' AND m.id IS NOT NULL)::int AS sellers,
        COUNT(DISTINCT c.id) FILTER (WHERE c.type = 'COMPANY_INTERNAL' AND m.id IS NOT NULL)::int AS internal
      FROM conversations c
      LEFT JOIN chat_messages m ON m.conversation_id = c.id AND m.read_at IS NULL AND m.sender_role != 'company'
    `;
    const customers = Number(counts[0]?.customers ?? 0);
    const sellers = Number(counts[0]?.sellers ?? 0);
    const internal = Number(counts[0]?.internal ?? 0);
    return c.json({
      success: true,
      data: {
        support: customers + sellers,
        customers,
        sellers,
        internal,
      },
    });
  } catch (err) {
    console.error("[chat] center unread error:", err);
    return c.json({ success: true, data: { support: 0, customers: 0, sellers: 0, internal: 0 } });
  }
});

/**
 * GET /center/chat/conversations — List company conversations by type
 */
chatRoutes.get("/center/chat/conversations", authMiddleware, async (c) => {
  const type = c.req.query("type") || "support";
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { items: [] } });
  }
  try {
    const sql = neon(env.DATABASE_URL);
    let filterSql;
    if (type === "customer") {
      filterSql = sql`c.type = 'CUSTOMER_COMPANY'`;
    } else if (type === "seller") {
      filterSql = sql`c.type = 'SELLER_COMPANY'`;
    } else if (type === "internal") {
      filterSql = sql`c.type = 'COMPANY_INTERNAL'`;
    } else {
      filterSql = sql`c.type IN ('CUSTOMER_COMPANY', 'SELLER_COMPANY')`;
    }
    const rows = await sql`
      SELECT
        c.id, c.type, c.title, c.support_status, c.assigned_to,
        c.last_message, c.last_message_at, c.updated_at,
        u_assigned.name AS assigned_to_name,
        u_cust.id AS customer_id, u_cust.name AS customer_name, u_cust.avatar AS customer_avatar,
        s.id AS seller_id, s.user_id AS seller_user_id, s.shop_name, s.logo_url AS shop_logo,
        u_seller.name AS seller_name, u_seller.avatar AS seller_avatar,
        p.id AS product_id, p.name AS product_name, p.price AS product_price, p.primary_image_url AS product_image,
        COUNT(m.id) FILTER (WHERE m.read_at IS NULL AND m.sender_role != 'company')::int AS unread_count
      FROM conversations c
      LEFT JOIN users u_assigned ON u_assigned.id = c.assigned_to
      LEFT JOIN users u_cust ON u_cust.id = c.customer_id
      LEFT JOIN sellers s ON s.id = c.seller_id
      LEFT JOIN users u_seller ON u_seller.id = s.user_id
      LEFT JOIN products p ON p.id = c.product_id
      LEFT JOIN chat_messages m ON m.conversation_id = c.id
      WHERE ${filterSql} AND c.status = 'active'
      GROUP BY c.id, u_assigned.name, u_cust.id, u_cust.name, u_cust.avatar, s.id, s.user_id, s.shop_name, s.logo_url, u_seller.name, u_seller.avatar, p.id, p.name, p.price, p.primary_image_url
      ORDER BY c.updated_at DESC
      LIMIT 100
    `;
    const items = rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      legacySupport: false,
      supportAudience: r.type === "SELLER_COMPANY" ? "seller" : "customer",
      title: r.title,
      status: r.support_status || "OPEN",
      assignedTo: r.assigned_to,
      assignedToName: r.assigned_to_name,
      customer: r.customer_id ? { id: r.customer_id, name: r.customer_name, avatar: r.customer_avatar } : null,
      seller: r.seller_id ? {
        id: r.seller_id,
        userId: r.seller_user_id,
        name: r.seller_name,
        avatar: r.seller_avatar,
        shopName: r.shop_name,
        shopLogo: r.shop_logo,
      } : null,
      product: r.product_id ? {
        id: r.product_id,
        name: r.product_name,
        price: Number(r.product_price ?? 0),
        imageUrl: r.product_image,
      } : null,
      lastMessage: r.last_message,
      lastMessageAt: r.last_message_at ? new Date(r.last_message_at).getTime() : null,
      unreadCount: Number(r.unread_count ?? 0),
      updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
      participantOnline: false,
      participantLastSeenAt: null,
    }));
    return c.json({ success: true, data: { items } });
  } catch (err) {
    console.error("[chat] center list error:", err);
    return c.json({ success: true, data: { items: [] } });
  }
});

/**
 * GET /center/chat/staff — Directory of staff for chat assignments
 */
chatRoutes.get("/center/chat/staff", authMiddleware, async (c) => {
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { items: [] } });
  }
  try {
    const sql = neon(env.DATABASE_URL);
    const staff = await sql`
      SELECT id, name, email, role
      FROM users
      WHERE role IN ('owner', 'admin', 'staff', 'center_staff', 'center_admin', 'center_superadmin')
      ORDER BY name ASC
    `;
    const items = staff.map((s: any) => ({
      id: s.id,
      name: s.name || s.email,
      role: s.role,
    }));
    return c.json({ success: true, data: { items } });
  } catch (err) {
    console.error("[chat] center staff error:", err);
    return c.json({ success: true, data: { items: [] } });
  }
});

/**
 * GET /center/chat/conversations/:id/messages — Messages for thread
 */
chatRoutes.get("/center/chat/conversations/:id/messages", authMiddleware, async (c) => {
  const conversationId = c.req.param("id");
  const before = c.req.query("before");
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { items: [], hasMore: false } });
  }
  try {
    const sql = neon(env.DATABASE_URL);
    let rows;
    if (before && !isNaN(Number(before))) {
      const beforeDate = new Date(Number(before)).toISOString();
      rows = await sql`
        SELECT id, conversation_id, sender_id, sender_role, body, status, read_at, created_at, attachment_key, system_kind
        FROM chat_messages
        WHERE conversation_id = ${conversationId} AND created_at < ${beforeDate}
        ORDER BY created_at ASC
        LIMIT 50
      `;
    } else {
      rows = await sql`
        SELECT id, conversation_id, sender_id, sender_role, body, status, read_at, created_at, attachment_key, system_kind
        FROM chat_messages
        WHERE conversation_id = ${conversationId}
        ORDER BY created_at ASC
        LIMIT 100
      `;
    }
    const items = rows.map((m: any) => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      senderRole: m.sender_role,
      body: m.body,
      status: m.status,
      readAt: m.read_at ? new Date(m.read_at).getTime() : null,
      createdAt: new Date(m.created_at).getTime(),
      isSystem: m.sender_role === "system",
      systemKind: m.system_kind,
      attachmentUrl: m.attachment_key ? `/api/media/${m.attachment_key}` : null,
    }));
    return c.json({ success: true, data: { items, hasMore: items.length >= 50 } });
  } catch (err) {
    console.error("[chat] center messages error:", err);
    return c.json({ success: true, data: { items: [], hasMore: false } });
  }
});

/**
 * POST /center/chat/conversations/:id/messages — Send company response
 */
chatRoutes.post("/center/chat/conversations/:id/messages", authMiddleware, async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) || {};
  const content = body.content || body.body || "";
  if (!content.trim() && !body.attachmentUrl) {
    return c.json({ success: false, error: "Message content cannot be empty" }, 400);
  }
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({
      success: true,
      data: {
        message: {
          id: crypto.randomUUID(),
          conversationId,
          senderId: user.sub,
          senderRole: "company",
          body: content.trim(),
          status: "sent",
          readAt: null,
          createdAt: Date.now(),
        },
      },
    }, 201);
  }
  try {
    const sql = neon(env.DATABASE_URL);
    const inserted = await sql`
      INSERT INTO chat_messages (conversation_id, sender_id, sender_role, body, status, client_id)
      VALUES (${conversationId}, ${user.sub}, 'company', ${content.trim()}, 'sent', ${body.clientId || null})
      RETURNING id, conversation_id, sender_id, sender_role, body, status, read_at, created_at
    `;
    const m = inserted[0];
    await sql`
      UPDATE conversations
      SET last_message = ${content.trim()},
          last_message_at = NOW(),
          updated_at = NOW()
      WHERE id = ${conversationId}
    `;
    return c.json({
      success: true,
      data: {
        message: {
          id: m.id,
          conversationId: m.conversation_id,
          senderId: m.sender_id,
          senderRole: m.sender_role,
          body: m.body,
          status: m.status,
          readAt: null,
          createdAt: new Date(m.created_at).getTime(),
        },
      },
    }, 201);
  } catch (err: any) {
    console.error("[chat] send center message error:", err);
    return c.json({ success: false, error: err?.message || "Failed to send message" }, 500);
  }
});

/**
 * POST /center/chat/conversations/:id/read — Mark messages read
 */
chatRoutes.post("/center/chat/conversations/:id/read", authMiddleware, async (c) => {
  const conversationId = c.req.param("id");
  const env = c.env as Bindings | undefined;
  if (env?.DATABASE_URL) {
    try {
      const sql = neon(env.DATABASE_URL);
      await sql`
        UPDATE chat_messages
        SET status = 'read', read_at = NOW()
        WHERE conversation_id = ${conversationId} AND read_at IS NULL AND sender_role != 'company'
      `;
    } catch (err) {
      console.error("[chat] center mark read error:", err);
    }
  }
  return c.json({ success: true, data: { message: "Marked read" } });
});

/**
 * PATCH /center/chat/conversations/:id — Update conversation status / assigned agent
 */
chatRoutes.patch("/center/chat/conversations/:id", authMiddleware, async (c) => {
  const conversationId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) || {};
  const env = c.env as Bindings | undefined;
  if (env?.DATABASE_URL) {
    try {
      const sql = neon(env.DATABASE_URL);
      const { status, assignedTo, title } = body;
      await sql`
        UPDATE conversations
        SET support_status = COALESCE(${status || null}, support_status),
            assigned_to = COALESCE(${assignedTo || null}, assigned_to),
            title = COALESCE(${title || null}, title),
            updated_at = NOW()
        WHERE id = ${conversationId}
      `;
    } catch (err) {
      console.error("[chat] center update conv error:", err);
    }
  }
  return c.json({ success: true, data: { updated: true } });
});

/**
 * POST /center/chat/internal/conversations — Create company internal chat room
 */
chatRoutes.post("/center/chat/internal/conversations", authMiddleware, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) || {};
  const title = (body.title || "").trim();
  if (!title) {
    return c.json({ success: false, error: "Title is required" }, 400);
  }
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { id: crypto.randomUUID(), type: "COMPANY_INTERNAL", title } }, 201);
  }
  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      INSERT INTO conversations (type, title, support_status)
      VALUES ('COMPANY_INTERNAL', ${title}, 'OPEN')
      RETURNING id, type, title, support_status, created_at, updated_at
    `;
    return c.json({ success: true, data: rows[0] }, 201);
  } catch (err: any) {
    console.error("[chat] create internal room error:", err);
    return c.json({ success: false, error: err?.message || "Failed to create internal room" }, 500);
  }
});
