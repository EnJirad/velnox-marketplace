/**
 * MVP seller — application, status, and order fulfilment.
 *
 * Seller lifecycle (`seller_profiles.status`):
 *
 *     (no row) → pending → approved → suspended
 *                     ↘ rejected → pending (re-apply)
 *
 * Applying is open to any active account and always creates/returns `pending`;
 * only an admin can move a seller to `approved` (`admin.ts`). Every seller
 * OPERATION is gated by `requireApprovedSeller`, so `pending`, `rejected` and
 * `suspended` can read their own application but cannot create, edit, submit,
 * publish, price or restock anything.
 */
import type { Express, Request, Response } from "express";
import { query, withTransaction } from "../db/index.js";
import { writeMvpAudit } from "./audit.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  ok,
  optionalString,
  pathUuid,
  queryOne,
  requireActiveUser,
  requireApprovedSeller,
  requireString,
  route,
  type SellerProfile,
} from "./http.js";
import { generateSellerSlug } from "./product-rules.js";
import { setupMvpSellerProductRoutes } from "./seller-products.js";

const SELLER_STATUSES = ["pending", "approved", "rejected", "suspended"] as const;

function sellerOf(req: Request): SellerProfile {
  const seller = req.mvpSeller;
  if (!seller) throw forbidden("SELLER_NOT_APPROVED", "This action requires an approved seller account");
  return seller;
}

