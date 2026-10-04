/**
 * VelRepeat V2 — customer plan STATUS.
 *
 *   GET /api/velrepeat/v2/plans/:planId — the plan, its prepaid total, its
 *   cycle schedule and the orders each cycle produced.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The write side of V2 is complete (create a draft plan, pay for it, and the
 * webhook activates it and mints cycles), but the read side did not exist: there
 * was NO way for a customer to see what became of their plan. The storefront
 * had nothing to poll after Stripe returned it, so "did my payment land?" could
 * only be answered by the customer refreshing a page that showed a draft
 * forever.
 *
 * This closes that gap with the SAME authority the write path uses:
 *
 *   • the plan is read through `user_id` in the WHERE, so another account's plan
 *     id is indistinguishable from one that does not exist;
 *   • plan status is the SERVER's value. A returned-from-Stripe browser is never
 *     treated as proof of payment — it polls this and renders whatever the server
 *     says, which is `draft` until the webhook has actually settled;
 *   • money comes from the FROZEN pricing snapshot the plan was charged against,
 *     never from today's product prices;
 *   • cycles come from `readPlanCycles`, the same reader the scheduler uses, and
 *     each cycle's orders are returned with their public order number so the
 *     customer can open the real order, and its real tracking, per shop.
 *
 * It also carries the two LIST reads the storefront needs to be usable at all:
 *
 *   GET /api/velrepeat/v2/packages — every package the customer may buy, read
 *     from the real tables. There was no list endpoint at all, so the only V2
 *     package id a customer could obtain was one somebody typed in.
 *   GET /api/velrepeat/v2/plans — the caller's own plans, newest first, so a
 *     returning customer finds the plan they already paid for.
 */
import type { Express, Request, Response } from "express";

import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";
import { readPlanCycles } from "../lib/velrepeat-cycles.js";
import { VELREPEAT_CURRENCY } from "../lib/velrepeat-pricing.js";
import { isUuid } from "./velrepeat-v2-plans.js";

/** The plan status vocabulary the customer UI may render. */
export const CUSTOMER_VISIBLE_PLAN_STATUSES = [
  "draft",
  "active",
  "paused",
  "processing",
  "payment_failed",
  "out_of_stock",
  "item_unavailable",
  "price_changed",
  "cancelled",
  "completed",
] as const;

