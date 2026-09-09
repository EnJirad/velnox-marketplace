/**
 * Velnox Center (P1 #4) — company dashboard data + behavioral events.
 *
 * Endpoints the VelCenter tabs were calling with no backend route behind them:
 *
 *   GET  /api/admin/overview            — goals + reorder intelligence KPIs
 *   GET  /api/admin/market-overview     — marketplace KPIs (real Neon data)
 *   GET  /api/admin/orders              — all orders (center view)
 *   PATCH /api/admin/orders/:orderId/status — transition an order
 *   GET  /api/admin/audit-logs          — append-only audit trail
 *   GET  /api/admin/permissions         — static permission catalog
 *   GET  /api/admin/users               — users list (staff table)
 *   PATCH /api/admin/users/:userId/access — set role/department
 *   GET  /api/admin/employees           — employee accounts
 *   POST /api/admin/employees           — create an employee account
 *   PATCH /api/admin/employees/:userId/active — activate/suspend
 *   PATCH /api/admin/staff              — update department + permissions
 *   GET  /api/memory/insights           — privacy-safe market interest summary
 *
 * Plus the missing event pipeline that feeds the insights:
 *   POST /api/events/track              — record a behavioral event
 *   POST /api/events/merge              — attach anonymous history to the user
 *
 * Role model: owner/admin/staff may READ center data; owner/admin may mutate
 * orders/settings; owner only for employees/users. Never trusts a
 * client-supplied role — the role always comes from the users table.
 */
import type { Express, Request, Response } from "express";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";

function param(req: Request, key: string): string {
  const v = req.params[key];
  return typeof v === "string" ? v : "";
}

async function roleOf(userId: string): Promise<string | null> {
  const r = await query("SELECT role FROM users WHERE id = $1", [userId]);
  return r.rows[0]?.role ?? null;
}

/** Center read access — owner/admin/staff. */
async function canReadCenter(userId: string): Promise<boolean> {
  const role = await roleOf(userId);
  return role === "owner" || role === "admin" || role === "staff";
}

/** Center write access — owner/admin (not staff). */
async function canWriteCenter(userId: string): Promise<boolean> {
  const role = await roleOf(userId);
  return role === "owner" || role === "admin";
}

/** Owner only. */
async function isOwner(userId: string): Promise<boolean> {
  return (await roleOf(userId)) === "owner";
}

async function writeAuditLog(userId: string, action: string, entityType: string, entityId: string | null, details: Record<string, unknown>): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, action, entityType, entityId, JSON.stringify(details), null],
    );
  } catch (err) {
    console.error("[center] audit log write failed:", err);
  }
}

// Order status transitions the center UI offers (mirror of the frontend map).
const ORDER_NEXT_STATUS: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: ["completed"],
  completed: [],
  cancelled: [],
};

const DEPARTMENTS = ["general", "marketing", "sales", "operations", "finance"];

const PERMISSION_CATALOG: { code: string; label: string; description: string }[] = [
  { code: "orders.view", label: "ดูออเดอร์", description: "ดูรายการออเดอร์ทั้งหมด" },
  { code: "orders.manage", label: "จัดการออเดอร์", description: "เปลี่ยนสถานะออเดอร์" },
  { code: "products.moderate", label: "ตรวจสอบสินค้า", description: "อนุมัติ/ปฏิเสธสินค้าที่รอตรวจสอบ" },
  { code: "sellers.manage", label: "จัดการผู้ขาย", description: "อนุมัติ/ระงับผู้ขาย" },
  { code: "users.manage", label: "จัดการบัญชีผู้ใช้", description: "เปลี่ยนบทบาท/สิทธิ์ผู้ใช้" },
  { code: "staff.manage", label: "จัดการพนักงาน", description: "สร้าง/แก้ไขบัญชีพนักงาน" },
  { code: "audit.view", label: "ดู Audit Logs", description: "ดูบันทึกการดำเนินการสำคัญ" },
  { code: "settings.manage", label: "จัดการตั้งค่าระบบ", description: "แก้ไขการตั้งค่าแพลตฟอร์ม" },
  { code: "payouts.process", label: "จัดการการจ่ายเงิน", description: "อนุมัติรอบการจ่ายเงิน" },
];

