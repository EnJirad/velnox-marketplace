/**
 * VelRepeat V2 — Recurring Plan Endpoints
 *
 * POST   /api/velrepeat/plans                     — Create a recurring plan
 * GET    /api/velrepeat/plans                     — List user's plans (+items)
 * GET    /api/velrepeat/plans/:planId             — Plan detail
 * PATCH  /api/velrepeat/plans/:planId             — Update frequency/items/address
 * POST   /api/velrepeat/plans/:planId/pause       — Pause a plan
 * POST   /api/velrepeat/plans/:planId/resume      — Resume a plan
 * POST   /api/velrepeat/plans/:planId/cancel      — Cancel a plan
 * POST   /api/velrepeat/plans/:planId/run-now     — Trigger next run immediately
 * GET    /api/velrepeat/plans/:planId/runs        — Run history
 * POST   /api/velrepeat/repeat-now                — Create a plan from a past order
 * GET    /api/seller/velrepeat/overview           — Seller recurring stats
 * GET    /api/admin/velrepeat/overview            — Center monitoring stats
 *
 * All customer endpoints are ownership-scoped (user_id = authenticated user).
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query, withTransaction } from "../db/index.js";
import { VALID_FREQUENCIES, calculateNextRunAt, processPlan } from "../jobs/velrepeat-scheduler.js";
import type { FrequencyType } from "../jobs/velrepeat-scheduler.js";

function param(req: Request, key: string): string {
  return (req.params as Record<string, string>)[key] ?? "";
}

interface PlanItemInput {
  productId?: unknown;
  variantId?: unknown;
  quantity?: unknown;
}

function toQty(v: unknown): number {
  return Math.max(1, Math.floor(Number(v) || 1));
}

/** Copy a user's address row into the JSONB snapshot shape used by orders. */
function addressSnapshot(a: any): Record<string, unknown> | null {
  if (!a) return null;
  return {
    label: a.label || "Home",
    recipientName: a.recipient_name || "",
    phone: a.phone || "",
    line1: a.line1 || "",
    line2: a.line2 || null,
    subdistrict: a.subdistrict || a.city || null,
    district: a.district || null,
    province: a.state || null,
    postalCode: a.postal_code || null,
    country: a.country || "TH",
  };
}

/** Validate one plan item input against live product/variant state. */
async function resolvePlanItem(input: PlanItemInput, planUserId: string): Promise<{ ok: true; item: any } | { ok: false; code: string; message: string }> {
  if (!input || typeof input.productId !== "string" || !input.productId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "items[].productId is required" };
  }
  const productId = input.productId;
  const qty = toQty(input.quantity);
  const variantId = input.variantId && typeof input.variantId === "string" ? input.variantId : null;

  const prodRes = await query(
    `SELECT p.id, p.name, p.price, p.status, p.vrepeat_enabled,
            p.vrepeat_min_qty, p.vrepeat_max_qty,
            p.shop_id, sh.seller_id
     FROM products p
     JOIN shops sh ON p.shop_id = sh.id
     WHERE p.id = $1`,
    [productId],
  );
  if (prodRes.rows.length === 0) {
    return { ok: false, code: "NOT_FOUND", message: `Product ${productId} not found` };
  }
  const product = prodRes.rows[0];
  if (product.status !== "published") {
    return { ok: false, code: "VALIDATION_ERROR", message: `Product "${product.name}" is not available` };
  }
  if (!product.vrepeat_enabled) {
    return { ok: false, code: "VALIDATION_ERROR", message: `Product "${product.name}" does not support VelRepeat` };
  }
  const minQty = product.vrepeat_min_qty != null ? Number(product.vrepeat_min_qty) : 1;
  const maxQty = product.vrepeat_max_qty != null ? Number(product.vrepeat_max_qty) : 999;
  if (qty < minQty || qty > maxQty) {
    return {
      ok: false, code: "VALIDATION_ERROR",
      message: `Quantity for "${product.name}" must be between ${minQty} and ${maxQty}`,
    };
  }

  let variant = null;
  let price = parseFloat(product.price);
  let stock = 999;
  if (variantId) {
    const vRes = await query(
      `SELECT id, price, stock, status, product_id, name, sku
       FROM product_variants WHERE id = $1`,
      [variantId],
    );
    if (vRes.rows.length === 0 || vRes.rows[0].product_id !== productId) {
      return { ok: false, code: "VALIDATION_ERROR", message: "Variant does not belong to this product" };
    }
    variant = vRes.rows[0];
    if (variant.status !== "active") {
      return { ok: false, code: "VALIDATION_ERROR", message: `Variant "${variant.name}" is not available` };
    }
    price = parseFloat(variant.price);
    stock = variant.stock;
  } else {
    const invRes = await query(
      `SELECT quantity, reserved FROM inventory WHERE product_id = $1`,
      [productId],
    );
    const inv = invRes.rows[0];
    stock = inv ? inv.quantity - inv.reserved : 999;
  }
  if (stock < qty) {
    return { ok: false, code: "INSUFFICIENT_STOCK", message: `Insufficient stock for "${product.name}"` };
  }

  return {
    ok: true,
    item: {
      productId,
      variantId,
      quantity: qty,
      unitPrice: price,
      shopId: product.shop_id,
      sellerId: product.seller_id,
      productName: product.name,
      // Unused here but kept for validation logging
      _userId: planUserId,
    },
  };
}

