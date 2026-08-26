/**
 * VelRepeat Package Endpoints
 *
 * VelRepeat is a "buy-ahead package + scheduled delivery" system.
 * Customer pays upfront for N units; system delivers on a schedule.
 *
 * POST   /api/velrepeat/packages         — Create a new package
 * GET    /api/velrepeat/packages          — List user's packages
 * GET    /api/velrepeat/packages/:id      — Get package detail
 * PATCH  /api/velrepeat/packages/:id      — Pause / resume / cancel
 * GET    /api/velrepeat/packages/:id/deliveries — Delivery schedule
 * GET    /api/seller/velrepeat/deliveries  — Seller's pending deliveries
 * PATCH  /api/seller/velrepeat/deliveries/:id — Update delivery status
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query, withTransaction } from "../db/index.js";

function param(req: Request, key: string): string {
  return (req.params as Record<string, string>)[key] ?? "";
}

/**
 * Calculate delivery interval in days for a package type.
 */
function intervalForType(packageType: string): number {
  switch (packageType) {
    case "weekly": return 7;
    case "monthly": return 30;
    default: return 7; // custom defaults to weekly
  }
}

/**
 * Create delivery schedule for a package.
 */
async function createDeliverySchedule(
  client: any,
  packageId: string,
  quantityTotal: number,
  intervalDays: number,
): Promise<void> {
  const now = new Date();
  for (let i = 0; i < quantityTotal; i++) {
    const scheduledAt = new Date(now.getTime() + (i + 1) * intervalDays * 24 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO vrepeat_deliveries (package_id, delivery_number, quantity, scheduled_at, status)
       VALUES ($1, $2, 1, $3, 'scheduled')`,
      [packageId, i + 1, scheduledAt.toISOString()],
    );
  }
}

export function setupVelRepeatRoutes(app: Express): void {

  // ── POST /api/velrepeat/packages ────────────────────────────────────────
  // Create a new VelRepeat package. This is called from checkout flow
  // AFTER payment is confirmed (or as part of the checkout process).
  app.post("/api/velrepeat/packages", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const {
        productId,
        variantId = null,
        packageType = "monthly",
        quantity = 1,
        unitPrice,
        customIntervalDays,
      } = req.body;

      if (!productId || typeof productId !== "string") {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "productId is required" } });
        return;
      }

      const qty = Math.max(1, Math.floor(Number(quantity) || 1));
      const pType = ["weekly", "monthly", "custom"].includes(packageType) ? packageType : "monthly";
      const intervalDays = pType === "custom"
        ? Math.max(1, Number(customIntervalDays) || 7)
        : intervalForType(pType);

      // Validate product exists, is published, and supports VelRepeat
      const productResult = await query(
        `SELECT p.id, p.price, p.status, p.shop_id, p.name,
                p.vrepeat_enabled, p.vrepeat_weekly_enabled, p.vrepeat_monthly_enabled,
                p.vrepeat_weekly_price, p.vrepeat_monthly_price,
                p.vrepeat_weekly_qty, p.vrepeat_monthly_qty,
                sh.seller_id
         FROM products p
         JOIN shops sh ON p.shop_id = sh.id
         WHERE p.id = $1`,
        [productId],
      );

      if (productResult.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
        return;
      }
      const product = productResult.rows[0];

      if (product.status !== "published") {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Product is not available" } });
        return;
      }

      if (!product.vrepeat_enabled) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "This product does not support VelRepeat" } });
        return;
      }

      // Check variant if specified
      if (variantId) {
        const variantResult = await query(
          "SELECT id, price, stock, status FROM product_variants WHERE id = $1 AND product_id = $2",
          [variantId, productId],
        );
        if (variantResult.rows.length === 0) {
          res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Variant not found" } });
          return;
        }
        const variant = variantResult.rows[0];
        if (variant.status !== "active") {
          res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Variant is not available" } });
          return;
        }
        if (variant.stock < qty) {
          res.status(400).json({ success: false, error: { code: "INSUFFICIENT_STOCK", message: "Insufficient stock for this variant" } });
          return;
        }
      }

      // Determine pricing
      const regularPrice = parseFloat(product.price);
      let specialPrice = regularPrice;
      let totalQty = qty;

      if (pType === "weekly" && product.vrepeat_weekly_enabled) {
        specialPrice = product.vrepeat_weekly_price ? parseFloat(product.vrepeat_weekly_price) : regularPrice;
        totalQty = product.vrepeat_weekly_qty || qty;
      } else if (pType === "monthly" && product.vrepeat_monthly_enabled) {
        specialPrice = product.vrepeat_monthly_price ? parseFloat(product.vrepeat_monthly_price) : regularPrice;
        totalQty = product.vrepeat_monthly_qty || qty;
      }

      // Override with custom price if provided
      if (unitPrice !== undefined && unitPrice !== null) {
        const parsed = Number(unitPrice);
        if (Number.isFinite(parsed) && parsed > 0) {
          specialPrice = parsed;
        }
      }

      const discountPerUnit = Math.max(0, regularPrice - specialPrice);
      const discountAmount = discountPerUnit * totalQty;
      const totalAmount = specialPrice * totalQty;

      // Create package in transaction
      let packageId = "";
      await withTransaction(async (client) => {
        const pkgResult = await client.query(
          `INSERT INTO vrepeat_packages
            (user_id, product_id, variant_id, shop_id, seller_id, package_type,
             quantity_total, unit_price, regular_unit_price, discount_amount,
             total_amount, interval_days, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending_payment')
           RETURNING id`,
          [
            userId, productId, variantId, product.shop_id, product.seller_id,
            pType, totalQty, specialPrice, regularPrice, discountAmount,
            totalAmount, intervalDays,
          ],
        );
        packageId = pkgResult.rows[0].id;

        // Create delivery schedule
        await createDeliverySchedule(client, packageId, totalQty, intervalDays);
      });

      console.log(`[velrepeat] Package created: ${packageId} for user ${userId}, product ${product.name}, type=${pType}, qty=${totalQty}`);

      res.json({
        success: true,
        data: {
          id: packageId,
          packageType: pType,
          quantityTotal: totalQty,
          unitPrice: specialPrice,
          regularUnitPrice: regularPrice,
          discountAmount,
          totalAmount,
          intervalDays,
          status: "pending_payment",
        },
      });
    } catch (err) {
      console.error("[velrepeat] create package error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to create package" } });
    }
  });

  // ── GET /api/velrepeat/packages ─────────────────────────────────────────
  app.get("/api/velrepeat/packages", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const result = await query(
        `SELECT vp.*,
                p.name AS product_name, p.unit AS product_unit,
                sh.name AS shop_name,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url
         FROM vrepeat_packages vp
         JOIN products p ON vp.product_id = p.id
         LEFT JOIN shops sh ON vp.shop_id = sh.id
         WHERE vp.user_id = $1
         ORDER BY vp.created_at DESC`,
        [userId],
      );

      const packages = result.rows.map((r: any) => ({
        id: r.id,
        productId: r.product_id,
        productName: r.product_name,
        productUnit: r.product_unit,
        variantId: r.variant_id,
        shopId: r.shop_id,
        shopName: r.shop_name,
        packageType: r.package_type,
        quantityTotal: r.quantity_total,
        quantityDelivered: r.quantity_delivered,
        unitPrice: parseFloat(r.unit_price),
        regularUnitPrice: parseFloat(r.regular_unit_price),
        discountAmount: parseFloat(r.discount_amount),
        totalAmount: parseFloat(r.total_amount),
        currency: r.currency,
        status: r.status,
        intervalDays: r.interval_days,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        productImageUrl: r.product_image_url,
        createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
        updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
      }));

      res.json({ success: true, data: packages });
    } catch (err) {
      console.error("[velrepeat] list packages error:", err);
      res.json({ success: true, data: [] });
    }
  });

  // ── GET /api/velrepeat/packages/:packageId ──────────────────────────────
  app.get("/api/velrepeat/packages/:packageId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const packageId = param(req, "packageId");

      const result = await query(
        `SELECT vp.*,
                p.name AS product_name, p.unit AS product_unit,
                sh.name AS shop_name,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url
         FROM vrepeat_packages vp
         JOIN products p ON vp.product_id = p.id
         LEFT JOIN shops sh ON vp.shop_id = sh.id
         WHERE vp.id = $1 AND vp.user_id = $2`,
        [packageId, userId],
      );

      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Package not found" } });
        return;
      }

      const r = result.rows[0];

      // Fetch deliveries
      const deliveriesResult = await query(
        `SELECT * FROM vrepeat_deliveries WHERE package_id = $1 ORDER BY delivery_number ASC`,
        [packageId],
      );

      const deliveries = deliveriesResult.rows.map((d: any) => ({
        id: d.id,
        deliveryNumber: d.delivery_number,
        quantity: d.quantity,
        scheduledAt: d.scheduled_at,
        shippedAt: d.shipped_at,
        deliveredAt: d.delivered_at,
        status: d.status,
        trackingNumber: d.tracking_number,
        orderId: d.order_id,
        notes: d.notes,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      }));

      res.json({
        success: true,
        data: {
          id: r.id,
          productId: r.product_id,
          productName: r.product_name,
          productUnit: r.product_unit,
          variantId: r.variant_id,
          shopId: r.shop_id,
          shopName: r.shop_name,
          packageType: r.package_type,
          quantityTotal: r.quantity_total,
          quantityDelivered: r.quantity_delivered,
          unitPrice: parseFloat(r.unit_price),
          regularUnitPrice: parseFloat(r.regular_unit_price),
          discountAmount: parseFloat(r.discount_amount),
          totalAmount: parseFloat(r.total_amount),
          currency: r.currency,
          status: r.status,
          intervalDays: r.interval_days,
          startedAt: r.started_at,
          completedAt: r.completed_at,
          productImageUrl: r.product_image_url,
          deliveries,
          createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
        },
      });
    } catch (err) {
      console.error("[velrepeat] get package error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch package" } });
    }
  });

  // ── PATCH /api/velrepeat/packages/:packageId ────────────────────────────
  // Pause, resume, or cancel a package
  app.patch("/api/velrepeat/packages/:packageId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const packageId = param(req, "packageId");
      const { action } = req.body; // 'pause' | 'resume' | 'cancel'

      const validActions: Record<string, string> = {
        pause: "paused",
        resume: "active",
        cancel: "cancelled",
      };
      const targetStatus = validActions[action];
      if (!targetStatus) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid action. Use: pause, resume, cancel" } });
        return;
      }

      // Verify ownership and valid transition
      const existing = await query(
        "SELECT id, status FROM vrepeat_packages WHERE id = $1 AND user_id = $2",
        [packageId, userId],
      );
      if (existing.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Package not found" } });
        return;
      }

      const currentStatus = existing.rows[0].status;
      const transitions: Record<string, string[]> = {
        active: ["paused", "cancelled"],
        paused: ["active", "cancelled"],
      };
      if (!transitions[currentStatus]?.includes(targetStatus)) {
        res.status(400).json({ success: false, error: { code: "INVALID_TRANSITION", message: `Cannot ${action} package in '${currentStatus}' status` } });
        return;
      }

      const updates: string[] = ["status = $1", "updated_at = NOW()"];
      const values: any[] = [targetStatus];
      let idx = 2;

      if (targetStatus === "cancelled") {
        // Cancel all pending deliveries
        await query(
          "UPDATE vrepeat_deliveries SET status = 'cancelled', updated_at = NOW() WHERE package_id = $1 AND status = 'scheduled'",
          [packageId],
        );
      }
      if (targetStatus === "active" && currentStatus === "paused") {
        // Resume: set started_at if null
        updates.push(`started_at = COALESCE(started_at, NOW())`);
      }

      values.push(packageId);
      await query(
        `UPDATE vrepeat_packages SET ${updates.join(", ")} WHERE id = $${idx}`,
        values,
      );

      res.json({ success: true, data: { id: packageId, status: targetStatus } });
    } catch (err) {
      console.error("[velrepeat] update package error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update package" } });
    }
  });

  // ── GET /api/velrepeat/packages/:packageId/deliveries ───────────────────
  app.get("/api/velrepeat/packages/:packageId/deliveries", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const packageId = param(req, "packageId");

      // Verify ownership
      const pkgCheck = await query(
        "SELECT id FROM vrepeat_packages WHERE id = $1 AND user_id = $2",
        [packageId, userId],
      );
      if (pkgCheck.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Package not found" } });
        return;
      }

      const result = await query(
        "SELECT * FROM vrepeat_deliveries WHERE package_id = $1 ORDER BY delivery_number ASC",
        [packageId],
      );

      const deliveries = result.rows.map((d: any) => ({
        id: d.id,
        deliveryNumber: d.delivery_number,
        quantity: d.quantity,
        scheduledAt: d.scheduled_at,
        shippedAt: d.shipped_at,
        deliveredAt: d.delivered_at,
        status: d.status,
        trackingNumber: d.tracking_number,
        orderId: d.order_id,
        notes: d.notes,
      }));

      res.json({ success: true, data: deliveries });
    } catch (err) {
      console.error("[velrepeat] list deliveries error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch deliveries" } });
    }
  });

  // ── GET /api/seller/velrepeat/deliveries ────────────────────────────────
  // Seller sees pending deliveries for their shop
  app.get("/api/seller/velrepeat/deliveries", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const sellerResult = await query("SELECT id FROM sellers WHERE user_id = $1", [userId]);
      if (sellerResult.rows.length === 0) {
        res.json({ success: true, data: [] });
        return;
      }
      const sellerId = sellerResult.rows[0].id;

      const result = await query(
        `SELECT vd.*, vp.user_id, vp.product_id, vp.package_type,
                p.name AS product_name,
                u.name AS customer_name,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url
         FROM vrepeat_deliveries vd
         JOIN vrepeat_packages vp ON vd.package_id = vp.id
         JOIN products p ON vp.product_id = p.id
         JOIN users u ON vp.user_id = u.id
         WHERE vp.seller_id = $1 AND vd.status IN ('scheduled', 'processing')
         ORDER BY vd.scheduled_at ASC`,
        [sellerId],
      );

      const deliveries = result.rows.map((r: any) => ({
        id: r.id,
        packageId: r.package_id,
        deliveryNumber: r.delivery_number,
        quantity: r.quantity,
        scheduledAt: r.scheduled_at,
        status: r.status,
        customerName: r.customer_name,
        productName: r.product_name,
        productImageUrl: r.product_image_url,
        packageType: r.package_type,
      }));

      res.json({ success: true, data: deliveries });
    } catch (err) {
      console.error("[velrepeat] seller deliveries error:", err);
      res.json({ success: true, data: [] });
    }
  });

  // ── PATCH /api/seller/velrepeat/deliveries/:deliveryId ──────────────────
  // Seller updates delivery status
  app.patch("/api/seller/velrepeat/deliveries/:deliveryId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const deliveryId = param(req, "deliveryId");
      const { status, trackingNumber } = req.body;

      const sellerResult = await query("SELECT id FROM sellers WHERE user_id = $1", [userId]);
      if (sellerResult.rows.length === 0) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } });
        return;
      }
      const sellerId = sellerResult.rows[0].id;

      // Verify seller owns the package
      const existing = await query(
        `SELECT vd.id, vd.status, vp.seller_id
         FROM vrepeat_deliveries vd
         JOIN vrepeat_packages vp ON vd.package_id = vp.id
         WHERE vd.id = $1 AND vp.seller_id = $2`,
        [deliveryId, sellerId],
      );
      if (existing.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Delivery not found" } });
        return;
      }

      const validStatuses = ["processing", "shipped", "delivered", "failed"];
      if (!validStatuses.includes(status)) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: `Invalid status: ${status}` } });
        return;
      }

      const updates: string[] = ["status = $1", "updated_at = NOW()"];
      const values: any[] = [status];
      let idx = 2;

      if (status === "shipped" && trackingNumber) {
        updates.push(`tracking_number = $${idx++}`);
        values.push(trackingNumber);
        updates.push(`shipped_at = NOW()`);
      }
      if (status === "delivered") {
        updates.push(`delivered_at = NOW()`);
      }

      values.push(deliveryId);
      await query(
        `UPDATE vrepeat_deliveries SET ${updates.join(", ")} WHERE id = $${idx}`,
        values,
      );

      // If delivered, increment quantity_delivered on package
      if (status === "delivered") {
        const pkgResult = await query(
          "SELECT package_id FROM vrepeat_deliveries WHERE id = $1",
          [deliveryId],
        );
        if (pkgResult.rows.length > 0) {
          const pkgId = pkgResult.rows[0].package_id;
          await query(
            `UPDATE vrepeat_packages
             SET quantity_delivered = quantity_delivered + 1, updated_at = NOW()
             WHERE id = $1`,
            [pkgId],
          );

          // Check if all deliveries completed
          const pkg = await query(
            "SELECT quantity_total, quantity_delivered FROM vrepeat_packages WHERE id = $1",
            [pkgId],
          );
          if (pkg.rows.length > 0 && pkg.rows[0].quantity_delivered >= pkg.rows[0].quantity_total) {
            await query(
              "UPDATE vrepeat_packages SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1",
              [pkgId],
            );
            console.log(`[velrepeat] Package ${pkgId} completed — all deliveries fulfilled`);
          }
        }
      }

      res.json({ success: true, data: { id: deliveryId, status } });
    } catch (err) {
      console.error("[velrepeat] update delivery error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update delivery" } });
    }
  });
}
