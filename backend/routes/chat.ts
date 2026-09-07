/**
 * Velnox Chat & Notifications Endpoints
 *
 * Customer:
 *   GET    /api/customer/conversations                — List my conversations
 *   POST   /api/customer/conversations                — Get-or-create (shopId, productId?)
 *   GET    /api/customer/conversations/:id/messages   — Messages (keyset pagination via ?before=)
 *   POST   /api/customer/conversations/:id/messages   — Send message
 *   POST   /api/customer/conversations/:id/read       — Mark incoming messages read
 *
 * Seller:
 *   GET    /api/seller/conversations                 — Conversations of my shop(s)
 *   GET    /api/seller/conversations/:id/messages    — Messages
 *   POST   /api/seller/conversations/:id/messages    — Reply
 *   POST   /api/seller/conversations/:id/read        — Mark incoming messages read
 *
 * Notifications:
 *   GET    /api/customer/notifications               — My notifications
 *   PATCH  /api/customer/notifications/:id/read      — Mark one read
 *   PUT    /api/customer/notifications/read-all      — Mark all read
 *
 * Security:
 *   - Every endpoint requires auth (httpOnly JWT cookie).
 *   - Customers can only access conversations where they are the customer.
 *   - Sellers can only access conversations of their own shop.
 *   - Message body validated server-side (1..4000 chars).
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";
import { CHANNELS, sendToUser } from "../realtime/index.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function param(req: Request, key: string): string {
  return (req.params as Record<string, string>)[key] ?? "";
}

/** Resolve the approved seller row for a user (or null). */
async function getSellerForUser(userId: string): Promise<{ id: string; user_id: string } | null> {
  const res = await query(
    "SELECT id, user_id FROM sellers WHERE user_id = $1 AND status = 'approved' LIMIT 1",
    [userId],
  );
  return res.rows[0] ?? null;
}

/** Map a chat_messages row to the API shape. */
function mapMessage(r: any): Record<string, unknown> {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    senderRole: r.sender_role,
    body: r.body,
    status: r.status,
    readAt: r.read_at ? new Date(r.read_at).getTime() : null,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}

async function loadMessages(conversationId: string, before?: string): Promise<{ items: any[]; hasMore: boolean }> {
  const LIMIT = 30;
  const params: unknown[] = [conversationId];
  let where = "WHERE m.conversation_id = $1";
  if (before) {
    const beforeMs = parseInt(String(before), 10);
    if (!Number.isNaN(beforeMs)) {
      params.push(new Date(beforeMs).toISOString());
      where += " AND m.created_at < $" + params.length;
    }
  }
  params.push(LIMIT + 1);
  const res = await query(
    `SELECT m.* FROM chat_messages m ${where} ORDER BY m.created_at DESC LIMIT $${params.length}`,
    params,
  );
  const hasMore = res.rows.length > LIMIT;
  const items = (hasMore ? res.rows.slice(0, LIMIT) : res.rows).reverse();
  return { items, hasMore };
}

/** Fetch one conversation row with participant/product/shop enrichment. */
async function getConversationById(conversationId: string): Promise<any | null> {
  const res = await query(
    `SELECT c.*,
            sh.name AS shop_name, sh.logo AS shop_logo,
            sl.user_id AS seller_user_id,
            su.name AS seller_name, su.avatar AS seller_avatar,
            cu.name AS customer_name, cu.avatar AS customer_avatar,
            p.name AS product_name, p.price AS product_price,
            (SELECT pi.url FROM product_images pi
              WHERE pi.product_id = c.product_id AND (pi.image_type = 'gallery' OR pi.image_type IS NULL)
              ORDER BY pi.sort_order ASC, pi.created_at ASC LIMIT 1) AS product_image
     FROM conversations c
     JOIN shops sh ON sh.id = c.shop_id
     JOIN sellers sl ON sl.id = c.seller_id
     LEFT JOIN users su ON su.id = sl.user_id
     LEFT JOIN users cu ON cu.id = c.customer_id
     LEFT JOIN products p ON p.id = c.product_id
     WHERE c.id = $1`,
    [conversationId],
  );
  return res.rows[0] ?? null;
}

