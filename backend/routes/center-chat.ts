/**
 * VelCenter — Company Chat (Company Support / Staff)
 *
 * This is the company side of the ONE Velnox chat core. It reads and writes the
 * SAME `conversations` + `chat_messages` tables, the same message validator,
 * pagination, read bound and idempotency helper as the customer and seller
 * routes (`routes/chat.ts`) — there is no second chat engine.
 *
 * Conversation types exposed here:
 *   CUSTOMER_COMPANY  — a customer's thread with Velnox
 *   SELLER_COMPANY    — an approved seller's thread with Velnox
 *   COMPANY_INTERNAL  — company-only rooms
 *
 * SECURITY
 * - Every endpoint requires an authenticated session AND a `users.role` of
 *   owner / admin / staff, resolved server-side.
 * - A private CUSTOMER_SELLER thread is NOT company data. The only exception is
 *   a legacy support thread still stored against the reserved `velnox-support`
 *   shop (see `routes/chat.ts`), which exists precisely because Velnox used to
 *   be modelled as a seller. Those rows are exposed as company conversations;
 *   no other CUSTOMER_SELLER row is reachable from this module.
 * - Company staff messages are stored with `sender_role = 'company'`; sender
 *   identity always comes from the session, never from the request body.
 *
 * Realtime reuses the existing addressed WebSocket: `sendToCenter` for company
 * recipients and `sendToUser` for the customer/seller participant. There is no
 * company socket, channel or polling loop.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";
import { CENTER_ROLES, roleOf } from "../lib/permissions.js";
import { CHANNELS, getUserLastSeenAt, isUserOnline, sendToCenter, sendToUser } from "../realtime/index.js";
import { SUPPORT_SHOP_SLUG } from "../lib/chat-access.js";
import {
  replaySend,
  rememberSend,
  validateBody,
  readUpTo,
  READ_BOUND_INVALID,
  READ_BOUND_SQL,
  loadMessages,
  mapMessage,
  insertHumanMessage,
  findMessageByClientId,
  resolveChatAttachment,
} from "./chat.js";

type CompanyTab = "customer" | "seller" | "internal";
type SupportStatus = "OPEN" | "ASSIGNED" | "WAITING" | "CLOSED";

const SUPPORT_STATUSES: SupportStatus[] = ["OPEN", "ASSIGNED", "WAITING", "CLOSED"];

function param(req: Request, key: string): string {
  return (req.params as Record<string, string>)[key] ?? "";
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ success: false, error: { code, message } });
}

/** Authenticated company member, or null after answering 401/403. */
async function requireCenterMember(req: Request, res: Response): Promise<{ id: string; role: string } | null> {
  const userId = req.user!.userId;
  let role: string | null = null;
  try {
    role = await roleOf(userId);
  } catch (err) {
    console.error("[center-chat] role lookup failed:", err);
  }
  if (!role || !CENTER_ROLES.includes(role)) {
    fail(res, 403, "FORBIDDEN", "Center access required");
    return null;
  }
  return { id: userId, role };
}

/**
 * Load a conversation the company is allowed to see, or null.
 *
 * This is the single authorization rule for the whole module. A private
 * seller↔customer thread can never satisfy it: only the four company types are
 * accepted, plus the reserved-shop legacy support row.
 */