function formatPlan(r: any, items: any[] = []): Record<string, unknown> {
  return {
    id: r.id,
    status: r.status,
    frequencyType: r.frequency_type,
    intervalValue: r.interval_value,
    nextRunAt: r.next_run_at ? new Date(r.next_run_at).getTime() : null,
    startedAt: r.started_at ? new Date(r.started_at).getTime() : null,
    endedAt: r.ended_at ? new Date(r.ended_at).getTime() : null,
    shippingAddressId: r.shipping_address_id,
    shippingAddress: r.shipping_address ? (typeof r.shipping_address === "string" ? JSON.parse(r.shipping_address) : r.shipping_address) : null,
    paymentMethod: r.payment_method,
    currency: r.currency,
    timezone: r.timezone,
    notes: r.notes,
    items: items.map((i: any) => ({
      id: i.id,
      productId: i.product_id,
      productName: i.product_name,
      variantId: i.variant_id,
      variantName: i.variant_name,
      variantOptionLabels: i.variant_option_labels || null,
      shopId: i.shop_id,
      shopName: i.shop_name,
      quantity: i.quantity,
      unitPrice: parseFloat(i.unit_price),
      productImageUrl: i.image_url,
    })),
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
  };
}

const PLAN_ITEM_QUERY = `
  SELECT vi.*,
         p.name AS product_name, p.unit AS product_unit,
         sh.name AS shop_name,
         pv.name AS variant_name,
         COALESCE(
           (SELECT string_agg(pov.label, ' / ' ORDER BY pog.sort_order)
            FROM product_variant_values pvv
            JOIN product_option_values pov ON pvv.option_value_id = pov.id
            JOIN product_option_groups pog ON pov.option_group_id = pog.id
            WHERE pvv.variant_id = vi.variant_id), ''
         ) AS variant_option_labels,
         (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS image_url
  FROM velrepeat_items vi
  JOIN products p ON vi.product_id = p.id
  LEFT JOIN shops sh ON vi.shop_id = sh.id
  LEFT JOIN product_variants pv ON vi.variant_id = pv.id
`;