export function setupCenterRoutes(app: Express): void {
  // ── POST /api/events/track ──────────────────────────────────────────────
  // Fire-and-forget behavioral tracking from the frontends. Anonymous users
  // are attributed via anonymousId; signed-in users via session cookie.
  app.post("/api/events/track", optionalAuth, async (req: Request, res: Response) => {
    try {
      const type = typeof req.body?.type === "string" ? req.body.type.slice(0, 50) : "";
      if (!type) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "type is required" } });
        return;
      }
      const entityId =
        typeof req.body?.entityId === "string" && req.body.entityId
          ? req.body.entityId.slice(0, 255)
          : null;
      const value = typeof req.body?.value === "string" ? req.body.value.slice(0, 255) : null;
      const context =
        req.body?.context && typeof req.body.context === "object"
          ? req.body.context
          : {};
      const anonymousId =
        typeof req.body?.anonymousId === "string" && req.body.anonymousId
          ? req.body.anonymousId.slice(0, 100)
          : null;

      const metadata = { ...(value ? { value } : {}), context };
      // entity_id is a UUID column — only pass through values that parse as UUID.
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const entityIdUuid = entityId && uuidRe.test(entityId) ? entityId : null;

      await query(
        `INSERT INTO behavioral_events (user_id, session_id, event_type, entity_type, entity_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.user?.userId ?? null, anonymousId ?? "anon", type, null, entityIdUuid, JSON.stringify(metadata)],
      );
      res.json({ success: true, data: { ok: true } });
    } catch (err) {
      console.error("[center] events/track error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to record event" } });
    }
  });

  // ── POST /api/events/merge ──────────────────────────────────────────────
  // Claim anonymous history for a newly signed-in user.
  app.post("/api/events/merge", requireAuth, async (req: Request, res: Response) => {
    try {
      const anonymousId =
        typeof req.body?.anonymousId === "string" && req.body.anonymousId
          ? req.body.anonymousId.slice(0, 100)
          : null;
      if (!anonymousId) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "anonymousId is required" } });
        return;
      }
      await query("UPDATE behavioral_events SET user_id = $1 WHERE session_id = $2 AND user_id IS NULL", [
        req.user!.userId,
        anonymousId,
      ]);
      res.json({ success: true, data: { ok: true } });
    } catch (err) {
      console.error("[center] events/merge error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to merge events" } });
    }
  });

  // ── GET /api/memory/insights ────────────────────────────────────────────
  // Privacy-safe aggregate market interest (last 30 days, no personal data).
  app.get("/api/memory/insights", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await canReadCenter(req.user!.userId))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Center access required" } });
        return;
      }
      const WINDOW_DAYS = 30;
      const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

      const [searches, categories, popular, eventCount] = await Promise.all([
        query(
          `SELECT COALESCE(NULLIF(metadata->>'value',''), '') AS q, COUNT(*)::int AS count
           FROM behavioral_events
           WHERE event_type = 'SEARCH' AND occurred_at >= $1
             AND NULLIF(metadata->>'value','') IS NOT NULL
           GROUP BY metadata->>'value'
           ORDER BY count DESC LIMIT 10`,
          [since],
        ),
        query(
          `SELECT be.entity_id AS category, c.name AS label, COUNT(*)::int AS count
           FROM behavioral_events be
           LEFT JOIN categories c ON c.slug = be.entity_id
           WHERE be.event_type = 'CATEGORY_VIEW' AND be.entity_id IS NOT NULL AND be.occurred_at >= $1
           GROUP BY be.entity_id, c.name
           ORDER BY count DESC LIMIT 10`,
          [since],
        ),
        query(
          `SELECT p.id, p.name, p.price, p.unit,
                  (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS image_url,
                  COUNT(*)::int AS views
           FROM behavioral_events be
           JOIN products p ON p.id = be.entity_id
           WHERE be.event_type = 'PRODUCT_VIEW' AND be.entity_id IS NOT NULL AND be.occurred_at >= $1
           GROUP BY p.id, p.name, p.price, p.unit
           ORDER BY views DESC LIMIT 10`,
          [since],
        ),
        query("SELECT COUNT(*)::int AS count FROM behavioral_events WHERE occurred_at >= $1", [since]),
      ]);

      res.json({
        success: true,
        data: {
          topSearches: searches.rows.map((r: any) => ({ q: r.q, count: r.count })),
          topCategories: categories.rows.map((r: any) => ({
            category: r.category,
            label: r.label ?? r.category,
            count: r.count,
          })),
          popularProducts: popular.rows.map((r: any) => ({
            product: {
              id: r.id,
              name: r.name,
              price: parseFloat(r.price) || 0,
              unit: r.unit ?? "ชิ้น",
              primaryImage: r.image_url ? { displayUrl: r.image_url, url: r.image_url } : null,
            },
            views: r.views,
          })),
          eventCount: eventCount.rows[0]?.count ?? 0,
          windowDays: WINDOW_DAYS,
        },
      });
    } catch (err) {
      console.error("[center] market insights error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to compute insights" } });
    }
  });

  // ── GET /api/admin/overview ─────────────────────────────────────────────
  app.get("/api/admin/overview", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await canReadCenter(req.user!.userId))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Center access required" } });
        return;
      }

      const [goals, lowStock, dueReorder] = await Promise.all([
        query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE current_value >= target_value)::int AS achieved
           FROM seller_goals`,
        ),
        query(
          `SELECT COUNT(*)::int AS count
           FROM products p
           JOIN inventory i ON i.product_id = p.id
           WHERE p.status = 'published' AND i.low_stock_threshold > 0
             AND (i.quantity - i.reserved) <= i.low_stock_threshold`,
        ),
        query(
          `WITH purchase_stats AS (
             SELECT oi.product_id,
                    COUNT(DISTINCT o.id) AS purchase_count,
                    MIN(o.created_at) AS first_at,
                    MAX(o.created_at) AS last_at
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE o.status NOT IN ('cancelled', 'failed', 'refunded')
             GROUP BY oi.product_id
           ),
           cycles AS (
             SELECT product_id, purchase_count, last_at,
                    CASE WHEN purchase_count >= 2 AND last_at > first_at
                         THEN EXTRACT(EPOCH FROM (last_at - first_at)) / (purchase_count - 1) / 86400
                    END AS avg_cycle_days
             FROM purchase_stats
           )
           SELECT COUNT(*)::int AS count
           FROM cycles c
           JOIN products p ON p.id = c.product_id
           WHERE p.status = 'published'
             AND c.avg_cycle_days IS NOT NULL
             AND EXTRACT(EPOCH FROM (NOW() - c.last_at)) / 86400 >= c.avg_cycle_days`,
        ),
      ]);

      res.json({
        success: true,
        data: {
          goalsAchieved: goals.rows[0]?.achieved ?? 0,
          goalsTotal: goals.rows[0]?.total ?? 0,
          lowStockCount: lowStock.rows[0]?.count ?? 0,
          dueReorderCount: dueReorder.rows[0]?.count ?? 0,
        },
      });
    } catch (err) {
      console.error("[center] overview error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load overview" } });
    }
  });

  // ── GET /api/admin/market-overview ──────────────────────────────────────
  app.get("/api/admin/market-overview", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await canReadCenter(req.user!.userId))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Center access required" } });
        return;
      }

      const [revenue, orders, products, customers, sellers] = await Promise.all([
        query(
          `SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*)::int AS count
           FROM orders WHERE status IN ('completed', 'delivered')`,
        ),
        query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
                  COUNT(*) FILTER (WHERE status IN ('completed', 'delivered'))::int AS completed
           FROM orders`,
        ),
        query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE status = 'published')::int AS published
           FROM products WHERE status <> 'archived'`,
        ),
        query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'customer'"),
        query("SELECT COUNT(*)::int AS count FROM sellers WHERE status = 'approved'"),
      ]);

      res.json({
        success: true,
        data: {
          revenue: parseFloat(revenue.rows[0]?.total) || 0,
          orderCount: orders.rows[0]?.total ?? 0,
          pendingOrders: orders.rows[0]?.pending ?? 0,
          completedOrders: orders.rows[0]?.completed ?? 0,
          productCount: products.rows[0]?.total ?? 0,
          publishedCount: products.rows[0]?.published ?? 0,
          customerCount: customers.rows[0]?.count ?? 0,
          sellerCount: sellers.rows[0]?.count ?? 0,
        },
      });
    } catch (err) {
      console.error("[center] market-overview error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load market overview" } });
    }
  });

  // ── GET /api/admin/orders ───────────────────────────────────────────────
  app.get("/api/admin/orders", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await canReadCenter(req.user!.userId))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Center access required" } });
        return;
      }
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 200);

      const orderRes = await query(
        `SELECT o.id, o.user_id, o.order_number, o.status, o.total_amount, o.created_at,
                sh.name AS shop_name,
                COALESCE((SELECT status FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1), 'unpaid') AS payment_status
         FROM orders o
         LEFT JOIN shops sh ON o.shop_id = sh.id
         ORDER BY o.created_at DESC
         LIMIT $1`,
        [limit],
      );
      const rows = orderRes.rows;
      const orderIds = rows.map((r: any) => r.id as string);
      const itemsByOrder = new Map<string, any[]>();
      if (orderIds.length > 0) {
        const items = await query(
          `SELECT oi.order_id, oi.id, oi.quantity, oi.subtotal,
                  COALESCE(NULLIF(oi.product_name_snapshot, ''), NULLIF(oi.product_name, ''), p.name, '') AS product_name,
                  p.unit AS unit
           FROM order_items oi
           LEFT JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = ANY($1)
           ORDER BY oi.created_at ASC`,
          [orderIds],
        );
        for (const it of items.rows) {
          const list = itemsByOrder.get(it.order_id) ?? [];
          list.push({
            id: it.id,
            productName: it.product_name || "สินค้า",
            unit: it.unit ?? "",
            quantity: it.quantity,
            subtotal: parseFloat(it.subtotal) || 0,
          });
          itemsByOrder.set(it.order_id, list);
        }
      }

      const userIds = [...new Set(rows.map((r: any) => r.user_id).filter(Boolean))];
      const customers = new Map<string, { name: string | null; phone: string | null }>();
      if (userIds.length > 0) {
        const uRes = await query("SELECT id, name, phone FROM users WHERE id = ANY($1)", [userIds]);
        for (const u of uRes.rows) customers.set(u.id, { name: u.name, phone: u.phone });
      }

      res.json({
        success: true,
        data: rows.map((r: any) => {
          const items = itemsByOrder.get(r.id) ?? [];
          const customer = customers.get(r.user_id);
          return {
            id: r.id,
            orderNumber: r.order_number || r.id,
            status: r.status,
            createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
            total: parseFloat(r.total_amount) || 0,
            customerName: customer?.name ?? null,
            customerPhone: customer?.phone ?? null,
            itemCount: items.reduce((s: number, i: any) => s + i.quantity, 0),
            shopName: r.shop_name ?? null,
            items,
          };
        }),
      });
    } catch (err) {
      console.error("[center] orders list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch orders" } });
    }
  });

  // ── PATCH /api/admin/orders/:orderId/status ─────────────────────────────
  app.patch("/api/admin/orders/:orderId/status", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await canWriteCenter(req.user!.userId))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Owner or admin access required" } });
        return;
      }
      const orderId = param(req, "orderId");
      const to = typeof req.body?.status === "string" ? req.body.status : "";
      if (!(to in ORDER_NEXT_STATUS)) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid order status" } });
        return;
      }

      const current = await query("SELECT status FROM orders WHERE id = $1", [orderId]);
      if (current.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Order not found" } });
        return;
      }
      const from = current.rows[0].status;
      if (to !== from && !(ORDER_NEXT_STATUS[from] ?? []).includes(to)) {
        res.status(409).json({
          success: false,
          error: { code: "INVALID_TRANSITION", message: `Cannot move order from ${from} to ${to}` },
        });
        return;
      }

      await query("UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2", [to, orderId]);
      await writeAuditLog(req.user!.userId, "ORDER_STATUS_UPDATE", "order", orderId, { from, to });
      res.json({ success: true, data: { id: orderId, status: to } });
    } catch (err) {
      console.error("[center] order status error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update order status" } });
    }
  });

  // ── GET /api/admin/audit-logs ───────────────────────────────────────────
  app.get("/api/admin/audit-logs", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await canWriteCenter(req.user!.userId))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Owner or admin access required" } });
        return;
      }
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 150, 1), 500);
      const result = await query(
        `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id, al.details, al.created_at,
                u.role AS actor_role
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.user_id
         ORDER BY al.created_at DESC
         LIMIT $1`,
        [limit],
      );
      res.json({
        success: true,
        data: result.rows.map((r: any) => {
          let after: Record<string, unknown> | null = null;
          try {
            const details = r.details && typeof r.details === "object" ? r.details : JSON.parse(r.details || "{}");
            after = details && Object.keys(details).length > 0 ? details : null;
          } catch {
            after = null;
          }
          return {
            id: r.id,
            actorId: r.user_id ?? null,
            actorRole: r.actor_role ?? null,
            action: r.action,
            entityType: r.entity_type ?? null,
            entityId: r.entity_id ?? null,
            before: null,
            after,
            createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          };
        }),
      });
    } catch (err) {
      console.error("[center] audit logs error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch audit logs" } });
    }
  });

  // ── GET /api/admin/permissions ──────────────────────────────────────────
  app.get("/api/admin/permissions", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await isOwner(req.user!.userId))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Owner access required" } });
        return;
      }
      res.json({ success: true, data: PERMISSION_CATALOG });
    } catch (err) {
      console.error("[center] permissions error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load permissions" } });
    }
  });

  // ── GET /api/admin/users ────────────────────────────────────────────────
  app.get("/api/admin/users", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await canReadCenter(req.user!.userId))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Center access required" } });
        return;
      }
      const result = await query(
        `SELECT u.id, u.email, u.name, u.role, u.department, u.status, u.created_at
         FROM users u
         ORDER BY u.created_at DESC
         LIMIT 500`,
      );
      res.json({
        success: true,
        data: result.rows.map((r: any) => ({
          _id: r.id,
          id: r.id,
          email: r.email ?? null,
          name: r.name || null,
          role: r.role ?? "customer",
          department: r.department ?? null,
          status: r.status ?? "active",
          createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
        })),
      });
    } catch (err) {
      console.error("[center] users list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch users" } });
    }
  });

  // ── PATCH /api/admin/users/:userId/access ───────────────────────────────
  app.patch("/api/admin/users/:userId/access", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await isOwner(req.user!.userId))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Owner access required" } });
        return;
      }
      const targetUserId = param(req, "userId");
      const role = typeof req.body?.role === "string" ? req.body.role : "";
      const allowedRoles = ["customer", "seller", "admin", "owner", "staff"];
      if (!allowedRoles.includes(role)) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid role" } });
        return;
      }
      const department =
        typeof req.body?.department === "string" && DEPARTMENTS.includes(req.body.department)
          ? req.body.department
          : null;
      if (role !== "owner" && targetUserId === req.user!.userId) {
        res.status(400).json({ success: false, error: { code: "SELF_DEMOTION", message: "You cannot change your own role" } });
        return;
      }
      await query("UPDATE users SET role = $1, department = $2, updated_at = NOW() WHERE id = $3", [
        role,
        department,
        targetUserId,
      ]);
      await writeAuditLog(req.user!.userId, "USER_ACCESS_UPDATE", "user", targetUserId, { role, department });
      res.json({ success: true, data: { id: targetUserId, role, department } });
    } catch (err) {
      console.error("[center] user access error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update user access" } });
    }
  });

  // ── GET /api/admin/employees ────────────────────────────────────────────
  app.get("/api/admin/employees", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await canReadCenter(req.user!.userId))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Center access required" } });
        return;
      }
      const result = await query(
        `SELECT u.id AS user_id, e.id AS neon_id, e.employee_id, e.permissions,
                u.email, u.name, u.role, u.department, u.status, u.created_at
         FROM users u
         LEFT JOIN employees e ON e.user_id = u.id
         WHERE u.role IN ('owner', 'admin', 'staff') OR e.id IS NOT NULL
         ORDER BY u.created_at DESC`,
      );
      res.json({
        success: true,
        data: result.rows.map((r: any) => {
          let permissions: string[] = [];
          try {
            permissions = Array.isArray(r.permissions) ? r.permissions : JSON.parse(r.permissions || "[]");
          } catch {
            permissions = [];
          }
          return {
            userId: r.user_id,
            neonId: r.neon_id ?? null,
            email: r.email ?? null,
            name: r.name || null,
            role: r.role ?? "staff",
            department: r.department ?? null,
            employeeId: r.employee_id ?? null,
            permissions,
            active: r.status === "active",
            mustChangePassword: false,
            passwordAuth: false,
            createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          };
        }),
      });
    } catch (err) {
      console.error("[center] employees list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch employees" } });
    }
  });

  // ── POST /api/admin/employees ───────────────────────────────────────────
  // Creates a real employee account (user + employees rows). Login is via
  // Google OAuth with the same email (identity resolution links it) — there
  // is intentionally no password provider, so no temp password is invented.
  app.post("/api/admin/employees", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await isOwner(req.user!.userId))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Owner access required" } });
        return;
      }
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const role = typeof req.body?.role === "string" ? req.body.role : "staff";
      const department =
        typeof req.body?.department === "string" && DEPARTMENTS.includes(req.body.department)
          ? req.body.department
          : "general";
      const employeeId = typeof req.body?.employeeId === "string" ? req.body.employeeId.trim().slice(0, 50) || null : null;
      const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions.filter((p: unknown) => typeof p === "string").slice(0, 50) : [];

      if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "A valid name and email are required" } });
        return;
      }
      if (!["admin", "staff"].includes(role)) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Role must be admin or staff" } });
        return;
      }

      const existing = await query("SELECT id FROM users WHERE email = $1", [email]);
      if (existing.rows.length > 0) {
        res.status(409).json({ success: false, error: { code: "EMAIL_EXISTS", message: "An account with this email already exists" } });
        return;
      }

      const ins = await query(
        `INSERT INTO users (email, name, role, department, status)
         VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [email, name, role, department],
      );
      const userId = ins.rows[0].id as string;
      await query(
        `INSERT INTO employees (user_id, role, employee_id, permissions)
         VALUES ($1, $2, $3, $4)`,
        [userId, role === "admin" ? "admin" : "staff", employeeId, JSON.stringify(permissions)],
      );
      await writeAuditLog(req.user!.userId, "EMPLOYEE_CREATE", "employee", userId, { email, role, department });

      res.json({
        success: true,
        data: {
          email,
          name,
          tempPassword: null, // no password provider — employees sign in with Google
          mustChangePassword: false,
          userId,
        },
      });
    } catch (err) {
      console.error("[center] employee create error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to create employee" } });
    }
  });

  // ── PATCH /api/admin/employees/:userId/active ───────────────────────────
  app.patch("/api/admin/employees/:userId/active", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await isOwner(req.user!.userId))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Owner access required" } });
        return;
      }
      const targetUserId = param(req, "userId");
      const active = req.body?.active === true;
      if (targetUserId === req.user!.userId) {
        res.status(400).json({ success: false, error: { code: "SELF_UPDATE", message: "You cannot deactivate your own account" } });
        return;
      }
      await query("UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2", [
        active ? "active" : "suspended",
        targetUserId,
      ]);
      await writeAuditLog(req.user!.userId, "EMPLOYEE_ACTIVE_UPDATE", "employee", targetUserId, { active });
      res.json({ success: true, data: { id: targetUserId, active } });
    } catch (err) {
      console.error("[center] employee active error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update employee" } });
    }
  });

  // ── PATCH /api/admin/staff ──────────────────────────────────────────────
  // Update department + permissions for an employee (keys on the Neon
  // employees row id per the VelCenter UI).
  app.patch("/api/admin/staff", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await isOwner(req.user!.userId))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Owner access required" } });
        return;
      }
      const neonId = typeof req.body?.userId === "string" ? req.body.userId : "";
      const department =
        typeof req.body?.department === "string" && DEPARTMENTS.includes(req.body.department)
          ? req.body.department
          : null;
      const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions.filter((p: unknown) => typeof p === "string").slice(0, 50) : [];

      const emp = await query("SELECT user_id FROM employees WHERE id = $1", [neonId]);
      if (emp.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
        return;
      }
      const userId = emp.rows[0].user_id as string;
      await query("UPDATE users SET department = $1, updated_at = NOW() WHERE id = $2", [department, userId]);
      await query("UPDATE employees SET permissions = $1, updated_at = NOW() WHERE id = $2", [
        JSON.stringify(permissions),
        neonId,
      ]);
      await writeAuditLog(req.user!.userId, "STAFF_PROFILE_UPDATE", "employee", userId, { department, permissions });
      res.json({ success: true, data: { id: neonId, department, permissions } });
    } catch (err) {
      console.error("[center] staff profile error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update staff profile" } });
    }
  });

  // ── POST /api/admin/employees/:userId/reset-password ────────────────────
  // Honest response: no password provider exists, so there is nothing to
  // reset. Registered so the route never 404s, but returns a clear error.
  app.post("/api/admin/employees/:userId/reset-password", requireAuth, async (req: Request, res: Response) => {
    if (!(await isOwner(req.user!.userId))) {
      res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Owner access required" } });
      return;
    }
    res.status(400).json({
      success: false,
      error: {
        code: "PASSWORD_AUTH_UNAVAILABLE",
        message: "Password login is not enabled — employees sign in with Google using their account email",
      },
    });
  });
}