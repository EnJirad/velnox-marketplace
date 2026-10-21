/**
 * MVP order reads and buyer cancellation.
 *
 * AUTHORIZATION ON EVERY READ. `loadOrderDetail` takes a viewer and filters in
 * SQL: a customer sees only their own orders, a seller only orders placed with
 * them, an admin sees everything. A caller asking for someone else's order gets
 * `null`, which the routes turn into 404 — not 403 — so an order id cannot be
 * used to probe for existence.
 *
 * Payments are exposed as status/amount/method/timestamps only. Provider ids,
 * metadata and failure messages stay server-side.
 */
import type { Express, Request, Response } from "express";
import { query, withTransaction } from "../db/index.js";
import { writeMvpAudit } from "./audit.js";
import { cancelUnpaidOrder } from "./checkout.js";
import { conflict, notFound, ok, pathUuid, requireActiveUser, route } from "./http.js";

export type OrderViewer =
  | { kind: "customer"; userId: string }
  | { kind: "seller"; sellerId: string }
  | { kind: "admin" };

export interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: string;
  shippingFee: string;
  totalAmount: string;
  currency: string;
  notes: string | null;
  shippingAddress: unknown;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  paymentExpiresAt: string | null;
  buyer: { name: string; email: string };
  seller: { id: string; storeName: string; slug: string };
  items: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  shipment: Record<string, unknown> | null;
}

export async function loadOrderDetail(
  orderId: string,
  viewer: OrderViewer,
): Promise<OrderDetail | null> {
  const params: unknown[] = [orderId];
  let scope = "TRUE";
  if (viewer.kind === "customer") {
    params.push(viewer.userId);
    scope = `o.user_id = $${params.length}`;
  } else if (viewer.kind === "seller") {
    params.push(viewer.sellerId);
    scope = `o.seller_id = $${params.length}`;
  }

  const result = await query(
    `SELECT o.id, o.order_number, o.status, o.subtotal, o.shipping_fee, o.total_amount,
            o.currency, o.notes, o.shipping_address, o.created_at, o.paid_at, o.shipped_at,
            o.delivered_at, o.cancelled_at, o.cancel_reason, o.payment_expires_at,
            u.name AS buyer_name, u.email AS buyer_email,
            sp.id AS seller_id, sp.store_name, sp.slug AS seller_slug
       FROM orders o
       JOIN users u ON u.id = o.user_id
       JOIN seller_profiles sp ON sp.id = o.seller_id
      WHERE o.id = $1 AND ${scope}`,
    params,
  );

  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  // The selling-unit columns are part of the immutable snapshot: the buyer (and
  // the seller) can always see WHICH pack was bought, what it contained and how
  // much stock it held, even after the seller renames or retires it.
  const items = await query(
    `SELECT id, product_id, variant_id, selling_unit_id, selling_unit_label,
            selling_unit_base_quantity, base_quantity_total,
            product_name, variant_name, image_url, unit_price, quantity, subtotal
       FROM order_items WHERE order_id = $1 ORDER BY created_at, id`,
    [orderId],
  );
  const payments = await query(
    `SELECT id, status, amount, currency, method, paid_at, created_at
       FROM payments WHERE order_id = $1 ORDER BY created_at DESC`,
    [orderId],
  );
  const shipment = await query(
    `SELECT carrier, tracking_number, shipped_at, delivered_at
       FROM shipments WHERE order_id = $1`,
    [orderId],
  );

  return {
    id: String(row.id),
    orderNumber: String(row.order_number),
    status: String(row.status),
    subtotal: String(row.subtotal),
    shippingFee: String(row.shipping_fee),
    totalAmount: String(row.total_amount),
    currency: String(row.currency),
    notes: (row.notes as string | null) ?? null,
    shippingAddress: row.shipping_address,
    createdAt: String(row.created_at),
    paidAt: (row.paid_at as string | null) ?? null,
    shippedAt: (row.shipped_at as string | null) ?? null,
    deliveredAt: (row.delivered_at as string | null) ?? null,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    cancelReason: (row.cancel_reason as string | null) ?? null,
    paymentExpiresAt: (row.payment_expires_at as string | null) ?? null,
    buyer: { name: String(row.buyer_name ?? ""), email: String(row.buyer_email ?? "") },
    seller: {
      id: String(row.seller_id),
      storeName: String(row.store_name),
      slug: String(row.seller_slug),
    },
    items: items.rows as Array<Record<string, unknown>>,
    payments: payments.rows as Array<Record<string, unknown>>,
    shipment: (shipment.rows[0] as Record<string, unknown> | undefined) ?? null,
  };
}

export function setupMvpOrderRoutes(app: Express): void {
  // ── My orders ────────────────────────────────────────────────────────────
  app.get(
    "/api/mvp/orders",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const userId = req.sessionUser!.id;
      const result = await query(
        `SELECT o.id, o.order_number, o.status, o.total_amount, o.currency, o.created_at,
                o.paid_at, o.cancelled_at, sp.store_name,
                (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count
           FROM orders o
           JOIN seller_profiles sp ON sp.id = o.seller_id
          WHERE o.user_id = $1
          ORDER BY o.created_at DESC
          LIMIT 200`,
        [userId],
      );
      ok(res, { orders: result.rows });
    }),
  );

  // ── One order ────────────────────────────────────────────────────────────
  app.get(
    "/api/mvp/orders/:id",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const user = req.sessionUser!;
      const orderId = pathUuid(req.params.id);
      const detail = await loadOrderDetail(orderId, { kind: "customer", userId: user.id });
      if (!detail) throw notFound("ORDER_NOT_FOUND", "Order not found");
      ok(res, { order: detail });
    }),
  );

  // ── Cancel an unpaid order ───────────────────────────────────────────────
  // Only `pending_payment` may be cancelled, and the stock it reserved is
  // released in the same transaction. A paid order is NOT cancellable here:
  // refunds are out of scope for this phase, so silently un-paying an order
  // would be worse than refusing.
  app.post(
    "/api/mvp/orders/:id/cancel",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const user = req.sessionUser!;
      const orderId = pathUuid(req.params.id);

      const outcome = await withTransaction(async (client) => {
        const owned = await client.query(
          `SELECT id, status FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [orderId, user.id],
        );
        const row = owned.rows[0] as { id: string; status: string } | undefined;
        if (!row) throw notFound("ORDER_NOT_FOUND", "Order not found");
        if (row.status === "cancelled") return "already_cancelled" as const;
        if (row.status !== "pending_payment") {
          throw conflict(
            "ORDER_NOT_CANCELLABLE",
            "Only an unpaid order can be cancelled; a paid order needs a refund flow",
          );
        }
        const cancelled = await cancelUnpaidOrder(client, orderId, "cancelled_by_customer");
        if (!cancelled) throw conflict("ORDER_NOT_CANCELLABLE", "This order cannot be cancelled");
        await writeMvpAudit(client, user.id, "ORDER_CANCELLED", "order", orderId, {
          by: "customer",
        });
        return "cancelled" as const;
      });

      const detail = await loadOrderDetail(orderId, { kind: "customer", userId: user.id });
      ok(res, { order: detail, outcome });
    }),
  );
}
