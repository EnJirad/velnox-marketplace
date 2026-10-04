/**
 * Velnox Seller Order Management Endpoints
 *
 * Customer order → seller receives order → seller views order → seller
 * updates order status. Multi-vendor safe: the checkout and VelRepeat
 * scheduler both create ONE order PER SHOP, so a seller's orders are the
 * orders containing items from that seller's shops. Every endpoint derives
 * the seller identity from the authenticated session (never from the
 * client), so sellerId spoofing is impossible.
 *
 * Endpoints:
 *   GET   /api/seller/orders              — seller's orders (paginated)
 *   GET   /api/seller/orders/:id          — seller's order detail (IDOR-safe)
 *   PATCH /api/seller/orders/:id/status   — transition order status (state machine)
 *   GET   /api/seller/subscriptions       — recurring VelRepeat plans for the seller
 *   POST  /api/subscriptions/process-due  — manually run the due-plan worker
 *
 * Authorization:
 *   - All endpoints require authentication (requireAuth).
 *   - The seller row is resolved from req.user.userId via sellers.user_id.
 *   - Only sellers with status 'approved' (or legacy 'active') may manage
 *     orders; anyone else gets 403.
 *   - Order access is scoped through order_items.shop_id → shops.seller_id,
 *     so a seller can never see or mutate another seller's order.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query, withTransaction } from "../db/index.js";
import { processPlan } from "../jobs/velrepeat-scheduler.js";
import { broadcast, CHANNELS } from "../realtime/index.js";
import {
  FULFILLMENT_STATUSES,
  FULFILLMENT_TRANSITIONS,
  FulfillmentError,
  assertNoSettledPaymentForCancellation,
  assertPaymentConfirmedForConfirmation,
  canTransitionFulfillment,
  ensureShipmentForShipping,
  isFulfillmentStatus,
  normalizeOrderStatusToFulfillment,
  type FulfillmentStatus,
} from "../lib/order-fulfillment.js";
import { releaseOrderInventory } from "../lib/inventory.js";

function param(req: Request, key: string): string {
  return (req.params as Record<string, string>)[key] ?? "";
}

// ─── Order fulfilment state machine ──────────────────────────────────────────
// The machine itself (statuses, transitions, the payment gate for a
// confirmation and the shipment gate for a dispatch) lives in
// `backend/lib/order-fulfillment.ts`, the ONE authority the seller route, the
// VelCenter route and their tests all read. These names are the seller-side view
// of it and are re-exported so the existing importers keep working; the seller UI
// mirrors the same table as NEXT_ORDER_STATUSES in
// packages/shared/src/lib/commerce.ts, so a button can never propose a move the
// API refuses.
export const SELLER_ORDER_STATUSES = FULFILLMENT_STATUSES;

export type SellerOrderStatus = FulfillmentStatus;

export const SELLER_ORDER_STATUS_TRANSITIONS = FULFILLMENT_TRANSITIONS;

export const isSellerOrderStatus = isFulfillmentStatus;

/** Whether an order may move from `from` to `to` under the business rules. */
export function canTransitionOrderStatus(from: string, to: string): boolean {
  return canTransitionFulfillment(from, to);
}

/**
 * Map a raw `orders.status` value to the seller-facing (fulfilment) status set.
 *
 * The Stripe flow writes its own lifecycle statuses ('pending_payment', 'paid',
 * 'payment_failed', 'refunded') that are NOT part of the fulfilment state
 * machine, so a raw value must be translated before it is displayed or
 * validated. `paid` is judged as `pending` because money is a SEPARATE axis
 * (the payment state lives in `payments`) — the fulfilment machine then decides
 * what the order may still do. `refunded` and `expired` are grouped with
 * `cancelled`: a full refund is terminal for the order, and an `expired` order's
 * reserved stock was already returned by the payment-reservation sweep, so
 * neither has anything left to fulfil.
 */
