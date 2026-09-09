/**
 * Velnox Seller Intelligence (P1 #4)
 *
 * Endpoints that the VelSeller Goals / Income / Reorder tabs were calling
 * with no backend route behind them:
 *
 *   GET    /api/seller/goals                  — list my goals
 *   POST   /api/seller/goals                  — create a goal
 *   PATCH  /api/seller/goals/:goalId          — update a goal
 *   DELETE /api/seller/goals/:goalId          — delete a goal
 *   POST   /api/seller/goals/:goalId/progress — add progress to a goal
 *   GET    /api/seller/income                 — income + commission report
 *   GET    /api/seller/reorder-suggestions    — smart reorder suggestions
 *
 * All endpoints require an approved seller session. Every query is scoped to
 * the authenticated seller's own data (products/orders/inventory) — no
 * client-supplied sellerId/shopId is ever trusted.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";
import {
  computeIncomeReport,
  computePurchaseStats,
  estimatedNextPurchase,
  reorderConfidence,
  validateGoalInput,
} from "../lib/seller-stats.js";
import { fetchSellerItemsForOrders } from "./seller-orders.js";

function param(req: Request, key: string): string {
  const v = req.params[key];
  return typeof v === "string" ? v : "";
}

/** Resolve the authenticated user to an approved seller id (or null). */
async function resolveSellerId(userId: string): Promise<string | null> {
  const res = await query("SELECT id FROM sellers WHERE user_id = $1 AND status = 'approved'", [userId]);
  return res.rows[0]?.id ?? null;
}