export function setupVelRepeatV2StatusRoutes(app: Express): void {
  // ── GET /api/velrepeat/v2/packages ─────────────────────────────────────
  // WHAT MAY BE BOUGHT. The same purchasability rule the single-package read
  // proves (`is_active`, `published` products, `active` variants, an owned shop)
  // is applied here in ONE query, so the list can never offer something the
  // purchase endpoint would refuse — and the price shown is the SUM of the
  // package's lines, a PREVIEW of one cycle only. The authoritative commitment
  // price is computed server-side when the plan is created.
  app.get("/api/velrepeat/v2/packages", requireAuth, async (_req: Request, res: Response) => {
    try {
      const rows = await query(
        `SELECT pkg.id, pkg.name, pkg.description,
                (SELECT COUNT(*)::int FROM velrepeat_package_items i
                  WHERE i.package_id = pkg.id) AS item_count,
                (SELECT COUNT(DISTINCT p.shop_id)::int
                   FROM velrepeat_package_items i
                   JOIN products p ON p.id = i.product_id
                  WHERE i.package_id = pkg.id) AS shop_count,
                (SELECT COALESCE(SUM(i.quantity * p.price), 0)::text
                   FROM velrepeat_package_items i
                   JOIN products p ON p.id = i.product_id
                  WHERE i.package_id = pkg.id) AS preview_cycle_price,
                (SELECT url FROM product_images pi
                   JOIN velrepeat_package_items i ON i.product_id = pi.product_id
                  WHERE i.package_id = pkg.id
                  ORDER BY i.id ASC, pi.sort_order ASC, pi.id ASC
                  LIMIT 1) AS image_url
           FROM velrepeat_packages pkg
          WHERE pkg.is_active = TRUE
            AND EXISTS (
              SELECT 1
                FROM velrepeat_package_items i
                JOIN products p ON p.id = i.product_id AND p.status = 'published'
                JOIN shops sh ON sh.id = p.shop_id
                LEFT JOIN product_variants v ON v.id = i.variant_id
               WHERE i.package_id = pkg.id
                 AND (i.variant_id IS NULL OR v.status = 'active')
            )
          ORDER BY pkg.created_at DESC, pkg.id ASC`,
      );

      res.json({
        success: true,
        data: (rows.rows as Array<Record<string, unknown>>).map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description ?? null,
          itemCount: r.item_count,
          shopCount: r.shop_count,
          // A PREVIEW of one delivery cycle, in the platform currency. The
          // commitment price the customer is actually charged is computed and
          // frozen server-side at purchase time.
          previewCyclePrice: r.preview_cycle_price,
          currency: VELREPEAT_CURRENCY,
          imageUrl: r.image_url ?? null,
        })),
      });
    } catch (err) {
      console.error("[velrepeat-v2] package list error:", err instanceof Error ? err.message : "unknown");
      res.status(500).json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Could not load packages" },
      });
    }
  });

  // ── GET /api/velrepeat/v2/plans ────────────────────────────────────────
  // The caller's own plans. Scoped by `user_id` in the WHERE for the same
  // reason as the single read: another account's plan id must resolve to
  // nothing, never to a 403 that confirms it exists.
  app.get("/api/velrepeat/v2/plans", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const rows = await query(
        `SELECT p.id, p.status, p.frequency_type, p.interval_value,
                p.commitment_cycles, p.next_run_at, p.currency, p.created_at,
                snap.total_amount, snap.cycle_price,
                (SELECT metadata->>'package_id' FROM velrepeat_pricing_snapshots s2
                  WHERE s2.plan_id = p.id ORDER BY s2.created_at DESC LIMIT 1) AS package_id,
                (SELECT name FROM velrepeat_packages pk WHERE pk.id = (
                    SELECT metadata->>'package_id' FROM velrepeat_pricing_snapshots s3
                     WHERE s3.plan_id = p.id ORDER BY s3.created_at DESC LIMIT 1)) AS package_name,
                (SELECT COUNT(*)::int FROM velrepeat_cycles c WHERE c.plan_id = p.id) AS cycle_count,
                (SELECT status FROM payments pay WHERE pay.plan_id = p.id
                  ORDER BY pay.created_at DESC LIMIT 1) AS payment_status
           FROM velrepeat_plans p
           LEFT JOIN LATERAL (
             SELECT total_amount, cycle_price
               FROM velrepeat_pricing_snapshots s
              WHERE s.plan_id = p.id
              ORDER BY s.created_at DESC
              LIMIT 1
           ) snap ON TRUE
          WHERE p.user_id = $1
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT 50`,
        [userId],
      );

      res.json({
        success: true,
        data: (rows.rows as Array<Record<string, unknown>>).map((r) => ({
          id: r.id,
          status: r.status,
          frequencyType: r.frequency_type,
          intervalValue: r.interval_value,
          commitmentCycles: r.commitment_cycles,
          nextRunAt: r.next_run_at,
          currency: r.currency,
          createdAt: r.created_at,
          packageId: r.package_id ?? null,
          packageName: r.package_name ?? null,
          cyclePrice: r.cycle_price ?? null,
          totalPrepaidAmount: r.total_amount ?? null,
          cycleCount: r.cycle_count,
          paymentStatus: r.payment_status ?? null,
        })),
      });
    } catch (err) {
      console.error("[velrepeat-v2] plan list error:", err instanceof Error ? err.message : "unknown");
      res.status(500).json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Could not load plans" },
      });
    }
  });

  // ── GET /api/velrepeat/v2/plans/:planId ────────────────────────────────
  app.get("/api/velrepeat/v2/plans/:planId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const planId = String(req.params.planId ?? "");
      if (!isUuid(planId)) {
        res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "planId must be a UUID" },
        });
        return;
      }

      // ── The plan, scoped to its owner ───────────────────────────────────
      // `user_id = $2` inside the WHERE is the authorization: a plan id from
      // another account simply does not match, so the answer is the same 404
      // an unknown id gets and existence is never confirmed.
      const planResult = await query(
        `SELECT p.id, p.status, p.frequency_type, p.interval_value,
                p.commitment_cycles, p.next_run_at, p.started_at, p.ended_at,
                p.currency, p.payment_method, p.created_at,
                (SELECT COUNT(*)::int FROM velrepeat_cycles c WHERE c.plan_id = p.id) AS cycle_count,
                (SELECT COUNT(*)::int FROM velrepeat_cycles c
                  WHERE c.plan_id = p.id AND c.status = 'scheduled') AS pending_cycle_count
           FROM velrepeat_plans p
          WHERE p.id = $1 AND p.user_id = $2`,
        [planId, userId],
      );
      const plan = planResult.rows[0];
      if (!plan) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Plan not found" },
        });
        return;
      }

      // ── The money the customer actually committed to ───────────────────
      // Read from the FROZEN snapshot the plan was charged against, so a price
      // change in the catalog after purchase can never rewrite history here.
      const snapshotResult = await query(
        `SELECT total_amount, cycle_price, discount_amount, currency, created_at,
                -- base_price is recorded in the snapshot's metadata JSONB (that
                -- is where the pricing engine writes it), not as a column.
                -- discount_value IS the effective discount percent column.
                metadata->>'base_price' AS base_price,
                discount_value AS effective_discount_percent,
                metadata->>'package_id' AS package_id
           FROM velrepeat_pricing_snapshots
          WHERE plan_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [planId],
      );
      const snapshot = snapshotResult.rows[0] ?? null;

      // ── The package this plan delivers ─────────────────────────────────
      // The package id is recorded in the FROZEN snapshot's metadata, so a plan
      // still names the package it was bought from even if the seller later
      // renames or retires it.
      const packageResult = snapshot?.package_id
        ? await query(
            `SELECT id, name, description, is_active
               FROM velrepeat_packages
              WHERE id = $1`,
            [snapshot.package_id],
          )
        : { rows: [] };
      const pkg = packageResult.rows[0] ?? null;

      // ── The package lines the customer will receive each cycle ─────────
      const itemsResult = await query(
        `SELECT p.name AS product_name, sh.name AS shop_name, pv.name AS variant_name,
                vi.quantity
           FROM velrepeat_items vi
           JOIN products p ON p.id = vi.product_id
           JOIN shops sh ON sh.id = vi.shop_id
           LEFT JOIN product_variants pv ON pv.id = vi.variant_id
          WHERE vi.plan_id = $1
          ORDER BY sh.name ASC, p.name ASC`,
        [planId],
      );

      // ── The cycle schedule ─────────────────────────────────────────────
      const cycles = await readPlanCycles(planId);
      const cycleIds = cycles.map((c) => c.id as string);

      // ── The orders those cycles produced, per shop ─────────────────────
      // `velrepeat_cycle_id` is the link, and the partial unique index on
      // `(velrepeat_cycle_id, shop_id)` is what makes "one order per shop per
      // cycle" true, so a multi-seller cycle legitimately returns several.
      const ordersByCycle = new Map<string, Array<Record<string, unknown>>>();
      if (cycleIds.length > 0) {
        const orderResult = await query(
          `SELECT o.id, o.velrepeat_cycle_id, o.order_number, o.status,
                  o.total_amount, o.currency, o.created_at,
                  sh.name AS shop_name, sh.slug AS shop_slug,
                  (SELECT status FROM shipments s
                    WHERE s.order_id = o.id ORDER BY s.created_at DESC LIMIT 1) AS shipping_status,
                  (SELECT tracking_number FROM shipments s
                    WHERE s.order_id = o.id AND s.tracking_number IS NOT NULL
                    ORDER BY s.created_at DESC LIMIT 1) AS tracking_number
             FROM orders o
             LEFT JOIN shops sh ON sh.id = o.shop_id
            WHERE o.velrepeat_cycle_id = ANY($1::uuid[])
            ORDER BY o.created_at ASC`,
          [cycleIds],
        );
        for (const row of orderResult.rows as Array<Record<string, unknown>>) {
          const key = String(row.velrepeat_cycle_id);
          const list = ordersByCycle.get(key) ?? [];
          list.push(row);
          ordersByCycle.set(key, list);
        }
      }

      // ── The payment, as the server records it ─────────────────────────
      // Deliberately NOT inferred from the browser: this is the row the
      // webhook writes, so the success page renders the truth.
      const paymentResult = await query(
        `SELECT id, status, method, amount, currency, paid_at, provider
           FROM payments
          WHERE plan_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [planId],
      );
      const payment = paymentResult.rows[0] ?? null;

      res.json({
        success: true,
        data: {
          plan: {
            id: plan.id,
            // The SERVER's status. `draft` here means the webhook has not
            // settled yet — the UI must keep waiting, never declare success.
            status: plan.status,
            frequencyType: plan.frequency_type,
            intervalValue: plan.interval_value,
            commitmentCycles: plan.commitment_cycles,
            nextRunAt: plan.next_run_at,
            startedAt: plan.started_at,
            endedAt: plan.ended_at,
            currency: plan.currency,
            paymentMethod: plan.payment_method,
            createdAt: plan.created_at,
            packageName: pkg?.name ?? null,
            cycleCount: plan.cycle_count,
            pendingCycleCount: plan.pending_cycle_count,
          },
          pricing: snapshot
            ? {
                currency: snapshot.currency,
                basePrice: snapshot.base_price,
                discountAmount: snapshot.discount_amount,
                // One delivery cycle …
                cyclePrice: snapshot.cycle_price,
                // … and the prepaid total for the whole commitment. They are
                // equal only when the commitment is a single cycle.
                totalPrepaidAmount: snapshot.total_amount,
                effectiveDiscountPercent: snapshot.effective_discount_percent,
              }
            : null,
          package: pkg
            ? {
                id: pkg.id,
                name: pkg.name,
                description: pkg.description ?? null,
              }
            : null,
          items: (itemsResult.rows as Array<Record<string, unknown>>).map((row) => ({
            productName: row.product_name,
            shopName: row.shop_name,
            variantName: row.variant_name ?? null,
            quantity: row.quantity,
          })),
          cycles: cycles.map((cycle) => ({
            id: cycle.id,
            cycleNumber: cycle.cycle_number,
            status: cycle.status,
            scheduledAt: cycle.scheduled_at,
            startedAt: cycle.started_at,
            completedAt: cycle.completed_at,
            // One entry per shop — a multi-seller cycle really does produce one
            // order per seller, and each carries its own fulfillment/tracking.
            orders: (ordersByCycle.get(String(cycle.id)) ?? []).map((o) => ({
              id: o.id,
              orderNumber: o.order_number ?? o.id,
              shopId: null,
              shopName: o.shop_name ?? null,
              shopSlug: o.shop_slug ?? null,
              status: o.status,
              totalAmount: o.total_amount,
              currency: o.currency,
              shippingStatus: o.shipping_status ?? null,
              trackingNumber: o.tracking_number ?? null,
            })),
          })),
          payment: payment
            ? {
                id: payment.id,
                status: payment.status,
                method: payment.method,
                amount: payment.amount,
                currency: payment.currency,
                paidAt: payment.paid_at,
                provider: payment.provider,
              }
            : null,
        },
      });
    } catch (err) {
      console.error("[velrepeat-v2] plan status error:", err instanceof Error ? err.message : "unknown");
      res.status(500).json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Could not load the plan" },
      });
    }
  });
}
