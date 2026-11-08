/**
 * Velnox Integrated Multi-Carrier Tracking — API endpoints.
 *
 * Roles:
 *   customer — view + refresh the tracking of their OWN order only (ownership
 *              enforced in the SQL WHERE — never a 403 that confirms existence).
 *   seller   — view + refresh the tracking of orders belonging to their own
 *              shops (scoped through order_items.shop_id → shops.seller_id).
 *   admin    — search every shipment, filter by carrier/status, view detail,
 *              refresh any order, and read per-carrier integration health.
 *
 * Security:
 *   • requireAuth on every route; the seller scope never trusts a client id,
 *   • admin routes re-check `isCenterMember` + `userHasPermission` (owner/admin
 *     hold every code; staff hold what was granted),
 *   • no endpoint returns another person's shipment without their role right,
 *   • carrier errors are normalized SAFE codes — never raw carrier text, never
 *     a phone number.
 *
 * Realtime/notifications: a refresh that actually moves the shipment machine
 * publishes `shipment:updated` and writes the customer notification via the
 * same helpers the seller/center routes use (tracking-service.ts does this).
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";
import { isCenterMember, userHasPermission } from "../lib/permissions.js";
import { refreshOrderTracking, getTrackingView, TrackingRequestError } from "../lib/tracking/tracking-service.js";
import { CARRIER_ADAPTERS, carrierIntegrationStatus } from "../lib/tracking/carrier-adapter.js";

/** Shipment row → admin list projection (joined with order info). */
function shipmentRow(row: any): any {
  return {
    id: row.id,
    orderId: row.order_id,
    orderNumber: row.order_number ?? row.order_id,
    customerUserId: row.user_id ?? null,
    shopName: row.shop_name ?? null,
    carrier: row.carrier ?? "",
    carrierCode: row.carrier_code ?? null,
    trackingNumber: row.tracking_number ?? null,
    status: row.status ?? "pending",
    originalStatus: row.original_status ?? null,
    estimatedDeliveryDate: row.estimated_delivery_date ?? null,
    lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at).toISOString() : null,
    lastError: row.last_error ?? null,
    trackingConfirmed: row.tracking_confirmed ?? false,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export function setupTrackingRoutes(app: Express): void {
  // ── Customer ─────────────────────────────────────────────────────────────

  // Read-only tracking for the customer's OWN order (cache-first, no carrier call).
  app.get("/api/customer/orders/:orderId/tracking", requireAuth, async (req: Request, res: Response) => {
    try {
      const orderId = (req.params as Record<string, string>).orderId ?? "";
      const userId = req.user!.userId;
      const own = await query(
        `SELECT 1 FROM orders WHERE id = $1 AND user_id = $2`,
        [orderId, userId],
      );
      if (own.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Order not found" } });
        return;
      }
      const view = await getTrackingView(orderId);
      res.json({ success: true, data: view });
    } catch (err) {
      if (err instanceof TrackingRequestError) {
        res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      console.error("[tracking] customer view error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load tracking" } });
    }
  });

  // Force refresh the customer's OWN order shipment.
  app.post("/api/customer/orders/:orderId/tracking/refresh", requireAuth, async (req: Request, res: Response) => {
    try {
      const orderId = (req.params as Record<string, string>).orderId ?? "";
      const userId = req.user!.userId;
      const own = await query(
        `SELECT 1 FROM orders WHERE id = $1 AND user_id = $2`,
        [orderId, userId],
      );
      if (own.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Order not found" } });
        return;
      }
      const view = await refreshOrderTracking(orderId);
      res.json({ success: true, data: view });
    } catch (err) {
      if (err instanceof TrackingRequestError) {
        res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      console.error("[tracking] customer refresh error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to refresh tracking" } });
    }
  });

  // ── Seller ───────────────────────────────────────────────────────────────

  const sellerOwnsOrder = async (orderId: string, sellerId: string): Promise<boolean> => {
    const res = await query(
      `SELECT 1
       FROM orders o
       WHERE o.id = $1
         AND EXISTS (
           SELECT 1 FROM order_items oi
           JOIN shops sh ON sh.id = oi.shop_id
           WHERE oi.order_id = o.id AND sh.seller_id = $2
         )
       LIMIT 1`,
      [orderId, sellerId],
    );
    return res.rows.length > 0;
  };

  app.get("/api/seller/orders/:id/tracking", requireAuth, async (req: Request, res: Response) => {
    try {
      const orderId = (req.params as Record<string, string>).id ?? "";
      const me = await query(`SELECT id, status FROM sellers WHERE user_id = $1 LIMIT 1`, [req.user!.userId]);
      const seller = me.rows[0] as { id: string; status: string } | undefined;
      if (!seller || (seller.status !== "approved" && seller.status !== "active")) {
        res.status(403).json({ success: false, error: { code: "SELLER_NOT_APPROVED", message: "Seller is not approved" } });
        return;
      }
      if (!(await sellerOwnsOrder(orderId, seller.id))) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Order not found" } });
        return;
      }
      const view = await getTrackingView(orderId);
      res.json({ success: true, data: view });
    } catch (err) {
      if (err instanceof TrackingRequestError) {
        res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      console.error("[tracking] seller view error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load tracking" } });
    }
  });

  app.post("/api/seller/orders/:id/tracking/refresh", requireAuth, async (req: Request, res: Response) => {
    try {
      const orderId = (req.params as Record<string, string>).id ?? "";
      const me = await query(`SELECT id, status FROM sellers WHERE user_id = $1 LIMIT 1`, [req.user!.userId]);
      const seller = me.rows[0] as { id: string; status: string } | undefined;
      if (!seller || (seller.status !== "approved" && seller.status !== "active")) {
        res.status(403).json({ success: false, error: { code: "SELLER_NOT_APPROVED", message: "Seller is not approved" } });
        return;
      }
      if (!(await sellerOwnsOrder(orderId, seller.id))) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Order not found" } });
        return;
      }
      const view = await refreshOrderTracking(orderId);
      res.json({ success: true, data: view });
    } catch (err) {
      if (err instanceof TrackingRequestError) {
        res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      console.error("[tracking] seller refresh error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to refresh tracking" } });
    }
  });

  // ── Admin (VelCenter) ────────────────────────────────────────────────────

  const guardAdmin = async (req: Request, res: Response, permission: string): Promise<boolean> => {
    const userId = req.user!.userId;
    if (!(await isCenterMember(userId)) || !(await userHasPermission(userId, permission))) {
      res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "No permission" } });
      return false;
    }
    return true;
  };

  // Search shipments globally (q = tracking number / order id / order number).
  app.get("/api/admin/tracking/search", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await guardAdmin(req, res, "orders.view"))) return;

      const q = String(req.query.q ?? "").trim();
      const carrier = String(req.query.carrier ?? "").trim();
      const status = String(req.query.status ?? "").trim();
      const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const where: string[] = ["1 = 1"];
      const params: unknown[] = [];
      if (q) {
        params.push(`%${q}%`);
        where.push(`(
          s.tracking_number ILIKE $${params.length}
          OR s.order_id::text ILIKE $${params.length}
          OR o.order_number ILIKE $${params.length}
        )`);
      }
      if (carrier) {
        params.push(carrier);
        where.push(`(s.carrier_code = $${params.length} OR s.carrier ILIKE $${params.length})`);
      }
      if (status) {
        params.push(status);
        where.push(`s.status = $${params.length}`);
      }
      params.push(limit);
      const limitParam = `$${params.length}`;
      params.push(offset);
      const offsetParam = `$${params.length}`;

      const rows = await query(
        `SELECT s.*, o.order_number, o.user_id, sh.name AS shop_name
         FROM shipments s
         LEFT JOIN orders o ON o.id = s.order_id
         LEFT JOIN shops sh ON sh.id = o.shop_id
         WHERE ${where.join(" AND ")}
         ORDER BY s.updated_at DESC
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params,
      );
      const countRes = await query(
        `SELECT COUNT(*)::int AS total FROM shipments s
         LEFT JOIN orders o ON o.id = s.order_id
         WHERE ${where.join(" AND ")}`,
        params.slice(0, params.length - 2),
      );

      res.json({
        success: true,
        data: {
          shipments: rows.rows.map(shipmentRow),
          total: countRes.rows[0]?.total ?? 0,
          limit,
          offset,
        },
      });
    } catch (err) {
      console.error("[tracking] admin search error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to search shipments" } });
    }
  });

  // Tracking detail (timeline) for one shipment.
  app.get("/api/admin/tracking/shipments/:shipmentId", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await guardAdmin(req, res, "orders.view"))) return;
      const shipmentId = (req.params as Record<string, string>).shipmentId ?? "";
      const res2 = await query(
        `SELECT s.*, o.order_number, o.user_id, sh.name AS shop_name
         FROM shipments s
         LEFT JOIN orders o ON o.id = s.order_id
         LEFT JOIN shops sh ON sh.id = o.shop_id
         WHERE s.id = $1
         LIMIT 1`,
        [shipmentId],
      );
      if (res2.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Shipment not found" } });
        return;
      }
      const events = await query(
        `SELECT status, description, location, occurred_at, carrier_status
         FROM tracking_events WHERE shipment_id = $1 ORDER BY occurred_at ASC`,
        [shipmentId],
      );
      res.json({
        success: true,
        data: {
          shipment: shipmentRow(res2.rows[0]),
          events: events.rows.map((e: any) => ({
            status: e.status,
            description: e.description,
            location: e.location,
            occurredAt: e.occurred_at ? new Date(e.occurred_at).toISOString() : null,
            originalStatus: e.carrier_status ?? null,
          })),
        },
      });
    } catch (err) {
      console.error("[tracking] admin detail error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load shipment" } });
    }
  });

  // Admin refresh of any order's shipment.
  app.post("/api/admin/orders/:orderId/tracking/refresh", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await guardAdmin(req, res, "orders.manage"))) return;
      const orderId = (req.params as Record<string, string>).orderId ?? "";
      const view = await refreshOrderTracking(orderId);
      res.json({ success: true, data: view });
    } catch (err) {
      if (err instanceof TrackingRequestError) {
        res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      console.error("[tracking] admin refresh error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to refresh tracking" } });
    }
  });

  // Per-carrier integration health.
  app.get("/api/admin/tracking/health", requireAuth, async (_req: Request, res: Response) => {
    try {
      if (!(await guardAdmin(_req, res, "orders.view"))) return;
      const health = CARRIER_ADAPTERS.map((a) => ({ ...carrierIntegrationStatus(a), numberFormat: a.numberExamples[0] ?? null }));
      res.json({ success: true, data: { carriers: health } });
    } catch (err) {
      console.error("[tracking] admin health error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load carrier health" } });
    }
  });
}