export function setupVelRepeatPlanRoutes(app: Express): void {

  // ── POST /api/velrepeat/plans ─────────────────────────────────────────
  app.post("/api/velrepeat/plans", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const {
        items,
        frequencyType = "days",
        intervalValue = 30,
        shippingAddressId = null,
        paymentMethod = "cod",
        notes = null,
      } = req.body as {
        items?: PlanItemInput[];
        frequencyType?: string;
        intervalValue?: number;
        shippingAddressId?: string | null;
        paymentMethod?: string;
        notes?: string | null;
      };

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "items is required" } });
        return;
      }
      if (!VALID_FREQUENCIES.includes(frequencyType as FrequencyType)) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "frequencyType must be days | weeks | months" } });
        return;
      }
      const interval = Math.max(1, Math.floor(Number(intervalValue) || 30));
      if (paymentMethod !== "cod") {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Only paymentMethod 'cod' is supported for recurring plans" } });
        return;
      }

      // Resolve + validate every item (server-side prices only)
      const resolved: any[] = [];
      for (const input of items) {
        const r = await resolvePlanItem(input, userId);
        if (!r.ok) {
          res.status(400).json({ success: false, error: { code: r.code, message: r.message } });
          return;
        }
        resolved.push(r.item);
      }

      // Shipping address must belong to the user; snapshot it for runs
      let shippingSnapshot: Record<string, unknown> | null = null;
      if (shippingAddressId) {
        const addrRes = await query(
          `SELECT label, recipient_name, phone, line1, line2, subdistrict, district, state, postal_code, country
           FROM addresses WHERE id = $1 AND user_id = $2`,
          [shippingAddressId, userId],
        );
        if (addrRes.rows.length === 0) {
          res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Shipping address not found" } });
          return;
        }
        shippingSnapshot = addressSnapshot(addrRes.rows[0]);
      }

      const now = new Date();
      const nextRunAt = calculateNextRunAt(now, frequencyType as FrequencyType, interval);

      let planId = "";
      await withTransaction(async (client) => {
        const planRes = await client.query(
          `INSERT INTO velrepeat_plans
             (user_id, status, frequency_type, interval_value, next_run_at,
              shipping_address_id, shipping_address, payment_method, notes)
           VALUES ($1, 'active', $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [userId, frequencyType, interval, nextRunAt.toISOString(),
           shippingAddressId || null, shippingSnapshot ? JSON.stringify(shippingSnapshot) : null,
           paymentMethod, notes || null],
        );
        planId = planRes.rows[0].id as string;

        for (const item of resolved) {
          await client.query(
            `INSERT INTO velrepeat_items (plan_id, product_id, variant_id, shop_id, seller_id, quantity, unit_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [planId, item.productId, item.variantId, item.shopId, item.sellerId, item.quantity, item.unitPrice],
          );
        }
        await client.query(
          `INSERT INTO velrepeat_events (plan_id, event_type, metadata)
           VALUES ($1, 'PLAN_CREATED', $2)`,
          [planId, JSON.stringify({ items: resolved.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })) })],
        );
      });

      console.log(`[velrepeat] plan created: ${planId} user=${userId} freq=${frequencyType}/${interval} items=${resolved.length} next=${nextRunAt.toISOString()}`);
      res.json({
        success: true,
        data: {
          id: planId,
          status: "active",
          frequencyType,
          intervalValue: interval,
          nextRunAt: nextRunAt.getTime(),
          items: resolved.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity, unitPrice: i.unitPrice, productName: i.productName })),
        },
      });
    } catch (err) {
      console.error("[velrepeat] create plan error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to create plan" } });
    }
  });

  // ── GET /api/velrepeat/plans ──────────────────────────────────────────
  app.get("/api/velrepeat/plans", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const plansRes = await query(
        `SELECT * FROM velrepeat_plans WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      const plans: any[] = [];
      for (const r of plansRes.rows) {
        const itemsRes = await query(`${PLAN_ITEM_QUERY} WHERE vi.plan_id = $1 ORDER BY vi.created_at ASC`, [r.id]);
        const lastRunRes = await query(
          `SELECT status, scheduled_for, completed_at, error_message FROM velrepeat_runs
           WHERE plan_id = $1 ORDER BY scheduled_for DESC LIMIT 1`,
          [r.id],
        );
        plans.push({
          ...formatPlan(r, itemsRes.rows),
          lastRun: lastRunRes.rows[0] ? {
            status: lastRunRes.rows[0].status,
            scheduledFor: lastRunRes.rows[0].scheduled_for,
            completedAt: lastRunRes.rows[0].completed_at,
            errorMessage: lastRunRes.rows[0].error_message,
          } : null,
        });
      }
      res.json({ success: true, data: plans });
    } catch (err) {
      console.error("[velrepeat] list plans error:", err);
      res.json({ success: true, data: [] });
    }
  });

  // ── GET /api/velrepeat/plans/:planId ──────────────────────────────────
  app.get("/api/velrepeat/plans/:planId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const planId = param(req, "planId");
      const planRes = await query(
        `SELECT * FROM velrepeat_plans WHERE id = $1 AND user_id = $2`,
        [planId, userId],
      );
      if (planRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Plan not found" } });
        return;
      }
      const r = planRes.rows[0];
      const itemsRes = await query(`${PLAN_ITEM_QUERY} WHERE vi.plan_id = $1 ORDER BY vi.created_at ASC`, [planId]);
      res.json({ success: true, data: formatPlan(r, itemsRes.rows) });
    } catch (err) {
      console.error("[velrepeat] get plan error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch plan" } });
    }
  });

  // ── PATCH /api/velrepeat/plans/:planId ────────────────────────────────
  app.patch("/api/velrepeat/plans/:planId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const planId = param(req, "planId");
      const { frequencyType, intervalValue, items, shippingAddressId, notes } = req.body as {
        frequencyType?: string;
        intervalValue?: number;
        items?: PlanItemInput[];
        shippingAddressId?: string | null;
        notes?: string | null;
      };

      const planRes = await query(
        `SELECT id, status FROM velrepeat_plans WHERE id = $1 AND user_id = $2`,
        [planId, userId],
      );
      if (planRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Plan not found" } });
        return;
      }
      const plan = planRes.rows[0];
      if (!["active", "paused", "out_of_stock"].includes(plan.status)) {
        res.status(400).json({ success: false, error: { code: "INVALID_TRANSITION", message: `Cannot edit a plan in '${plan.status}' status` } });
        return;
      }

      let freq: FrequencyType | null = null;
      let interval = 0;
      if (frequencyType !== undefined || intervalValue !== undefined) {
        freq = (frequencyType || plan.frequency_type) as FrequencyType;
        if (!VALID_FREQUENCIES.includes(freq)) {
          res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "frequencyType must be days | weeks | months" } });
          return;
        }
        interval = Math.max(1, Math.floor(Number(intervalValue) || plan.interval_value));
      }

      let resolved: any[] | null = null;
      if (items !== undefined) {
        if (!Array.isArray(items) || items.length === 0) {
          res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "items must be a non-empty array" } });
          return;
        }
        resolved = [];
        for (const input of items) {
          const r = await resolvePlanItem(input, userId);
          if (!r.ok) {
            res.status(400).json({ success: false, error: { code: r.code, message: r.message } });
            return;
          }
          resolved.push(r.item);
        }
      }

      let shippingSnapshot: Record<string, unknown> | null | undefined = undefined;
      if (shippingAddressId !== undefined) {
        if (shippingAddressId) {
          const addrRes = await query(
            `SELECT label, recipient_name, phone, line1, line2, subdistrict, district, state, postal_code, country
             FROM addresses WHERE id = $1 AND user_id = $2`,
            [shippingAddressId, userId],
          );
          if (addrRes.rows.length === 0) {
            res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Shipping address not found" } });
            return;
          }
          shippingSnapshot = addressSnapshot(addrRes.rows[0]);
        } else {
          shippingSnapshot = null;
        }
      }

      await withTransaction(async (client) => {
        const updates: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (freq && interval > 0) {
          updates.push(`frequency_type = $${idx++}`, `interval_value = $${idx++}`);
          values.push(freq, interval);
          // Reschedule from now (deterministic — keeps phase predictable)
          const nextRunAt = calculateNextRunAt(new Date(), freq, interval);
          updates.push(`next_run_at = $${idx++}`);
          values.push(nextRunAt.toISOString());
        }
        if (resolved) {
          await client.query(`DELETE FROM velrepeat_items WHERE plan_id = $1`, [planId]);
          for (const item of resolved) {
            await client.query(
              `INSERT INTO velrepeat_items (plan_id, product_id, variant_id, shop_id, seller_id, quantity, unit_price)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [planId, item.productId, item.variantId, item.shopId, item.sellerId, item.quantity, item.unitPrice],
            );
          }
        }
        if (shippingSnapshot !== undefined) {
          updates.push(`shipping_address_id = $${idx++}`, `shipping_address = $${idx++}`);
          values.push(shippingAddressId || null, shippingSnapshot ? JSON.stringify(shippingSnapshot) : null);
        }
        if (notes !== undefined) {
          updates.push(`notes = $${idx++}`);
          values.push(notes || null);
        }
        if (updates.length > 0) {
          updates.push(`updated_at = NOW()`);
          values.push(planId);
          await client.query(`UPDATE velrepeat_plans SET ${updates.join(", ")} WHERE id = $${idx}`, values);
        }
        await client.query(
          `INSERT INTO velrepeat_events (plan_id, event_type, metadata) VALUES ($1, 'PLAN_UPDATED', $2)`,
          [planId, JSON.stringify({ frequencyType: freq, intervalValue: interval, itemsChanged: !!resolved })],
        );
      });

      res.json({ success: true, data: { id: planId, updated: true } });
    } catch (err) {
      console.error("[velrepeat] update plan error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update plan" } });
    }
  });

  // ── POST /api/velrepeat/plans/:planId/pause | resume | cancel ─────────
  const transition = (action: "pause" | "resume" | "cancel") => async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const planId = param(req, "planId");

      const planRes = await query(
        `SELECT id, status, next_run_at FROM velrepeat_plans WHERE id = $1 AND user_id = $2`,
        [planId, userId],
      );
      if (planRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Plan not found" } });
        return;
      }
      const plan = planRes.rows[0];
      const allowed: Record<string, string[]> = {
        pause: ["active", "out_of_stock"],
        resume: ["paused"],
        cancel: ["active", "paused", "out_of_stock"],
      };
      const allowedFor = allowed[action];
      if (!allowedFor || !allowedFor.includes(plan.status)) {
        res.status(400).json({ success: false, error: { code: "INVALID_TRANSITION", message: `Cannot ${action} a plan in '${plan.status}' status` } });
        return;
      }

      if (action === "pause") {
        await query(
          `UPDATE velrepeat_plans SET status = 'paused', updated_at = NOW() WHERE id = $1`,
          [planId],
        );
        await query(
          `INSERT INTO velrepeat_events (plan_id, event_type) VALUES ($1, 'PLAN_PAUSED')`,
          [planId],
        );
      } else if (action === "resume") {
        // Never resume into the past — process from now onward
        await query(
          `UPDATE velrepeat_plans
           SET status = 'active',
               next_run_at = GREATEST(next_run_at, NOW()),
               updated_at = NOW()
           WHERE id = $1`,
          [planId],
        );
        await query(
          `INSERT INTO velrepeat_events (plan_id, event_type) VALUES ($1, 'PLAN_RESUMED')`,
          [planId],
        );
      } else {
        await query(
          `UPDATE velrepeat_plans SET status = 'cancelled', ended_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [planId],
        );
        await query(
          `INSERT INTO velrepeat_events (plan_id, event_type) VALUES ($1, 'PLAN_CANCELLED')`,
          [planId],
        );
      }

      res.json({ success: true, data: { id: planId, status: action === "pause" ? "paused" : action === "resume" ? "active" : "cancelled" } });
    } catch (err) {
      console.error(`[velrepeat] ${action} plan error:`, err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: `Failed to ${action} plan` } });
    }
  };
  app.post("/api/velrepeat/plans/:planId/pause", requireAuth, transition("pause"));
  app.post("/api/velrepeat/plans/:planId/resume", requireAuth, transition("resume"));
  app.post("/api/velrepeat/plans/:planId/cancel", requireAuth, transition("cancel"));

  // ── POST /api/velrepeat/plans/:planId/run-now ─────────────────────────
  // Trigger the next run immediately (used for testing + manual re-order).
  app.post("/api/velrepeat/plans/:planId/run-now", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const planId = param(req, "planId");
      const planRes = await query(
        `SELECT id, status FROM velrepeat_plans WHERE id = $1 AND user_id = $2`,
        [planId, userId],
      );
      if (planRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Plan not found" } });
        return;
      }
      const plan = planRes.rows[0];
      if (plan.status !== "active" && plan.status !== "out_of_stock") {
        res.status(400).json({ success: false, error: { code: "INVALID_TRANSITION", message: `Cannot run a plan in '${plan.status}' status` } });
        return;
      }
      // Make it due now — processPlan claims + locks + idempotency-protects.
      await query(
        `UPDATE velrepeat_plans SET next_run_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [planId],
      );
      const outcome = await processPlan(planId);
      res.json({ success: true, data: { id: planId, runStatus: outcome } });
    } catch (err) {
      console.error("[velrepeat] run-now error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to trigger run" } });
    }
  });

  // ── GET /api/velrepeat/plans/:planId/runs ─────────────────────────────
  app.get("/api/velrepeat/plans/:planId/runs", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const planId = param(req, "planId");
      const planRes = await query(
        `SELECT id FROM velrepeat_plans WHERE id = $1 AND user_id = $2`,
        [planId, userId],
      );
      if (planRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Plan not found" } });
        return;
      }
      const runsRes = await query(
        `SELECT vr.*, o.order_number
         FROM velrepeat_runs vr
         LEFT JOIN orders o ON vr.order_id = o.id
         WHERE vr.plan_id = $1
         ORDER BY vr.scheduled_for DESC`,
        [planId],
      );
      const runs = runsRes.rows.map((r: any) => ({
        id: r.id,
        scheduledFor: r.scheduled_for,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        status: r.status,
        orderId: r.order_id,
        errorCode: r.error_code,
        errorMessage: r.error_message,
        metadata: r.metadata,
      }));
      res.json({ success: true, data: runs });
    } catch (err) {
      console.error("[velrepeat] runs error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch runs" } });
    }
  });

  // ── POST /api/velrepeat/repeat-now ────────────────────────────────────
  // Create a recurring plan from a past order's items.
  app.post("/api/velrepeat/repeat-now", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { orderId, frequencyType = "days", intervalValue = 30 } = req.body as {
        orderId?: string;
        frequencyType?: string;
        intervalValue?: number;
      };

      if (!orderId || typeof orderId !== "string") {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "orderId is required" } });
        return;
      }
      if (!VALID_FREQUENCIES.includes(frequencyType as FrequencyType)) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "frequencyType must be days | weeks | months" } });
        return;
      }
      const interval = Math.max(1, Math.floor(Number(intervalValue) || 30));

      const orderRes = await query(
        `SELECT id, status FROM orders WHERE id = $1 AND user_id = $2`,
        [orderId, userId],
      );
      if (orderRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Order not found" } });
        return;
      }
      const order = orderRes.rows[0];
      if (["cancelled", "payment_failed"].includes(order.status)) {
        res.status(400).json({ success: false, error: { code: "INVALID_TRANSITION", message: `Cannot repeat an order in '${order.status}' status` } });
        return;
      }

      const itemsRes = await query(
        `SELECT product_id, variant_id, quantity, price FROM order_items WHERE order_id = $1`,
        [orderId],
      );
      if (itemsRes.rows.length === 0) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Order has no items" } });
        return;
      }

      // Reuse plan-item validation (prices are re-resolved server-side)
      const resolved: any[] = [];
      const blocked: string[] = [];
      for (const oi of itemsRes.rows) {
        const r = await resolvePlanItem({ productId: oi.product_id, variantId: oi.variant_id, quantity: oi.quantity }, userId);
        if (r.ok) resolved.push(r.item);
        else blocked.push(r.message);
      }
      if (resolved.length === 0) {
        res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: blocked.join("; ") || "No items can be repeated" },
        });
        return;
      }

      const now = new Date();
      const nextRunAt = calculateNextRunAt(now, frequencyType as FrequencyType, interval);
      let planId = "";
      await withTransaction(async (client) => {
        const planRes = await client.query(
          `INSERT INTO velrepeat_plans (user_id, status, frequency_type, interval_value, next_run_at)
           VALUES ($1, 'active', $2, $3, $4) RETURNING id`,
          [userId, frequencyType, interval, nextRunAt.toISOString()],
        );
        planId = planRes.rows[0].id as string;
        for (const item of resolved) {
          await client.query(
            `INSERT INTO velrepeat_items (plan_id, product_id, variant_id, shop_id, seller_id, quantity, unit_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [planId, item.productId, item.variantId, item.shopId, item.sellerId, item.quantity, item.unitPrice],
          );
        }
        await client.query(
          `INSERT INTO velrepeat_events (plan_id, event_type, metadata)
           VALUES ($1, 'PLAN_CREATED_FROM_ORDER', $2)`,
          [planId, JSON.stringify({ orderId, blocked })],
        );
      });

      res.json({
        success: true,
        data: { id: planId, status: "active", frequencyType, intervalValue: interval, nextRunAt: nextRunAt.getTime(), blocked },
      });
    } catch (err) {
      console.error("[velrepeat] repeat-now error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to create repeat plan" } });
    }
  });

  // ── GET /api/seller/velrepeat/overview ────────────────────────────────
  app.get("/api/seller/velrepeat/overview", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const sellerRes = await query("SELECT id FROM sellers WHERE user_id = $1", [userId]);
      if (sellerRes.rows.length === 0) {
        res.json({ success: true, data: { recurringOrders: 0, activePlans: 0, recentRuns: [] } });
        return;
      }
      const sellerId = sellerRes.rows[0].id as string;
      const empty = { success: true, data: { recurringOrders: 0, activePlans: 0, recentRuns: [] } };
      let stats: { orders: any; plans: any; runs: any } | null = null;
      try {
        const [o, p, r] = await Promise.all([
          query(
            `SELECT COUNT(*)::int AS count FROM orders o
             WHERE o.velrepeat_run_id IS NOT NULL AND o.shop_id IN (SELECT id FROM shops WHERE seller_id = $1)`,
            [sellerId],
          ),
          query(
            `SELECT COUNT(DISTINCT vi.plan_id)::int AS count FROM velrepeat_items vi
             JOIN velrepeat_plans vp ON vi.plan_id = vp.id
             WHERE vi.seller_id = $1 AND vp.status = 'active'`,
            [sellerId],
          ),
          query(
            `SELECT vr.id, vr.status, vr.scheduled_for, vr.completed_at, vr.error_message,
                    o.id AS order_id, o.total_amount, p.name AS product_name
             FROM velrepeat_runs vr
             JOIN orders o ON vr.order_id = o.id
             JOIN order_items oi ON oi.order_id = o.id
             JOIN products p ON oi.product_id = p.id
             WHERE o.shop_id IN (SELECT id FROM shops WHERE seller_id = $1)
             ORDER BY vr.scheduled_for DESC LIMIT 20`,
            [sellerId],
          ),
        ]);
        stats = { orders: o, plans: p, runs: r };
      } catch (tblErr: any) {
        if (tblErr?.code === "42P01" || String(tblErr?.message ?? "").includes("does not exist")) {
          res.json(empty);
          return;
        }
        throw tblErr;
      }
      res.json({
        success: true,
        data: {
          recurringOrders: stats?.orders.rows[0]?.count ?? 0,
          activePlans: stats?.plans.rows[0]?.count ?? 0,
          recentRuns: (stats?.runs.rows ?? []).map((r: any) => ({
            id: r.id, status: r.status, scheduledFor: r.scheduled_for, completedAt: r.completed_at,
            orderId: r.order_id, total: parseFloat(r.total_amount), productName: r.product_name,
            errorMessage: r.error_message,
          })),
        },
      });
    } catch (err) {
      console.error("[velrepeat] seller overview error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch seller overview" } });
    }
  });

  // ── GET /api/admin/velrepeat/overview ─────────────────────────────────
  app.get("/api/admin/velrepeat/overview", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const userRes = await query(`SELECT role FROM users WHERE id = $1`, [userId]);
      const role = userRes.rows[0]?.role;
      if (!["owner", "admin", "staff"].includes(role)) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Admin access required" } });
        return;
      }
      const [plans, runs, failed, outOfStock, revenue] = await Promise.all([
        query(`SELECT status, COUNT(*)::int AS count FROM velrepeat_plans GROUP BY status`),
        query(`SELECT COUNT(*)::int AS count FROM velrepeat_runs WHERE status = 'success'`),
        query(`SELECT COUNT(*)::int AS count FROM velrepeat_runs WHERE status IN ('payment_failed', 'failed')`),
        query(`SELECT COUNT(*)::int AS count FROM velrepeat_runs WHERE status = 'out_of_stock'`),
        query(
          `SELECT COALESCE(SUM(o.total_amount), 0)::float AS total FROM orders o
           WHERE o.velrepeat_run_id IS NOT NULL AND o.status IN ('paid', 'pending', 'completed', 'delivered')`,
        ),
      ]);
      res.json({
        success: true,
        data: {
          plansByStatus: Object.fromEntries(plans.rows.map((r: any) => [r.status, r.count])),
          successRuns: runs.rows[0]?.count ?? 0,
          failedRuns: failed.rows[0]?.count ?? 0,
          outOfStockRuns: outOfStock.rows[0]?.count ?? 0,
          recurringRevenue: revenue.rows[0]?.total ?? 0,
        },
      });
    } catch (err) {
      console.error("[velrepeat] admin overview error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch admin overview" } });
    }
  });
}