/** Build the API conversation object from a row for a given viewer. */
function mapConversation(r: any, viewerUserId: string): Record<string, unknown> {
  const isCustomerView = r.customer_id === viewerUserId;
  const otherUserId = isCustomerView ? r.seller_user_id : r.customer_id;
  const otherName = isCustomerView ? r.seller_name : r.customer_name;
  const otherAvatar = isCustomerView ? r.seller_avatar : r.customer_avatar;
  return {
    id: r.id,
    customerId: r.customer_id,
    sellerId: r.seller_id,
    shopId: r.shop_id,
    productId: r.product_id ?? null,
    shopName: r.shop_name,
    shopLogo: r.shop_logo,
    // The person on the other side of the thread, from the viewer's perspective
    participantId: otherUserId ?? null,
    participantName: otherName ?? null,
    participantAvatar: otherAvatar ?? null,
    product: r.product_id
      ? {
          id: r.product_id,
          name: r.product_name ?? null,
          price: r.product_price != null ? Number(r.product_price) : null,
          imageUrl: r.product_image ?? null,
        }
      : null,
    lastMessage: r.last_message ?? null,
    lastMessageAt: r.last_message_at ? new Date(r.last_message_at).getTime() : null,
    unreadCount: parseInt(r.unread_count ?? "0", 10),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
  };
}

