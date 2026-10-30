/**
 * Velnox Chat & Notifications Endpoints — the ONE conversation core.
 *
 * Every chat type is a row in `conversations`, distinguished by `type`:
 *   CUSTOMER_SELLER, CUSTOMER_COMPANY, SELLER_COMPANY, COMPANY_INTERNAL
 * and every message is a row in `chat_messages`. There is no second chat
 * engine, table or socket; the VelCenter company surface (routes/center-chat.ts)
 * imports these same helpers.
 *
 * Customer:
 *   GET    /api/customer/conversations                — List my conversations
 *   POST   /api/customer/conversations                — Get-or-create (shopId, productId?)
 *   POST   /api/customer/support/conversation         — Get-or-create company thread
 *   GET    /api/customer/conversations/:id/messages   — Messages (keyset pagination via ?before=)
 *   POST   /api/customer/conversations/:id/messages   — Send message
 *   POST   /api/customer/conversations/:id/read       — Mark incoming messages read
 *
 * Seller:
 *   GET    /api/seller/conversations                 — Customer + company threads
 *   POST   /api/seller/company/conversation          — Get-or-create company thread
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
 *   - Sender identity comes from the session, never from the request body.
 *   - A send may carry `clientId`; a retried submission replays the stored
 *     message instead of writing a duplicate row/push/notification (see
 *     `recentSends` — in-process, bounded, documented limitation).
 *   - A read may carry `upTo` (epoch ms): only messages the reader had already
 *     loaded are marked read, so a message arriving while the request is in
 *     flight stays unread.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";
import { CENTER_ROLES } from "../lib/permissions.js";
import {
  CHANNELS,
  getViewingConversation,
  sendToCenter,
  sendToUser,
} from "../realtime/index.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function param(req: Request, key: string): string {
  return (req.params as Record<string, string>)[key] ?? "";
}

/** Resolve the approved seller row for a user (or null). */
export async function getSellerForUser(userId: string): Promise<{ id: string; user_id: string } | null> {
  const res = await query(
    "SELECT id, user_id FROM sellers WHERE user_id = $1 AND status = 'approved' LIMIT 1",
    [userId],
  );
  return res.rows[0] ?? null;
}

// ─── Company chat ───────────────────────────────────────────────────────────
// Velnox company conversations are rows with type CUSTOMER_COMPANY /
// SELLER_COMPANY / COMPANY_INTERNAL. They are NOT marketplace sellers and are
// never served by the seller routes of a reserved shop.
//
// LEGACY COMPATIBILITY: an older database may still hold a support thread as
// CUSTOMER_SELLER against the reserved shop slug below. It stays readable and
// replyable (center chat includes it), and `ensureCustomerCompanyConversation`
// converts it in place the first time that customer opens support — the
// messages are preserved, and the thread stops depending on a fake shop.
const SUPPORT_SHOP_SLUG = "velnox-support";

const CONVERSATION_TYPES = [
  "CUSTOMER_SELLER",
  "CUSTOMER_COMPANY",
  "SELLER_COMPANY",
  "COMPANY_INTERNAL",
] as const;

export type ConversationType = (typeof CONVERSATION_TYPES)[number];

/** Get-or-create the one CUSTOMER_COMPANY thread for this customer. */
export async function ensureCustomerCompanyConversation(userId: string): Promise<any | null> {
  const existing = await query(
    "SELECT id FROM conversations WHERE customer_id = $1 AND type = 'CUSTOMER_COMPANY' LIMIT 1",
    [userId],
  );
  if (existing.rows[0]) return getConversationById(existing.rows[0].id);

  // Migrate a legacy reserved-shop support thread in place. Messages, timestamps
  // and read state are untouched; only the participant shape changes.
  const legacy = await query(
    `UPDATE conversations c
        SET type = 'CUSTOMER_COMPANY', seller_id = NULL, shop_id = NULL, updated_at = NOW()
       FROM shops sh
      WHERE c.shop_id = sh.id AND sh.slug = $2
        AND c.customer_id = $1 AND c.type = 'CUSTOMER_SELLER'
      RETURNING c.id`,
    [userId, SUPPORT_SHOP_SLUG],
  );
  if (legacy.rows[0]) return getConversationById(legacy.rows[0].id);

  const inserted = await query(
    `INSERT INTO conversations (type, customer_id) VALUES ('CUSTOMER_COMPANY', $1)
     ON CONFLICT DO NOTHING RETURNING id`,
    [userId],
  );
  if (inserted.rows[0]) return getConversationById(inserted.rows[0].id);

  // Lost a concurrent get-or-create race: the unique partial index guarantees
  // exactly one row, so read the winner instead of creating a second thread.
  const retry = await query(
    "SELECT id FROM conversations WHERE customer_id = $1 AND type = 'CUSTOMER_COMPANY' LIMIT 1",
    [userId],
  );
  return retry.rows[0] ? getConversationById(retry.rows[0].id) : null;
}