async function loadCompanyConversation(conversationId: string): Promise<any | null> {
  const res = await query(
    `SELECT c.*,
            sh.slug AS shop_slug,
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
  const row = res.rows[0];
  if (!row) return null;
  if (row.type === "CUSTOMER_COMPANY" || row.type === "SELLER_COMPANY" || row.type === "COMPANY_INTERNAL") {
    return row;
  }
  if (row.type === "CUSTOMER_SELLER" && row.shop_slug === SUPPORT_SHOP_SLUG) return row;
  return null;
}

/** Map a company conversation row to the VelCenter API shape. */
function mapCompanyConversation(r: any): Record<string, unknown> {
  return {
    id: r.id,
    // A legacy reserved-shop row is conceptually a customer→company thread.
    type: r.type === "CUSTOMER_SELLER" ? "CUSTOMER_COMPANY" : r.type,
    legacySupport: r.type === "CUSTOMER_SELLER",
    title: r.title ?? null,
    status: r.support_status ?? "OPEN",
    assignedTo: r.assigned_to ?? null,
    assignedToName: r.assigned_to_name ?? null,
    customer: r.customer_id
      ? {
          id: r.customer_id,
          name: r.customer_name ?? null,
          avatar: r.customer_avatar ?? null,
        }
      : null,
    seller: r.seller_id
      ? {
          id: r.seller_id,
          userId: r.seller_user_id ?? null,
          name: r.seller_name ?? null,
          avatar: r.seller_avatar ?? null,
          shopName: r.shop_name ?? null,
          shopLogo: r.shop_logo ?? null,
        }
      : null,
    product: r.product_id
      ? {
          id: r.product_id,
          name: r.product_name ?? null,
          price: r.product_price != null ? Number(r.product_price) : null,
          imageUrl: r.product_image ?? null,
        }
      : null,
    // Latest UNREAD message wins as the preview; the stored value is the fallback.
    lastMessage: r.last_unread_body ?? r.last_message ?? null,
    lastMessageAt: r.last_message_at ? new Date(r.last_message_at).getTime() : null,
    unreadCount: parseInt(r.unread_count ?? "0", 10),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
  };
}

/** The unread subquery every company list uses — one indexed COUNT, no history. */
const UNREAD_SUBQUERY = `(SELECT COUNT(*) FROM chat_messages m
  WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread_count,
  (SELECT CASE WHEN m.body <> '' THEN m.body ELSE '📷' END
     FROM chat_messages m
    WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.read_at IS NULL
    ORDER BY m.created_at DESC LIMIT 1) AS last_unread_body`;

/** Conversation list per tab, scoped by the tab's type (never client ids). */
async function listCompanyConversations(tab: CompanyTab, viewerId: string): Promise<any[]> {
  if (tab === "customer") {
    // Customer→company, plus the legacy reserved-shop support rows. The slug
    // predicate is what keeps private customer↔seller threads out.
    const res = await query(
      `SELECT c.*,
              cu.name AS customer_name, cu.avatar AS customer_avatar,
              au.name AS assigned_to_name,
              p.name AS product_name, p.price AS product_price,
              (SELECT pi.url FROM product_images pi
                WHERE pi.product_id = c.product_id AND (pi.image_type = 'gallery' OR pi.image_type IS NULL)
                ORDER BY pi.sort_order ASC, pi.created_at ASC LIMIT 1) AS product_image,
              ${UNREAD_SUBQUERY}
         FROM conversations c
         LEFT JOIN shops sh ON sh.id = c.shop_id
         JOIN users cu ON cu.id = c.customer_id
         LEFT JOIN users au ON au.id = c.assigned_to
         LEFT JOIN products p ON p.id = c.product_id
        WHERE c.type = 'CUSTOMER_COMPANY'
           OR (c.type = 'CUSTOMER_SELLER' AND sh.slug = $2)
        ORDER BY c.updated_at DESC
        LIMIT 200`,
      [viewerId, SUPPORT_SHOP_SLUG],
    );
    return res.rows;
  }

  if (tab === "seller") {
    const res = await query(
      `SELECT c.*,
              sl.user_id AS seller_user_id,
              su.name AS seller_name, su.avatar AS seller_avatar,
              sh.name AS shop_name, sh.logo AS shop_logo,
              au.name AS assigned_to_name,
              ${UNREAD_SUBQUERY}
         FROM conversations c
         JOIN sellers sl ON sl.id = c.seller_id
         LEFT JOIN users su ON su.id = sl.user_id
         LEFT JOIN LATERAL (
           SELECT s.name, s.logo FROM shops s
            WHERE s.seller_id = sl.id ORDER BY s.created_at ASC LIMIT 1
         ) sh ON TRUE
         LEFT JOIN users au ON au.id = c.assigned_to
        WHERE c.type = 'SELLER_COMPANY'
        ORDER BY c.updated_at DESC
        LIMIT 200`,
      [viewerId],
    );
    return res.rows;
  }

  const res = await query(
    `SELECT c.*, au.name AS assigned_to_name, ${UNREAD_SUBQUERY}
       FROM conversations c
       LEFT JOIN users au ON au.id = c.assigned_to
      WHERE c.type = 'COMPANY_INTERNAL'
      ORDER BY c.updated_at DESC
      LIMIT 200`,
    [viewerId],
  );
  return res.rows;
}

/** Unread MESSAGE counts for the three VelCenter chat tabs. */
async function companyUnreadCounts(viewerId: string): Promise<{ customers: number; sellers: number; internal: number }> {
  const res = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM chat_messages m
          JOIN conversations c ON c.id = m.conversation_id
          LEFT JOIN shops sh ON sh.id = c.shop_id
         WHERE (c.type = 'CUSTOMER_COMPANY' OR (c.type = 'CUSTOMER_SELLER' AND sh.slug = $2))
           AND m.sender_role = 'customer' AND m.read_at IS NULL) AS customers,
       (SELECT COUNT(*)::int FROM chat_messages m
          JOIN conversations c ON c.id = m.conversation_id
         WHERE c.type = 'SELLER_COMPANY'
           AND m.sender_role = 'seller' AND m.read_at IS NULL) AS sellers,
       (SELECT COUNT(*)::int FROM chat_messages m
          JOIN conversations c ON c.id = m.conversation_id
         WHERE c.type = 'COMPANY_INTERNAL'
           AND m.sender_role = 'company' AND m.sender_id <> $1 AND m.read_at IS NULL) AS internal`,
    [viewerId, SUPPORT_SHOP_SLUG],
  );
  const row = res.rows[0] ?? {};
  return {
    customers: Number(row.customers ?? 0),
    sellers: Number(row.sellers ?? 0),
    internal: Number(row.internal ?? 0),
  };
}

async function markRead(req: Request, res: Response, row: any, conversationId: string): Promise<void> {
  const upTo = readUpTo(req);
  if (upTo === "invalid") {
    res.status(400).json(READ_BOUND_INVALID);
    return;
  }
  const params: unknown[] = [conversationId, req.user!.userId];
  let sql = `UPDATE chat_messages SET status = 'read', read_at = NOW()
       WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`;
  if (upTo !== null) {
    params.push(upTo);
    sql += READ_BOUND_SQL;
  }
  sql += " RETURNING created_at";
  const updated = await query(sql, params);
  if (updated.rows.length === 0) {
    res.json({ success: true, data: { marked: 0 } });
    return;
  }

  // What was ACTUALLY marked read in this statement: the sender ticks exactly
  // these messages (✓✓) and a message that landed afterwards stays unread.
  const readUpToMs = updated.rows.reduce(
    (max: number, r: any) => Math.max(max, new Date(r.created_at).getTime()),
    0,
  );

  if (row.type === "CUSTOMER_COMPANY" || (row.type === "CUSTOMER_SELLER" && row.shop_slug === SUPPORT_SHOP_SLUG)) {
    sendToUser(row.customer_id, "", CHANNELS.CHAT_READ, {
      conversationId,
      readerId: req.user!.userId,
      upTo: readUpToMs,
    });
  } else if (row.type === "SELLER_COMPANY" && row.seller_user_id) {
    sendToUser(row.seller_user_id, "", CHANNELS.CHAT_READ, {
      conversationId,
      readerId: req.user!.userId,
      upTo: readUpToMs,
    });
  } else {
    sendToCenter(CHANNELS.CHAT_READ, CHANNELS.CHAT_READ, {
      conversationId,
      readerId: req.user!.userId,
      upTo: readUpToMs,
    });
  }
  res.json({ success: true, data: { marked: updated.rows.length } });
}

export function setupCenterChatRoutes(app: Express): void {
  // ── GET /api/center/chat/conversations?type=customer|seller|internal ─────
  app.get("/api/center/chat/conversations", requireAuth, async (req: Request, res: Response) => {
    const member = await requireCenterMember(req, res);
    if (!member) return;
    const tab = req.query.type;
    if (tab !== "customer" && tab !== "seller" && tab !== "internal") {
      fail(res, 400, "VALIDATION_ERROR", "type must be customer, seller or internal");
      return;
    }
    try {
      const rows = await listCompanyConversations(tab, member.id);
      // Presence is attached only when the tab has ONE human counterpart: the
      // customer, or the seller behind the shop. Internal rooms have none.
      const items = rows.map((row: any) => ({
        ...mapCompanyConversation(row),
        participantOnline:
          tab === "customer"
            ? isUserOnline(row.customer_id)
            : tab === "seller"
              ? isUserOnline(row.seller_user_id)
              : null,
        participantLastSeenAt:
          tab === "customer"
            ? getUserLastSeenAt(row.customer_id)
            : tab === "seller"
              ? getUserLastSeenAt(row.seller_user_id)
              : null,
      }));
      res.json({ success: true, data: { items } });
    } catch (err) {
      console.error("[center-chat] list error:", err);
      fail(res, 500, "DB_ERROR", "Failed to load conversations");
    }
  });

  // ── GET /api/center/chat/unread — three tab counts, one aggregate query ──
  app.get("/api/center/chat/unread", requireAuth, async (req: Request, res: Response) => {
    const member = await requireCenterMember(req, res);
    if (!member) return;
    try {
      res.json({ success: true, data: await companyUnreadCounts(member.id) });
    } catch (err) {
      console.error("[center-chat] unread error:", err);
      fail(res, 500, "DB_ERROR", "Failed to load unread counts");
    }
  });

  // ── GET /api/center/chat/staff — assignment choices (company members) ────
  app.get("/api/center/chat/staff", requireAuth, async (req: Request, res: Response) => {
    const member = await requireCenterMember(req, res);
    if (!member) return;
    try {
      const result = await query(
        `SELECT id, name, role FROM users
          WHERE role = ANY($1::text[]) AND status = 'active'
          ORDER BY name ASC NULLS LAST, created_at ASC
          LIMIT 100`,
        [CENTER_ROLES],
      );
      res.json({ success: true, data: { items: result.rows } });
    } catch (err) {
      console.error("[center-chat] staff error:", err);
      fail(res, 500, "DB_ERROR", "Failed to load staff");
    }
  });

  // ── GET /api/center/chat/conversations/:id/messages ──────────────────────
  app.get("/api/center/chat/conversations/:id/messages", requireAuth, async (req: Request, res: Response) => {
    const member = await requireCenterMember(req, res);
    if (!member) return;
    try {
      const conversationId = param(req, "id");
      const row = await loadCompanyConversation(conversationId);
      if (!row) {
        fail(res, 404, "NOT_FOUND", "Conversation not found");
        return;
      }
      const before = typeof req.query.before === "string" ? req.query.before : undefined;
      const { items, hasMore } = await loadMessages(conversationId, before);
      res.json({ success: true, data: { items, hasMore } });
    } catch (err) {
      console.error("[center-chat] messages error:", err);
      fail(res, 500, "DB_ERROR", "Failed to load messages");
    }
  });

  // ── POST /api/center/chat/conversations/:id/messages — staff reply ───────
  app.post("/api/center/chat/conversations/:id/messages", requireAuth, async (req: Request, res: Response) => {
    const member = await requireCenterMember(req, res);
    if (!member) return;
    try {
      const conversationId = param(req, "id");
      const row = await loadCompanyConversation(conversationId);
      if (!row) {
        fail(res, 404, "NOT_FOUND", "Conversation not found");
        return;
      }
      const attachment = await resolveChatAttachment(conversationId, member.id, req.body?.attachmentKey);
      if (!attachment.ok) {
        res.status(400).json({ success: false, error: { code: attachment.code, message: attachment.message } });
        return;
      }
      const body = validateBody(req.body?.body) ?? (attachment.key ? "" : null);
      if (body === null) {
        fail(res, 400, "VALIDATION_ERROR", "Message must be 1-4000 characters");
        return;
      }
      const clientId =
        typeof req.body?.clientId === "string" && req.body.clientId.length > 0
          ? req.body.clientId.slice(0, 64)
          : null;
      const userId = member.id;

      const dedupeKey = clientId ? `${conversationId}:${userId}:${clientId}` : null;
      if (dedupeKey) {
        const duplicate = replaySend(dedupeKey);
        if (duplicate) {
          res.json({ success: true, data: { message: duplicate, clientId, duplicate: true } });
          return;
        }
      }

      // Same durable claim as the customer/seller routes: the partial UNIQUE
      // index on (conversation_id, sender_id, client_id) decides the race, so a
      // retry from another tab, instance or after a restart cannot duplicate.
      const insertRes = await insertHumanMessage({
        conversationId,
        senderId: userId,
        senderRole: "company",
        body,
        clientId,
        attachmentKey: attachment.key,
      });
      if (insertRes.rows.length === 0) {
        const stored = clientId ? await findMessageByClientId(conversationId, userId, clientId) : null;
        const replay = stored ? mapMessage(stored) : null;
        if (replay) {
          if (dedupeKey) rememberSend(dedupeKey, replay);
          res.json({ success: true, data: { message: replay, clientId, duplicate: true } });
          return;
        }
        res.status(409).json({
          success: false,
          error: { code: "DUPLICATE_SEND", message: "Message already stored" },
        });
        return;
      }

      // A staff reply claims an unassigned thread and moves the support status
      // forward. This is deliberately lightweight — no ticket workflow.
      await query(
        `UPDATE conversations
            SET last_message = $1, last_message_at = NOW(), updated_at = NOW(),
                assigned_to = CASE WHEN type = 'COMPANY_INTERNAL' THEN assigned_to
                                   ELSE COALESCE(assigned_to, $2) END,
                support_status = CASE
                  WHEN type = 'COMPANY_INTERNAL' THEN support_status
                  WHEN support_status = 'OPEN' THEN 'ASSIGNED'
                  ELSE 'WAITING'
                END
          WHERE id = $3`,
        [body.trim() ? body.slice(0, 200) : attachment.key ? "📷" : "", userId, conversationId],
      );

      const message = mapMessage(insertRes.rows[0]);
      if (dedupeKey) rememberSend(dedupeKey, message);

      if (row.type === "COMPANY_INTERNAL") {
        sendToCenter(CHANNELS.CHAT_MESSAGE, CHANNELS.CHAT_MESSAGE, {
          conversationId,
          message,
          clientId,
        });
      } else if (row.type === "SELLER_COMPANY") {
        if (row.seller_user_id) {
          sendToUser(row.seller_user_id, "", CHANNELS.CHAT_MESSAGE, {
            conversationId,
            message,
            clientId,
          });
        }
      } else {
        sendToUser(row.customer_id, "", CHANNELS.CHAT_MESSAGE, {
          conversationId,
          message,
          clientId,
        });
        // NO bell row for chat: the customer's Messages list owns the unread
        // state for this conversation (see chat.ts for the full rationale).
      }

      res.json({ success: true, data: { message, clientId } });
    } catch (err) {
      console.error("[center-chat] send error:", err);
      fail(res, 500, "DB_ERROR", "Failed to send message");
    }
  });

  // ── POST /api/center/chat/conversations/:id/read ─────────────────────────
  app.post("/api/center/chat/conversations/:id/read", requireAuth, async (req: Request, res: Response) => {
    const member = await requireCenterMember(req, res);
    if (!member) return;
    try {
      const conversationId = param(req, "id");
      const row = await loadCompanyConversation(conversationId);
      if (!row) {
        fail(res, 404, "NOT_FOUND", "Conversation not found");
        return;
      }
      await markRead(req, res, row, conversationId);
    } catch (err) {
      console.error("[center-chat] read error:", err);
      fail(res, 500, "DB_ERROR", "Failed to mark messages read");
    }
  });

  // ── PATCH /api/center/chat/conversations/:id — status / assignment ───────
  app.patch("/api/center/chat/conversations/:id", requireAuth, async (req: Request, res: Response) => {
    const member = await requireCenterMember(req, res);
    if (!member) return;
    try {
      const conversationId = param(req, "id");
      const row = await loadCompanyConversation(conversationId);
      if (!row) {
        fail(res, 404, "NOT_FOUND", "Conversation not found");
        return;
      }
      if (row.type === "COMPANY_INTERNAL") {
        fail(res, 400, "VALIDATION_ERROR", "Internal conversations have no support status");
        return;
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      if (req.body?.status !== undefined) {
        const status = req.body.status;
        if (typeof status !== "string" || !SUPPORT_STATUSES.includes(status as SupportStatus)) {
          fail(res, 400, "VALIDATION_ERROR", "status must be OPEN, ASSIGNED, WAITING or CLOSED");
          return;
        }
        params.push(status);
        sets.push(`support_status = $${params.length}`);
        if (status === "CLOSED") {
          // Closing releases the handler, but the history keeps who replied.
          sets.push("assigned_to = NULL");
        }
      }

      if (req.body?.assignedTo !== undefined) {
        const assignedTo = req.body.assignedTo;
        if (assignedTo === null) {
          sets.push("assigned_to = NULL");
        } else if (typeof assignedTo === "string" && assignedTo.length > 0) {
          const staff = await query(
            `SELECT id FROM users WHERE id = $1 AND role = ANY($2::text[]) AND status = 'active'`,
            [assignedTo, CENTER_ROLES],
          );
          if (!staff.rows[0]) {
            fail(res, 400, "VALIDATION_ERROR", "assignedTo must be an active company member");
            return;
          }
          params.push(assignedTo);
          sets.push(`assigned_to = $${params.length}`);
        } else {
          fail(res, 400, "VALIDATION_ERROR", "assignedTo must be a user id or null");
          return;
        }
      }

      if (sets.length === 0) {
        fail(res, 400, "VALIDATION_ERROR", "status or assignedTo is required");
        return;
      }

      params.push(conversationId);
      await query(`UPDATE conversations SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
      const refreshed = await loadCompanyConversation(conversationId);
      res.json({ success: true, data: mapCompanyConversation(refreshed) });
    } catch (err) {
      console.error("[center-chat] update error:", err);
      fail(res, 500, "DB_ERROR", "Failed to update conversation");
    }
  });

  // ── POST /api/center/chat/internal/conversations — create a room ────────
  app.post("/api/center/chat/internal/conversations", requireAuth, async (req: Request, res: Response) => {
    const member = await requireCenterMember(req, res);
    if (!member) return;
    try {
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
      if (title.length === 0 || title.length > 80) {
        fail(res, 400, "VALIDATION_ERROR", "title must be 1-80 characters");
        return;
      }
      const inserted = await query(
        `INSERT INTO conversations (type, title) VALUES ('COMPANY_INTERNAL', $1)
         ON CONFLICT DO NOTHING RETURNING id`,
        [title],
      );
      let id = inserted.rows[0]?.id as string | undefined;
      if (!id) {
        const existing = await query(
          "SELECT id FROM conversations WHERE type = 'COMPANY_INTERNAL' AND title = $1 LIMIT 1",
          [title],
        );
        id = existing.rows[0]?.id as string | undefined;
      }
      if (!id) {
        fail(res, 500, "DB_ERROR", "Failed to create room");
        return;
      }
      const row = await loadCompanyConversation(id);
      // Let every other staff session add the new room without a reload.
      sendToCenter(CHANNELS.CHAT_CONVERSATION, CHANNELS.CHAT_CONVERSATION, {
        conversationId: id,
        type: "COMPANY_INTERNAL",
      });
      res.json({ success: true, data: mapCompanyConversation(row) });
    } catch (err) {
      console.error("[center-chat] internal create error:", err);
      fail(res, 500, "DB_ERROR", "Failed to create room");
    }
  });
}