export function setupMvpSellerRoutes(app: Express): void {
  // ── Apply to sell ────────────────────────────────────────────────────────
  app.post(
    "/api/mvp/seller/apply",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const user = req.sessionUser!;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const storeName = requireString(body.storeName, "storeName", { min: 2, max: 120 });
      const description = optionalString(body.description, "description", { max: 2000 });

      const existing = await queryOne<SellerProfile>(
        `SELECT id, user_id, store_name, slug, status, rejection_reason, suspension_reason
           FROM seller_profiles WHERE user_id = $1`,
        [user.id],
      );

      if (existing) {
        if (existing.status === "rejected") {
          // A rejected application may be corrected and resubmitted. The slug is
          // kept: public URLs and the store name's history stay stable.
          const updated = await query(
            `UPDATE seller_profiles
                SET store_name = $2, description = COALESCE($3, description),
                    status = 'pending', rejection_reason = NULL, updated_at = NOW()
              WHERE user_id = $1 AND status = 'rejected'
              RETURNING id, user_id, store_name, slug, status, rejection_reason, suspension_reason`,
            [user.id, storeName, description],
          );
          if (updated.rowCount === 0) {
            throw conflict("APPLICATION_IN_PROGRESS", "This seller application cannot be resubmitted");
          }
          ok(res, { seller: updated.rows[0] });
          return;
        }
        throw conflict("APPLICATION_EXISTS", `A seller application already exists (${existing.status})`);
      }

      const inserted = await query(
        `INSERT INTO seller_profiles (user_id, store_name, slug, description, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING id, user_id, store_name, slug, status, rejection_reason, suspension_reason`,
        [user.id, storeName, generateSellerSlug(storeName), description],
      );
      const seller = inserted.rows[0] as SellerProfile;
      await writeMvpAudit(null, user.id, "SELLER_APPLIED", "seller_profile", seller.id, {
        storeName,
      });
      ok(res, { seller }, 201);
    }),
  );

  // ── Own application status ───────────────────────────────────────────────
  app.get(
    "/api/mvp/seller/status",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const user = req.sessionUser!;
      const seller = await queryOne<SellerProfile>(
        `SELECT id, user_id, store_name, slug, status, rejection_reason, suspension_reason, description
           FROM seller_profiles WHERE user_id = $1`,
        [user.id],
      );
      if (!seller) {
        ok(res, { seller: null, productCounts: {} });
        return;
      }
      const counts = await query(
        `SELECT status, COUNT(*)::int AS n FROM products WHERE seller_id = $1 GROUP BY status`,
        [seller.id],
      );
      const productCounts: Record<string, number> = {};
      for (const row of counts.rows as Array<{ status: string; n: number }>) {
        productCounts[row.status] = Number(row.n);
      }
      ok(res, { seller, productCounts });
    }),
  );

  // ── Update own store profile ──────────────────────────────────────────────
  app.patch(
    "/api/mvp/seller/profile",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const user = req.sessionUser!;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const storeName = requireString(body.storeName, "storeName", { min: 2, max: 120 });
      const description = optionalString(body.description, "description", { max: 2000 });

      // Only the caller's own row, and only while the store is not being
      // reviewed/suspended — an admin decides those states, not the seller.
      const updated = await query(
        `UPDATE seller_profiles
            SET store_name = $2,
                description = COALESCE($3, description),
                updated_at = NOW()
          WHERE user_id = $1 AND status IN ('pending', 'approved')
          RETURNING id, user_id, store_name, slug, status, rejection_reason, suspension_reason,
                    description`,
        [user.id, storeName, description],
      );
      if (updated.rowCount === 0) {
        throw forbidden("PROFILE_NOT_EDITABLE", "This store profile cannot be edited right now");
      }
      await writeMvpAudit(null, user.id, "SELLER_PROFILE_UPDATED", "seller_profile", (updated.rows[0] as { id: string }).id, {
        storeName,
      });
      ok(res, { seller: updated.rows[0] });
    }),
  );

  // ── Seller order list ────────────────────────────────────────────────────
  app.get(
    "/api/mvp/seller/orders",
    requireApprovedSeller,
    route(async (req: Request, res: Response) => {
      const seller = sellerOf(req);
      const status = optionalString(req.query.status, "status", { max: 30 });
      if (status && !(SELLER_STATUSES as readonly string[]).includes(status)) {
        // The filter is an order status, not a seller status: validate against
        // the order axis so a typo returns 400 instead of an empty page.
        const orderStatuses = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled"];
        if (!orderStatuses.includes(status)) {
          throw badRequest("INVALID_INPUT", "Unknown order status filter");
        }
      }
      const result = await query(
        `SELECT o.id, o.order_number, o.status, o.subtotal, o.shipping_fee, o.total_amount,
                o.currency, o.shipping_address, o.notes, o.created_at, o.paid_at,
                o.shipped_at, o.delivered_at, o.cancelled_at,
                u.name AS buyer_name,
                (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
                (SELECT p.status FROM payments p WHERE p.order_id = o.id
                  ORDER BY p.created_at DESC LIMIT 1) AS payment_status
           FROM orders o
           JOIN users u ON u.id = o.user_id
          WHERE o.seller_id = $1
            AND ($2::text IS NULL OR o.status = $2)
          ORDER BY o.created_at DESC
          LIMIT 200`,
        [seller.id, status],
      );
      ok(res, { orders: result.rows });
    }),
  );

  // ── Advance an order ─────────────────────────────────────────────────────
  // `pending_payment → cancelled` and payment settlement are NOT seller
  // actions: cancellation belongs to the buyer/expiry sweep, and only a signed
  // Stripe event may mark an order paid. A seller may only move a paid order
  // along its fulfilment path.
  app.patch(
    "/api/mvp/seller/orders/:id/status",
    requireApprovedSeller,
    route(async (req: Request, res: Response) => {
      const seller = sellerOf(req);
      const orderId = pathUuid(req.params.id);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const next = requireString(body.status, "status", { max: 30 });
      if (!["processing", "shipped", "delivered"].includes(next)) {
        throw badRequest(
          "INVALID_STATUS",
          "A seller may set 'processing', 'shipped' or 'delivered' only",
        );
      }
      const carrier = optionalString(body.carrier, "carrier", { max: 120 }) ?? "";
      const trackingNumber = optionalString(body.trackingNumber, "trackingNumber", { max: 120 });

      const updated = await withTransaction(async (client) => {
        const current = await client.query(
          `SELECT id, status FROM orders WHERE id = $1 AND seller_id = $2 FOR UPDATE`,
          [orderId, seller.id],
        );
        const row = current.rows[0] as { id: string; status: string } | undefined;
        if (!row) throw notFound("ORDER_NOT_FOUND", "Order not found");

        // Evidence columns required by the table's CHECKs are written in the SAME
        // statement as the status, and never overwritten once set.
        const result = await client.query(
          `UPDATE orders
              SET status = $2,
                  shipped_at = CASE WHEN $2 = 'shipped' THEN COALESCE(shipped_at, NOW()) ELSE shipped_at END,
                  delivered_at = CASE WHEN $2 = 'delivered' THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
                  updated_at = NOW()
            WHERE id = $1 AND seller_id = $3
            RETURNING id, order_number, status, shipped_at, delivered_at`,
          [orderId, next, seller.id],
        );

        if (next === "shipped") {
          await client.query(
            `INSERT INTO shipments (order_id, carrier, tracking_number, shipped_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (order_id) DO UPDATE
               SET carrier = CASE WHEN EXCLUDED.carrier <> '' THEN EXCLUDED.carrier ELSE shipments.carrier END,
                   tracking_number = COALESCE(EXCLUDED.tracking_number, shipments.tracking_number),
                   shipped_at = COALESCE(shipments.shipped_at, EXCLUDED.shipped_at),
                   updated_at = NOW()`,
            [orderId, carrier, trackingNumber],
          );
        }
        if (next === "delivered") {
          await client.query(
            `UPDATE shipments SET delivered_at = COALESCE(delivered_at, NOW()), updated_at = NOW()
              WHERE order_id = $1`,
            [orderId],
          );
        }

        await writeMvpAudit(client, seller.user_id, "ORDER_STATUS_UPDATED", "order", orderId, {
          from: row.status,
          to: next,
        });
        return result.rows[0];
      });

      ok(res, { order: updated });
    }),
  );

  // Seller product management shares the approved-seller gate.
  setupMvpSellerProductRoutes(app);
}
