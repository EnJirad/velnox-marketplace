/**
 * Unified Chat & Notifications HTTP Routes
 * Implements Customer, Seller, and Company conversation flows with auth guards.
 */

import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
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