/** Get-or-create the one SELLER_COMPANY thread for this approved seller. */
export async function ensureSellerCompanyConversation(sellerId: string): Promise<any | null> {
  const existing = await query(
    "SELECT id FROM conversations WHERE seller_id = $1 AND type = 'SELLER_COMPANY' LIMIT 1",
    [sellerId],
  );
  if (existing.rows[0]) return getConversationById(existing.rows[0].id);

  const inserted = await query(
    `INSERT INTO conversations (type, seller_id) VALUES ('SELLER_COMPANY', $1)
     ON CONFLICT DO NOTHING RETURNING id`,
    [sellerId],
  );
  if (inserted.rows[0]) return getConversationById(inserted.rows[0].id);

  const retry = await query(
    "SELECT id FROM conversations WHERE seller_id = $1 AND type = 'SELLER_COMPANY' LIMIT 1",
    [sellerId],
  );
  return retry.rows[0] ? getConversationById(retry.rows[0].id) : null;
}

/** Map a chat_messages row to the API shape. */
export function mapMessage(r: any): Record<string, unknown> {
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

export async function loadMessages(conversationId: string, before?: string): Promise<{ items: any[]; hasMore: boolean }> {
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
  // Same API shape as a send response. Before this mapping the endpoint leaked
  // raw `sender_id` / `created_at` columns while every client reads
  // `senderId` / `createdAt` — so a reloaded thread lost its own-message side,
  // timestamps and read ticks. One mapper, both paths.
  const items = (hasMore ? res.rows.slice(0, LIMIT) : res.rows).reverse().map(mapMessage);
  return { items, hasMore };
}

/** Fetch one conversation row with participant/product/shop enrichment. */
async function getConversationById(conversationId: string): Promise<any | null> {
  const res = await query(
    `SELECT c.*,
            sh.name AS shop_name, sh.logo AS shop_logo, sh.slug AS shop_slug,
            sl.user_id AS seller_user_id,
            su.name AS seller_name, su.avatar AS seller_avatar,
            cu.name AS customer_name, cu.avatar AS customer_avatar,
            au.name AS assigned_to_name,
            p.name AS product_name, p.price AS product_price,
            (SELECT pi.url FROM product_images pi
              WHERE pi.product_id = c.product_id AND (pi.image_type = 'gallery' OR pi.image_type IS NULL)
              ORDER BY pi.sort_order ASC, pi.created_at ASC LIMIT 1) AS product_image
     FROM conversations c
     LEFT JOIN shops sh ON sh.id = c.shop_id
     LEFT JOIN sellers sl ON sl.id = c.seller_id
     LEFT JOIN users su ON su.id = sl.user_id
     LEFT JOIN users cu ON cu.id = c.customer_id
     LEFT JOIN users au ON au.id = c.assigned_to
     LEFT JOIN products p ON p.id = c.product_id
     WHERE c.id = $1`,
    [conversationId],
  );
  return res.rows[0] ?? null;
}

/** Build the API conversation object from a row for a given viewer. */
export function mapConversation(r: any, viewerUserId: string): Record<string, unknown> {
  const type = (r.type ?? "CUSTOMER_SELLER") as ConversationType;
  const isCompany = type === "CUSTOMER_COMPANY" || type === "SELLER_COMPANY";
  const isCustomerView = r.customer_id === viewerUserId;
  const otherUserId = isCustomerView ? r.seller_user_id : r.customer_id;
  const otherName = isCustomerView ? r.seller_name : r.customer_name;
  const otherAvatar = isCustomerView ? r.seller_avatar : r.customer_avatar;
  return {
    id: r.id,
    type,
    customerId: r.customer_id,
    sellerId: r.seller_id,
    shopId: r.shop_id,
    productId: r.product_id ?? null,
    isSupport: type === "CUSTOMER_COMPANY" || r.shop_slug === SUPPORT_SHOP_SLUG,
    isCompany,
    supportStatus: r.support_status ?? "OPEN",
    assignedTo: r.assigned_to ?? null,
    assignedToName: r.assigned_to_name ?? null,
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
export async function notifyUser(userId: string, type: string, title: string, message: string, data?: unknown): Promise<void> {
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

/**
 * Notify the company side of a customer/seller message. One row per active
 * VelCenter account (owner/admin/staff) — the chat itself never depends on it,
 * and a staff member already looking at the thread is skipped (the message
 * still arrives over the socket). Bounded so a large staff never turns one send
 * into an unbounded fan-out.
 */
export async function notifyCompanyStaff(
  conversationId: string,
  title: string,
  message: string,
  exceptUserId?: string,
): Promise<void> {
  try {
    const res = await query(
      `SELECT id FROM users WHERE role = ANY($1::text[]) AND status = 'active' ORDER BY created_at ASC LIMIT 100`,
      [CENTER_ROLES],
    );
    for (const row of res.rows) {
      const userId = row.id as string;
      if (userId === exceptUserId) continue;
      if (getViewingConversation(userId, conversationId)) continue;
      await notifyUser(userId, "chat", title, message.slice(0, 120), { conversationId });
    }
  } catch (err) {
    console.error("[chat] notifyCompanyStaff failed:", err);
  }
}

/** Shared validation: body must be a non-empty string of ≤ 4000 chars. */
export function validateBody(body: unknown): string | null {
  if (typeof body !== "string") return null;
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > 4000) return null;
  return trimmed;
}

/**
 * Optional read bound (`upTo`, epoch ms): mark only the messages the reader had
 * actually loaded, never anything created after them. Without it a message that
 * arrives between the reader's message fetch and this UPDATE is swallowed as
 * "read" although nobody ever saw it (Phase 2D §7 — the open-thread race).
 * Absent → the previous unbounded behaviour, so an older client keeps working.
 * Present but unusable → "invalid" (a 400), never a silently ignored bound.
 */
export function readUpTo(req: Request): number | null | "invalid" {
  const raw = req.body?.upTo;
  if (raw === undefined || raw === null) return null;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return n;
}

export const READ_BOUND_INVALID = {
  success: false,
  error: { code: "VALIDATION_ERROR", message: "upTo must be an epoch-ms timestamp" },
} as const;

/**
 * The `upTo` bound, applied at the precision the value actually carries.
 *
 * Clients derive `upTo` from `createdAt`, which `mapMessage` builds with
 * `new Date(...).getTime()` — epoch MILLISECONDS — while `chat_messages.created_at`
 * is a microsecond-precision TIMESTAMPTZ filled by `NOW()`. A strict
 * `created_at <= upTo` therefore EXCLUDED the very message the reader derived the
 * bound from (`…:123456` is not `<= …:123000`), so a bounded read marked nothing
 * and a thread could never be cleared. Cover the whole millisecond the bound
 * names instead: every message the reader could have loaded is included, while a
 * message that lands afterwards stays unread — the residual race is bounded by
 * 1 ms rather than the previous unbounded mark-all.
 */
export const READ_BOUND_SQL = ` AND created_at < to_timestamp($3::double precision / 1000) + interval '1 millisecond'`;

/**
 * In-process idempotency for message sends.
 *
 * A send carries a client-generated `clientId`, and a retried submission (a
 * double press, or a resend of the same draft after a timeout) reuses it — the
 * second request must not create a second row, a second push or a second
 * notification row. `chat_messages` has no `client_id` column and the schema is
 * not this phase's to change, so the claim lives in this process: key =
 * conversation + sender + clientId, TTL'd and size-capped.
 *
 * What it honestly does NOT cover: a restart of this process forgets the map,
 * two genuinely concurrent requests are not serialised (no constraint to lean
 * on), and a fresh clientId is by definition a new submission. The durable fix
 * is a UNIQUE index on (conversation_id, sender_id, client_id) — a schema change
 * deliberately left for owner approval, not smuggled in here.
 */
const SEND_DEDUPE_TTL_MS = 10 * 60 * 1000;
const SEND_DEDUPE_MAX_ENTRIES = 1000;
const recentSends = new Map<string, { message: Record<string, unknown>; expires: number }>();

export function rememberSend(key: string, message: Record<string, unknown>): void {
  const now = Date.now();
  while (recentSends.size >= SEND_DEDUPE_MAX_ENTRIES) {
    // Map iteration is insertion-ordered: the first key is the oldest entry.
    const oldest = recentSends.keys().next();
    if (oldest.done) break;
    recentSends.delete(oldest.value);
  }
  recentSends.set(key, { message, expires: now + SEND_DEDUPE_TTL_MS });
}

/** The already-stored message for a retried send, or null for a new one. */
export function replaySend(key: string): Record<string, unknown> | null {
  const hit = recentSends.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    recentSends.delete(key);
    return null;
  }
  return hit.message;
}

// ─── Route setup ─────────────────────────────────────────────────────────────

export function setupChatRoutes(app: Express): void {
  // ═══════════════════════ NOTIFICATIONS (customer) ═══════════════════════

  app.get("/api/customer/notifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT id, type, title, message, read, data, created_at
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
        data: r.data ?? null,
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
                sh.name AS shop_name, sh.logo AS shop_logo, sh.slug AS shop_slug,
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
         LEFT JOIN shops sh ON sh.id = c.shop_id
         LEFT JOIN sellers sl ON sl.id = c.seller_id
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

  // ── POST /api/customer/support/conversation — get-or-create company thread ──
  // A CUSTOMER_COMPANY row, not a marketplace shop. A legacy reserved-shop
  // support thread is converted in place on first open (messages preserved).
  app.post("/api/customer/support/conversation", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const conversation = await ensureCustomerCompanyConversation(userId);
      if (!conversation) {
        res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to create support conversation" } });
        return;
      }
      res.json({ success: true, data: mapConversation(conversation, userId) });
    } catch (err) {
      console.error("[chat] support conversation error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to create support conversation" } });
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
        `SELECT c.*, sl.user_id AS seller_user_id, sh.slug AS shop_slug
           FROM conversations c
           LEFT JOIN sellers sl ON sl.id = c.seller_id
           LEFT JOIN shops sh ON sh.id = c.shop_id
          WHERE c.id = $1 AND c.customer_id = $2`,
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
      const clientId =
        typeof req.body?.clientId === "string" && req.body.clientId.length > 0
          ? req.body.clientId.slice(0, 64)
          : null;
      const userId = req.user!.userId;

      // Retried submission → replay what was already stored instead of writing
      // a second copy. The sender always comes from the session above; nothing
      // the client sent can choose it.
      const dedupeKey = clientId ? `${conversationId}:${userId}:${clientId}` : null;
      if (dedupeKey) {
        const duplicate = replaySend(dedupeKey);
        if (duplicate) {
          res.json({ success: true, data: { message: duplicate, clientId, duplicate: true } });
          return;
        }
      }

      const insertRes = await query(
        `INSERT INTO chat_messages (conversation_id, sender_id, sender_role, body)
         VALUES ($1, $2, 'customer', $3) RETURNING *`,
        [conversationId, userId, body],
      );
      await query(
        `UPDATE conversations
            SET last_message = $1, last_message_at = NOW(), updated_at = NOW(),
                support_status = CASE WHEN support_status = 'CLOSED' THEN 'OPEN' ELSE support_status END
          WHERE id = $2`,
        [body.slice(0, 200), conversationId],
      );

      const message = mapMessage(insertRes.rows[0]);
      if (dedupeKey) rememberSend(dedupeKey, message);
      const conv = convRes.rows[0];
      // Company thread (including a legacy reserved-shop support row): addressed
      // to every live VelCenter session; a seller thread goes to its seller.
      if (conv.type === "CUSTOMER_COMPANY" || conv.shop_slug === SUPPORT_SHOP_SLUG) {
        sendToCenter(CHANNELS.CHAT_MESSAGE, CHANNELS.CHAT_MESSAGE, {
          conversationId,
          message,
          clientId,
        });
        await notifyCompanyStaff(
          conversationId,
          "ลูกค้าติดต่อ Velnox Support",
          body,
        );
      } else {
        sendToUser(conv.seller_user_id, "", CHANNELS.CHAT_MESSAGE, {
          conversationId,
          message,
          clientId,
        });
        // Notification row for the seller (skipped while they are viewing this
        // thread — the message still arrives over the realtime socket).
        if (!getViewingConversation(conv.seller_user_id, conversationId)) {
          await notifyUser(
            conv.seller_user_id,
            "chat",
            "ข้อความใหม่จากลูกค้า",
            body.slice(0, 120),
            { conversationId },
          );
        }
      }

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
        `SELECT c.*, sl.user_id AS seller_user_id, sh.slug AS shop_slug
           FROM conversations c
           LEFT JOIN sellers sl ON sl.id = c.seller_id
           LEFT JOIN shops sh ON sh.id = c.shop_id
          WHERE c.id = $1 AND c.customer_id = $2`,
        [conversationId, req.user!.userId],
      );
      if (convRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Conversation not found" } });
        return;
      }
      // Bound the mark-read to what this reader had actually loaded, so a
      // message that lands while the request is in flight stays unread.
      const upTo = readUpTo(req);
      if (upTo === "invalid") {
        res.status(400).json(READ_BOUND_INVALID);
        return;
      }
      const markParams: unknown[] = [conversationId, req.user!.userId];
      let markSql = `UPDATE chat_messages SET status = 'read', read_at = NOW()
         WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`;
      if (upTo !== null) {
        markParams.push(upTo);
        markSql += READ_BOUND_SQL;
      }
      markSql += ` RETURNING id`;
      const updated = await query(markSql, markParams);
      if (updated.rows.length > 0) {
        const conv = convRes.rows[0];
        if (conv.type === "CUSTOMER_COMPANY" || conv.shop_slug === SUPPORT_SHOP_SLUG) {
          sendToCenter(CHANNELS.CHAT_READ, CHANNELS.CHAT_READ, {
            conversationId,
            readerId: req.user!.userId,
          });
        } else {
          sendToUser(conv.seller_user_id, "", CHANNELS.CHAT_READ, {
            conversationId,
            readerId: req.user!.userId,
          });
        }
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
                sh.name AS shop_name, sh.logo AS shop_logo, sh.slug AS shop_slug,
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
         LEFT JOIN shops sh ON sh.id = c.shop_id
         JOIN sellers sl ON sl.id = c.seller_id
         LEFT JOIN users su ON su.id = sl.user_id
         LEFT JOIN users cu ON cu.id = c.customer_id
         LEFT JOIN products p ON p.id = c.product_id
         WHERE c.seller_id = $2
           AND c.type IN ('CUSTOMER_SELLER', 'SELLER_COMPANY')
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

  // ── POST /api/seller/company/conversation — get-or-create Velnox thread ──
  app.post("/api/seller/company/conversation", requireAuth, async (req: Request, res: Response) => {
    try {
      const seller = await getSellerForUser(req.user!.userId);
      if (!seller) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not an approved seller" } });
        return;
      }
      const conversation = await ensureSellerCompanyConversation(seller.id);
      if (!conversation) {
        res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to create company conversation" } });
        return;
      }
      res.json({ success: true, data: mapConversation(conversation, req.user!.userId) });
    } catch (err) {
      console.error("[chat] seller company conversation error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to create company conversation" } });
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
      const convRes = await query(
        `SELECT c.*, sh.name AS shop_name
           FROM conversations c
           LEFT JOIN shops sh ON sh.id = c.shop_id
          WHERE c.id = $1 AND c.seller_id = $2`,
        [conversationId, seller.id],
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
      const clientId =
        typeof req.body?.clientId === "string" && req.body.clientId.length > 0
          ? req.body.clientId.slice(0, 64)
          : null;
      const userId = req.user!.userId;

      // Retried submission → replay what was already stored instead of writing
      // a second copy. The sender always comes from the session above; nothing
      // the client sent can choose it.
      const dedupeKey = clientId ? `${conversationId}:${userId}:${clientId}` : null;
      if (dedupeKey) {
        const duplicate = replaySend(dedupeKey);
        if (duplicate) {
          res.json({ success: true, data: { message: duplicate, clientId, duplicate: true } });
          return;
        }
      }

      const insertRes = await query(
        `INSERT INTO chat_messages (conversation_id, sender_id, sender_role, body)
         VALUES ($1, $2, 'seller', $3) RETURNING *`,
        [conversationId, userId, body],
      );
      await query(
        `UPDATE conversations
            SET last_message = $1, last_message_at = NOW(), updated_at = NOW(),
                support_status = CASE WHEN support_status IN ('CLOSED', 'WAITING') THEN 'OPEN' ELSE support_status END
          WHERE id = $2`,
        [body.slice(0, 200), conversationId],
      );

      const message = mapMessage(insertRes.rows[0]);
      if (dedupeKey) rememberSend(dedupeKey, message);
      const conv = convRes.rows[0];
      // A seller→company thread is addressed to VelCenter; a customer thread to
      // that customer's own channel.
      if (conv.type === "SELLER_COMPANY") {
        sendToCenter(CHANNELS.CHAT_MESSAGE, CHANNELS.CHAT_MESSAGE, {
          conversationId,
          message,
          clientId,
        });
        await notifyCompanyStaff(
          conversationId,
          "ผู้ขายติดต่อ Velnox",
          body,
          userId,
        );
      } else {
        sendToUser(conv.customer_id, "", CHANNELS.CHAT_MESSAGE, {
          conversationId,
          message,
          clientId,
        });
        // Notification row for the customer (skipped while they are viewing
        // this thread — the message still arrives over the realtime socket).
        if (!getViewingConversation(conv.customer_id, conversationId)) {
          await notifyUser(
            conv.customer_id,
            "chat",
            `ข้อความใหม่จากร้าน ${conv.shop_name ?? ""}`.trim(),
            body.slice(0, 120),
            { conversationId },
          );
        }
      }

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
      // Bound the mark-read to what this reader had actually loaded, so a
      // message that lands while the request is in flight stays unread.
      const upTo = readUpTo(req);
      if (upTo === "invalid") {
        res.status(400).json(READ_BOUND_INVALID);
        return;
      }
      const markParams: unknown[] = [conversationId, req.user!.userId];
      let markSql = `UPDATE chat_messages SET status = 'read', read_at = NOW()
         WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`;
      if (upTo !== null) {
        markParams.push(upTo);
        markSql += READ_BOUND_SQL;
      }
      markSql += ` RETURNING id`;
      const updated = await query(markSql, markParams);
      if (updated.rows.length > 0) {
        const conv = convRes.rows[0];
        if (conv.type === "SELLER_COMPANY") {
          sendToCenter(CHANNELS.CHAT_READ, CHANNELS.CHAT_READ, {
            conversationId,
            readerId: req.user!.userId,
          });
        } else {
          sendToUser(conv.customer_id, "", CHANNELS.CHAT_READ, {
            conversationId,
            readerId: req.user!.userId,
          });
        }
      }
      res.json({ success: true, data: { marked: updated.rows.length } });
    } catch (err) {
      console.error("[chat] seller read error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to mark messages read" } });
    }
  });
}