/** Insert a notification row and push it over the user's realtime channel. */
async function notifyUser(userId: string, type: string, title: string, message: string, data?: unknown): Promise<void> {
  try {
    const res = await query(
      `INSERT INTO notifications (user_id, type, title, message, data)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, type, title, message, data ? JSON.stringify(data) : null],
    );
    sendToUser(userId, "", CHANNELS.NOTIFICATION_CREATED, {
      id: res.rows[0]?.id ?? null,
      type,
      title,
      message,
    });
  } catch (err) {
    // Notifications must never break the chat flow.
    console.error("[chat] notifyUser failed:", err);
  }
}

/** Shared validation: body must be a non-empty string of ≤ 4000 chars. */
function validateBody(body: unknown): string | null {
  if (typeof body !== "string") return null;
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > 4000) return null;
  return trimmed;
}

// ─── Route setup ─────────────────────────────────────────────────────────────

export function setupChatRoutes(app: Express): void {
  // ═══════════════════════ NOTIFICATIONS (customer) ═══════════════════════

  app.get("/api/customer/notifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT id, type, title, message, read, created_at
         FROM notifications WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 50`,
        [req.user!.userId],
      );
      const items = result.rows.map((r: any) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        message: r.message ?? null,
        isRead: !!r.read,
        createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
      }));
      res.json({ success: true, data: { items } });
    } catch (err) {
      console.error("[chat] notifications list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load notifications" } });
    }
  });

  app.patch("/api/customer/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const result = await query(
        `UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id`,
        [param(req, "id"), req.user!.userId],
      );
      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Notification not found" } });
        return;
      }
      res.json({ success: true, data: { id: result.rows[0].id } });
    } catch (err) {
      console.error("[chat] notification read error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update notification" } });
    }
  });

  app.put("/api/customer/notifications/read-all", requireAuth, async (_req: Request, res: Response) => {
    try {
      await query(`UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`, [_req.user!.userId]);
      res.json({ success: true, data: { updated: true } });
    } catch (err) {
      console.error("[chat] notifications read-all error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update notifications" } });
    }
  });

  // ═══════════════════════ CUSTOMER CHAT ═══════════════════════════════════

  // ── GET /api/customer/conversations ──────────────────────────────────────
  app.get("/api/customer/conversations", requireAuth, async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT c.*,
                sh.name AS shop_name, sh.logo AS shop_logo,
                sl.user_id AS seller_user_id,
                su.name AS seller_name, su.avatar AS seller_avatar,
                cu.name AS customer_name, cu.avatar AS customer_avatar,
                p.name AS product_name, p.price AS product_price,
                (SELECT pi.url FROM product_images pi
                  WHERE pi.product_id = c.product_id AND (pi.image_type = 'gallery' OR pi.image_type IS NULL)
                  ORDER BY pi.sort_order ASC, pi.created_at ASC LIMIT 1) AS product_image,
                (SELECT COUNT(*) FROM chat_messages m
                  WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread_count
         FROM conversations c
         JOIN shops sh ON sh.id = c.shop_id
         JOIN sellers sl ON sl.id = c.seller_id
         LEFT JOIN users su ON su.id = sl.user_id
         LEFT JOIN users cu ON cu.id = c.customer_id
         LEFT JOIN products p ON p.id = c.product_id
         WHERE c.customer_id = $1
         ORDER BY c.updated_at DESC`,
        [req.user!.userId],
      );
      res.json({
        success: true,
        data: result.rows.map((r: any) => mapConversation(r, req.user!.userId)),
      });
    } catch (err) {
      console.error("[chat] customer conversations error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load conversations" } });
    }
  });

  // ── POST /api/customer/conversations — get-or-create by shop ────────────
  app.post("/api/customer/conversations", requireAuth, async (req: Request, res: Response) => {
    try {
      const shopId: unknown = req.body?.shopId;
      const productId: unknown = req.body?.productId ?? null;
      if (typeof shopId !== "string" || shopId.length === 0) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "shopId is required" } });
        return;
      }
      // Shop must exist and belong to an approved seller.
      const shopRes = await query(
        `SELECT sh.id, sl.id AS seller_id FROM shops sh
         JOIN sellers sl ON sl.id = sh.seller_id
         WHERE sh.id = $1 AND sl.status = 'approved'`,
        [shopId],
      );
      if (shopRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "SHOP_NOT_FOUND", message: "Shop not found" } });
        return;
      }
      const sellerId = shopRes.rows[0].seller_id;

      // Optional product must exist and belong to this shop.
      if (productId) {
        if (typeof productId !== "string") {
          res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid product" } });
          return;
        }
        const prodRes = await query("SELECT id FROM products WHERE id = $1 AND shop_id = $2", [productId, shopId]);
        if (prodRes.rows.length === 0) {
          res.status(400).json({ success: false, error: { code: "PRODUCT_NOT_FOUND", message: "Product not found in this shop" } });
          return;
        }
      }

      const userId = req.user!.userId;
      // Get-or-create (race-safe).
      await query(
        `INSERT INTO conversations (customer_id, seller_id, shop_id, product_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (customer_id, shop_id) DO UPDATE SET product_id = COALESCE(conversations.product_id, EXCLUDED.product_id)`,
        [userId, sellerId, shopId, productId],
      );
      const convRes = await query(
        "SELECT id FROM conversations WHERE customer_id = $1 AND shop_id = $2",
        [userId, shopId],
      );
      const conversation = await getConversationById(convRes.rows[0].id);
      res.json({ success: true, data: mapConversation(conversation, userId) });
    } catch (err) {
      console.error("[chat] create conversation error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to create conversation" } });
    }
  });

  // ── GET /api/customer/conversations/:id/messages ────────────────────────
  app.get("/api/customer/conversations/:id/messages", requireAuth, async (req: Request, res: Response) => {
    try {
      const conversationId = param(req, "id");
      const convRes = await query("SELECT id FROM conversations WHERE id = $1 AND customer_id = $2", [
        conversationId,
        req.user!.userId,
      ]);
      if (convRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Conversation not found" } });
        return;
      }
      const before = typeof req.query.before === "string" ? req.query.before : undefined;
      const { items, hasMore } = await loadMessages(conversationId, before);
      res.json({ success: true, data: { items, hasMore } });
    } catch (err) {
      console.error("[chat] customer messages error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load messages" } });
    }
  });

  // ── POST /api/customer/conversations/:id/messages ───────────────────────
  app.post("/api/customer/conversations/:id/messages", requireAuth, async (req: Request, res: Response) => {
    try {
      const conversationId = param(req, "id");
      const convRes = await query(
        "SELECT c.*, sl.user_id AS seller_user_id FROM conversations c JOIN sellers sl ON sl.id = c.seller_id WHERE c.id = $1 AND c.customer_id = $2",
        [conversationId, req.user!.userId],
      );
      if (convRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Conversation not found" } });
        return;
      }
      const body = validateBody(req.body?.body);
      if (!body) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Message must be 1-4000 characters" } });
        return;
      }
      const clientId = typeof req.body?.clientId === "string" ? req.body.clientId.slice(0, 64) : null;
      const userId = req.user!.userId;

      const insertRes = await query(
        `INSERT INTO chat_messages (conversation_id, sender_id, sender_role, body)
         VALUES ($1, $2, 'customer', $3) RETURNING *`,
        [conversationId, userId, body],
      );
      await query(
        `UPDATE conversations SET last_message = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [body.slice(0, 200), conversationId],
      );

      const message = mapMessage(insertRes.rows[0]);
      // Realtime: notify the seller's user channel.
      const conv = convRes.rows[0];
      sendToUser(conv.seller_user_id, "", CHANNELS.CHAT_MESSAGE, {
        conversationId,
        message,
        clientId,
      });
      // Notification row for the seller.
      await notifyUser(
        conv.seller_user_id,
        "chat",
        "ข้อความใหม่จากลูกค้า",
        body.slice(0, 120),
        { conversationId },
      );

      res.json({ success: true, data: { message, clientId } });
    } catch (err) {
      console.error("[chat] customer send error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to send message" } });
    }
  });

  // ── POST /api/customer/conversations/:id/read ───────────────────────────
  app.post("/api/customer/conversations/:id/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const conversationId = param(req, "id");
      const convRes = await query(
        "SELECT c.*, sl.user_id AS seller_user_id FROM conversations c JOIN sellers sl ON sl.id = c.seller_id WHERE c.id = $1 AND c.customer_id = $2",
        [conversationId, req.user!.userId],
      );
      if (convRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Conversation not found" } });
        return;
      }
      const updated = await query(
        `UPDATE chat_messages SET status = 'read', read_at = NOW()
         WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL
         RETURNING id`,
        [conversationId, req.user!.userId],
      );
      if (updated.rows.length > 0) {
        sendToUser(convRes.rows[0].seller_user_id, "", CHANNELS.CHAT_READ, {
          conversationId,
          readerId: req.user!.userId,
        });
      }
      res.json({ success: true, data: { marked: updated.rows.length } });
    } catch (err) {
      console.error("[chat] customer read error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to mark messages read" } });
    }
  });

  // ═══════════════════════ SELLER CHAT ═════════════════════════════════════

  // ── GET /api/seller/conversations ───────────────────────────────────────
  app.get("/api/seller/conversations", requireAuth, async (req: Request, res: Response) => {
    try {
      const seller = await getSellerForUser(req.user!.userId);
      if (!seller) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not an approved seller" } });
        return;
      }
      const result = await query(
        `SELECT c.*,
                sh.name AS shop_name, sh.logo AS shop_logo,
                sl.user_id AS seller_user_id,
                su.name AS seller_name, su.avatar AS seller_avatar,
                cu.name AS customer_name, cu.avatar AS customer_avatar,
                p.name AS product_name, p.price AS product_price,
                (SELECT pi.url FROM product_images pi
                  WHERE pi.product_id = c.product_id AND (pi.image_type = 'gallery' OR pi.image_type IS NULL)
                  ORDER BY pi.sort_order ASC, pi.created_at ASC LIMIT 1) AS product_image,
                (SELECT COUNT(*) FROM chat_messages m
                  WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread_count
         FROM conversations c
         JOIN shops sh ON sh.id = c.shop_id
         JOIN sellers sl ON sl.id = c.seller_id
         LEFT JOIN users su ON su.id = sl.user_id
         LEFT JOIN users cu ON cu.id = c.customer_id
         LEFT JOIN products p ON p.id = c.product_id
         WHERE c.seller_id = $2
         ORDER BY c.updated_at DESC`,
        [req.user!.userId, seller.id],
      );
      res.json({
        success: true,
        data: result.rows.map((r: any) => mapConversation(r, req.user!.userId)),
      });
    } catch (err) {
      console.error("[chat] seller conversations error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load conversations" } });
    }
  });

  // ── GET /api/seller/conversations/:id/messages ──────────────────────────
  app.get("/api/seller/conversations/:id/messages", requireAuth, async (req: Request, res: Response) => {
    try {
      const conversationId = param(req, "id");
      const seller = await getSellerForUser(req.user!.userId);
      if (!seller) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not an approved seller" } });
        return;
      }
      const convRes = await query("SELECT id FROM conversations WHERE id = $1 AND seller_id = $2", [
        conversationId,
        seller.id,
      ]);
      if (convRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Conversation not found" } });
        return;
      }
      const before = typeof req.query.before === "string" ? req.query.before : undefined;
      const { items, hasMore } = await loadMessages(conversationId, before);
      res.json({ success: true, data: { items, hasMore } });
    } catch (err) {
      console.error("[chat] seller messages error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load messages" } });
    }
  });

  // ── POST /api/seller/conversations/:id/messages ─────────────────────────
  app.post("/api/seller/conversations/:id/messages", requireAuth, async (req: Request, res: Response) => {
    try {
      const conversationId = param(req, "id");
      const seller = await getSellerForUser(req.user!.userId);
      if (!seller) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not an approved seller" } });
        return;
      }
      const convRes = await query("SELECT * FROM conversations WHERE id = $1 AND seller_id = $2", [
        conversationId,
        seller.id,
      ]);
      if (convRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Conversation not found" } });
        return;
      }
      const body = validateBody(req.body?.body);
      if (!body) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Message must be 1-4000 characters" } });
        return;
      }
      const clientId = typeof req.body?.clientId === "string" ? req.body.clientId.slice(0, 64) : null;
      const userId = req.user!.userId;

      const insertRes = await query(
        `INSERT INTO chat_messages (conversation_id, sender_id, sender_role, body)
         VALUES ($1, $2, 'seller', $3) RETURNING *`,
        [conversationId, userId, body],
      );
      await query(
        `UPDATE conversations SET last_message = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [body.slice(0, 200), conversationId],
      );

      const message = mapMessage(insertRes.rows[0]);
      // Realtime: notify the customer's user channel.
      const conv = convRes.rows[0];
      sendToUser(conv.customer_id, "", CHANNELS.CHAT_MESSAGE, {
        conversationId,
        message,
        clientId,
      });
      await notifyUser(
        conv.customer_id,
        "chat",
        `ข้อความใหม่จากร้าน ${conv.shop_name ?? ""}`.trim(),
        body.slice(0, 120),
        { conversationId },
      );

      res.json({ success: true, data: { message, clientId } });
    } catch (err) {
      console.error("[chat] seller send error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to send message" } });
    }
  });

  // ── POST /api/seller/conversations/:id/read ─────────────────────────────
  app.post("/api/seller/conversations/:id/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const conversationId = param(req, "id");
      const seller = await getSellerForUser(req.user!.userId);
      if (!seller) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not an approved seller" } });
        return;
      }
      const convRes = await query("SELECT * FROM conversations WHERE id = $1 AND seller_id = $2", [
        conversationId,
        seller.id,
      ]);
      if (convRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Conversation not found" } });
        return;
      }
      const updated = await query(
        `UPDATE chat_messages SET status = 'read', read_at = NOW()
         WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL
         RETURNING id`,
        [conversationId, req.user!.userId],
      );
      if (updated.rows.length > 0) {
        sendToUser(convRes.rows[0].customer_id, "", CHANNELS.CHAT_READ, {
          conversationId,
          readerId: req.user!.userId,
        });
      }
      res.json({ success: true, data: { marked: updated.rows.length } });
    } catch (err) {
      console.error("[chat] seller read error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to mark messages read" } });
    }
  });
}