export const normalizeSellerOrderStatus = normalizeOrderStatusToFulfillment;

// ─── Subscription (VelRepeat plan) display mapping ───────────────────────────
// velrepeat_plans.status → the compact status the seller UI understands.
// Non-active plan states that can still recover (out_of_stock, payment_failed)
// display as paused so sellers see they are not auto-running.
export function mapPlanStatusToSubscriptionStatus(
  planStatus: string,
): "active" | "paused" | "cancelled" {
  if (planStatus === "active" || planStatus === "processing") return "active";
  if (planStatus === "cancelled" || planStatus === "completed") return "cancelled";
  return "paused"; // paused / payment_failed / out_of_stock / draft
}

/** velrepeat_plans.frequency_type → StoreSubscription.frequency. */
export function mapFrequencyType(frequencyType: string): "daily" | "weekly" | "monthly" | "custom" {
  if (frequencyType === "days") return "daily";
  if (frequencyType === "weeks") return "weekly";
  if (frequencyType === "months") return "monthly";
  return "custom";
}

// ─── HTTP error helper (used inside transactions where we must roll back) ────
class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the seller id for an authenticated user.
 * Never trusts a sellerId from the client — only the session.
 * Returns null when the user is not an approved seller.
 */
async function resolveApprovedSellerId(userId: string): Promise<string | null> {
  const res = await query(
    `SELECT id, status FROM sellers WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  const row = res.rows[0];
  if (!row) return null;
  // 'active' is tolerated for legacy rows; 011_seller_status_constraint
  // normalizes active → approved, but never trust a non-approved seller.
  if (row.status !== "approved" && row.status !== "active") return null;
  return row.id as string;
}

function parseShippingAddress(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A non-empty trimmed string, or null. */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The customer contact a SELLER sees for one order.
 *
 * The order's OWN snapshot (`orders.shipping_address.recipientName` / `.phone`)
 * wins over the account row. The seller uses these values to pack and hand the
 * parcel over, so they must be the details the customer entered FOR THIS ORDER:
 * if the customer later changes their phone or display name, an order placed
 * last week must still show the recipient and number it was placed with. The
 * account values remain as a fallback for legacy orders written before the
 * snapshot carried them — never as the source of truth.
 */
export function orderContact(
  address: Record<string, unknown> | null,
  account: { name?: string | null; phone?: string | null } | undefined,
): { name: string | null; phone: string | null } {
  return {
    name: text(address?.recipientName) ?? text(account?.name),
    phone: text(address?.phone) ?? text(account?.phone),
  };
}

/**
 * Load the seller's items for one or more orders. Only items belonging to
 * the seller's shops are returned — an order that also contains another
 * seller's items only exposes this seller's portion.
 */
export async function fetchSellerItemsForOrders(
  orderIds: string[],
  sellerId: string,
): Promise<Record<string, any[]>> {
  if (orderIds.length === 0) return {};

  const itemsRes = await query(
    `SELECT oi.id, oi.order_id, oi.product_id, oi.shop_id, oi.variant_id,
            oi.quantity, oi.price, oi.subtotal,
            COALESCE(NULLIF(oi.product_name_snapshot, ''), NULLIF(oi.product_name, ''), p.name, '') AS product_name,
            oi.variant_name_snapshot AS variant_name_snapshot,
            COALESCE(oi.image_url_snapshot,
                     (SELECT url FROM product_images WHERE product_id = oi.product_id ORDER BY sort_order ASC LIMIT 1)) AS image_url,
            p.unit AS unit, p.status AS product_status, sh.seller_id AS seller_id
     FROM order_items oi
     LEFT JOIN products p ON oi.product_id = p.id
     JOIN shops sh ON oi.shop_id = sh.id
     WHERE oi.order_id = ANY($1) AND sh.seller_id = $2
     ORDER BY oi.created_at ASC`,
    [orderIds, sellerId],
  );

  // Resolve current variant labels when the purchased snapshot is missing
  // (legacy orders created before snapshots were stored).
  const variantIds = [...new Set(itemsRes.rows.map((r: any) => r.variant_id).filter(Boolean))];
  const variantLabels = new Map<string, string>();
  if (variantIds.length > 0) {
    try {
      const varRes = await query(
        `SELECT pvv.variant_id,
                (SELECT string_agg(pov.label, ' / ' ORDER BY pog.sort_order)
                 FROM product_variant_values pvv2
                 JOIN product_option_values pov ON pvv2.option_value_id = pov.id
                 JOIN product_option_groups pog ON pov.option_group_id = pog.id
                 WHERE pvv2.variant_id = pvv.variant_id) AS option_labels
         FROM product_variant_values pvv
         WHERE pvv.variant_id = ANY($1)
         GROUP BY pvv.variant_id`,
        [variantIds],
      );
      for (const row of varRes.rows) {
        if (row.option_labels) variantLabels.set(row.variant_id, row.option_labels);
      }
    } catch {
      // Variant tables may not exist on legacy databases — snapshots cover most cases.
    }
  }

  const byOrder = new Map<string, any[]>();
  for (const r of itemsRes.rows) {
    const unitPrice = parseFloat(r.price) || 0;
    const item = {
      id: r.id,
      orderId: r.order_id,
      productId: r.product_id,
      shopId: r.shop_id,
      sellerId: r.seller_id,
      variantId: r.variant_id,
      productName: r.product_name || "สินค้า",
      unit: r.unit ?? "",
      unitPrice,
      price: unitPrice,
      quantity: r.quantity,
      subtotal: parseFloat(r.subtotal) || unitPrice * r.quantity,
      commissionRate: 0,
      variantName: r.variant_name_snapshot || variantLabels.get(r.variant_id) || null,
      imageUrl: r.image_url || null,
      productStatus: r.product_status,
    };
    const list = byOrder.get(r.order_id) ?? [];
    list.push(item);
    byOrder.set(r.order_id, list);
  }
  return Object.fromEntries(byOrder);
}

/** Load shipments + tracking events for an order (defensive for legacy DBs). */
async function fetchShipmentsForOrder(orderId: string): Promise<any[]> {
  const sRes = await query(
    `SELECT id, carrier, tracking_number, status, estimated_delivery_date
     FROM shipments WHERE order_id = $1 ORDER BY created_at DESC`,
    [orderId],
  );
  const shipments = sRes.rows.map((r: any) => ({
    id: r.id,
    carrier: r.carrier,
    trackingNumber: r.tracking_number,
    status: r.status,
    estimatedDeliveryDate: r.estimated_delivery_date,
    events: [] as any[],
  }));
  if (shipments.length === 0) return shipments;
  try {
    const eventsRes = await query(
      `SELECT te.id, te.shipment_id, te.status, te.description, te.location, te.occurred_at
       FROM tracking_events te
       WHERE te.shipment_id = ANY($1)
       ORDER BY te.occurred_at ASC`,
      [shipments.map((s) => s.id)],
    );
    const byShipment = new Map<string, any[]>();
    for (const e of eventsRes.rows) {
      const list = byShipment.get(e.shipment_id) ?? [];
      list.push({
        id: e.id,
        status: e.status,
        description: e.description,
        location: e.location,
        occurredAt: e.occurred_at,
      });
      byShipment.set(e.shipment_id, list);
    }
    for (const s of shipments) s.events = byShipment.get(s.id) ?? [];
  } catch {
    // tracking_events may not exist on legacy databases.
  }
  return shipments;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export function setupSellerOrderRoutes(app: Express): void {
  // ── GET /api/seller/orders ───────────────────────────────────────────────
  // Seller's orders (paginated, stable ordering, seller-scoped).
  // Only orders containing products from the authenticated seller's shops
  // are returned; totals/items are limited to that seller's portion.
  app.get("/api/seller/orders", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerId = await resolveApprovedSellerId(req.user!.userId);
      if (!sellerId) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
      // Also accept page/pageSize for conventional pagination.
      const page = Math.max(parseInt(req.query.page as string) || 1, 1);
      const pageSize = Math.min(Math.max(parseInt(req.query.pageSize as string) || limit, 1), 100);
      const finalLimit = pageSize;
      const finalOffset = page > 1 ? (page - 1) * pageSize : offset;

      const statusFilter = req.query.status as string | undefined;

      let whereSql = "WHERE sh.seller_id = $1";
      const whereParams: unknown[] = [sellerId];
      if (statusFilter && isSellerOrderStatus(statusFilter)) {
        whereSql += " AND o.status = $2";
        whereParams.push(statusFilter);
      }

      const countRes = await query(
        `SELECT COUNT(DISTINCT o.id)::int AS count
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN shops sh ON oi.shop_id = sh.id
         ${whereSql}`,
        whereParams,
      );
      const total = countRes.rows[0]?.count ?? 0;

      const orderRes = await query(
        `SELECT DISTINCT o.id, o.user_id, o.order_number, o.status, o.subtotal,
                o.shipping_fee, o.discount, o.total_amount, o.currency,
                o.shipping_address, o.notes, o.created_at, o.updated_at,
                o.checkout_group_id,
                sh.name AS shop_name, sh.slug AS shop_slug,
                COALESCE((SELECT status FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1), 'unpaid') AS payment_status,
                COALESCE((SELECT status FROM shipments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1), 'none') AS shipping_status
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN shops sh ON oi.shop_id = sh.id
         ${whereSql}
         ORDER BY o.created_at DESC
         LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`,
        [...whereParams, finalLimit, finalOffset],
      );

      const rows = orderRes.rows;
      const orderIds = rows.map((r: any) => r.id as string);
      const itemsByOrder = await fetchSellerItemsForOrders(orderIds, sellerId);

      // Batch customer info (name/phone are already visible on orders via the
      // shipping snapshot; returning the account name/phone is what the seller
      // UI already renders today).
      const userIds = [...new Set(rows.map((r: any) => r.user_id).filter(Boolean))];
      const customers = new Map<string, { name: string | null; phone: string | null }>();
      if (userIds.length > 0) {
        const uRes = await query(
          `SELECT id, name, phone FROM users WHERE id = ANY($1)`,
          [userIds],
        );
        for (const u of uRes.rows) customers.set(u.id, { name: u.name, phone: u.phone });
      }

      const orders = rows.map((r: any) => {
        const items = itemsByOrder[r.id] ?? [];
        const customer = customers.get(r.user_id);
        const addressSnapshot = parseShippingAddress(r.shipping_address);
        // The order's snapshot decides the contact shown to the seller — see
        // `orderContact()`. `orders.shipping_address` is selected above.
        const contact = orderContact(addressSnapshot, customer);
        return {
          id: r.id,
          orderNumber: r.order_number || r.id,
          // The purchase this order belongs to. It is an IDENTIFIER only: the
          // seller list is already scoped to this seller's own shop_id, so a
          // group id never exposes another seller's order — it only lets the
          // seller UI say "part of the same purchase".
          checkoutGroupId: r.checkout_group_id ?? null,
          parentOrderId: r.id,
          customerUserId: r.user_id,
          status: normalizeSellerOrderStatus(r.status),
          paymentStatus: r.payment_status,
          shippingStatus: r.shipping_status,
          shippingMethod: null,
          trackingNumber: null,
          subtotal: parseFloat(r.subtotal) || 0,
          discount: parseFloat(r.discount) || 0,
          shippingFee: parseFloat(r.shipping_fee) || 0,
          total: parseFloat(r.total_amount) || 0,
          currency: r.currency ?? "THB",
          addressSnapshot,
          note: r.notes,
          shopId: r.shop_id,
          shopName: r.shop_name,
          shopSlug: r.shop_slug,
          customerName: contact.name,
          customerPhone: contact.phone,
          createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
          items,
          itemCount: items.reduce((s: number, i: any) => s + i.quantity, 0),
        };
      });

      res.json({ success: true, data: orders });
    } catch (err) {
      console.error("[seller-orders] list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch seller orders" } });
    }
  });

  // ── GET /api/seller/orders/:id ───────────────────────────────────────────
  // Seller order detail — ownership verified, IDOR-safe. Only the seller's
  // items are returned; another seller's portion of the order is never exposed.
  app.get("/api/seller/orders/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerId = await resolveApprovedSellerId(req.user!.userId);
      if (!sellerId) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }
      const orderId = param(req, "id");

      const orderRes = await query(
        `SELECT DISTINCT o.*, sh.name AS shop_name, sh.slug AS shop_slug,
                COALESCE((SELECT status FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1), 'unpaid') AS payment_status,
                COALESCE((SELECT status FROM shipments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1), 'none') AS shipping_status
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN shops sh ON oi.shop_id = sh.id
         WHERE o.id = $1 AND sh.seller_id = $2`,
        [orderId, sellerId],
      );
      if (orderRes.rows.length === 0) {
        // Same response for unknown/foreign orders — never leak existence.
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Order not found" } });
        return;
      }
      const order = orderRes.rows[0];

      const [itemsByOrder, shipments, paymentsRes, customerRes] = await Promise.all([
        fetchSellerItemsForOrders([orderId], sellerId),
        fetchShipmentsForOrder(orderId),
        query(
          `SELECT id, method, status, amount, provider FROM payments
           WHERE order_id = $1 ORDER BY created_at DESC`,
          [orderId],
        ),
        query(`SELECT name, phone FROM users WHERE id = $1`, [order.user_id]),
      ]);
      const items = itemsByOrder[orderId] ?? [];
      const customer = customerRes.rows[0];
      const addressSnapshot = parseShippingAddress(order.shipping_address);
      // Same rule as the list: the order's snapshot is the recipient the seller
      // must actually ship to, and it never follows a later profile edit.
      const contact = orderContact(addressSnapshot, customer);

      res.json({
        success: true,
        data: {
          id: order.id,
          orderNumber: order.order_number || order.id,
          parentOrderId: order.id,
          customerUserId: order.user_id,
          status: normalizeSellerOrderStatus(order.status),
          paymentStatus: order.payment_status,
          shippingStatus: order.shipping_status,
          shippingMethod: null,
          trackingNumber: shipments[0]?.trackingNumber ?? null,
          subtotal: parseFloat(order.subtotal) || 0,
          discount: parseFloat(order.discount) || 0,
          shippingFee: parseFloat(order.shipping_fee) || 0,
          total: parseFloat(order.total_amount) || 0,
          currency: order.currency ?? "THB",
          addressSnapshot,
          note: order.notes,
          shopId: order.shop_id,
          shopName: order.shop_name,
          shopSlug: order.shop_slug,
          customerName: contact.name,
          customerPhone: contact.phone,
          createdAt: order.created_at ? new Date(order.created_at).getTime() : Date.now(),
          updatedAt: order.updated_at ? new Date(order.updated_at).getTime() : Date.now(),
          items,
          itemCount: items.reduce((s: number, i: any) => s + i.quantity, 0),
          shipments,
          payments: paymentsRes.rows.map((p: any) => ({
            id: p.id,
            method: p.method,
            status: p.status,
            amount: parseFloat(p.amount) || 0,
          })),
        },
      });
    } catch (err) {
      console.error("[seller-orders] detail error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch order" } });
    }
  });

  // ── PATCH /api/seller/orders/:id/status ──────────────────────────────────
  // Transition an order status. The backend enforces the state machine; the
  // seller must own (at least one item of) the order. Cancelling restores
  // that seller's stock inside the same transaction.
  //
  // Two extra gates ride on top of the transition table, both inside the same
  // transaction and both after the order row is locked:
  //   • `confirmed` requires the payment to be SETTLED (a `paid` payment row,
  //     written by the Stripe webhook — a seller can never mark an order paid),
  //     so an unpaid Card/PromptPay order cannot enter fulfilment. COD only
  //     passes while its (disabled-by-default) rail is actually enabled.
  //   • `shipped` requires a real shipment: the request may carry
  //     `carrier` + `trackingNumber` (which are written to `shipments` here),
  //     otherwise the order must already have one with both values. `shipped`
  //     is never a placeholder.
  //   • `cancelled` requires that the money has NOT settled: a `paid` order (or
  //     one with a payment in flight) is refused with 409 `ORDER_ALREADY_PAID` /
  //     `PAYMENT_IN_PROGRESS` — the same refusal the customer's own cancel gives
  //     — because a refund is an operator flow, not a status change.
  //   • `packing` → `cancelled` is not in the table at all: once fulfilment has
  //     started neither side may cancel.
  app.patch("/api/seller/orders/:id/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerId = await resolveApprovedSellerId(req.user!.userId);
      if (!sellerId) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }
      const orderId = param(req, "id");
      const status = req.body?.status;
      const carrier = req.body?.carrier;
      const trackingNumber = req.body?.trackingNumber;

      if (!isSellerOrderStatus(status)) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_STATUS",
            message: `Invalid status. Must be one of: ${SELLER_ORDER_STATUSES.join(", ")}`,
          },
        });
        return;
      }

      // Captured inside the transaction so the broadcast after COMMIT can
      // report the real previous status without a second read.
      let previousStatus = "";
      try {
        await withTransaction(async (client) => {
          // Lock the order row; re-check ownership inside the transaction.
          const orderRes = await client.query(
            `SELECT o.id, o.status, o.user_id, o.order_number
             FROM orders o WHERE o.id = $1 FOR UPDATE`,
            [orderId],
          );
          if (orderRes.rows.length === 0) {
            throw new HttpError(404, "NOT_FOUND", "Order not found");
          }
          const order = orderRes.rows[0];

          const ownRes = await client.query(
            `SELECT oi.id FROM order_items oi
             JOIN shops sh ON oi.shop_id = sh.id
             WHERE oi.order_id = $1 AND sh.seller_id = $2
             LIMIT 1`,
            [orderId, sellerId],
          );
          if (ownRes.rows.length === 0) {
            throw new HttpError(404, "NOT_FOUND", "Order not found");
          }

          // Normalize the raw DB status before validating the transition so
          // Stripe lifecycle statuses ('paid', 'pending_payment', ...) are
          // judged by their fulfillment meaning, not their raw value.
          const fromStatus = normalizeSellerOrderStatus(order.status);
          previousStatus = fromStatus;
          if (!canTransitionOrderStatus(fromStatus, status)) {
            throw new HttpError(
              400,
              "INVALID_TRANSITION",
              `Cannot change order from '${fromStatus}' to '${status}'`,
            );
          }

          // Payment is a SEPARATE axis from fulfilment, but it gates the move
          // that starts fulfilment: an order may only be confirmed once money
          // has actually moved (or, only while the COD rail is on, when the
          // order's own rail is COD).
          if (status === "confirmed") {
            await assertPaymentConfirmedForConfirmation(client, orderId);
          }

          // `shipped` means the parcel exists: it requires a shipment carrying
          // a carrier and a tracking number, created here in the SAME
          // transaction as the status change.
          if (status === "shipped") {
            await ensureShipmentForShipping(client, orderId, { carrier, trackingNumber });
          }

          // Money outranks a cancellation, exactly as it outranks the
          // customer's own: a `paid` order (raw `paid` normalizes to `pending`,
          // which HAS an edge to `cancelled`) may not be cancelled here. Without
          // this the order would be marked `cancelled` while the release
          // authority below quietly keeps the money and the committed stock —
          // the customer is left with neither the goods nor their money. The
          // only safe outcome is a refund, which is an operator flow.
          if (status === "cancelled") {
            await assertNoSettledPaymentForCancellation(client, orderId);
          }

          await client.query(
            `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
            [status, orderId],
          );

          // Cancellation restores the seller's stock — through the ONE release
          // authority (lib/inventory.ts), never inline. The status change above
          // already committed, so the `inventory_released` claim can win exactly
          // once here, and a concurrent webhook, sweep or customer cancel can
          // never restore the same units a second time. Reaching it at all means
          // the settled-payment gate above already passed, and the authority
          // re-checks the same set, so a `paid` order never loses its stock.
          if (status === "cancelled") {
            await releaseOrderInventory(client, orderId);
          }
        });
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
          return;
        }
        // A refused payment/shipment gate answers with its own code so the
        // seller UI can say WHY (pay first / add a tracking number) instead of
        // showing a generic failure.
        if (err instanceof FulfillmentError) {
          res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
          return;
        }
        throw err;
      }

      // Publish the transition on the ONE order channel so every other open
      // session follows it (VelCenter orders tab, the buyer's order list) —
      // this route previously reached them only through its audit event.
      try {
        broadcast(CHANNELS.ORDER_UPDATED, "order:updated", {
          orderId,
          from: previousStatus,
          to: status,
        });
      } catch { /* best-effort — a committed transition never fails on a socket error */ }

      res.json({ success: true, data: { id: orderId, status } });
    } catch (err) {
      console.error("[seller-orders] status update error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update order status" } });
    }
  });

  // ── GET /api/seller/subscriptions ────────────────────────────────────────
  // Recurring VelRepeat plans that include this seller's products. Reuses the
  // V2 velrepeat_plans/velrepeat_items tables (the real recurring engine) —
  // no duplicate subscription tables.
  app.get("/api/seller/subscriptions", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerRes = await query(
        `SELECT id, status FROM sellers WHERE user_id = $1 LIMIT 1`,
        [req.user!.userId],
      );
      const seller = sellerRes.rows[0];
      if (!seller || (seller.status !== "approved" && seller.status !== "active")) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }
      const sellerId = seller.id as string;

      const result = await query(
        `SELECT vp.id AS plan_id, vp.user_id, vp.status AS plan_status,
                vp.frequency_type, vp.interval_value, vp.next_run_at,
                vp.created_at, vp.updated_at, vp.timezone,
                vi.product_id, vi.shop_id, vi.seller_id, vi.quantity, vi.unit_price,
                p.name AS product_name,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url,
                u.name AS customer_name, u.email AS customer_email,
                to_char(vp.next_run_at AT TIME ZONE COALESCE(vp.timezone, 'Asia/Bangkok'), 'YYYY-MM-DD') AS next_order_date
         FROM velrepeat_plans vp
         JOIN velrepeat_items vi ON vi.plan_id = vp.id
         JOIN products p ON vi.product_id = p.id
         JOIN users u ON vp.user_id = u.id
         WHERE vi.seller_id = $1
           AND vp.status IN ('active', 'paused', 'processing', 'payment_failed',
                             'out_of_stock', 'cancelled', 'completed')
         ORDER BY vp.next_run_at ASC`,
        [sellerId],
      );

      const subscriptions = result.rows.map((r: any) => {
        const status = mapPlanStatusToSubscriptionStatus(r.plan_status as string);
        const frequency = mapFrequencyType(r.frequency_type as string);

        return {
          id: r.plan_id,
          customerUserId: r.user_id,
          productId: r.product_id,
          shopId: r.shop_id,
          sellerId: r.seller_id,
          quantity: r.quantity,
          unitPriceSnapshot: parseFloat(r.unit_price) || 0,
          frequency,
          intervalDays: r.interval_value,
          // Date-only value in the plan's own timezone (to_char above) — the
          // UI appends T00:00:00 when comparing, so a timezone-shifted date
          // would be off by one day. Fall back to UTC slice for legacy rows.
          nextOrderDate: r.next_order_date
            ? String(r.next_order_date)
            : r.next_run_at
              ? String(
                  (r.next_run_at instanceof Date ? r.next_run_at : new Date(r.next_run_at))
                    .toISOString()
                    .slice(0, 10),
                )
              : null,
          status,
          productName: r.product_name ?? null,
          productImageUrl: r.product_image_url ?? null,
          customerName: r.customer_name ?? null,
          customerEmail: r.customer_email ?? null,
          createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
        };
      });

      res.json({ success: true, data: subscriptions });
    } catch (err: any) {
      // velrepeat_plans may not exist on legacy databases — treat as empty.
      if (err?.code === "42P01" || String(err?.message ?? "").includes("does not exist")) {
        console.warn("[seller-orders] velrepeat_plans table not found — returning empty subscriptions");
        res.json({ success: true, data: [] });
        return;
      }
      console.error("[seller-orders] subscriptions error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch subscriptions" } });
    }
  });

  // ── POST /api/subscriptions/process-due ───────────────────────────────────
  // Force-run the due-plan worker (the same engine the VelRepeat scheduler
  // polls) — for THIS SELLER's plans only. Reuses processPlan from
  // jobs/velrepeat-scheduler.ts — one order per shop, idempotent runs, no
  // duplicate subscription systems.
  //
  // OWNERSHIP (owner decision, 2026-09-30 — contract §35): the CENTRAL
  // SCHEDULER owns global due-plan processing. A seller must never trigger a
  // customer's plan that is not theirs. The selection below is therefore scoped
  // with the SAME ownership predicate the read path already uses
  // (`GET /api/seller/subscriptions`, `WHERE vi.seller_id = $1`): a plan is
  // only eligible when at least one of its items belongs to the calling
  // seller. Before this change the query had no user scope at all, so any
  // approved seller could force-run any customer's due plans — a cross-tenant
  // side-effect trigger.
  app.post("/api/subscriptions/process-due", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerRes = await query(
        `SELECT id, status FROM sellers WHERE user_id = $1 LIMIT 1`,
        [req.user!.userId],
      );
      const seller = sellerRes.rows[0];
      if (!seller || (seller.status !== "approved" && seller.status !== "active")) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }

      const limit = Math.min(Math.max(parseInt(req.body?.limit as string) || 25, 1), 100);
      const due = await query(
        `SELECT vp.id FROM velrepeat_plans vp
         WHERE vp.status = 'active' AND vp.next_run_at <= NOW()
           AND EXISTS (
             SELECT 1 FROM velrepeat_items vi
              WHERE vi.plan_id = vp.id AND vi.seller_id = $1
           )
         ORDER BY vp.next_run_at ASC
         LIMIT $2`,
        [seller.id, limit],
      );

      let created = 0;
      let skipped = 0;
      for (const row of due.rows) {
        try {
          const outcome = await processPlan(row.id as string);
          if (outcome === null) skipped++; // claimed by a concurrent worker
          else if (outcome === "success") created++;
          else skipped++; // out_of_stock / item_unavailable / payment_failed / failed
        } catch (err) {
          console.error(`[seller-orders] process-due plan ${row.id} failed:`, err);
          skipped++;
        }
      }

      res.json({ success: true, data: { created, skipped, due: due.rows.length } });
    } catch (err: any) {
      if (err?.code === "42P01" || String(err?.message ?? "").includes("does not exist")) {
        console.warn("[seller-orders] velrepeat_plans table not found — nothing to process");
        res.json({ success: true, data: { created: 0, skipped: 0, due: 0 } });
        return;
      }
      console.error("[seller-orders] process-due error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to process due subscriptions" } });
    }
  });
}