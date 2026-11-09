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
  round2,
  SELLER_COMMISSION_RATE,
  isOrderIncomeEligible,
  isReturnCounted,
  SELLER_RETURN_COVERAGE,
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

      // Fetch all order items with shipment and return data for this seller
      const itemsRes = await query(
        `SELECT 
           oi.id AS item_id,
           oi.order_id,
           oi.product_id,
           oi.shop_id,
           oi.quantity,
           oi.price,
           oi.subtotal,
           COALESCE(NULLIF(oi.product_name_snapshot, ''), NULLIF(oi.product_name, ''), p.name, '') AS product_name,
           o.status AS order_status,
           o.created_at AS order_created_at,
           s.id AS shipment_id,
           s.status AS shipment_status,
           s.created_at AS shipment_created_at,
           r.id AS return_id,
           r.status AS return_status,
           r.created_at AS return_created_at
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN shops sh ON oi.shop_id = sh.id
         LEFT JOIN products p ON oi.product_id = p.id
         LEFT JOIN shipment_items si ON si.order_item_id = oi.id
         LEFT JOIN shipments s ON s.id = si.shipment_id
         LEFT JOIN order_returns r ON r.order_item_id = oi.id
         WHERE sh.seller_id = $1
         ORDER BY o.created_at ASC`,
        [sellerId],
      );

      // Process items for detailed calculation
      const items = itemsRes.rows.map((row: any) => ({
        orderId: row.order_id,
        orderStatus: row.order_status,
        orderCreatedAt: row.order_created_at ? new Date(row.order_created_at) : new Date(),
        itemId: row.item_id,
        productId: row.product_id,
        productName: row.product_name || "สินค้า",
        quantity: row.quantity,
        unitPrice: parseFloat(row.price) || 0,
        subtotal: parseFloat(row.subtotal) || (parseFloat(row.price) || 0) * row.quantity,
        shipmentId: row.shipment_id,
        shipmentStatus: row.shipment_status,
        shipmentCreatedAt: row.shipment_created_at ? new Date(row.shipment_created_at) : undefined,
        returnId: row.return_id,
        returnStatus: row.return_status,
        returnCreatedAt: row.return_created_at ? new Date(row.return_created_at) : undefined,
      }));

      // Calculate using detailed per-item logic
      let gross = 0;
      let grossCount = 0;
      let grossDeliveredCount = 0;
      let returns = 0;
      let returnCount = 0;
      let returnShippedCount = 0;
      let commission = 0;
      const itemBreakdown: any[] = [];

      for (const item of items) {
        // THE ORDER IS THE AUTHORITY (lib/seller-stats.ts explains why): a
        // completed/delivered order is money the seller earned even when no
        // shipment row was ever recorded. Requiring a shipment silently zeroed
        // the whole income page for every order placed without a carrier.
        const isCommissionEligible = isOrderIncomeEligible(item.orderStatus);
        // A confirmed return counts on its own lifecycle — it does not depend on
        // the shipment row that the eligibility bug above also required.
        const isReturnEligible = isReturnCounted(item.returnStatus);

        const itemCommission = isCommissionEligible ? round2(item.subtotal * SELLER_COMMISSION_RATE) : 0;
        const itemReturnAmount = isReturnEligible ? round2(item.subtotal) : 0;

        if (isCommissionEligible) {
          gross += item.subtotal;
          grossCount += item.quantity;
          grossDeliveredCount += item.quantity;
          commission += itemCommission;
        }
        
        if (isReturnEligible) {
          returns += item.subtotal;
          returnCount += item.quantity;
          returnShippedCount += item.quantity;
        }

        itemBreakdown.push({
          orderId: item.orderId,
          orderStatus: item.orderStatus,
          itemId: item.itemId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: round2(item.subtotal),
          isCommissionEligible,
          commissionAmount: itemCommission,
          isReturnEligible,
          returnAmount: itemReturnAmount,
        });
      }

      // Use computeIncomeReport for the standard summary (gross, returns, commission, payout)
      const report = computeIncomeReport(gross, grossCount, returns, returnCount);

      // Real date-grouped breakdown using order creation date for delivered items
      const dayBuckets = new Map<string, { date: string; gross: number; grossCount: number; returns: number; returnCount: number }>();
      for (const item of items) {
        if (!item.orderCreatedAt) continue;
        // Same eligibility as the KPI loop above — a chart that disagrees with
        // the totals above it is worse than no chart.
        const isOrderDelivered = isOrderIncomeEligible(item.orderStatus);
        const isReturnEligible = isReturnCounted(item.returnStatus);

        if (!isOrderDelivered && !isReturnEligible) continue;

        const day = new Date(item.orderCreatedAt).toISOString().slice(0, 10);
        const b = dayBuckets.get(day) ?? { date: day, gross: 0, grossCount: 0, returns: 0, returnCount: 0 };
        if (isOrderDelivered) {
          b.gross += item.subtotal;
          b.grossCount += item.quantity;
        }
        if (isReturnEligible) {
          b.returns += item.subtotal;
          b.returnCount += item.quantity;
        }
        dayBuckets.set(day, b);
      }
      const grouped = [...dayBuckets.values()]
        .map((b) => ({
          date: b.date,
          gross: round2(b.gross),
          grossCount: b.grossCount,
          returns: round2(b.returns),
          returnCount: b.returnCount,
          commission: round2(b.gross * SELLER_COMMISSION_RATE),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Recent transactions (seller's portion only), NEWEST first. `items` is
      // ordered by order date ASC, so a plain slice(0, 50) handed the page the 50
      // OLDEST orders while the heading said "recent".
      const orderRecency = new Map<string, number>();
      for (const i of items) {
        const t = i.orderCreatedAt ? new Date(i.orderCreatedAt).getTime() : 0;
        if (t > (orderRecency.get(i.orderId) ?? 0)) orderRecency.set(i.orderId, t);
      }
      const recentOrderIds = [...new Set(items.map((i) => i.orderId))]
        .sort((a, b) => (orderRecency.get(b) ?? 0) - (orderRecency.get(a) ?? 0))
        .slice(0, 50);
      const itemsByOrder = await fetchSellerItemsForOrders(recentOrderIds, sellerId);

      // Real order headers: the row above the transactions list showed a UUID in
      // the order-number column and ฿0 as the total (both were placeholders).
      const orderHeaderRes = await query(
        `SELECT id, order_number, total_amount FROM orders WHERE id = ANY($1::uuid[])`,
        [recentOrderIds],
      );
      const orderHeaders = new Map<string, { orderNumber: string | null; total: number }>();
      for (const row of orderHeaderRes.rows) {
        orderHeaders.set(String(row.id), {
          orderNumber: row.order_number ?? null,
          total: parseFloat(row.total_amount) || 0,
        });
      }

      const customerIds = [...new Set(items.map((i: any) => i.orderId).filter(Boolean))];
      // We need to fetch customer names from orders
      const customerRes = await query(
        `SELECT o.id AS order_id, u.name
         FROM users u
         JOIN orders o ON o.user_id = u.id
         WHERE o.id = ANY($1::uuid[])`,
        [recentOrderIds],
      );
      // Keyed by ORDER id: the previous version keyed by user id and then looked
      // the customer up by order id, so every transaction showed "—".
      const customers = new Map<string, { name: string | null }>();
      for (const u of customerRes.rows) customers.set(String(u.order_id), { name: u.name });

      const transactions = recentOrderIds
        .map((orderId: string) => {
          const orderItems = itemsByOrder[orderId] ?? [];
          const orderData = items.find(i => i.orderId === orderId);
          if (!orderData) return null;
          const subtotal = orderItems.reduce((s: number, i: any) => s + (parseFloat(i.subtotal) || 0), 0);
          const terminal = ["completed", "delivered", "cancelled", "failed", "refunded"].includes(orderData.orderStatus);
          return {
            order: {
              id: orderData.orderId,
              orderNumber: orderHeaders.get(orderData.orderId)?.orderNumber ?? orderData.orderId,
              status: orderData.orderStatus,
              createdAt: orderData.orderCreatedAt.getTime(),
              customerName: customers.get(orderData.orderId)?.name ?? null,
              total: orderHeaders.get(orderData.orderId)?.total ?? 0,
            },
            items: orderItems,
            subtotal,
            pending: !terminal,
          };
        })
        .filter(Boolean);

      res.json({
        success: true,
        data: {
          ...report,
          grossDeliveredCount,
          returnShippedCount,
          grouped,
          transactions,
          items: itemBreakdown,
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