/** DB row → the exact Goal shape the VelSeller Goals UI renders. */
function toGoal(row: Record<string, any>): Record<string, unknown> {
  return {
    _id: row.id,
    title: row.title,
    description: row.description ?? null,
    category: row.category ?? "other",
    period: row.period ?? "monthly",
    unit: row.unit ?? "ครั้ง",
    targetValue: parseFloat(row.target_value) || 0,
    currentValue: parseFloat(row.current_value) || 0,
    dueDate: row.due_date ? new Date(row.due_date).getTime() : undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

export function setupSellerIntelligenceRoutes(app: Express): void {
  // ── GET /api/seller/goals ────────────────────────────────────────────────
  app.get("/api/seller/goals", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerId = await resolveSellerId(req.user!.userId);
      if (!sellerId) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }
      const result = await query(
        "SELECT * FROM seller_goals WHERE seller_id = $1 ORDER BY created_at ASC",
        [sellerId],
      );
      res.json({ success: true, data: result.rows.map(toGoal) });
    } catch (err) {
      console.error("[seller-intel] goals list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch goals" } });
    }
  });

  // ── POST /api/seller/goals ───────────────────────────────────────────────
  app.post("/api/seller/goals", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerId = await resolveSellerId(req.user!.userId);
      if (!sellerId) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }
      const v = validateGoalInput(req.body);
      if (v.error) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: v.error } });
        return;
      }
      const ins = await query(
        `INSERT INTO seller_goals (seller_id, title, description, category, period, unit, target_value, current_value, due_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [sellerId, v.title, v.description, v.category, v.period, v.unit, v.targetValue, v.currentValue, v.dueDate ? new Date(v.dueDate) : null],
      );
      res.json({ success: true, data: toGoal(ins.rows[0]) });
    } catch (err) {
      console.error("[seller-intel] goal create error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to create goal" } });
    }
  });

  // ── PATCH /api/seller/goals/:goalId ──────────────────────────────────────
  app.patch("/api/seller/goals/:goalId", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerId = await resolveSellerId(req.user!.userId);
      if (!sellerId) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }
      const goalId = param(req, "goalId");
      const owned = await query("SELECT id FROM seller_goals WHERE id = $1 AND seller_id = $2", [goalId, sellerId]);
      if (owned.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Goal not found" } });
        return;
      }
      const v = validateGoalInput(req.body);
      if (v.error) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: v.error } });
        return;
      }
      const upd = await query(
        `UPDATE seller_goals
         SET title = $1, description = $2, category = $3, period = $4, unit = $5,
             target_value = $6, current_value = $7, due_date = $8, updated_at = NOW()
         WHERE id = $9 AND seller_id = $10 RETURNING *`,
        [v.title, v.description, v.category, v.period, v.unit, v.targetValue, v.currentValue, v.dueDate ? new Date(v.dueDate) : null, goalId, sellerId],
      );
      res.json({ success: true, data: toGoal(upd.rows[0]) });
    } catch (err) {
      console.error("[seller-intel] goal update error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update goal" } });
    }
  });

  // ── DELETE /api/seller/goals/:goalId ─────────────────────────────────────
  app.delete("/api/seller/goals/:goalId", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerId = await resolveSellerId(req.user!.userId);
      if (!sellerId) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }
      const goalId = param(req, "goalId");
      const del = await query(
        "DELETE FROM seller_goals WHERE id = $1 AND seller_id = $2 RETURNING id",
        [goalId, sellerId],
      );
      if (del.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Goal not found" } });
        return;
      }
      res.json({ success: true, data: { id: goalId } });
    } catch (err) {
      console.error("[seller-intel] goal delete error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to delete goal" } });
    }
  });

  // ── POST /api/seller/goals/:goalId/progress ──────────────────────────────
  app.post("/api/seller/goals/:goalId/progress", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerId = await resolveSellerId(req.user!.userId);
      if (!sellerId) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }
      const goalId = param(req, "goalId");
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "amount must be a number greater than 0" } });
        return;
      }
      const upd = await query(
        `UPDATE seller_goals SET current_value = current_value + $1, updated_at = NOW()
         WHERE id = $2 AND seller_id = $3 RETURNING *`,
        [amount, goalId, sellerId],
      );
      if (upd.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Goal not found" } });
        return;
      }
      res.json({ success: true, data: toGoal(upd.rows[0]) });
    } catch (err) {
      console.error("[seller-intel] goal progress error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to record progress" } });
    }
  });

  // ── GET /api/seller/income ───────────────────────────────────────────────
  // Income report computed live from the seller's real orders (no fake
  // numbers): gross = completed/delivered items, returns = cancelled/failed,
  // commission 3%, payout after the 10% return-coverage policy.
  app.get("/api/seller/income", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerId = await resolveSellerId(req.user!.userId);
      if (!sellerId) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }

      // Aggregate: per order, the seller's items subtotal + count + status.
      const agg = await query(
        `SELECT o.id, o.user_id, o.status, o.order_number, o.total_amount, o.created_at,
                SUM(oi.subtotal) AS seller_subtotal,
                SUM(oi.quantity)::int AS seller_item_count
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN shops sh ON oi.shop_id = sh.id
         WHERE sh.seller_id = $1
         GROUP BY o.id, o.user_id, o.status, o.order_number, o.total_amount, o.created_at`,
        [sellerId],
      );

      let gross = 0;
      let grossCount = 0;
      let returns = 0;
      let returnCount = 0;
      for (const r of agg.rows) {
        const subtotal = parseFloat(r.seller_subtotal) || 0;
        const itemCount = r.seller_item_count || 0;
        if (["completed", "delivered"].includes(r.status)) {
          gross += subtotal;
          grossCount += itemCount;
        } else if (["cancelled", "failed", "refunded"].includes(r.status)) {
          returns += subtotal;
          returnCount += itemCount;
        }
      }

      const report = computeIncomeReport(gross, grossCount, returns, returnCount);

      // Recent transactions (seller's portion only), newest first.
      const recentIds = agg.rows
        .sort((a: any, b: any) => (b.created_at?.getTime?.() ?? 0) - (a.created_at?.getTime?.() ?? 0))
        .slice(0, 50)
        .map((r: any) => r.id as string);
      const itemsByOrder = await fetchSellerItemsForOrders(recentIds, sellerId);

      const customerIds = [...new Set(agg.rows.map((r: any) => r.user_id).filter(Boolean))];
      const customers = new Map<string, { name: string | null }>();
      if (customerIds.length > 0) {
        const uRes = await query("SELECT id, name FROM users WHERE id = ANY($1)", [customerIds]);
        for (const u of uRes.rows) customers.set(u.id, { name: u.name });
      }

      const transactions = agg.rows
        .sort((a: any, b: any) => (b.created_at?.getTime?.() ?? 0) - (a.created_at?.getTime?.() ?? 0))
        .slice(0, 50)
        .map((r: any) => {
          const items = itemsByOrder[r.id] ?? [];
          const subtotal = items.reduce((s: number, i: any) => s + (parseFloat(i.subtotal) || 0), 0);
          const terminal = ["completed", "delivered", "cancelled", "failed", "refunded"].includes(r.status);
          return {
            order: {
              id: r.id,
              orderNumber: r.order_number || r.id,
              status: r.status,
              createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
              customerName: customers.get(r.user_id)?.name ?? null,
              total: parseFloat(r.total_amount) || 0,
            },
            items,
            subtotal,
            pending: !terminal,
          };
        });

      res.json({
        success: true,
        data: {
          ...report,
          transactions,
        },
      });
    } catch (err) {
      console.error("[seller-intel] income error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to compute income report" } });
    }
  });

  // ── GET /api/seller/reorder-suggestions ──────────────────────────────────
  // Smart reorder: per product — stock vs reorder level + learned purchase
  // cycle from the seller's real order history.

  // ── GET /api/seller/reorder-suggestions ──────────────────────────────────
  // Smart reorder: per product — stock vs reorder level + learned purchase
  // cycle from the seller's real order history.
  app.get("/api/seller/reorder-suggestions", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerId = await resolveSellerId(req.user!.userId);
      if (!sellerId) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }

      const products = await query(
        `SELECT p.id, p.name, p.category_id, p.price, p.unit, p.status,
                i.quantity, i.reserved, i.low_stock_threshold AS reorder_level,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS image_url
         FROM products p
         JOIN shops sh ON p.shop_id = sh.id
         LEFT JOIN inventory i ON i.product_id = p.id
         WHERE sh.seller_id = $1 AND p.status <> 'archived'
         ORDER BY p.created_at DESC`,
        [sellerId],
      );

      const productIds = products.rows.map((r: any) => r.id as string);
      const purchaseByProduct = new Map<string, { times: number[]; units: number }>();
      if (productIds.length > 0) {
        const stats = await query(
          `SELECT oi.product_id,
                  o.created_at,
                  SUM(oi.quantity) OVER (PARTITION BY oi.product_id) AS total_units
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           WHERE oi.product_id = ANY($1) AND o.status NOT IN ('cancelled', 'failed', 'refunded')
           ORDER BY oi.product_id, o.created_at ASC`,
          [productIds],
        );
        for (const r of stats.rows) {
          const entry = purchaseByProduct.get(r.product_id) ?? { times: [], units: 0 };
          entry.times.push(new Date(r.created_at).getTime());
          entry.units = r.total_units;
          purchaseByProduct.set(r.product_id, entry);
        }
      }

      const suggestions = products.rows.map((r: any) => {
        const available = (parseInt(r.quantity) || 0) - (parseInt(r.reserved) || 0);
        const reorderLevel = parseInt(r.reorder_level) || 0;
        const lowStock = reorderLevel > 0 && available <= reorderLevel;
        const outOfStock = available <= 0;

        const history = purchaseByProduct.get(r.id);
        const stats = computePurchaseStats(history?.times ?? [], history?.units ?? 0);
        const next = estimatedNextPurchase({
          lastPurchaseAt: stats.lastPurchaseAt,
          avgCycleDays: stats.avgCycleDays,
        });

        return {
          product: {
            id: r.id,
            name: r.name,
            category: r.category_id || "general",
            price: parseFloat(r.price) || 0,
            unit: r.unit ?? "ชิ้น",
            status: r.status,
            primaryImage: r.image_url ? { thumbUrl: r.image_url, url: r.image_url } : null,
            inventory: {
              available,
              quantity: parseInt(r.quantity) || 0,
              reorderLevel,
            },
          },
          available,
          reorderLevel,
          lowStock,
          outOfStock,
          purchaseCount: stats.purchaseCount,
          unitsSold: stats.unitsSold,
          lastPurchaseAt: stats.lastPurchaseAt ? new Date(stats.lastPurchaseAt).toISOString() : null,
          avgCycleDays: stats.avgCycleDays !== null ? Math.round(stats.avgCycleDays * 10) / 10 : null,
          estimatedNextPurchase: next !== null ? new Date(next).toISOString() : null,
          confidence: reorderConfidence(stats.purchaseCount),
          due: next !== null && next <= Date.now(),
        };
      });

      res.json({ success: true, data: suggestions });
    } catch (err) {
      console.error("[seller-intel] reorder suggestions error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to compute reorder suggestions" } });
    }
  });
}

